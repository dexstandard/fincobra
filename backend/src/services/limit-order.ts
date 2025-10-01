import {
  cancelOrder,
  fetchOrder,
  parseBinanceError,
} from './binance-client.js';
import { updateLimitOrderStatus } from '../repos/limit-orders.js';
import { LimitOrderStatus } from '../repos/limit-orders.types.js';

export async function cancelLimitOrder(
  userId: string,
  opts: { symbol: string; orderId: string; reason: string },
): Promise<LimitOrderStatus> {
  try {
    const res = await cancelOrder(userId, {
      symbol: opts.symbol,
      orderId: Number(opts.orderId),
    });
    if (res && res.status === 'FILLED') {
      await updateLimitOrderStatus(
        userId,
        opts.orderId,
        LimitOrderStatus.Filled,
      );
      return LimitOrderStatus.Filled;
    }
    await updateLimitOrderStatus(
      userId,
      opts.orderId,
      LimitOrderStatus.Canceled,
      opts.reason,
    );
    return LimitOrderStatus.Canceled;
  } catch (err) {
    const { code } = parseBinanceError(err);
    if (code === -2013) {
      try {
        const order = await fetchOrder(userId, {
          symbol: opts.symbol,
          orderId: Number(opts.orderId),
        });
        const status = order?.status?.toUpperCase();
        if (status === 'FILLED') {
          await updateLimitOrderStatus(
            userId,
            opts.orderId,
            LimitOrderStatus.Filled,
          );
          return LimitOrderStatus.Filled;
        }
        if (
          status === 'CANCELED' ||
          status === 'PENDING_CANCEL' ||
          status === 'EXPIRED'
        ) {
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
    throw err;
  }
}
