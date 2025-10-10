import type { FastifyBaseLogger } from 'fastify';
import {
  getAllOpenLimitOrders,
  getOpenLimitOrdersForWorkflow,
  updateLimitOrderStatus,
  updateLimitOrderStatusIfCurrent,
} from '../repos/limit-orders.js';
import {
  LimitOrderStatus,
  type LimitOrderOpen,
} from '../repos/limit-orders.types.js';
import { parseBinanceError } from './binance-client.js';
import { cancelLimitOrder } from './limit-order.js';
import { getExchangeGateway, type SupportedExchange } from './exchange-gateway.js';
import type {
  ExchangeGatewaySpotModule,
  ExchangeSpotOpenOrder,
} from './exchange-gateway.types.js';
import type { CancelOrderReason } from './order-orchestrator.types.js';

interface CancelOrdersForWorkflowOptions {
  workflowId: string;
  reason: CancelOrderReason;
  log: FastifyBaseLogger;
}

interface PlannedOrder {
  symbol: string;
  exchange: SupportedExchange;
}

interface GroupedOrder extends LimitOrderOpen {
  planned: PlannedOrder;
}

const CLOSED_ORDER_STATUS_DESCRIPTIONS: Record<string, string> = {
  CANCELED: 'canceled the order',
  PENDING_CANCEL: 'marked the order as pending cancellation',
  EXPIRED: 'expired the order before it could fill',
  REJECTED: 'rejected the order',
  EXPIRED_IN_MATCH: 'expired the order while matching',
};

const CLOSED_ORDER_STATUSES = new Set<string>(
  Object.keys(CLOSED_ORDER_STATUS_DESCRIPTIONS),
);

function formatExchangeName(exchange: SupportedExchange): string {
  return exchange.charAt(0).toUpperCase() + exchange.slice(1);
}

function resolveExternalCancellationReason(
  exchange: SupportedExchange,
  status: string,
): string {
  const description =
    CLOSED_ORDER_STATUS_DESCRIPTIONS[status] ?? 'closed the order';
  return `${formatExchangeName(exchange)} ${description} (status ${status})`;
}

function normalizeOrderStatus(value: unknown): string | null {
  if (typeof value === 'string') return value.toUpperCase();
  if (!value || typeof value !== 'object') return null;
  const maybeStatus = (value as { status?: unknown }).status;
  return typeof maybeStatus === 'string' ? maybeStatus.toUpperCase() : null;
}

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
    let planned: PlannedOrder;
    try {
      planned = parsePlannedOrder(order.plannedJson, order.orderId);
    } catch (err) {
      log.error({ err, orderId: order.orderId }, 'failed to parse planned order');
      await updateLimitOrderStatus(
        order.userId,
        order.orderId,
        LimitOrderStatus.Canceled,
        reason,
      );
      continue;
    }
    try {
      await cancelLimitOrder(order.userId, {
        symbol: planned.symbol,
        orderId: order.orderId,
        reason,
        exchange: planned.exchange,
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
    const key = `${order.userId}-${planned.exchange}-${planned.symbol}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ ...order, planned });
  }
  return groups;
}

async function reconcileGroup(log: FastifyBaseLogger, list: GroupedOrder[]) {
  const { userId, planned } = list[0];
  const gateway = getExchangeGateway(planned.exchange);
  const spot = gateway.spot;
  if (!spot) {
    log.error(
      { userId, exchange: planned.exchange },
      'spot trading not supported for exchange',
    );
    return;
  }
  let open: ExchangeSpotOpenOrder[] = [];
  try {
    const res = await spot.fetchOpenOrders(userId, { symbol: planned.symbol });
    open = Array.isArray(res) ? res : [];
  } catch (err) {
    log.error(
      { err, userId, symbol: planned.symbol, exchange: planned.exchange },
      'failed to fetch open orders',
    );
    return;
  }
  for (const order of list) {
    try {
      await reconcileOrder(log, order, planned.symbol, open, planned.exchange, spot);
    } catch (err) {
      log.error({ err, orderId: order.orderId }, 'failed to reconcile order');
    }
  }
}

type ResolvedClosedStatus =
  | { type: LimitOrderStatus.Filled }
  | { type: LimitOrderStatus.Canceled; reason: string };

async function resolveClosedStatus(
  log: FastifyBaseLogger,
  order: GroupedOrder,
  symbol: string,
  exchange: SupportedExchange,
  spot: ExchangeGatewaySpotModule,
): Promise<ResolvedClosedStatus | null> {
  const orderReference = {
    symbol,
    orderId: Number.isFinite(Number(order.orderId))
      ? Number(order.orderId)
      : order.orderId,
  } as const;

  try {
    const res = await spot.fetchOrder(order.userId, orderReference);
    const status = normalizeOrderStatus(res);
    if (!status) {
      log.error(
        { orderId: order.orderId, exchange },
        'missing order status while reconciling',
      );
      return null;
    }
    if (status === 'FILLED') return { type: LimitOrderStatus.Filled };
    if (CLOSED_ORDER_STATUSES.has(status)) {
      return {
        type: LimitOrderStatus.Canceled,
        reason: resolveExternalCancellationReason(exchange, status),
      };
    }
    log.error(
      { orderId: order.orderId, status, exchange },
      'unexpected order status while reconciling',
    );
    return null;
  } catch (err) {
    if (exchange === 'binance') {
      const { code, msg } = parseBinanceError(err);
      if (code === -2013) {
        const message = typeof msg === 'string' ? msg.trim() : '';
        return {
          type: LimitOrderStatus.Canceled,
          reason: message
            ? `Binance: ${message}`
            : 'Binance could not find the order (code -2013)',
        };
      }
    }
    log.error(
      { err, orderId: order.orderId, exchange },
      'failed to fetch order while reconciling',
    );
    return null;
  }
}

async function reconcileOrder(
  log: FastifyBaseLogger,
  order: GroupedOrder,
  symbol: string,
  open: ExchangeSpotOpenOrder[],
  exchange: SupportedExchange,
  spot: ExchangeGatewaySpotModule,
) {
  const exists = open.some(
    (entry) => String(entry.orderId ?? '') === order.orderId,
  );
  if (!exists) {
    const status = await resolveClosedStatus(log, order, symbol, exchange, spot);
    if (status?.type === LimitOrderStatus.Filled) {
      await updateLimitOrderStatus(
        order.userId,
        order.orderId,
        LimitOrderStatus.Filled,
      );
    } else if (status?.type === LimitOrderStatus.Canceled) {
      await updateLimitOrderStatusIfCurrent(
        order.userId,
        order.orderId,
        LimitOrderStatus.Open,
        LimitOrderStatus.Canceled,
        status.reason,
      );
    }
    return;
  }
  if (order.workflowStatus !== 'active') {
    try {
      await cancelLimitOrder(order.userId, {
        symbol,
        orderId: order.orderId,
        reason: 'Workflow inactive',
        exchange,
      });
    } catch (err) {
      log.error({ err }, 'failed to cancel order');
    }
  }
}

function resolvePlannedExchange(value: unknown): SupportedExchange {
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (normalized === 'bybit') return 'bybit';
  }
  return 'binance';
}

function parsePlannedOrder(plannedJson: string, orderId: string): PlannedOrder {
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
  const exchange = resolvePlannedExchange(parsed.exchange);
  return { symbol, exchange };
}
