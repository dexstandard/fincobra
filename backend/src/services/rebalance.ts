import type { FastifyBaseLogger } from 'fastify';
import { insertLimitOrder, type LimitOrderStatus } from '../repos/limit-orders.js';
import type { MainTraderOrder } from '../agents/main-trader.js';
import {
  fetchPairData,
  fetchPairInfo,
  createLimitOrder,
  parseBinanceError,
} from './binance.js';
import { TOKEN_SYMBOLS } from '../util/tokens.js';

export const MIN_LIMIT_ORDER_USD = 0.02;

export async function calcRebalanceOrder(opts: {
  tokens: string[];
  positions: { sym: string; value_usdt: number }[];
  newAllocation: number;
}) {
  const { tokens, positions, newAllocation } = opts;
  const [token1, token2] = tokens;
  const pos1 = positions.find((p) => p.sym === token1);
  const pos2 = positions.find((p) => p.sym === token2);
  if (!pos1 || !pos2) return null;
  const { currentPrice } = await fetchPairData(token1, token2);
  const total = pos1.value_usdt + pos2.value_usdt;
  const target1 = (newAllocation / 100) * total;
  const diff = target1 - pos1.value_usdt;
  if (!diff || Math.abs(diff) < MIN_LIMIT_ORDER_USD) return null;
  const quantity = Math.abs(diff) / currentPrice;
  return { diff, quantity, currentPrice } as const;
}

export async function createRebalanceLimitOrder(opts: {
  userId: string;
  tokens: string[];
  positions: { sym: string; value_usdt: number }[];
  newAllocation: number;
  reviewResultId: string;
  log: FastifyBaseLogger;
  price?: number;
  quantity?: number;
  manuallyEdited?: boolean;
}) {
  const {
    userId,
    tokens,
    positions,
    newAllocation,
    reviewResultId,
    log,
    price,
    quantity,
    manuallyEdited,
  } = opts;
  log.info({ step: 'createLimitOrder' }, 'step start');
  const [token1, token2] = tokens;
  const order = await calcRebalanceOrder({ tokens, positions, newAllocation });
  if (!order) {
    log.info({ step: 'createLimitOrder' }, 'step success: no rebalance needed');
    return;
  }
  const info = await fetchPairInfo(token1, token2);
  const wantMoreToken1 = order.diff > 0;
  const side = info.baseAsset === token1
    ? (wantMoreToken1 ? 'BUY' : 'SELL')
    : (wantMoreToken1 ? 'SELL' : 'BUY');
  const qty = quantity ?? order.quantity;
  const prc = price ?? order.currentPrice * (side === 'BUY' ? 0.999 : 1.001);
  const roundedQty = Number(qty.toFixed(info.quantityPrecision));
  const roundedPrice = Number(prc.toFixed(info.pricePrecision));
  const params = {
    symbol: info.symbol,
    side,
    quantity: roundedQty,
    price: roundedPrice,
  } as const;
  if (roundedQty * roundedPrice < info.minNotional) {
    await insertLimitOrder({
      userId,
      planned: { ...params, manuallyEdited: manuallyEdited ?? false },
      status: 'canceled' as LimitOrderStatus,
      reviewResultId,
      orderId: String(Date.now()),
      cancellationReason: 'order below min notional',
    });
    log.info({ step: 'createLimitOrder' }, 'step success: order below min notional');
    return;
  }
  try {
    const res = await createLimitOrder(userId, params);
    if (!res || res.orderId === undefined || res.orderId === null) {
      const reason = 'order id missing';
      await insertLimitOrder({
        userId,
        planned: { ...params, manuallyEdited: manuallyEdited ?? false },
        status: 'canceled' as LimitOrderStatus,
        reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: reason,
      });
      log.error({ step: 'createLimitOrder' }, 'step failed');
      return;
    }
    await insertLimitOrder({
      userId,
      planned: { ...params, manuallyEdited: manuallyEdited ?? false },
      status: 'open' as LimitOrderStatus,
      reviewResultId,
      orderId: String(res.orderId),
    });
    log.info({ step: 'createLimitOrder', orderId: res.orderId, order: params }, 'step success');
  } catch (err) {
    const { msg } = parseBinanceError(err);
    const reason = msg || (err instanceof Error ? err.message : 'unknown error');
    await insertLimitOrder({
      userId,
      planned: { ...params, manuallyEdited: manuallyEdited ?? false },
      status: 'canceled' as LimitOrderStatus,
      reviewResultId,
      orderId: String(Date.now()),
      cancellationReason: reason,
    });
    log.error({ err, step: 'createLimitOrder' }, 'step failed');
    throw err;
  }
}

function splitPair(pair: string): [string, string] {
  for (const sym of TOKEN_SYMBOLS) {
    if (pair.startsWith(sym)) {
      const rest = pair.slice(sym.length);
      if (TOKEN_SYMBOLS.includes(rest)) return [sym, rest];
    }
  }
  return ['', ''];
}

const MIN_MAX_PRICE_DIVERGENCE = 0.0001;

function adjustLimitPrice(requested: number, current: number, side: 'BUY' | 'SELL'): number {
  const anchor = side === 'BUY' ? current * 0.999 : current * 1.001;
  return side === 'BUY' ? Math.min(requested, anchor) : Math.max(requested, anchor);
}

