import type { FastifyBaseLogger } from 'fastify';
import {
  getAllOpenLimitOrders,
  updateLimitOrderStatus,
} from '../repos/limit-orders.js';
import {
  cancelOrder,
  fetchOpenOrders,
  parseBinanceError,
  type OpenOrder,
} from '../services/binance.js';

interface Order {
  user_id: string;
  order_id: string;
  agent_status: string;
  planned_json: string;
}

interface GroupedOrder extends Order {
  planned: { symbol: string };
}

export default async function checkOpenOrders(log: FastifyBaseLogger) {
  const orders = await getAllOpenLimitOrders();
  if (!orders.length) return;

  const groups = groupByUserAndSymbol(orders);
  for (const list of groups.values()) {
    await reconcileGroup(log, list);
  }
}

function groupByUserAndSymbol(orders: Order[]) {
  const groups = new Map<string, GroupedOrder[]>();
  for (const o of orders) {
    const planned = JSON.parse(o.planned_json) as { symbol: string };
    const key = `${o.user_id}-${planned.symbol}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ ...o, planned });
  }
  return groups;
}

async function reconcileGroup(log: FastifyBaseLogger, list: GroupedOrder[]) {
  const { user_id, planned } = list[0];
  let open: OpenOrder[] = [];
  try {
    const res = await fetchOpenOrders(user_id, { symbol: planned.symbol });
    open = Array.isArray(res) ? res : [];
  } catch (err) {
    log.error({ err }, 'failed to fetch open orders');
    return;
  }
  for (const o of list) {
    await reconcileOrder(log, o, planned.symbol, open);
  }
}

async function reconcileOrder(
  log: FastifyBaseLogger,
  o: GroupedOrder,
  symbol: string,
  open: OpenOrder[],
) {
  const exists = open.some((r) => String(r.orderId) === o.order_id);
  if (!exists) {
    await updateLimitOrderStatus(o.user_id, o.order_id, 'filled');
    return;
  }
  if (o.agent_status !== 'active') {
    try {
      await cancelOrder(o.user_id, {
        symbol,
        orderId: Number(o.order_id),
      });
      await updateLimitOrderStatus(o.user_id, o.order_id, 'canceled');
    } catch (err) {
      const { code } = parseBinanceError(err);
      if (code === -2013) {
        await updateLimitOrderStatus(o.user_id, o.order_id, 'filled');
      } else {
        log.error({ err }, 'failed to cancel order');
      }
    }
  }
}
