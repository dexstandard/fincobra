import { describe, it, expect, vi } from 'vitest';
import buildServer from '../src/server.js';
import { insertUserWithKeys } from './repos/users.js';
import { insertAgent } from './repos/portfolio-workflow.js';
import { insertReviewResult } from './repos/review-result.js';
import { insertLimitOrder } from './repos/limit-orders.js';
import { getLimitOrdersByReviewResult } from '../src/repos/limit-orders.js';
import { LimitOrderStatus } from '../src/repos/limit-orders.types.js';
import { authCookies } from './helpers.js';
import * as orderOrchestrator from '../src/services/order-orchestrator.js';

vi.mock('../src/workflows/portfolio-review.js', () => ({
  reviewAgentPortfolio: vi.fn(() => Promise.resolve()),
  removeWorkflowFromSchedule: vi.fn(),
}));

const { cancelOrder } = vi.hoisted(() => ({
  cancelOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/services/binance-client.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/binance-client.js')>(
    '../src/services/binance-client.js',
  );
  return { ...actual, cancelOrder };
});

const cancelOrdersSpy = vi.spyOn(
  orderOrchestrator,
  'cancelOrdersForWorkflow',
);

describe('delete workflow cancels all orders', () => {
  it('cancels open orders for all symbols', async () => {
    cancelOrdersSpy.mockClear();
    const app = await buildServer();
    const userId = await insertUserWithKeys('multi');
    const agent = await insertAgent({
      userId,
      model: 'm',
      status: 'active',
      startBalance: null,
      name: 'A',
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'ETH', minAllocation: 20 },
        { token: 'SOL', minAllocation: 30 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      manualRebalance: false,
      useEarn: false,
    });
    const rrId = await insertReviewResult({ portfolioWorkflowId: agent.id, log: '' });
    await insertLimitOrder({
      userId,
      planned: { symbol: 'BTCETH' },
      status: LimitOrderStatus.Open,
      reviewResultId: rrId,
      orderId: '1',
    });
    await insertLimitOrder({
      userId,
      planned: { symbol: 'ETHSOL' },
      status: LimitOrderStatus.Open,
      reviewResultId: rrId,
      orderId: '2',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/portfolio-workflows/${agent.id}`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(cancelOrder).toHaveBeenCalledWith(userId, {
      symbol: 'BTCETH',
      orderId: 1,
    });
    expect(cancelOrder).toHaveBeenCalledWith(userId, {
      symbol: 'ETHSOL',
      orderId: 2,
    });
    expect(cancelOrder).toHaveBeenCalledTimes(2);
    expect(cancelOrdersSpy).toHaveBeenCalledTimes(1);
    expect(cancelOrdersSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: agent.id,
        reason: orderOrchestrator.CANCEL_ORDER_REASONS.WORKFLOW_DELETED,
      }),
    );
    const orders = await getLimitOrdersByReviewResult(agent.id, rrId);
    expect(orders.map((o) => o.status)).toEqual([LimitOrderStatus.Canceled, LimitOrderStatus.Canceled]);
    await app.close();
  });
});
