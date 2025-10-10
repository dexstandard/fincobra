import type { FastifyBaseLogger } from 'fastify';
import { randomUUID } from 'crypto';
import { insertLimitOrder } from '../repos/limit-orders.js';
import { LimitOrderStatus } from '../repos/limit-orders.types.js';
import type { MainTraderOrder } from '../agents/main-trader.types.js';
import {
  fetchPairInfo,
  fetchSymbolPrice,
  createLimitOrder,
  parseBinanceError,
} from './binance-client.js';
import { getExchangeGateway, type SupportedExchange } from './exchange-gateway.js';
import { TOKEN_SYMBOLS } from '../util/tokens.js';

interface CreateDecisionLimitOrdersResult {
  placed: number;
  canceled: number;
  priceDivergenceCancellations: number;
  futuresExecuted: number;
  futuresFailed: number;
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

function normalizeExchangeName(value: unknown): SupportedExchange | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase();
  if (normalized === 'bybit') return 'bybit';
  if (normalized === 'binance') return 'binance';
  return null;
}

function resolveOrderExchange(
  order: MainTraderOrder,
  defaultExchange?: SupportedExchange,
): SupportedExchange {
  return (
    normalizeExchangeName(order.exchange) ?? defaultExchange ?? 'binance'
  );
}

