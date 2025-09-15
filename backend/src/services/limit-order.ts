import { cancelOrder, parseBinanceError } from './binance.js';
import { updateLimitOrderStatus } from '../repos/limit-orders.js';

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
    await updateLimitOrderStatus(
      userId,
      opts.orderId,
      'canceled',
      opts.reason,
    );
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
