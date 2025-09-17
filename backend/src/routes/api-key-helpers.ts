import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { getOpenLimitOrdersForWorkflow, updateLimitOrderStatus } from '../repos/limit-orders.js';
import { cancelLimitOrder } from '../services/limit-order.js';

export const userIdParams = z.object({ id: z.string().regex(/^\d+$/) });

export async function cancelOrdersForWorkflow(
  workflowId: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const openOrders = await getOpenLimitOrdersForWorkflow(workflowId);
  for (const order of openOrders) {
    let symbol: string | undefined;
    try {
      const planned = JSON.parse(order.planned_json);
      if (typeof planned.symbol === 'string') symbol = planned.symbol;
    } catch (err) {
      log.error({ err, orderId: order.order_id }, 'failed to parse planned order');
    }
    if (!symbol) {
      await updateLimitOrderStatus(
        order.user_id,
        order.order_id,
        'canceled',
        'API key removed',
      );
      continue;
    }
    try {
      await cancelLimitOrder(order.user_id, {
        symbol,
        orderId: order.order_id,
        reason: 'API key removed',
      });
    } catch (err) {
      log.error({ err, orderId: order.order_id }, 'failed to cancel order');
    }
  }
}
