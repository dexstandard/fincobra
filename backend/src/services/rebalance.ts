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
    const reason =
      parseBinanceError(err) || (err instanceof Error ? err.message : 'unknown error');
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
  orders: { pair: string; token: string; side: string; quantity: number }[];
  reviewResultId: string;
  log: FastifyBaseLogger;
}) {
  for (const o of opts.orders) {
    const [a, b] = splitPair(o.pair);
    if (!a || !b) continue;
    const info = await fetchPairInfo(a, b);
    const { currentPrice } = await fetchPairData(a, b);
    const side = o.side as 'BUY' | 'SELL';
    let quantity: number;
    if (o.token === info.baseAsset) {
      quantity = o.quantity;
    } else if (o.token === info.quoteAsset) {
      quantity = o.quantity / currentPrice;
    } else {
      continue;
    }
    const price = currentPrice * (side === 'BUY' ? 0.999 : 1.001);
    const qty = Number(quantity.toFixed(info.quantityPrecision));
    const prc = Number(price.toFixed(info.pricePrecision));
    if (qty * prc < info.minNotional) continue;
    const params = { symbol: info.symbol, side, quantity: qty, price: prc } as const;
    try {
      const res = await createLimitOrder(opts.userId, params);
      if (!res || res.orderId === undefined || res.orderId === null) {
        await insertLimitOrder({
          userId: opts.userId,
          planned: { ...params, manuallyEdited: false },
          status: 'canceled' as LimitOrderStatus,
          reviewResultId: opts.reviewResultId,
          orderId: String(Date.now()),
          cancellationReason: 'order id missing',
        });
        continue;
      }
      await insertLimitOrder({
        userId: opts.userId,
        planned: { ...params, manuallyEdited: false },
        status: 'open' as LimitOrderStatus,
        reviewResultId: opts.reviewResultId,
        orderId: String(res.orderId),
      });
      opts.log.info({ step: 'createLimitOrder', orderId: res.orderId }, 'step success');
    } catch (err) {
      const reason =
        parseBinanceError(err) || (err instanceof Error ? err.message : 'unknown error');
      await insertLimitOrder({
        userId: opts.userId,
        planned: { ...params, manuallyEdited: false },
        status: 'canceled' as LimitOrderStatus,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: reason,
      });
      opts.log.error({ err, step: 'createLimitOrder' }, 'step failed');
    }
  }
}
