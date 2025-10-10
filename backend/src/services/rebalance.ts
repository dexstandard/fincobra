import type { FastifyBaseLogger } from 'fastify';
import { insertLimitOrder } from '../repos/limit-orders.js';
import { LimitOrderStatus } from '../repos/limit-orders.types.js';
import type { MainTraderOrder } from '../agents/main-trader.types.js';
import { parseBinanceError } from './binance-client.js';
import { getExchangeGateway, type SupportedExchange } from './exchange-gateway.js';
import { TOKEN_SYMBOLS } from '../util/tokens.js';

interface CreateDecisionLimitOrdersResult {
  placed: number;
  canceled: number;
  priceDivergenceCancellations: number;
  needsPriceDivergenceRetry: boolean;
}

const TOKEN_SYMBOLS_BY_LENGTH = [...TOKEN_SYMBOLS].sort(
  (a, b) => b.length - a.length,
);
const TOKEN_SYMBOL_SET = new Set(TOKEN_SYMBOLS);

function splitPair(pair: string): [string, string] {
  const normalized = pair.toUpperCase();
  for (const sym of TOKEN_SYMBOLS_BY_LENGTH) {
    if (!normalized.startsWith(sym)) continue;
    const rest = normalized.slice(sym.length);
    if (TOKEN_SYMBOL_SET.has(rest)) return [sym, rest];
  }
  return ['', ''];
}

const MIN_MAX_PRICE_DRIFT = 0.0001;
const NOMINAL_BUFFER_RATIO = 1.0001;

interface NominalAdjustmentOptions {
  price: number;
  precision: number;
  targetNominal: number;
}

function extractLeadingDigit(
  value: number,
): { exponent: number; digit: number } | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const scientific = value.toExponential();
  const [coeff, exponentPart] = scientific.split('e');
  if (coeff === undefined || exponentPart === undefined) return null;
  const exponent = Number(exponentPart);
  if (!Number.isFinite(exponent)) return null;
  const normalizedCoeff = coeff.replace('.', '').replace('-', '');
  if (!normalizedCoeff) return null;
  const digit = Number(normalizedCoeff[0]);
  if (!Number.isFinite(digit)) return null;
  return { exponent, digit };
}

function matchesTruncatedPrefix(requested: number, target: number): boolean {
  const requestedLeading = extractLeadingDigit(requested);
  const targetLeading = extractLeadingDigit(target);
  if (!requestedLeading || !targetLeading) return false;
  return (
    requestedLeading.digit === targetLeading.digit &&
    requestedLeading.exponent === targetLeading.exponent
  );
}

function adjustLimitPrice(
  requested: number,
  current: number,
  side: 'BUY' | 'SELL',
): number {
  const anchor = side === 'BUY' ? current * 0.999 : current * 1.001;
  return side === 'BUY'
    ? Math.min(requested, anchor)
    : Math.max(requested, anchor);
}

function roundLimitPrice(
  price: number,
  precision: number,
  side: 'BUY' | 'SELL',
): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const factor = 10 ** precision;
  if (!Number.isFinite(factor) || factor <= 0) return 0;
  if (side === 'BUY') {
    const floored = Math.floor(price * factor);
    const adjusted = floored <= 0 ? 1 : floored;
    return adjusted / factor;
  }
  const ceiled = Math.ceil(price * factor);
  const adjusted = ceiled <= 0 ? 1 : ceiled;
  return adjusted / factor;
}

function increaseQuantityToMeetNominal({
  price,
  precision,
  targetNominal,
}: NominalAdjustmentOptions): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(targetNominal) || targetNominal <= 0) return null;
  const factor = 10 ** precision;
  if (!Number.isFinite(factor) || factor <= 0) return null;
  const requiredQty = Math.ceil((targetNominal / price) * factor) / factor;
  if (!Number.isFinite(requiredQty) || requiredQty <= 0) return null;
  const adjusted = Number(requiredQty.toFixed(precision));
  if (!Number.isFinite(adjusted) || adjusted <= 0) return null;
  return adjusted;
}

function meetsMinNotional(value: number, minNotional: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(minNotional)) return false;
  const tolerance =
    Math.max(Math.abs(value), Math.abs(minNotional), 1) * Number.EPSILON;
  return value + tolerance >= minNotional;
}

