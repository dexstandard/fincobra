import type { FastifyBaseLogger } from 'fastify';
import { insertLimitOrder } from '../repos/limit-orders.js';
import { LimitOrderStatus } from '../repos/limit-orders.types.js';
import type {
  MainTraderFuturesConfig,
  MainTraderOrder,
} from '../agents/main-trader.types.js';
import {
  fetchPairInfo,
  fetchSymbolPrice,
  createLimitOrder,
  parseBinanceError,
} from './binance-client.js';
import { TOKEN_SYMBOLS } from '../util/tokens.js';
import {
  openFuturesPosition,
  setFuturesLeverage,
  setFuturesStopLoss,
  setFuturesTakeProfit,
} from './binance-futures.js';

interface CreateDecisionLimitOrdersResult {
  placed: number;
  canceled: number;
  priceDivergenceCancellations: number;
  needsPriceDivergenceRetry: boolean;
}

interface CreateDecisionOrderOptions {
  userId: string;
  orders: (MainTraderOrder & { manuallyEdited?: boolean })[];
  reviewResultId: string;
  log: FastifyBaseLogger;
  useFutures?: boolean;
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

function normalizeFuturesLeverage(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const normalized = Math.trunc(value);
  return normalized >= 1 ? normalized : undefined;
}

function extractFuturesOrderId(response: Record<string, unknown>): string | null {
  const keys = ['orderId', 'orderID', 'clientOrderId', 'origClientOrderId'];
  for (const key of keys) {
    const raw = response[key];
    if (typeof raw === 'string' && raw) return raw;
    if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  }
  return null;
}

function extractFuturesStatus(response: Record<string, unknown>): string | null {
  const rawStatus = response.status;
  if (typeof rawStatus === 'string' && rawStatus) return rawStatus.toUpperCase();
  return null;
}

export async function createDecisionLimitOrders(
  opts: CreateDecisionOrderOptions,
): Promise<CreateDecisionLimitOrdersResult> {
  if (opts.useFutures) {
    return createDecisionFuturesOrders(opts);
  }
  const result: CreateDecisionLimitOrdersResult = {
    placed: 0,
    canceled: 0,
    priceDivergenceCancellations: 0,
    needsPriceDivergenceRetry: false,
  };
  for (const o of opts.orders) {
    const [a, b] = splitPair(o.pair);
    if (!a || !b) continue;
    const info = await fetchPairInfo(a, b);
    const { currentPrice } = await fetchSymbolPrice(info.symbol);
    const requestedSide = o.side;
    const requestedToken =
      typeof o.token === 'string' ? o.token.toUpperCase() : '';
    const manuallyEdited = o.manuallyEdited ?? false;
    const plannedBase: Record<string, unknown> = {
      symbol: info.symbol,
      pair: o.pair,
      token: requestedToken || o.token,
      side: requestedSide,
      manuallyEdited,
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

async function createDecisionFuturesOrders(
  opts: CreateDecisionOrderOptions,
): Promise<CreateDecisionLimitOrdersResult> {
  const result: CreateDecisionLimitOrdersResult = {
    placed: 0,
    canceled: 0,
    priceDivergenceCancellations: 0,
    needsPriceDivergenceRetry: false,
  };

  for (const o of opts.orders) {
    const [baseSym, quoteSym] = splitPair(o.pair);
    if (!baseSym || !quoteSym) continue;

    const info = await fetchPairInfo(baseSym, quoteSym);
    const { currentPrice } = await fetchSymbolPrice(info.symbol);

    const requestedSide = o.side;
    const requestedToken =
      typeof o.token === 'string' ? o.token.toUpperCase() : '';
    const manuallyEdited = o.manuallyEdited ?? false;

    const plannedBase: Record<string, unknown> = {
      symbol: info.symbol,
      pair: o.pair,
      token: requestedToken || o.token,
      side: requestedSide,
      manuallyEdited,
      basePrice: o.basePrice,
      limitPrice: o.limitPrice,
      maxPriceDriftPct: o.maxPriceDriftPct,
      requestedQty: o.qty,
      observedPrice: currentPrice,
      execution: 'futures',
    };

    const cancelWithReason = async (
      reason: string,
      planned: Record<string, unknown> = plannedBase,
    ) => {
      await insertLimitOrder({
        userId: opts.userId,
        planned,
        status: LimitOrderStatus.Canceled,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: reason,
      });
      result.canceled += 1;
    };

    if (requestedSide !== 'BUY' && requestedSide !== 'SELL') {
      await cancelWithReason(`Invalid order side: ${requestedSide}`);
      continue;
    }
    const side: 'BUY' | 'SELL' = requestedSide;

    const futuresConfig: MainTraderFuturesConfig | undefined = o.futures;
    if (!futuresConfig) {
      await cancelWithReason('missing futures configuration');
      continue;
    }

    plannedBase.futures = futuresConfig;

    const positionSide = futuresConfig.positionSide;
    if (positionSide !== 'LONG' && positionSide !== 'SHORT') {
      await cancelWithReason(
        `Invalid futures positionSide: ${String(positionSide)}`,
      );
      continue;
    }

    const stopLoss = futuresConfig.stopLoss;
    if (typeof stopLoss !== 'number' || !Number.isFinite(stopLoss) || stopLoss <= 0) {
      await cancelWithReason(`Invalid futures stopLoss: ${String(stopLoss)}`);
      continue;
    }

    const takeProfit = futuresConfig.takeProfit;
    if (
      typeof takeProfit !== 'number' ||
      !Number.isFinite(takeProfit) ||
      takeProfit <= 0
    ) {
      await cancelWithReason(
        `Invalid futures takeProfit: ${String(takeProfit)}`,
      );
      continue;
    }

    const typeRaw =
      typeof futuresConfig.type === 'string'
        ? futuresConfig.type.toUpperCase()
        : undefined;
    if (typeRaw && typeRaw !== 'MARKET' && typeRaw !== 'LIMIT') {
      await cancelWithReason(`Invalid futures order type: ${typeRaw}`);
      continue;
    }
    const orderType: 'MARKET' | 'LIMIT' = typeRaw ?? 'MARKET';
    const reduceOnly = futuresConfig.reduceOnly === true;

    const leverage = normalizeFuturesLeverage(futuresConfig.leverage);
    if (futuresConfig.leverage !== undefined && leverage === undefined) {
      await cancelWithReason(
        `Invalid futures leverage: ${String(futuresConfig.leverage)}`,
      );
      continue;
    }

    if (!Number.isFinite(o.qty) || o.qty <= 0) {
      await cancelWithReason(`Malformed qty: ${o.qty}`);
      continue;
    }

    if (!Number.isFinite(o.basePrice) || o.basePrice <= 0) {
      await cancelWithReason(`Malformed basePrice: ${o.basePrice}`);
      continue;
    }

    if (
      !Number.isFinite(o.maxPriceDriftPct) ||
      o.maxPriceDriftPct < MIN_MAX_PRICE_DRIFT
    ) {
      await cancelWithReason(
        `Malformed maxPriceDriftPct: ${o.maxPriceDriftPct}`,
      );
      continue;
    }

    if (
      orderType === 'LIMIT' && (!Number.isFinite(o.limitPrice) || o.limitPrice <= 0)
    ) {
      await cancelWithReason(`Malformed limitPrice: ${o.limitPrice}`);
      continue;
    }

    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      await cancelWithReason(
        `Malformed observed price: ${currentPrice}`,
      );
      continue;
    }

    const basePrice = o.basePrice;
    const divergenceLimit = o.maxPriceDriftPct;
    const divergence = Math.abs(currentPrice - basePrice) / basePrice;
    if (divergence > divergenceLimit) {
      await cancelWithReason('price divergence too high');
      result.priceDivergenceCancellations += 1;
      continue;
    }

    const normalizedFutures: Record<string, unknown> = {
      positionSide,
      type: orderType,
      stopLoss,
      takeProfit,
      reduceOnly,
    };
    if (leverage !== undefined) {
      normalizedFutures.leverage = leverage;
    }

    let planned: Record<string, unknown> = {
      ...plannedBase,
      futures: normalizedFutures,
    };

    let priceForEntry = currentPrice;
    if (orderType === 'LIMIT') {
      const requestedLimitPrice = o.limitPrice as number;
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
        await cancelWithReason(
          `Malformed adjusted limitPrice: ${adjustedLimit}`,
          planned,
        );
        continue;
      }
      priceForEntry = roundedLimit;
      planned = {
        ...planned,
        limitPrice: roundedLimit,
      };
    }

    let quantity: number;
    if (requestedToken === info.baseAsset) {
      quantity = o.qty;
    } else if (requestedToken === info.quoteAsset) {
      if (!Number.isFinite(priceForEntry) || priceForEntry <= 0) {
        await cancelWithReason(
          `Malformed futures entry price: ${priceForEntry}`,
          planned,
        );
        continue;
      }
      quantity = o.qty / priceForEntry;
    } else {
      await cancelWithReason(`Unsupported token for pair: ${requestedToken}`);
      continue;
    }

    const rawQty = quantity;
    let qty = Number(rawQty.toFixed(info.quantityPrecision));
    const freshNominal = rawQty * priceForEntry;
    const roundedNominal = qty * priceForEntry;
    const meetsRoundedNominal = meetsMinNotional(
      roundedNominal,
      info.minNotional,
    );
    if (!meetsRoundedNominal && info.minNotional > 0) {
      let minForRequestedToken: number | null = null;
      if (o.token === info.baseAsset) {
        minForRequestedToken =
          Number.isFinite(priceForEntry) && priceForEntry > 0
            ? info.minNotional / priceForEntry
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
          price: priceForEntry,
          precision: info.quantityPrecision,
          targetNominal,
        });
        if (adjustedQty !== null && adjustedQty > qty) {
          qty = adjustedQty;
        }
      }
    }

    const nominalValue = qty * priceForEntry;
    planned = {
      ...planned,
      qty,
      price: priceForEntry,
      basePrice,
      limitPrice: priceForEntry,
      maxPriceDriftPct: divergenceLimit,
    };

    if (!meetsMinNotional(nominalValue, info.minNotional)) {
      await cancelWithReason('order below min notional', planned);
      continue;
    }

    try {
      if (leverage !== undefined) {
        await setFuturesLeverage(opts.userId, info.symbol, leverage);
      }

      const entryParams: {
        symbol: string;
        positionSide: 'LONG' | 'SHORT';
        quantity: number;
        type: 'MARKET' | 'LIMIT';
        price?: number;
        reduceOnly?: boolean;
      } = {
        symbol: info.symbol,
        positionSide,
        quantity: qty,
        type: orderType,
      };

      if (orderType === 'LIMIT') {
        entryParams.price = priceForEntry;
      }
      if (reduceOnly) {
        entryParams.reduceOnly = true;
      }

      const entryRes = await openFuturesPosition(opts.userId, entryParams);
      const entryOrderId = extractFuturesOrderId(entryRes);
      if (!entryOrderId) {
        await cancelWithReason('futures order id missing', planned);
        continue;
      }

      const entryStatus = extractFuturesStatus(entryRes);
      let status = LimitOrderStatus.Open;
      if (entryStatus === 'FILLED') {
        status = LimitOrderStatus.Filled;
      }

      let stopLossRes: Record<string, unknown> | null = null;
      try {
        stopLossRes = await setFuturesStopLoss(opts.userId, {
          symbol: info.symbol,
          positionSide,
          stopPrice: stopLoss,
        });
      } catch (err) {
        opts.log.error({ err, step: 'setFuturesStopLoss' }, 'step failed');
      }

      let takeProfitRes: Record<string, unknown> | null = null;
      try {
        takeProfitRes = await setFuturesTakeProfit(opts.userId, {
          symbol: info.symbol,
          positionSide,
          stopPrice: takeProfit,
        });
      } catch (err) {
        opts.log.error({ err, step: 'setFuturesTakeProfit' }, 'step failed');
      }

      const futuresOrders: Record<string, unknown> = { entry: entryRes };
      if (stopLossRes) futuresOrders.stopLoss = stopLossRes;
      if (takeProfitRes) futuresOrders.takeProfit = takeProfitRes;

      planned = {
        ...planned,
        futuresOrders,
      };

      await insertLimitOrder({
        userId: opts.userId,
        planned,
        status,
        reviewResultId: opts.reviewResultId,
        orderId: entryOrderId,
      });
      result.placed += 1;
      opts.log.info(
        { step: 'createFuturesOrder', orderId: entryOrderId },
        'step success',
      );
    } catch (err) {
      const { msg } = parseBinanceError(err);
      const reason =
        msg || (err instanceof Error ? err.message : 'unknown error');
      await cancelWithReason(reason, planned);
      opts.log.error({ err, step: 'createFuturesOrder' }, 'step failed');
    }
  }

  return result;
}
