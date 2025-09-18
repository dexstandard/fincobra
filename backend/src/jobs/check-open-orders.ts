import type { FastifyBaseLogger } from 'fastify';
import {
  getAllOpenLimitOrders,
  updateLimitOrderStatus,
} from '../repos/limit-orders.js';
import type { LimitOrderOpen } from '../repos/limit-orders.types.js';
import {
  fetchOpenOrders,
  fetchOrder,
  parseBinanceError,
  type OpenOrder,
} from '../services/binance.js';
import { cancelLimitOrder } from '../services/limit-order.js';

interface GroupedOrder extends LimitOrderOpen {
  planned: { symbol: string };
}

const CLOSED_ORDER_STATUSES = new Set([
  'CANCELED',
  'PENDING_CANCEL',
  'EXPIRED',
  'REJECTED',
  'EXPIRED_IN_MATCH',
]);

export default async function checkOpenOrders(log: FastifyBaseLogger) {
  const orders = await getAllOpenLimitOrders();
  if (!orders.length) return;

  const groups = groupByUserAndSymbol(orders);
  for (const list of groups.values()) {
    await reconcileGroup(log, list);
  }
}

function groupByUserAndSymbol(orders: LimitOrderOpen[]) {
  const groups = new Map<string, GroupedOrder[]>();
  for (const o of orders) {
    const planned = JSON.parse(o.plannedJson) as { symbol: string };
    const key = `${o.userId}-${planned.symbol}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ ...o, planned });
  }
  return groups;
}

async function reconcileGroup(log: FastifyBaseLogger, list: GroupedOrder[]) {
  const { userId, planned } = list[0];
  let open: OpenOrder[] = [];
  try {
    const res = await fetchOpenOrders(userId, { symbol: planned.symbol });
    open = Array.isArray(res) ? res : [];
  } catch (err) {
    log.error({ err }, 'failed to fetch open orders');
    return;
  }
  for (const o of list) {
    await reconcileOrder(log, o, planned.symbol, open);
  }
}

async function resolveClosedStatus(
  log: FastifyBaseLogger,
  order: GroupedOrder,
  symbol: string,
): Promise<'filled' | 'canceled' | null> {
  const orderId = Number(order.orderId);
  if (!Number.isFinite(orderId)) {
    log.error(
      { orderId: order.orderId },
      'invalid order id while reconciling limit order',
    );
    return null;
  }

  try {
    const res = await fetchOrder(order.userId, { symbol, orderId });
    if (!res || !res.status) {
      log.error(
        { orderId: order.orderId },
        'missing Binance order status while reconciling',
      );
      return null;
    }
    const status = res.status.toUpperCase();
    if (status === 'FILLED') return 'filled';
    if (CLOSED_ORDER_STATUSES.has(status)) return 'canceled';
    log.error(
      { orderId: order.orderId, status },
      'unexpected Binance order status while reconciling',
    );
    return null;
  } catch (err) {
    const { code } = parseBinanceError(err);
    if (code === -2013) return 'canceled';
    log.error(
      { err, orderId: order.orderId },
      'failed to fetch Binance order while reconciling',
    );
    return null;
  }
}

async function reconcileOrder(
  log: FastifyBaseLogger,
  o: GroupedOrder,
  symbol: string,
  open: OpenOrder[],
) {
  const exists = open.some((r) => String(r.orderId) === o.orderId);
  if (!exists) {
    const status = await resolveClosedStatus(log, o, symbol);
    if (status === 'filled') {
      await updateLimitOrderStatus(o.userId, o.orderId, 'filled');
    } else if (status === 'canceled') {
      await updateLimitOrderStatus(o.userId, o.orderId, 'canceled');
    }
    return;
  }
  if (o.workflowStatus !== 'active') {
    try {
      await cancelLimitOrder(o.userId, {
        symbol,
        orderId: o.orderId,
        reason: 'Workflow inactive',
      });
    } catch (err) {
      log.error({ err }, 'failed to cancel order');
    }
  }
}
