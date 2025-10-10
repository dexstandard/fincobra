import { updateLimitOrderStatus } from '../repos/limit-orders.js';
import { LimitOrderStatus } from '../repos/limit-orders.types.js';
import { getExchangeGateway, type SupportedExchange } from './exchange-gateway.js';
import { parseBinanceError } from './binance-client.js';

export async function cancelLimitOrder(
  userId: string,
  opts: {
    exchange: SupportedExchange;
    symbol: string;
    orderId: string;
    reason: string;
  },
): Promise<LimitOrderStatus> {
  const gateway = getExchangeGateway(opts.exchange);
  const spot = gateway.spot;
  if (!spot) {
    throw new Error(`spot trading is not supported on ${opts.exchange}`);
  }
  const reference = { symbol: opts.symbol, orderId: opts.orderId };
  const markCanceled = async () => {
    await updateLimitOrderStatus(
      userId,
      opts.orderId,
      LimitOrderStatus.Canceled,
      opts.reason,
    );
    return LimitOrderStatus.Canceled;
  };
  const markFilled = async () => {
    await updateLimitOrderStatus(userId, opts.orderId, LimitOrderStatus.Filled);
    return LimitOrderStatus.Filled;
  };
  const resolveStatusFromFetch = async () => {
    try {
      const status = await spot.fetchOrder(userId, reference);
      const normalized = status?.status?.toUpperCase();
      if (normalized === 'FILLED') {
        return markFilled();
      }
      if (normalized === 'CANCELED' || normalized === 'PENDING_CANCEL' || normalized === 'EXPIRED') {
        return markCanceled();
      }
    } catch {}
    return markCanceled();
  };
  try {
    const res = await spot.cancelOrder(userId, reference);
    const status = typeof (res as { status?: string } | null)?.status === 'string'
      ? String((res as { status?: string }).status).toUpperCase()
      : undefined;
    if (status === 'FILLED') {
      return markFilled();
    }
    return markCanceled();
  } catch (err) {
    if (opts.exchange === 'binance') {
      const { code } = parseBinanceError(err);
      if (code === -2013) {
        return resolveStatusFromFetch();
      }
    }
    throw err;
  }
}