function roundLimitPrice(price: number, precision: number, side: 'BUY' | 'SELL'): number {
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

export async function createDecisionLimitOrders(opts: {
  userId: string;
  orders: MainTraderOrder[];
  reviewResultId: string;
  log: FastifyBaseLogger;
}) {
  for (const o of opts.orders) {
    const [a, b] = splitPair(o.pair);
    if (!a || !b) continue;
    const info = await fetchPairInfo(a, b);
    const { currentPrice } = await fetchPairData(a, b);
    const requestedSide = o.side;
    const plannedBase: Record<string, unknown> = {
      symbol: info.symbol,
      pair: o.pair,
      token: o.token,
      side: requestedSide,
      manuallyEdited: false,
      basePrice: o.basePrice,
      limitPrice: o.limitPrice,
      maxPriceDivergencePct: o.maxPriceDivergencePct,
      requestedQuantity: o.quantity,
      observedPrice: currentPrice,
    };

    if (requestedSide !== 'BUY' && requestedSide !== 'SELL') {
      await insertLimitOrder({
        userId: opts.userId,
        planned: plannedBase,
        status: 'canceled' as LimitOrderStatus,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: `Invalid order side: ${requestedSide}`,
      });
      continue;
    }

    const side: 'BUY' | 'SELL' = requestedSide;

    if (!Number.isFinite(o.basePrice) || o.basePrice <= 0) {
      await insertLimitOrder({
        userId: opts.userId,
        planned: plannedBase,
        status: 'canceled' as LimitOrderStatus,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: `Malformed basePrice: ${o.basePrice}`,
      });
      continue;
    }

    if (!Number.isFinite(o.limitPrice) || o.limitPrice <= 0) {
      await insertLimitOrder({
        userId: opts.userId,
        planned: plannedBase,
        status: 'canceled' as LimitOrderStatus,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: `Malformed limitPrice: ${o.limitPrice}`,
      });
      continue;
    }

    if (
      !Number.isFinite(o.maxPriceDivergencePct) ||
      o.maxPriceDivergencePct < MIN_MAX_PRICE_DIVERGENCE
    ) {
      await insertLimitOrder({
        userId: opts.userId,
        planned: plannedBase,
        status: 'canceled' as LimitOrderStatus,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: `Malformed maxPriceDivergencePct: ${o.maxPriceDivergencePct}`,
      });
      continue;
    }

    const basePrice = o.basePrice;
    const requestedLimitPrice = o.limitPrice;
    const divergenceLimit = o.maxPriceDivergencePct;
    const divergence = Math.abs(currentPrice - basePrice) / basePrice;
    if (divergence > divergenceLimit) {
      await insertLimitOrder({
        userId: opts.userId,
        planned: {
          ...plannedBase,
          basePrice,
          limitPrice: requestedLimitPrice,
          maxPriceDivergencePct: divergenceLimit,
        },
        status: 'canceled' as LimitOrderStatus,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: 'price divergence too high',
      });
      continue;
    }

    const adjustedLimit = adjustLimitPrice(requestedLimitPrice, currentPrice, side);
    const roundedLimit = roundLimitPrice(adjustedLimit, info.pricePrecision, side);
    if (!Number.isFinite(roundedLimit) || roundedLimit <= 0) {
      await insertLimitOrder({
        userId: opts.userId,
        planned: {
          ...plannedBase,
          basePrice,
          limitPrice: adjustedLimit,
          maxPriceDivergencePct: divergenceLimit,
        },
        status: 'canceled' as LimitOrderStatus,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: `Malformed adjusted limitPrice: ${adjustedLimit}`,
      });
      continue;
    }

    let quantity: number;
    if (o.token === info.baseAsset) {
      quantity = o.quantity;
    } else if (o.token === info.quoteAsset) {
      quantity = o.quantity / roundedLimit;
    } else {
      continue;
    }
    const qty = Number(quantity.toFixed(info.quantityPrecision));
    const params = { symbol: info.symbol, side, quantity: qty, price: roundedLimit } as const;
    const planned = {
      ...plannedBase,
      quantity: qty,
      price: roundedLimit,
      basePrice,
      limitPrice: roundedLimit,
      maxPriceDivergencePct: divergenceLimit,
    };

    if (qty * roundedLimit < info.minNotional) {
      await insertLimitOrder({
        userId: opts.userId,
        planned,
        status: 'canceled' as LimitOrderStatus,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: 'order below min notional',
      });
      continue;
    }

    try {
      const res = await createLimitOrder(opts.userId, params);
      if (!res || res.orderId === undefined || res.orderId === null) {
        await insertLimitOrder({
          userId: opts.userId,
          planned,
          status: 'canceled' as LimitOrderStatus,
          reviewResultId: opts.reviewResultId,
          orderId: String(Date.now()),
          cancellationReason: 'order id missing',
        });
        continue;
      }
      await insertLimitOrder({
        userId: opts.userId,
        planned,
        status: 'open' as LimitOrderStatus,
        reviewResultId: opts.reviewResultId,
        orderId: String(res.orderId),
      });
      opts.log.info({ step: 'createLimitOrder', orderId: res.orderId }, 'step success');
    } catch (err) {
      const { msg } = parseBinanceError(err);
      const reason = msg || (err instanceof Error ? err.message : 'unknown error');
      await insertLimitOrder({
        userId: opts.userId,
        planned,
        status: 'canceled' as LimitOrderStatus,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: reason,
      });
      opts.log.error({ err, step: 'createLimitOrder' }, 'step failed');
    }
  }
}
