import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLimitOrders, clearLimitOrders } from './repos/limit-orders.js';
import { LimitOrderStatus } from '../src/repos/limit-orders.types.js';
import { mockLogger } from './helpers.js';
import { insertUser } from './repos/users.js';
import { insertAgent } from './repos/portfolio-workflow.js';
import { insertReviewResult } from './repos/review-result.js';
import { db } from '../src/db/index.js';

vi.mock('../src/services/binance.js', () => ({
  fetchPairData: vi.fn().mockResolvedValue({ symbol: 'BTCETH', currentPrice: 100 }),
  fetchPairInfo: vi.fn().mockResolvedValue({
    symbol: 'BTCETH',
    baseAsset: 'BTC',
    quoteAsset: 'ETH',
    quantityPrecision: 8,
    pricePrecision: 8,
    minNotional: 0,
  }),
  createLimitOrder: vi.fn().mockResolvedValue({ orderId: 1 }),
  fetchOrder: vi.fn().mockResolvedValue(undefined),
}));

import { createDecisionLimitOrders } from '../src/services/rebalance.js';
import { createLimitOrder, fetchPairData, fetchPairInfo } from '../src/services/binance.js';

describe('createDecisionLimitOrders', () => {
  beforeEach(async () => {
    await clearLimitOrders();
    vi.mocked(createLimitOrder).mockClear();
  });

  it('keeps side when quantity is given in quote asset', async () => {
    const log = mockLogger();
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
    const reviewResultId = await insertReviewResult({ portfolioWorkflowId: agent.id, log: '' });
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
      orders: [
        {
          pair: 'BTCUSDT',
          token: 'USDT',
          side: 'BUY',
          quantity: 100,
          limitPrice: 99.9,
          basePrice: 100,
          maxPriceDivergencePct: 0.05,
        },
      ],
      reviewResultId,
      log,
    });
    const row = (await getLimitOrders())[0];
    expect(JSON.parse(row.planned_json)).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: 1.001001,
      price: 99.9,
      limitPrice: 99.9,
      basePrice: 100,
      maxPriceDivergencePct: 0.05,
      manuallyEdited: false,
    });
    expect(createLimitOrder).toHaveBeenCalledWith(userId, {
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: 1.001001,
      price: 99.9,
    });
  });

  it('uses final price for quote-denominated quantity', async () => {
    const log = mockLogger();
    const userId = await insertUser('13');
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
    const reviewResultId = await insertReviewResult({ portfolioWorkflowId: agent.id, log: '' });
    vi.mocked(fetchPairInfo).mockResolvedValueOnce({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      quantityPrecision: 8,
      pricePrecision: 8,
      minNotional: 0,
    });
    vi.mocked(fetchPairData).mockResolvedValueOnce({ currentPrice: 100 });
    await createDecisionLimitOrders({
      userId,
      orders: [
        {
          pair: 'BTCUSDT',
          token: 'USDT',
          side: 'BUY',
          quantity: 100,
          limitPrice: 95,
          basePrice: 100,
          maxPriceDivergencePct: 0.05,
        },
      ],
      reviewResultId,
      log,
    });
    const row2 = (await getLimitOrders())[0];
    expect(JSON.parse(row2.planned_json)).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: 1.05263158,
      price: 95,
      basePrice: 100,
      limitPrice: 95,
      maxPriceDivergencePct: 0.05,
      manuallyEdited: false,
    });
    expect(createLimitOrder).toHaveBeenCalledWith(userId, {
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: 1.05263158,
      price: 95,
    });
  });

  it('uses limit price for base-denominated quantity', async () => {
    const log = mockLogger();
    const userId = await insertUser('11');
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
    const reviewResultId = await insertReviewResult({ portfolioWorkflowId: agent.id, log: '' });
    vi.mocked(fetchPairInfo).mockResolvedValueOnce({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      quantityPrecision: 8,
      pricePrecision: 8,
      minNotional: 0,
    });
    vi.mocked(fetchPairData).mockResolvedValueOnce({ currentPrice: 100 });
    await createDecisionLimitOrders({
      userId,
      orders: [
        {
          pair: 'BTCUSDT',
          token: 'BTC',
          side: 'BUY',
          quantity: 1,
          limitPrice: 95,
          basePrice: 100,
          maxPriceDivergencePct: 0.05,
        },
      ],
      reviewResultId,
      log,
    });
    const row = (await getLimitOrders())[0];
    expect(JSON.parse(row.planned_json)).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: 1,
      price: 95,
      basePrice: 100,
      limitPrice: 95,
      maxPriceDivergencePct: 0.05,
      manuallyEdited: false,
    });
    expect(createLimitOrder).toHaveBeenCalledWith(userId, {
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: 1,
      price: 95,
    });
  });

  it('boosts sell price when the market moves favorably within divergence bounds', async () => {
    const log = mockLogger();
    const userId = await insertUser('16');
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
    const reviewResultId = await insertReviewResult({ portfolioWorkflowId: agent.id, log: '' });
    vi.mocked(fetchPairInfo).mockResolvedValueOnce({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      quantityPrecision: 8,
      pricePrecision: 3,
      minNotional: 0,
    });
    vi.mocked(fetchPairData).mockResolvedValueOnce({ currentPrice: 251 });
    await createDecisionLimitOrders({
      userId,
      orders: [
        {
          pair: 'BTCUSDT',
          token: 'BTC',
          side: 'SELL',
          quantity: 1,
          limitPrice: 250,
          basePrice: 249,
          maxPriceDivergencePct: 0.02,
        },
      ],
      reviewResultId,
      log,
    });
    const row = (await getLimitOrders())[0];
    const planned = JSON.parse(row.planned_json);
    expect(planned.price).toBeCloseTo(251.251, 6);
    expect(planned.limitPrice).toBeCloseTo(251.251, 6);
    expect(planned.basePrice).toBe(249);
    expect(planned.observedPrice).toBe(251);
    expect(row.status).toBe(LimitOrderStatus.Open);
    expect(createLimitOrder).toHaveBeenCalledWith(userId, {
      symbol: 'BTCUSDT',
      side: 'SELL',
      quantity: 1,
      price: 251.251,
    });
  });

  it('tightens buy price when the market dips but remains within divergence', async () => {
    const log = mockLogger();
    const userId = await insertUser('19');
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
    const reviewResultId = await insertReviewResult({ portfolioWorkflowId: agent.id, log: '' });
    vi.mocked(fetchPairInfo).mockResolvedValueOnce({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      quantityPrecision: 8,
      pricePrecision: 3,
      minNotional: 0,
    });
    vi.mocked(fetchPairData).mockResolvedValueOnce({ currentPrice: 98 });
    await createDecisionLimitOrders({
      userId,
      orders: [
        {
          pair: 'BTCUSDT',
          token: 'BTC',
          side: 'BUY',
          quantity: 1,
          limitPrice: 100,
          basePrice: 101,
          maxPriceDivergencePct: 0.05,
        },
      ],
      reviewResultId,
      log,
    });
    const row = (await getLimitOrders())[0];
    const planned = JSON.parse(row.planned_json);
    expect(planned.price).toBeCloseTo(97.902, 6);
    expect(planned.limitPrice).toBeCloseTo(97.902, 6);
    expect(createLimitOrder).toHaveBeenCalledWith(userId, {
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: 1,
      price: 97.902,
    });
  });

  it('cancels order when price diverges beyond threshold', async () => {
    const log = mockLogger();
    const userId = await insertUser('12');
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
    const reviewResultId = await insertReviewResult({ portfolioWorkflowId: agent.id, log: '' });
    vi.mocked(fetchPairInfo).mockResolvedValueOnce({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      quantityPrecision: 8,
      pricePrecision: 8,
      minNotional: 0,
    });
    vi.mocked(fetchPairData).mockResolvedValueOnce({ currentPrice: 105 });
    await createDecisionLimitOrders({
      userId,
      orders: [
        {
          pair: 'BTCUSDT',
          token: 'BTC',
          side: 'BUY',
          quantity: 1,
          limitPrice: 99.9,
          basePrice: 100,
          maxPriceDivergencePct: 0.02,
        },
      ],
      reviewResultId,
      log,
    });
    const row = (await getLimitOrders())[0];
    expect(row.status).toBe(LimitOrderStatus.Canceled);
    expect(createLimitOrder).not.toHaveBeenCalled();
  });

  it('cancels orders with malformed limit price', async () => {
    const log = mockLogger();
    const userId = await insertUser('17');
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
    const reviewResultId = await insertReviewResult({ portfolioWorkflowId: agent.id, log: '' });
    vi.mocked(fetchPairInfo).mockResolvedValueOnce({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      quantityPrecision: 8,
      pricePrecision: 8,
      minNotional: 0,
    });
    vi.mocked(fetchPairData).mockResolvedValueOnce({ currentPrice: 100 });
    await createDecisionLimitOrders({
      userId,
      orders: [
        {
          pair: 'BTCUSDT',
          token: 'BTC',
          side: 'BUY',
          quantity: 1,
          limitPrice: Number.NaN,
          basePrice: 100,
          maxPriceDivergencePct: 0.05,
        },
      ],
      reviewResultId,
      log,
    });
    const rows = await getLimitOrders();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(LimitOrderStatus.Canceled);
    expect(rows[0].cancellation_reason).toBe('Malformed limitPrice: NaN');
    expect(createLimitOrder).not.toHaveBeenCalled();
  });

  it('requires a minimum maxPriceDivergencePct', async () => {
    const log = mockLogger();
    const userId = await insertUser('18');
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
    const reviewResultId = await insertReviewResult({ portfolioWorkflowId: agent.id, log: '' });
    vi.mocked(fetchPairInfo).mockResolvedValueOnce({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      quantityPrecision: 8,
      pricePrecision: 8,
      minNotional: 0,
    });
    vi.mocked(fetchPairData).mockResolvedValueOnce({ currentPrice: 100 });
    await createDecisionLimitOrders({
      userId,
      orders: [
        {
          pair: 'BTCUSDT',
          token: 'BTC',
          side: 'BUY',
          quantity: 1,
          limitPrice: 99,
          basePrice: 100,
          maxPriceDivergencePct: 0,
        },
      ],
      reviewResultId,
      log,
    });
    const rows = await getLimitOrders();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(LimitOrderStatus.Canceled);
    expect(rows[0].cancellation_reason).toBe('Malformed maxPriceDivergencePct: 0');
    expect(createLimitOrder).not.toHaveBeenCalled();
  });

  it('records decision orders below min notional as canceled', async () => {
    const log = mockLogger();
    const userId = await insertUser('15');
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
    const reviewResultId = await insertReviewResult({ portfolioWorkflowId: agent.id, log: '' });
    vi.mocked(fetchPairInfo).mockResolvedValueOnce({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      quantityPrecision: 8,
      pricePrecision: 8,
      minNotional: 10,
    });
    await createDecisionLimitOrders({
      userId,
      orders: [
        {
          pair: 'BTCUSDT',
          token: 'BTC',
          side: 'BUY',
          quantity: 0.05,
          limitPrice: 99.9,
          basePrice: 100,
          maxPriceDivergencePct: 0.05,
        },
      ],
      reviewResultId,
      log,
    });
    const rows = await getLimitOrders();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(LimitOrderStatus.Canceled);
    expect(rows[0].cancellation_reason).toBe('order below min notional');
    expect(createLimitOrder).not.toHaveBeenCalled();
  });

  it('bumps nominal above min when rounding reduces buy order value', async () => {
    const log = mockLogger();
    const userId = await insertUser('26');
    const agent = await insertAgent({
      userId,
      model: 'm',
      status: 'active',
      startBalance: null,
      name: 'A',
      tokens: [
        { token: 'DOGE', minAllocation: 10 },
        { token: 'USDT', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      manualRebalance: false,
      useEarn: true,
    });
    const reviewResultId = await insertReviewResult({ portfolioWorkflowId: agent.id, log: '' });
    vi.mocked(fetchPairInfo).mockResolvedValueOnce({
      symbol: 'DOGEUSDT',
      baseAsset: 'DOGE',
      quoteAsset: 'USDT',
      quantityPrecision: 1,
      pricePrecision: 2,
      minNotional: 0.02056,
    });
    vi.mocked(fetchPairData).mockResolvedValueOnce({ currentPrice: 0.0207 });
    await createDecisionLimitOrders({
      userId,
      orders: [
        {
          pair: 'DOGEUSDT',
          token: 'USDT',
          side: 'BUY',
          quantity: 0.02056,
          limitPrice: 0.02065,
          basePrice: 0.02065,
          maxPriceDivergencePct: 0.01,
        },
      ],
      reviewResultId,
      log,
    });
    const rows = await getLimitOrders();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(LimitOrderStatus.Open);
    const planned = JSON.parse(rows[0].planned_json);
    expect(planned.quantity).toBe(1.1);
    expect(planned.price).toBe(0.02);
    expect(planned.quantity * planned.price).toBeGreaterThan(0.02056);
    expect(createLimitOrder).toHaveBeenCalledWith(userId, {
      symbol: 'DOGEUSDT',
      side: 'BUY',
      quantity: 1.1,
      price: 0.02,
    });
  });

  it('preserves manuallyEdited flag when provided', async () => {
    const log = mockLogger();
    const userId = await insertUser('20');
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
    const reviewResultId = await insertReviewResult({ portfolioWorkflowId: agent.id, log: '' });
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
      orders: [
        {
          pair: 'BTCUSDT',
          token: 'BTC',
          side: 'BUY',
          quantity: 0.5,
          limitPrice: 99.5,
          basePrice: 100,
          maxPriceDivergencePct: 0.05,
          manuallyEdited: true,
        },
      ],
      reviewResultId,
      log,
    });
    const planned = JSON.parse((await getLimitOrders())[0].planned_json);
    expect(planned.manuallyEdited).toBe(true);
  });
});
