import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import {
  getOpenLimitOrdersForWorkflow,
  updateLimitOrderStatus,
} from '../repos/limit-orders.js';
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

function parsePlannedOrderSymbol(
  plannedJson: string,
  log: FastifyBaseLogger,
  orderId: string,
): string | undefined {
  try {
    const planned = JSON.parse(plannedJson);
    if (typeof planned.symbol === 'string') return planned.symbol;
  } catch (err) {
    log.error({ err, orderId }, 'failed to parse planned order');
  }
  return undefined;
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
