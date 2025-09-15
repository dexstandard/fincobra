import type { FastifyBaseLogger } from 'fastify';
import { insertLimitOrder, type LimitOrderStatus } from '../repos/limit-orders.js';
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
  if (roundedQty * roundedPrice < info.minNotional) {
    log.info({ step: 'createLimitOrder' }, 'step success: order below min notional');
    return;
  }
  const params = {
    symbol: info.symbol,
    side,
    quantity: roundedQty,
    price: roundedPrice,
  } as const;
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

export async function createDecisionLimitOrders(opts: {
  userId: string;
  orders: {
    pair: string;
    token: string;
    side: string;
    quantity: number;
    delta: number | null;
    limitPrice: number | null;
    basePrice: number | null;
    maxPriceDivergence: number | null;
  }[];
  reviewResultId: string;
  log: FastifyBaseLogger;
}) {
  for (const o of opts.orders) {
    const [a, b] = splitPair(o.pair);
    if (!a || !b) continue;
    const info = await fetchPairInfo(a, b);
    const { currentPrice } = await fetchPairData(a, b);
    const side = o.side as 'BUY' | 'SELL';
    const basePrice = o.basePrice ?? currentPrice;
    const rawPrice =
      o.limitPrice !== null
        ? o.limitPrice
        : basePrice * (o.delta !== null ? 1 + o.delta : side === 'BUY' ? 0.999 : 1.001);
    let quantity: number;
    if (o.token === info.baseAsset) {
      quantity = o.quantity;
    } else if (o.token === info.quoteAsset) {
      quantity = o.quantity / rawPrice;
    } else {
      continue;
    }
    const qty = Number(quantity.toFixed(info.quantityPrecision));
    const prc = Number(rawPrice.toFixed(info.pricePrecision));
    const params = { symbol: info.symbol, side, quantity: qty, price: prc } as const;
    const planned = {
      ...params,
      manuallyEdited: false,
      ...(o.delta !== null ? { delta: o.delta } : {}),
      ...(o.limitPrice !== null ? { limitPrice: o.limitPrice } : {}),
      ...(o.basePrice !== null ? { basePrice: o.basePrice } : {}),
      ...(o.maxPriceDivergence !== null ? { maxPriceDivergence: o.maxPriceDivergence } : {}),
    };
    if (
      o.maxPriceDivergence !== null &&
      Math.abs(currentPrice - basePrice) / basePrice > o.maxPriceDivergence
    ) {
      await insertLimitOrder({
        userId: opts.userId,
        planned,
        status: 'canceled' as LimitOrderStatus,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: 'price divergence too high',
      });
      continue;
    }
    if (qty * prc < info.minNotional) continue;
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
