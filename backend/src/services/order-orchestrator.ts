import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import {
  getAllOpenLimitOrders,
  getOpenLimitOrdersForWorkflow,
  updateLimitOrderStatus,
} from '../repos/limit-orders.js';
import type { LimitOrderOpen } from '../repos/limit-orders.types.js';
import {
  fetchOpenOrders,
  fetchOrder,
  parseBinanceError,
  type OpenOrder,
} from './binance.js';
import { cancelLimitOrder } from './limit-order.js';

export const userIdParams = z.object({ id: z.string().regex(/^\d+$/) });

export const CANCEL_ORDER_REASONS = {
  API_KEY_REMOVED: 'API key removed',
  WORKFLOW_DELETED: 'Workflow deleted',
  WORKFLOW_STOPPED: 'Workflow stopped',
} as const;

export type CancelOrderReason =
  (typeof CANCEL_ORDER_REASONS)[keyof typeof CANCEL_ORDER_REASONS];

interface CancelOrdersForWorkflowOptions {
  workflowId: string;
  reason: CancelOrderReason;
  log: FastifyBaseLogger;
}

interface PlannedOrder {
  symbol: string;
}

interface GroupedOrder extends LimitOrderOpen {
  planned: PlannedOrder;
}

const CLOSED_ORDER_STATUSES = new Set([
  'CANCELED',
  'PENDING_CANCEL',
  'EXPIRED',
  'REJECTED',
  'EXPIRED_IN_MATCH',
]);

export async function syncOpenOrderStatuses(
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    const orders = await getAllOpenLimitOrders();
    if (!orders.length) return;

    const groups = groupByUserAndSymbol(orders);
    for (const list of groups.values()) {
      try {
        await reconcileGroup(log, list);
      } catch (err) {
        const details = list[0];
        log.error(
          {
            err,
            userId: details?.userId,
            symbol: details?.planned?.symbol,
          },
          'failed to reconcile order group',
        );
      }
    }
  } catch (err) {
    log.error({ err }, 'failed to sync open order statuses');
  }
}

export async function cancelOrdersForWorkflow({
  workflowId,
  reason,
  log,
}: CancelOrdersForWorkflowOptions): Promise<void> {
  const openOrders = await getOpenLimitOrdersForWorkflow(workflowId);
  for (const order of openOrders) {
    const symbol = parsePlannedOrderSymbol(order.plannedJson, log, order.orderId);
    if (!symbol) {
      await updateLimitOrderStatus(order.userId, order.orderId, 'canceled', reason);
      continue;
    }
    try {
      await cancelLimitOrder(order.userId, {
        symbol,
        orderId: order.orderId,
        reason,
      });
    } catch (err) {
      log.error({ err, orderId: order.orderId }, 'failed to cancel order');
    }
  }
}

function groupByUserAndSymbol(orders: LimitOrderOpen[]) {
  const groups = new Map<string, GroupedOrder[]>();
  for (const order of orders) {
    const planned = parsePlannedOrder(order.plannedJson, order.orderId);
    const key = `${order.userId}-${planned.symbol}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ ...order, planned });
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
  for (const order of list) {
    await reconcileOrder(log, order, planned.symbol, open);
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
  order: GroupedOrder,
  symbol: string,
  open: OpenOrder[],
) {
  const exists = open.some((entry) => String(entry.orderId) === order.orderId);
  if (!exists) {
    const status = await resolveClosedStatus(log, order, symbol);
    if (status === 'filled') {
      await updateLimitOrderStatus(order.userId, order.orderId, 'filled');
    } else if (status === 'canceled') {
      await updateLimitOrderStatus(order.userId, order.orderId, 'canceled');
    }
    return;
  }
  if (order.workflowStatus !== 'active') {
    try {
      await cancelLimitOrder(order.userId, {
        symbol,
        orderId: order.orderId,
        reason: 'Workflow inactive',
      });
    } catch (err) {
      log.error({ err }, 'failed to cancel order');
    }
  }
}

function parsePlannedOrderSymbol(
  plannedJson: string,
  log: FastifyBaseLogger,
  orderId: string,
): string | undefined {
  try {
    return parsePlannedOrder(plannedJson, orderId).symbol;
  } catch (err) {
    log.error({ err, orderId }, 'failed to parse planned order');
    return undefined;
  }
}

function parsePlannedOrder(
  plannedJson: string,
  orderId: string,
): PlannedOrder {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(plannedJson) as Record<string, unknown> | null;
  } catch {
    throw new Error(`failed to parse planned order ${orderId}`);
  }
  if (!parsed) {
    throw new Error(`missing planned order data ${orderId}`);
  }
  const symbol = parsed.symbol;
  if (typeof symbol !== 'string') {
    throw new Error(`missing planned order symbol ${orderId}`);
  }
  return { symbol };
}
