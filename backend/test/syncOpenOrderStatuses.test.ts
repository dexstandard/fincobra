import { describe, it, expect, beforeEach, vi } from 'vitest';
import { syncOpenOrderStatuses } from '../src/services/order-orchestrator.js';
import { insertUser } from './repos/users.js';
import { insertAgent } from './repos/portfolio-workflow.js';
import { insertReviewResult } from './repos/review-result.js';
import {
  insertLimitOrder,
  getLimitOrder,
} from './repos/limit-orders.js';
import { mockLogger } from './helpers.js';

const { fetchOpenOrders, fetchOrder, parseBinanceError } = vi.hoisted(() => ({
  fetchOpenOrders: vi.fn(),
  fetchOrder: vi.fn(),
  parseBinanceError: vi.fn(),
}));

vi.mock('../src/services/binance.js', () => ({
  fetchOpenOrders,
  fetchOrder,
  parseBinanceError,
}));

vi.mock('../src/services/limit-order.js', () => ({
  cancelLimitOrder: vi.fn(),
}));

describe('syncOpenOrderStatuses', () => {
  beforeEach(() => {
    fetchOpenOrders.mockReset();
    fetchOrder.mockReset();
    parseBinanceError.mockReset();
    fetchOpenOrders.mockResolvedValue([]);
    parseBinanceError.mockReturnValue({});
  });

  async function setupOrder(orderId = '123') {
    const userId = await insertUser('user-1');
    const agent = await insertAgent({
      userId,
      model: 'gpt',
      status: 'active',
      startBalance: null,
      name: 'A',
      tokens: [
        { token: 'SOL', minAllocation: 10 },
        { token: 'USDT', minAllocation: 10 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      manualRebalance: false,
      useEarn: false,
    });
    const reviewResultId = await insertReviewResult({
      portfolioWorkflowId: agent.id,
      log: 'log',
      rebalance: true,
      newAllocation: 50,
      shortReport: 's',
    });
    await insertLimitOrder({
      userId,
      planned: { symbol: 'SOLUSDT', side: 'BUY', quantity: 0.1, price: 10 },
      status: 'open',
      reviewResultId,
      orderId,
    });
    return { orderId };
  }

  it('marks missing orders as canceled when Binance reports cancellation', async () => {
    const { orderId } = await setupOrder();
    fetchOrder.mockResolvedValueOnce({ status: 'CANCELED' });

    await syncOpenOrderStatuses(mockLogger());

    const order = await getLimitOrder(orderId);
    expect(order?.status).toBe('canceled');
  });

  it('marks missing orders as filled when Binance reports filled status', async () => {
    const { orderId } = await setupOrder('456');
    fetchOrder.mockResolvedValueOnce({ status: 'FILLED' });

    await syncOpenOrderStatuses(mockLogger());

    const order = await getLimitOrder(orderId);
    expect(order?.status).toBe('filled');
  });

  it('marks missing orders as canceled when Binance returns unknown order error', async () => {
    const { orderId } = await setupOrder('789');
    fetchOrder.mockRejectedValueOnce(new Error('err'));
    parseBinanceError.mockReturnValueOnce({ code: -2013 });

    await syncOpenOrderStatuses(mockLogger());

    const order = await getLimitOrder(orderId);
    expect(order?.status).toBe('canceled');
  });
});
