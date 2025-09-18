import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import {
  getOpenLimitOrdersForWorkflow,
  updateLimitOrderStatus,
} from '../repos/limit-orders.js';
import { cancelLimitOrder } from './limit-order.js';

export const userIdParams = z.object({ id: z.string().regex(/^\d+$/) });

export async function cancelOrdersForWorkflow(
  workflowId: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const openOrders = await getOpenLimitOrdersForWorkflow(workflowId);
  for (const order of openOrders) {
    let symbol: string | undefined;
    try {
      const planned = JSON.parse(order.plannedJson);
      if (typeof planned.symbol === 'string') symbol = planned.symbol;
    } catch (err) {
      log.error({ err, orderId: order.orderId }, 'failed to parse planned order');
    }
    if (!symbol) {
      await updateLimitOrderStatus(
        order.userId,
        order.orderId,
        'canceled',
        'API key removed',
      );
      continue;
    }
    try {
      await cancelLimitOrder(order.userId, {
        symbol,
        orderId: order.orderId,
        reason: 'API key removed',
      });
    } catch (err) {
      log.error({ err, orderId: order.orderId }, 'failed to cancel order');
    }
  }
}
