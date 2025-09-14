import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { getLimitOrders } from './repos/limit-orders.js';
import { insertUser } from './repos/users.js';
import { insertAgent } from './repos/portfolio-workflow.js';
import { insertReviewResult } from './repos/agent-review-result.js';
import { db } from '../src/db/index.js';

vi.mock('../src/services/binance.js', () => ({
  fetchPairData: vi.fn().mockResolvedValue({ currentPrice: 100 }),
  fetchPairInfo: vi.fn().mockResolvedValue({
    symbol: 'BTCETH',
    baseAsset: 'BTC',
    quoteAsset: 'ETH',
    quantityPrecision: 8,
    pricePrecision: 8,
    minNotional: 0,
  }),
  createLimitOrder: vi.fn().mockResolvedValue({ orderId: 1 }),
}));

import { createRebalanceLimitOrder, createDecisionLimitOrders } from '../src/services/rebalance.js';
import { createLimitOrder, fetchPairData, fetchPairInfo } from '../src/services/binance.js';

describe('createRebalanceLimitOrder', () => {
  beforeEach(async () => {
    await db.query('TRUNCATE limit_order RESTART IDENTITY CASCADE');
  });
  it('saves execution with status and exec result', async () => {
    const log = { info: () => {}, error: () => {} } as unknown as FastifyBaseLogger;
    const userId = await insertUser('1');
    const agent = await insertAgent({
      userId,
      model: 'm',
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
    const reviewResultId = await insertReviewResult({ portfolioId: agent.id, log: '' });
    await createRebalanceLimitOrder({
      userId,
      tokens: ['BTC', 'ETH'],
      positions: [
        { sym: 'BTC', value_usdt: 50 },
        { sym: 'ETH', value_usdt: 150 },
      ],
      newAllocation: 50,
      log,
      reviewResultId,
    });

    const row = (await getLimitOrders())[0];

    expect(row.user_id).toBe(userId);
    expect(JSON.parse(row.planned_json)).toMatchObject({
      symbol: 'BTCETH',
      side: 'BUY',
      quantity: 0.5,
      price: 99.9,
      manuallyEdited: false,
    });
    expect(row.status).toBe('open');
    expect(row.review_result_id).toBe(reviewResultId);
    expect(row.order_id).toBe('1');
    expect(createLimitOrder).toHaveBeenCalledWith(userId, {
      symbol: 'BTCETH',
      side: 'BUY',
      quantity: 0.5,
      price: 99.9,
    });
  });

  it('handles pairs where second token is the base asset', async () => {
    const log = { info: () => {}, error: () => {} } as unknown as FastifyBaseLogger;
    const userId = await insertUser('5');
    const agent = await insertAgent({
      userId,
      model: 'm',
      status: 'active',
      startBalance: null,
      name: 'A',
      tokens: [
        { token: 'ETH', minAllocation: 10 },
        { token: 'BTC', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      manualRebalance: false,
      useEarn: true,
    });
    const reviewResultId = await insertReviewResult({ portfolioId: agent.id, log: '' });
    await createRebalanceLimitOrder({
      userId,
      tokens: ['ETH', 'BTC'],
      positions: [
        { sym: 'ETH', value_usdt: 50 },
        { sym: 'BTC', value_usdt: 150 },
      ],
      newAllocation: 50,
      log,
      reviewResultId,
    });
    const row = (await getLimitOrders())[0];
    expect(JSON.parse(row.planned_json)).toMatchObject({
      symbol: 'BTCETH',
      side: 'SELL',
      quantity: 0.5,
      price: 100.1,
      manuallyEdited: false,
    });
    expect(createLimitOrder).toHaveBeenCalledWith(userId, {
      symbol: 'BTCETH',
      side: 'SELL',
      quantity: 0.5,
      price: 100.1,
    });
  });

  it('allows manual overrides and sets flag', async () => {
    const log = { info: () => {}, error: () => {} } as unknown as FastifyBaseLogger;
    const userId = await insertUser('2');
    const agent = await insertAgent({
      userId,
      model: 'm',
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
    const reviewResultId = await insertReviewResult({ portfolioId: agent.id, log: '' });
    await createRebalanceLimitOrder({
      userId,
      tokens: ['BTC', 'ETH'],
      positions: [
        { sym: 'BTC', value_usdt: 50 },
        { sym: 'ETH', value_usdt: 150 },
      ],
      newAllocation: 50,
      log,
      reviewResultId,
      price: 120,
      quantity: 0.3,
      manuallyEdited: true,
    });
    const row = (await getLimitOrders())[0];
    expect(JSON.parse(row.planned_json)).toMatchObject({
      symbol: 'BTCETH',
      side: 'BUY',
      quantity: 0.3,
      price: 120,
      manuallyEdited: true,
    });
  });

  it('skips orders below minimum value', async () => {
    const log = { info: () => {}, error: () => {} } as unknown as FastifyBaseLogger;
    const userId = await insertUser('3');
    const agent = await insertAgent({
      userId,
      model: 'm',
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
    const reviewResultId = await insertReviewResult({ portfolioId: agent.id, log: '' });
    vi.mocked(createLimitOrder).mockClear();
    await createRebalanceLimitOrder({
      userId,
      tokens: ['BTC', 'ETH'],
      positions: [
        { sym: 'BTC', value_usdt: 100 },
        { sym: 'ETH', value_usdt: 99.99 },
      ],
      newAllocation: 50,
      log,
      reviewResultId,
    });
    const rows = await getLimitOrders();
    expect(rows).toHaveLength(0);
    expect(createLimitOrder).not.toHaveBeenCalled();
  });

  it('skips orders below exchange min notional', async () => {
    const log = { info: () => {}, error: () => {} } as unknown as FastifyBaseLogger;
    const userId = await insertUser('7');
    const agent = await insertAgent({
      userId,
      model: 'm',
      status: 'active',
      startBalance: null,
      name: 'A',
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'USDT', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      manualRebalance: false,
      useEarn: true,
    });
    const reviewResultId = await insertReviewResult({ portfolioId: agent.id, log: '' });
    vi.mocked(fetchPairData).mockResolvedValueOnce({ currentPrice: 1 });
    vi.mocked(fetchPairInfo).mockResolvedValueOnce({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      quantityPrecision: 8,
      pricePrecision: 8,
      minNotional: 10,
    });
    vi.mocked(createLimitOrder).mockClear();
    await createRebalanceLimitOrder({
      userId,
      tokens: ['BTC', 'USDT'],
      positions: [
        { sym: 'BTC', value_usdt: 95 },
        { sym: 'USDT', value_usdt: 105 },
      ],
      newAllocation: 50,
      log,
      reviewResultId,
    });
    const rows = await getLimitOrders();
    expect(rows).toHaveLength(0);
    expect(createLimitOrder).not.toHaveBeenCalled();
  });

  it('rounds price and quantity to exchange precision', async () => {
    const log = { info: () => {}, error: () => {} } as unknown as FastifyBaseLogger;
    const userId = await insertUser('4');
    const agent = await insertAgent({
      userId,
      model: 'm',
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
    const reviewResultId = await insertReviewResult({ portfolioId: agent.id, log: '' });
    vi.mocked(fetchPairInfo).mockResolvedValueOnce({
      symbol: 'BTCETH',
      baseAsset: 'BTC',
      quoteAsset: 'ETH',
      quantityPrecision: 3,
      pricePrecision: 2,
      minNotional: 0,
    });
    await createRebalanceLimitOrder({
      userId,
      tokens: ['BTC', 'ETH'],
      positions: [
        { sym: 'BTC', value_usdt: 50 },
        { sym: 'ETH', value_usdt: 150 },
      ],
      newAllocation: 50,
      log,
      reviewResultId,
      price: 1.2345,
      quantity: 0.123456,
      manuallyEdited: true,
    });
    expect(createLimitOrder).toHaveBeenCalledWith(userId, {
      symbol: 'BTCETH',
      side: 'BUY',
      quantity: 0.123,
      price: 1.23,
    });
  });
});

describe('createDecisionLimitOrders', () => {
  beforeEach(async () => {
    await db.query('TRUNCATE limit_order RESTART IDENTITY CASCADE');
    vi.mocked(createLimitOrder).mockClear();
  });

  it('keeps side when quantity is given in quote asset', async () => {
    const log = { info: () => {}, error: () => {} } as unknown as FastifyBaseLogger;
    const userId = await insertUser('10');
    const agent = await insertAgent({
      userId,
      model: 'm',
      status: 'active',
      startBalance: null,
      name: 'A',
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'USDT', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      manualRebalance: false,
      useEarn: true,
    });
    const reviewResultId = await insertReviewResult({ portfolioId: agent.id, log: '' });
    vi.mocked(fetchPairInfo).mockResolvedValueOnce({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      quantityPrecision: 8,
      pricePrecision: 8,
      minNotional: 0,
    });
    await createDecisionLimitOrders({
      userId,
      orders: [{ pair: 'BTCUSDT', token: 'USDT', side: 'BUY', quantity: 100 }],
      reviewResultId,
      log,
    });
    const row = (await getLimitOrders())[0];
    expect(JSON.parse(row.planned_json)).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: 1,
      price: 99.9,
      manuallyEdited: false,
    });
    expect(createLimitOrder).toHaveBeenCalledWith(userId, {
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: 1,
      price: 99.9,
    });
  });
});