export async function createDecisionLimitOrders(opts: {
  userId: string;
  orders: (MainTraderOrder & { manuallyEdited?: boolean })[];
  reviewResultId: string;
  log: FastifyBaseLogger;
  exchange: SupportedExchange;
}): Promise<CreateDecisionLimitOrdersResult> {
  const result: CreateDecisionLimitOrdersResult = {
    placed: 0,
    canceled: 0,
    priceDivergenceCancellations: 0,
    needsPriceDivergenceRetry: false,
  };
  const gateway = getExchangeGateway(opts.exchange);
  const spot = gateway.spot;
  if (!spot) {
    throw new Error(`spot trading is not supported on ${opts.exchange}`);
  }
  for (const o of opts.orders) {
    const [a, b] = splitPair(o.pair);
    if (!a || !b) continue;
    const market = await gateway.metadata.fetchMarket(a, b);
    const ticker = await gateway.metadata.fetchTicker(market.symbol);
    const currentPrice = ticker.price;
    const requestedSide = o.side;
    const requestedToken =
      typeof o.token === 'string' ? o.token.toUpperCase() : '';
    const manuallyEdited = o.manuallyEdited ?? false;
    const plannedBase: Record<string, unknown> = {
      symbol: market.symbol,
      pair: o.pair,
      token: requestedToken || o.token,
      side: requestedSide,
      manuallyEdited,
      exchange: opts.exchange,
      basePrice: o.basePrice,
      limitPrice: o.limitPrice,
      maxPriceDriftPct: o.maxPriceDriftPct,
      requestedQty: o.qty,
      observedPrice: currentPrice,
    };

    if (requestedSide !== 'BUY' && requestedSide !== 'SELL') {
      await insertLimitOrder({
        userId: opts.userId,
      planned: plannedBase,
      status: LimitOrderStatus.Canceled,
      reviewResultId: opts.reviewResultId,
      orderId: String(Date.now()),
      cancellationReason: `Invalid order side: ${requestedSide}`,
      });
      result.canceled += 1;
      continue;
    }

    const side: 'BUY' | 'SELL' = requestedSide;

    if (!Number.isFinite(o.qty) || o.qty <= 0) {
      await insertLimitOrder({
        userId: opts.userId,
        planned: plannedBase,
        status: LimitOrderStatus.Canceled,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: `Malformed qty: ${o.qty}`,
      });
      result.canceled += 1;
      continue;
    }

    if (!Number.isFinite(o.basePrice) || o.basePrice <= 0) {
      await insertLimitOrder({
        userId: opts.userId,
        planned: plannedBase,
        status: LimitOrderStatus.Canceled,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: `Malformed basePrice: ${o.basePrice}`,
      });
      result.canceled += 1;
      continue;
    }

    if (!Number.isFinite(o.limitPrice) || o.limitPrice <= 0) {
      await insertLimitOrder({
        userId: opts.userId,
        planned: plannedBase,
        status: LimitOrderStatus.Canceled,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: `Malformed limitPrice: ${o.limitPrice}`,
      });
      result.canceled += 1;
      continue;
    }

    if (
      !Number.isFinite(o.maxPriceDriftPct) ||
      o.maxPriceDriftPct < MIN_MAX_PRICE_DRIFT
    ) {
      await insertLimitOrder({
        userId: opts.userId,
        planned: plannedBase,
        status: LimitOrderStatus.Canceled,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: `Malformed maxPriceDriftPct: ${o.maxPriceDriftPct}`,
      });
      result.canceled += 1;
      continue;
    }

    const basePrice = o.basePrice;
    const requestedLimitPrice = o.limitPrice;
    const divergenceLimit = o.maxPriceDriftPct;
    const divergence = Math.abs(currentPrice - basePrice) / basePrice;
    if (divergence > divergenceLimit) {
      await insertLimitOrder({
        userId: opts.userId,
        planned: {
          ...plannedBase,
          basePrice,
          limitPrice: requestedLimitPrice,
          maxPriceDriftPct: divergenceLimit,
        },
        status: LimitOrderStatus.Canceled,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: 'price divergence too high',
      });
      result.canceled += 1;
      result.priceDivergenceCancellations += 1;
      continue;
    }

    const adjustedLimit = adjustLimitPrice(
      requestedLimitPrice,
      currentPrice,
      side,
    );
    const roundedLimit = roundLimitPrice(
      adjustedLimit,
      market.pricePrecision,
      side,
    );
    if (!Number.isFinite(roundedLimit) || roundedLimit <= 0) {
      await insertLimitOrder({
        userId: opts.userId,
        planned: {
          ...plannedBase,
          basePrice,
          limitPrice: adjustedLimit,
          maxPriceDriftPct: divergenceLimit,
        },
        status: LimitOrderStatus.Canceled,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: `Malformed adjusted limitPrice: ${adjustedLimit}`,
      });
      result.canceled += 1;
      continue;
    }

    let quantity: number;
    if (requestedToken === market.baseAsset) {
      quantity = o.qty;
    } else if (requestedToken === market.quoteAsset) {
      quantity = o.qty / roundedLimit;
    } else {
      continue;
    }
    const rawQty = quantity;
    let qty = Number(rawQty.toFixed(market.quantityPrecision));
    const freshNominal = rawQty * roundedLimit;
    const roundedNominal = qty * roundedLimit;
    const meetsRoundedNominal = meetsMinNotional(
      roundedNominal,
      market.minNotional,
    );
    if (!meetsRoundedNominal && market.minNotional > 0) {
      let minForRequestedToken: number | null = null;
      if (o.token === market.baseAsset) {
        minForRequestedToken =
          Number.isFinite(roundedLimit) && roundedLimit > 0
            ? market.minNotional / roundedLimit
            : null;
      } else if (o.token === market.quoteAsset) {
        minForRequestedToken = market.minNotional;
      }

      if (
        minForRequestedToken !== null &&
        minForRequestedToken > 0 &&
        matchesTruncatedPrefix(o.qty, minForRequestedToken)
      ) {
        const targetNominal =
          Math.max(freshNominal, market.minNotional) * NOMINAL_BUFFER_RATIO;
        const adjustedQty = increaseQuantityToMeetNominal({
          price: roundedLimit,
          precision: market.quantityPrecision,
          targetNominal,
        });
        if (adjustedQty !== null && adjustedQty > qty) {
          qty = adjustedQty;
        }
      }
    }
    const nominalValue = qty * roundedLimit;
    const params = {
      symbol: market.symbol,
      side,
      quantity: qty,
      limitPrice: roundedLimit,
    } as const;
    const planned = {
      ...plannedBase,
      exchange: opts.exchange,
      qty,
      price: roundedLimit,
      basePrice,
      limitPrice: roundedLimit,
      maxPriceDriftPct: divergenceLimit,
    };

    if (!meetsMinNotional(nominalValue, market.minNotional)) {
      await insertLimitOrder({
        userId: opts.userId,
        planned,
        status: LimitOrderStatus.Canceled,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: 'order below min notional',
      });
      result.canceled += 1;
      continue;
    }

    try {
      const res = await spot.placeLimitOrder(opts.userId, {
        symbol: params.symbol,
        side: params.side,
        quantity: params.quantity,
        limitPrice: params.limitPrice,
      });
      if (!res || res.orderId === undefined || res.orderId === null) {
        await insertLimitOrder({
          userId: opts.userId,
          planned,
          status: LimitOrderStatus.Canceled,
          reviewResultId: opts.reviewResultId,
          orderId: String(Date.now()),
          cancellationReason: 'order id missing',
        });
        result.canceled += 1;
        continue;
      }
      await insertLimitOrder({
        userId: opts.userId,
        planned,
        status: LimitOrderStatus.Open,
        reviewResultId: opts.reviewResultId,
        orderId: String(res.orderId),
      });
      result.placed += 1;
      opts.log.info(
        { step: 'createLimitOrder', orderId: res.orderId },
        'step success',
      );
    } catch (err) {
      let reason = err instanceof Error ? err.message : 'unknown error';
      if (opts.exchange === 'binance') {
        const { msg } = parseBinanceError(err);
        if (msg) {
          reason = msg;
        }
      }
      await insertLimitOrder({
        userId: opts.userId,
        planned,
        status: LimitOrderStatus.Canceled,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: reason,
      });
      result.canceled += 1;
      opts.log.error(
        { err, step: 'createLimitOrder', exchange: opts.exchange },
        'step failed',
      );
    }
  }
  result.needsPriceDivergenceRetry =
    result.priceDivergenceCancellations > 0 && result.placed === 0;
  return result;
}
