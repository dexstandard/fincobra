import { describe, it, expect, beforeEach, vi } from 'vitest';
import { syncOpenOrderStatuses } from '../src/services/order-orchestrator.js';
import { CANCEL_ORDER_REASONS } from '../src/services/order-orchestrator.types.js';
import { insertUser } from './repos/users.js';
import { insertPortfolioWorkflow } from './repos/portfolio-workflows.js';
import { insertReviewResult } from './repos/review-result.js';
import { insertLimitOrder, getLimitOrder } from './repos/limit-orders.js';
import { LimitOrderStatus } from '../src/repos/limit-orders.types.js';
import { updateLimitOrderStatus } from '../src/repos/limit-orders.js';
import { mockLogger } from './helpers.js';

const { fetchOpenOrders, fetchOrder, parseBinanceError } = vi.hoisted(() => ({
  fetchOpenOrders: vi.fn(),
  fetchOrder: vi.fn(),
  parseBinanceError: vi.fn(),
}));

vi.mock('../src/services/binance-client.js', () => ({
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
    const agent = await insertPortfolioWorkflow({
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
      planned: { symbol: 'SOLUSDT', side: 'BUY', qty: 0.1, price: 10 },
      status: LimitOrderStatus.Open,
      reviewResultId,
      orderId,
    });
    return { orderId, userId };
  }

  it('marks missing orders as canceled when Binance reports cancellation', async () => {
    const { orderId } = await setupOrder();
    fetchOrder.mockResolvedValueOnce({ status: 'CANCELED' });

    await syncOpenOrderStatuses(mockLogger());

    const order = await getLimitOrder(orderId);
    expect(order?.status).toBe(LimitOrderStatus.Canceled);
    expect(order?.cancellation_reason).toBe(
      'Binance canceled the order (status CANCELED)',
    );
  });

  it('marks missing orders as filled when Binance reports filled status', async () => {
    const { orderId } = await setupOrder('456');
    fetchOrder.mockResolvedValueOnce({ status: 'FILLED' });

    await syncOpenOrderStatuses(mockLogger());

    const order = await getLimitOrder(orderId);
    expect(order?.status).toBe(LimitOrderStatus.Filled);
  });

  it('marks missing orders as canceled when Binance returns unknown order error', async () => {
    const { orderId } = await setupOrder('789');
    fetchOrder.mockRejectedValueOnce(new Error('err'));
    parseBinanceError.mockReturnValueOnce({
      code: -2013,
      msg: 'Order does not exist.',
    });

    await syncOpenOrderStatuses(mockLogger());

    const order = await getLimitOrder(orderId);
    expect(order?.status).toBe(LimitOrderStatus.Canceled);
    expect(order?.cancellation_reason).toBe('Binance: Order does not exist.');
  });

  it('falls back to a generic message when Binance omits the unknown order error message', async () => {
    const { orderId } = await setupOrder('101112');
    fetchOrder.mockRejectedValueOnce(new Error('err'));
    parseBinanceError.mockReturnValueOnce({ code: -2013 });

    await syncOpenOrderStatuses(mockLogger());

    const order = await getLimitOrder(orderId);
    expect(order?.status).toBe(LimitOrderStatus.Canceled);
    expect(order?.cancellation_reason).toBe(
      'Binance could not find the order (code -2013)',
    );
  });

  it('does not overwrite local cancellation reasons during reconciliation', async () => {
    const { orderId, userId } = await setupOrder('131415');
    fetchOrder.mockImplementationOnce(async () => {
      await updateLimitOrderStatus(
        userId,
        orderId,
        LimitOrderStatus.Canceled,
        CANCEL_ORDER_REASONS.WORKFLOW_STOPPED,
      );
      return { status: 'CANCELED' };
    });

    await syncOpenOrderStatuses(mockLogger());

    const order = await getLimitOrder(orderId);
    expect(order?.status).toBe(LimitOrderStatus.Canceled);
    expect(order?.cancellation_reason).toBe(
      CANCEL_ORDER_REASONS.WORKFLOW_STOPPED,
    );
  });
});
