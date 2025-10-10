import { parseBinanceError } from './binance-client.js';
import { updateLimitOrderStatus } from '../repos/limit-orders.js';
import { LimitOrderStatus } from '../repos/limit-orders.types.js';
import {
  getExchangeGateway,
  type SupportedExchange,
} from './exchange-gateway.js';

function normalizeOrderStatus(value: unknown): string | null {
  if (typeof value === 'string') return value.toUpperCase();
  if (!value || typeof value !== 'object') return null;
  const maybeStatus = (value as { status?: unknown }).status;
  return typeof maybeStatus === 'string' ? maybeStatus.toUpperCase() : null;
}

export async function cancelLimitOrder(
  userId: string,
  opts: {
    symbol: string;
    orderId: string;
    reason: string;
    exchange?: SupportedExchange;
  },
): Promise<LimitOrderStatus> {
  const exchange = opts.exchange ?? 'binance';
  const gateway = getExchangeGateway(exchange);
  const spot = gateway.spot;
  if (!spot) {
    throw new Error(`spot trading not supported for exchange ${exchange}`);
  }

  const numericOrderId = Number(opts.orderId);
  const orderReference = {
    symbol: opts.symbol,
    orderId: Number.isFinite(numericOrderId) ? numericOrderId : opts.orderId,
  } as const;

  let cancelStatus: string | null = null;
  try {
    const res = await spot.cancelOrder(userId, orderReference);
    cancelStatus = normalizeOrderStatus(res);
  } catch (err) {
    if (exchange === 'binance') {
      const { code } = parseBinanceError(err);
      if (code === -2013) {
        try {
          const order = await spot.fetchOrder(userId, orderReference);
          const status = normalizeOrderStatus(order);
          if (status === 'FILLED') {
            await updateLimitOrderStatus(
              userId,
              opts.orderId,
              LimitOrderStatus.Filled,
            );
            return LimitOrderStatus.Filled;
          }
          if (status && status !== 'FILLED') {
            await updateLimitOrderStatus(
              userId,
              opts.orderId,
              LimitOrderStatus.Canceled,
              opts.reason,
            );
            return LimitOrderStatus.Canceled;
          }
        } catch {}
        await updateLimitOrderStatus(
          userId,
          opts.orderId,
          LimitOrderStatus.Canceled,
          opts.reason,
        );
        return LimitOrderStatus.Canceled;
      }
    }
    throw err;
  }

  if (cancelStatus === 'FILLED') {
    await updateLimitOrderStatus(
      userId,
      opts.orderId,
      LimitOrderStatus.Filled,
    );
    return LimitOrderStatus.Filled;
  }

  try {
    const status = await spot.fetchOrder(userId, orderReference);
    const normalizedStatus = normalizeOrderStatus(status);
    if (normalizedStatus === 'FILLED') {
      await updateLimitOrderStatus(
        userId,
        opts.orderId,
        LimitOrderStatus.Filled,
      );
      return LimitOrderStatus.Filled;
    }
  } catch (err) {
    if (exchange === 'binance') {
      const { code } = parseBinanceError(err);
      if (code === -2013) {
        await updateLimitOrderStatus(
          userId,
          opts.orderId,
          LimitOrderStatus.Canceled,
          opts.reason,
        );
        return LimitOrderStatus.Canceled;
      }
    }
    throw err;
  }

  await updateLimitOrderStatus(
    userId,
    opts.orderId,
    LimitOrderStatus.Canceled,
    opts.reason,
  );
  return LimitOrderStatus.Canceled;
}

