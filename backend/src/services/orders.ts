import type { FastifyBaseLogger } from 'fastify';
import {
  insertLimitOrder,
  updateLimitOrderStatus,
  type LimitOrderStatus,
} from '../repos/limit-orders.js';
import {
  fetchPairData,
  fetchPairInfo,
  createLimitOrder,
  cancelOrder,
  parseBinanceError,
} from './binance.js';
import { TOKEN_SYMBOLS } from '../util/tokens.js';

export const MIN_LIMIT_ORDER_USD = 0.02;
const EXECUTION_SPREAD = 0.001;

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
  const adjustment = side === 'BUY' ? 1 - EXECUTION_SPREAD : 1 + EXECUTION_SPREAD;
  const prc = price ?? order.currentPrice * adjustment;
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

export async function createDecisionLimitOrders(opts: {
  userId: string;
  orders: {
    pair: string;
    token: string;
    side: string;
    quantity: number;
    limitPrice: number | null;
    maxPriceDivergence: number | null;
  }[];
  reviewResultId: string;
  log: FastifyBaseLogger;
}) {
  for (const o of opts.orders) {
    const [base, quote] = splitPair(o.pair);
    if (!base || !quote) continue;
    const info = await fetchPairInfo(base, quote);
    const { currentPrice } = await fetchPairData(base, quote);
    const side = (o.side === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
    const requestedPrice = o.limitPrice ?? currentPrice;
    const maxDivergence = o.maxPriceDivergence ?? null;
    const favorablePrice =
      side === 'BUY'
        ? currentPrice * (1 - EXECUTION_SPREAD)
        : currentPrice * (1 + EXECUTION_SPREAD);

    let executionPrice = requestedPrice;
    if (o.limitPrice === null) {
      executionPrice = favorablePrice;
    } else if (side === 'BUY') {
      executionPrice = Math.min(executionPrice, favorablePrice);
    } else {
      executionPrice = Math.max(executionPrice, favorablePrice);
    }

    if (!Number.isFinite(executionPrice) || executionPrice <= 0) {
      await insertLimitOrder({
        userId: opts.userId,
        planned: {
          symbol: info.symbol,
          side,
          quantity: 0,
          price: requestedPrice,
          manuallyEdited: false,
          ...(o.limitPrice != null ? { requestedLimitPrice: o.limitPrice } : {}),
          ...(maxDivergence !== null
            ? { maxPriceDivergence: maxDivergence }
            : {}),
        },
        status: 'canceled' as LimitOrderStatus,
        reviewResultId: opts.reviewResultId,
        orderId: String(Date.now()),
        cancellationReason: 'invalid limit price',
      });
      continue;
    }

    let quantity: number;
    if (o.token === info.baseAsset) {
      quantity = o.quantity;
    } else if (o.token === info.quoteAsset) {
      quantity = o.quantity / executionPrice;
    } else {
      continue;
    }

    const qty = Number(quantity.toFixed(info.quantityPrecision));
    const prc = Number(executionPrice.toFixed(info.pricePrecision));
    const params = { symbol: info.symbol, side, quantity: qty, price: prc } as const;
    const planned = {
      ...params,
      manuallyEdited: false,
      ...(o.limitPrice != null ? { requestedLimitPrice: o.limitPrice } : {}),
      ...(maxDivergence !== null ? { maxPriceDivergence: maxDivergence } : {}),
      marketPrice: currentPrice,
    };

    if (
      maxDivergence !== null &&
      Math.abs(requestedPrice - currentPrice) / currentPrice > maxDivergence
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

    if (qty * prc < info.minNotional) {
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

export async function cancelLimitOrder(
  userId: string,
  opts: { symbol: string; orderId: string; reason: string },
): Promise<'canceled' | 'filled'> {
  try {
    const res = await cancelOrder(userId, {
      symbol: opts.symbol,
      orderId: Number(opts.orderId),
    });
    if (res && res.status === 'FILLED') {
      await updateLimitOrderStatus(userId, opts.orderId, 'filled');
      return 'filled';
    }
    await updateLimitOrderStatus(userId, opts.orderId, 'canceled', opts.reason);
    return 'canceled';
  } catch (err) {
    const { code } = parseBinanceError(err);
    if (code === -2013) {
      await updateLimitOrderStatus(userId, opts.orderId, 'filled');
      return 'filled';
    }
    throw err;
  }
}
