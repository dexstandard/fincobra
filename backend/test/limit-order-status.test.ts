import { describe, it, expect } from 'vitest';
import { insertUser } from './repos/users.js';
import { insertPortfolioWorkflow } from './repos/portfolio-workflows.js';
import { insertReviewResult } from '../src/repos/review-result.js';
import { insertLimitOrder, getLimitOrder } from './repos/limit-orders.js';
import { LimitOrderStatus } from '../src/repos/limit-orders.types.js';
import { updateLimitOrderStatus } from '../src/repos/limit-orders.js';

/**
 * Regression test for an issue where cancellation reason persisted
 * after an order was filled.
 */
describe('updateLimitOrderStatus', () => {
  it('clears cancellation reason when order is filled', async () => {
    const userId = await insertUser('24');
    const agent = await insertPortfolioWorkflow({
      userId,
      model: 'gpt',
      status: 'active',
      startBalance: null,
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'ETH', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      manualRebalance: false,
      useEarn: true,
    });
    const reviewResultId = await insertReviewResult({
      portfolioWorkflowId: agent.id,
      log: '',
    });
    await insertLimitOrder({
      userId,
      planned: { side: 'BUY', qty: 1, price: 100, symbol: 'BTCETH' },
      status: LimitOrderStatus.Open,
      reviewResultId,
      orderId: '42',
    });
    await updateLimitOrderStatus(
      userId,
      '42',
      LimitOrderStatus.Canceled,
      'Could not fill within interval',
    );
    let row = await getLimitOrder('42');
    expect(row?.status).toBe(LimitOrderStatus.Canceled);
    expect(row?.cancellation_reason).toBe('Could not fill within interval');
    await updateLimitOrderStatus(userId, '42', LimitOrderStatus.Filled);
    row = await getLimitOrder('42');
    expect(row?.status).toBe(LimitOrderStatus.Filled);
    expect(row?.cancellation_reason).toBeNull();
  });
});
