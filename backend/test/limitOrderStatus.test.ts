import { describe, it, expect } from 'vitest';
import { insertUser } from './repos/users.js';
import { insertAgent } from './repos/portfolio-workflow.js';
import { insertReviewResult } from '../src/repos/review-result';
import {
  insertLimitOrder,
  getLimitOrder,
} from './repos/limit-orders.js';
import { updateLimitOrderStatus } from '../src/repos/limit-orders.js';

/**
 * Regression test for an issue where cancellation reason persisted
 * after an order was filled.
 */
describe('updateLimitOrderStatus', () => {
  it('clears cancellation reason when order is filled', async () => {
    const userId = await insertUser('24');
    const agent = await insertAgent({
      userId,
      model: 'gpt',
      status: 'active',
      startBalance: null,
      name: 'A',
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
      portfolioId: agent.id,
      log: '',
    });
    await insertLimitOrder({
      userId,
      planned: { side: 'BUY', quantity: 1, price: 100, symbol: 'BTCETH' },
      status: 'open',
      reviewResultId,
      orderId: '42',
    });
    await updateLimitOrderStatus(
      userId,
      '42',
      'canceled',
      'Could not fill within interval',
    );
    let row = await getLimitOrder('42');
    expect(row?.status).toBe('canceled');
    expect(row?.cancellation_reason).toBe('Could not fill within interval');
    await updateLimitOrderStatus(userId, '42', 'filled');
    row = await getLimitOrder('42');
    expect(row?.status).toBe('filled');
    expect(row?.cancellation_reason).toBeNull();
  });
});
