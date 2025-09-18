import type { FastifyBaseLogger } from 'fastify';
import { insertLimitOrder } from '../repos/limit-orders.js';
import type { LimitOrderStatus } from '../repos/limit-orders.types.js';
import type { MainTraderOrder } from '../agents/main-trader.js';
import {
  fetchPairData,
  fetchPairInfo,
  createLimitOrder,
  parseBinanceError,
} from './binance.js';
import { TOKEN_SYMBOLS } from '../util/tokens.js';

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
  orders: (MainTraderOrder & { manuallyEdited?: boolean })[];
  reviewResultId: string;
  log: FastifyBaseLogger;
}) {
  for (const o of opts.orders) {
    const [a, b] = splitPair(o.pair);
    if (!a || !b) continue;
    const info = await fetchPairInfo(a, b);
    const { currentPrice } = await fetchPairData(a, b);
    const requestedSide = o.side;
    const manuallyEdited = o.manuallyEdited ?? false;
    const plannedBase: Record<string, unknown> = {
      symbol: info.symbol,
      pair: o.pair,
      token: o.token,
      side: requestedSide,
      manuallyEdited,
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
