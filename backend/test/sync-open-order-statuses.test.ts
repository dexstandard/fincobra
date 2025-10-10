import { describe, it, beforeEach, expect, vi } from 'vitest';
import { syncOpenOrderStatuses } from '../src/services/order-orchestrator.js';
import { insertUser } from './repos/users.js';
import { insertPortfolioWorkflow } from './repos/portfolio-workflows.js';
import { insertReviewResult } from './repos/review-result.js';
import { insertLimitOrder, getLimitOrder } from './repos/limit-orders.js';
import { LimitOrderStatus } from '../src/repos/limit-orders.types.js';
import { mockLogger } from './helpers.js';
import { db } from '../src/db/index.js';

const gatewaySpotMock = vi.hoisted(() => ({
  fetchOpenOrders: vi.fn(),
  fetchOrder: vi.fn(),
  cancelOrder: vi.fn(),
}));

vi.mock('../src/services/exchange-gateway.js', () => ({
  getExchangeGateway: vi.fn(() => ({
    metadata: { fetchMarket: vi.fn(), fetchTicker: vi.fn() },
    spot: gatewaySpotMock,
  })),
}));

vi.mock('../src/services/limit-order.js', () => ({
  cancelLimitOrder: vi.fn(),
}));

import { getExchangeGateway } from '../src/services/exchange-gateway.js';
import { cancelLimitOrder } from '../src/services/limit-order.js';

async function createOpenOrder(
  orderId = '123',
  status: LimitOrderStatus = LimitOrderStatus.Open,
) {
  const userId = await insertUser('sync-user');
  const workflow = await insertPortfolioWorkflow({
    userId,
    model: 'm',
    status: 'active',
    startBalance: null,
    tokens: [
      { token: 'BTC', minAllocation: 10 },
      { token: 'USDT', minAllocation: 10 },
    ],
    risk: 'low',
    reviewInterval: '1h',
    agentInstructions: 'inst',
    manualRebalance: false,
    useEarn: false,
  });
  const reviewResultId = await insertReviewResult({
    portfolioWorkflowId: workflow.id,
    log: '{}',
  });
  await insertLimitOrder({
    userId,
    planned: { symbol: 'BTCUSDT', side: 'BUY', qty: 1, price: 100, exchange: 'binance' },
    status,
    reviewResultId,
    orderId,
  });
  return { userId, orderId, workflowId: workflow.id };
}

describe('syncOpenOrderStatuses', () => {
  beforeEach(() => {
    gatewaySpotMock.fetchOpenOrders.mockReset();
    gatewaySpotMock.fetchOrder.mockReset();
    gatewaySpotMock.cancelOrder.mockReset();
    gatewaySpotMock.fetchOpenOrders.mockResolvedValue([]);
    vi.mocked(getExchangeGateway).mockClear();
  });

  it('marks missing orders as filled when exchange reports filled status', async () => {
    const { orderId } = await createOpenOrder('1001');
    gatewaySpotMock.fetchOrder.mockResolvedValueOnce({ status: 'FILLED' });

    await syncOpenOrderStatuses(mockLogger());

    const order = await getLimitOrder(orderId);
    expect(order?.status).toBe(LimitOrderStatus.Filled);
  });

  it('records cancellation reason when exchange closes order', async () => {
    const { orderId } = await createOpenOrder('1002');
    gatewaySpotMock.fetchOrder.mockResolvedValueOnce({ status: 'CANCELED' });

    await syncOpenOrderStatuses(mockLogger());

    const order = await getLimitOrder(orderId);
    expect(order?.status).toBe(LimitOrderStatus.Canceled);
    expect(order?.cancellation_reason).toContain('Binance canceled the order');
  });

  it('cancels outstanding orders when workflow is inactive', async () => {
    const { orderId, userId, workflowId } = await createOpenOrder('1003');
    vi.mocked(cancelLimitOrder).mockResolvedValueOnce(LimitOrderStatus.Canceled);
    // Return open order to simulate presence on exchange
    gatewaySpotMock.fetchOpenOrders.mockResolvedValueOnce([
      { orderId, symbol: 'BTCUSDT' },
    ]);

    await db.query("UPDATE portfolio_workflow SET status = 'inactive' WHERE id = $1", [workflowId]);

    await syncOpenOrderStatuses(mockLogger());

    expect(cancelLimitOrder).toHaveBeenCalledWith(userId, {
      symbol: 'BTCUSDT',
      orderId,
      reason: 'Workflow inactive',
      exchange: 'binance',
    });
  });
});