function toPositiveNumber(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

async function executeFuturesOrder(
  opts: {
    userId: string;
    reviewResultId: string;
    log: FastifyBaseLogger;
  },
  order: MainTraderOrder & { manuallyEdited?: boolean },
  exchange: SupportedExchange,
  plannedBase: Record<string, unknown>,
): Promise<'success' | 'failure' | 'skipped'> {
  const futuresIntent = order.futures;
  if (!futuresIntent) return 'skipped';

  const symbol =
    typeof order.pair === 'string' && order.pair
      ? order.pair.toUpperCase()
      : '';
  const planned: Record<string, unknown> = {
    ...plannedBase,
    symbol,
    futures: {
      positionSide: futuresIntent.positionSide,
      quantity: futuresIntent.quantity ?? order.qty,
      type: futuresIntent.type ?? undefined,
      price: futuresIntent.price,
      reduceOnly: futuresIntent.reduceOnly ?? false,
      leverage: futuresIntent.leverage,
      stopLoss: futuresIntent.stopLoss,
      takeProfit: futuresIntent.takeProfit,
      hedgeMode: futuresIntent.hedgeMode,
      positionIdx: futuresIntent.positionIdx,
    },
  };

  const recordResult = async (
    status: LimitOrderStatus,
    reason?: string,
  ): Promise<void> => {
    await insertLimitOrder({
      userId: opts.userId,
      planned,
      status,
      reviewResultId: opts.reviewResultId,
      orderId: randomUUID(),
      cancellationReason: reason,
    });
  };

  if (
    futuresIntent.positionSide !== 'LONG' &&
    futuresIntent.positionSide !== 'SHORT'
  ) {
    await recordResult(
      LimitOrderStatus.Canceled,
      `Invalid futures positionSide: ${String(futuresIntent.positionSide)}`,
    );
    return 'failure';
  }

  const quantity = toPositiveNumber(futuresIntent.quantity ?? order.qty);
  if (quantity === null) {
    await recordResult(
      LimitOrderStatus.Canceled,
      `Malformed futures quantity: ${String(futuresIntent.quantity ?? order.qty)}`,
    );
    return 'failure';
  }
  (planned.futures as Record<string, unknown>).quantity = quantity;

  if (futuresIntent.type === 'LIMIT' && futuresIntent.price === undefined) {
    await recordResult(
      LimitOrderStatus.Canceled,
      'price is required for limit futures orders',
    );
    return 'failure';
  }
  if (
    futuresIntent.price !== undefined &&
    toPositiveNumber(futuresIntent.price) === null
  ) {
    await recordResult(
      LimitOrderStatus.Canceled,
      `Malformed futures price: ${String(futuresIntent.price)}`,
    );
    return 'failure';
  }

  const gateway = getExchangeGateway(exchange);
  if (!gateway.futures) {
    await recordResult(
      LimitOrderStatus.Canceled,
      'futures trading not supported for exchange',
    );
    opts.log.error(
      { exchange, symbol },
      'futures trading unavailable for exchange',
    );
    return 'failure';
  }

  const leverage = toPositiveNumber(futuresIntent.leverage ?? null);
  const stopLoss = toPositiveNumber(futuresIntent.stopLoss ?? null);
  const takeProfit = toPositiveNumber(futuresIntent.takeProfit ?? null);

  try {
    if (leverage !== null) {
      await gateway.futures.setLeverage(opts.userId, {
        symbol,
        leverage: Math.max(1, Math.min(125, Math.round(leverage))),
      });
    }

    await gateway.futures.openPosition(opts.userId, {
      symbol,
      positionSide: futuresIntent.positionSide,
      quantity,
      type: futuresIntent.type,
      price: futuresIntent.price,
      reduceOnly: futuresIntent.reduceOnly,
      hedgeMode: futuresIntent.hedgeMode,
      positionIdx: futuresIntent.positionIdx,
    });

    if (stopLoss !== null) {
      await gateway.futures.setStopLoss(opts.userId, {
        symbol,
        positionSide: futuresIntent.positionSide,
        stopPrice: stopLoss,
        hedgeMode: futuresIntent.hedgeMode,
        positionIdx: futuresIntent.positionIdx,
      });
    }

    if (takeProfit !== null) {
      await gateway.futures.setTakeProfit(opts.userId, {
        symbol,
        positionSide: futuresIntent.positionSide,
        stopPrice: takeProfit,
        hedgeMode: futuresIntent.hedgeMode,
        positionIdx: futuresIntent.positionIdx,
      });
    }

    await recordResult(LimitOrderStatus.Filled);
    opts.log.info(
      { step: 'createDecisionFuturesOrder', exchange, symbol },
      'executed futures order',
    );
    return 'success';
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown error';
    await recordResult(LimitOrderStatus.Canceled, reason);
    opts.log.error(
      { err, step: 'createDecisionFuturesOrder', exchange, symbol },
      'failed to execute futures order',
    );
    return 'failure';
  }
}

export async function createDecisionLimitOrders(opts: {
  userId: string;
  orders: (MainTraderOrder & { manuallyEdited?: boolean })[];
  reviewResultId: string;
  log: FastifyBaseLogger;
  defaultExchange?: SupportedExchange;
}): Promise<CreateDecisionLimitOrdersResult> {
  const result: CreateDecisionLimitOrdersResult = {
    placed: 0,
    canceled: 0,
    priceDivergenceCancellations: 0,
    futuresExecuted: 0,
    futuresFailed: 0,
    needsPriceDivergenceRetry: false,
  };
  for (const o of opts.orders) {
    const exchange = resolveOrderExchange(o, opts.defaultExchange);
    const requestedToken =
      typeof o.token === 'string' ? o.token.toUpperCase() : '';
    const manuallyEdited = o.manuallyEdited ?? false;
    const plannedBase: Record<string, unknown> = {
      exchange,
      symbol:
        typeof o.pair === 'string' && o.pair ? o.pair.toUpperCase() : o.pair,
      pair: o.pair,
      token: requestedToken || o.token,
      side: o.side,
      manuallyEdited,
      basePrice: o.basePrice,
      limitPrice: o.limitPrice,
      maxPriceDriftPct: o.maxPriceDriftPct,
      requestedQty: o.qty,
    };

    const futuresStatus = await executeFuturesOrder(
      {
        userId: opts.userId,
        reviewResultId: opts.reviewResultId,
        log: opts.log,
      },
      o,
      exchange,
      plannedBase,
    );
    if (futuresStatus === 'success') {
      result.futuresExecuted += 1;
      continue;
    }
    if (futuresStatus === 'failure') {
      result.futuresFailed += 1;
      continue;
    }

    const [a, b] = splitPair(o.pair);
    if (!a || !b) continue;
    const info = await fetchPairInfo(a, b);
    const { currentPrice } = await fetchSymbolPrice(info.symbol);
    plannedBase.symbol = info.symbol;
    plannedBase.observedPrice = currentPrice;
    const requestedSide = o.side;

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
      info.pricePrecision,
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
    if (requestedToken === info.baseAsset) {
      quantity = o.qty;
    } else if (requestedToken === info.quoteAsset) {
      quantity = o.qty / roundedLimit;
    } else {
      continue;
    }
    const rawQty = quantity;
    let qty = Number(rawQty.toFixed(info.quantityPrecision));
    const freshNominal = rawQty * roundedLimit;
    const roundedNominal = qty * roundedLimit;
    const meetsRoundedNominal = meetsMinNotional(
      roundedNominal,
      info.minNotional,
    );
    if (!meetsRoundedNominal && info.minNotional > 0) {
      let minForRequestedToken: number | null = null;
      if (o.token === info.baseAsset) {
        minForRequestedToken =
          Number.isFinite(roundedLimit) && roundedLimit > 0
            ? info.minNotional / roundedLimit
            : null;
      } else if (o.token === info.quoteAsset) {
        minForRequestedToken = info.minNotional;
      }

      if (
        minForRequestedToken !== null &&
        minForRequestedToken > 0 &&
        matchesTruncatedPrefix(o.qty, minForRequestedToken)
      ) {
        const targetNominal =
          Math.max(freshNominal, info.minNotional) * NOMINAL_BUFFER_RATIO;
        const adjustedQty = increaseQuantityToMeetNominal({
          price: roundedLimit,
          precision: info.quantityPrecision,
          targetNominal,
        });
        if (adjustedQty !== null && adjustedQty > qty) {
          qty = adjustedQty;
        }
      }
    }
    const nominalValue = qty * roundedLimit;
    const params = {
      symbol: info.symbol,
      side,
      qty,
      price: roundedLimit,
    } as const;
    const planned = {
      ...plannedBase,
      qty,
      price: roundedLimit,
      basePrice,
      limitPrice: roundedLimit,
      maxPriceDriftPct: divergenceLimit,
    };

    if (!meetsMinNotional(nominalValue, info.minNotional)) {
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
      const res = await createLimitOrder(opts.userId, params);
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
      const { msg } = parseBinanceError(err);
      const reason =
        msg || (err instanceof Error ? err.message : 'unknown error');
      await insertLimitOrder({
        userId: opts.userId,
        planned,
        status: LimitOrderStatus.Canceled,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: reason,
      });
      result.canceled += 1;
      opts.log.error({ err, step: 'createLimitOrder' }, 'step failed');
    }
  }
  result.needsPriceDivergenceRetry =
    result.priceDivergenceCancellations > 0 && result.placed === 0;
  return result;
}
