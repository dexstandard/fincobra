import { describe, it, expect, vi, beforeEach } from 'vitest';
import { insertUser } from './repos/users.js';
import { insertAgent } from './repos/portfolio-workflow.js';
import { insertReviewResult } from './repos/agent-review-result.js';
import { mockLogger } from './helpers.js';
import {
  insertLimitOrder,
  getLimitOrdersByReviewResult,
} from '../src/repos/limit-orders.js';
import { setAiKey } from '../src/repos/api-keys.js';
import { reviewAgentPortfolio } from '../src/workflows/portfolio-review.js';

const sampleIndicators = vi.hoisted(() => ({
  ret: { '1h': 0, '4h': 0, '24h': 0, '7d': 0, '30d': 0 },
  sma_dist: { '20': 0, '50': 0, '200': 0 },
  macd_hist: 0,
  vol: { rv_7d: 0, rv_30d: 0, atr_pct: 0 },
  range: { bb_bw: 0, donchian20: 0 },
  volume: { z_1h: 0, z_24h: 0 },
  corr: { BTC_30d: 0 },
  regime: { BTC: 'range' },
  osc: { rsi_14: 0, stoch_k: 0, stoch_d: 0 },
}));

vi.mock('../src/util/ai.js', () => ({
  callAi: vi.fn().mockResolvedValue('ok'),
}));

vi.mock('../src/util/crypto.js', () => ({
  decrypt: vi.fn().mockReturnValue('key'),
}));

const { cancelOrder, parseBinanceError, fetchOrder } = vi.hoisted(() => ({
  cancelOrder: vi.fn().mockResolvedValue(undefined),
  parseBinanceError: vi.fn().mockReturnValue({}),
  fetchOrder: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/services/binance.js', () => ({
  fetchAccount: vi.fn().mockResolvedValue({
    balances: [
      { asset: 'BTC', free: '1', locked: '0' },
      { asset: 'ETH', free: '1', locked: '0' },
    ],
  }),
  fetchPairData: vi.fn().mockResolvedValue({ symbol: 'BTCETH', currentPrice: 100 }),
  fetchMarketTimeseries: vi.fn().mockResolvedValue({ minute_60: [], hourly_24h: [], monthly_24m: [] }),
  fetchPairInfo: vi.fn().mockResolvedValue({
    symbol: 'BTCETH',
    baseAsset: 'BTC',
    quoteAsset: 'ETH',
    quantityPrecision: 8,
    pricePrecision: 8,
    minNotional: 0,
  }),
  cancelOrder,
  parseBinanceError,
  fetchOrder,
}));

vi.mock('../src/services/indicators.js', () => ({
  fetchTokenIndicators: vi.fn().mockResolvedValue(sampleIndicators),
}));

vi.mock('../src/services/rebalance.js', () => ({
  createRebalanceLimitOrder: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  cancelOrder.mockReset();
  cancelOrder.mockResolvedValue(undefined);
  parseBinanceError.mockReset();
  parseBinanceError.mockReturnValue({});
  fetchOrder.mockReset();
  fetchOrder.mockResolvedValue(undefined);
});

describe('cleanup open orders', () => {
  it('cancels open orders before running agent', async () => {
    const userId = await insertUser('1');
    await setAiKey(userId, 'enc');
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
      useEarn: false,
    });
    const rrId = await insertReviewResult({
      portfolioId: agent.id,
      log: 'log',
      rebalance: true,
      newAllocation: 50,
      shortReport: 's',
    });
    await insertLimitOrder({
      userId,
      planned: { symbol: 'BTCETH', side: 'BUY', quantity: 1, price: 1 },
      status: 'open',
      reviewResultId: rrId,
      orderId: '123',
    });
    const log = mockLogger();
    await reviewAgentPortfolio(log, agent.id);
    expect(cancelOrder).toHaveBeenCalledTimes(1);
    const orders = await getLimitOrdersByReviewResult(agent.id, rrId);
    expect(orders[0].status).toBe('canceled');
  });

  it('cancels multiple open orders in parallel', async () => {
    cancelOrder.mockReset();
    const resolves: (() => void)[] = [];
    cancelOrder.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolves.push(resolve);
        }),
    );

    const userId = await insertUser('1');
    await setAiKey(userId, 'enc');
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
      useEarn: false,
    });
    const rrId = await insertReviewResult({
      portfolioId: agent.id,
      log: 'log',
      rebalance: true,
      newAllocation: 50,
      shortReport: 's',
    });
    await insertLimitOrder({
      userId,
      planned: { symbol: 'BTCETH', side: 'BUY', quantity: 1, price: 1 },
      status: 'open',
      reviewResultId: rrId,
      orderId: '123',
    });
    await insertLimitOrder({
      userId,
      planned: { symbol: 'BTCETH', side: 'BUY', quantity: 1, price: 1 },
      status: 'open',
      reviewResultId: rrId,
      orderId: '456',
    });

    const log = mockLogger();
    const runPromise = reviewAgentPortfolio(log, agent.id);
    await vi.waitUntil(() => cancelOrder.mock.calls.length === 2);
    resolves.forEach((r) => r());
    await runPromise;
    const orders = await getLimitOrdersByReviewResult(agent.id, rrId);
    expect(orders.map((o) => ({ order_id: o.order_id, status: o.status }))).toEqual([
      { order_id: '123', status: 'canceled' },
      { order_id: '456', status: 'canceled' },
    ]);
  });

  it('marks order filled when Binance reports unknown order', async () => {
    cancelOrder.mockRejectedValueOnce(new Error('err'));
    parseBinanceError.mockReturnValueOnce({ code: -2013 });
    fetchOrder.mockResolvedValueOnce({ status: 'FILLED' } as any);
    const userId = await insertUser('1');
    await setAiKey(userId, 'enc');
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
      useEarn: false,
    });
    const rrId = await insertReviewResult({
      portfolioId: agent.id,
      log: 'log',
      rebalance: true,
      newAllocation: 50,
      shortReport: 's',
    });
    await insertLimitOrder({
      userId,
      planned: { symbol: 'BTCETH', side: 'BUY', quantity: 1, price: 1 },
      status: 'open',
      reviewResultId: rrId,
      orderId: '123',
    });
    const log = mockLogger();
    await reviewAgentPortfolio(log, agent.id);
    const orders = await getLimitOrdersByReviewResult(agent.id, rrId);
    expect(orders[0].status).toBe('filled');
  });

  it('marks order canceled when Binance reports unknown order but fetch shows canceled', async () => {
    cancelOrder.mockRejectedValueOnce(new Error('err'));
    parseBinanceError.mockReturnValueOnce({ code: -2013 });
    fetchOrder.mockResolvedValueOnce({ status: 'CANCELED' } as any);
    const userId = await insertUser('3');
    await setAiKey(userId, 'enc');
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
      useEarn: false,
    });
    const rrId = await insertReviewResult({
      portfolioId: agent.id,
      log: 'log',
      rebalance: true,
      newAllocation: 50,
      shortReport: 's',
    });
    await insertLimitOrder({
      userId,
      planned: { symbol: 'BTCETH', side: 'BUY', quantity: 1, price: 1 },
      status: 'open',
      reviewResultId: rrId,
      orderId: '999',
    });
    const log = mockLogger();
    await reviewAgentPortfolio(log, agent.id);
    const orders = await getLimitOrdersByReviewResult(agent.id, rrId);
    expect(orders[0].status).toBe('canceled');
    expect(orders[0].cancellation_reason).toBe('Could not fill within interval');
  });

  it('marks order filled when cancel returns FILLED', async () => {
    cancelOrder.mockResolvedValueOnce({ status: 'FILLED' } as any);
    const userId = await insertUser('2');
    await setAiKey(userId, 'enc');
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
      useEarn: false,
    });
    const rrId = await insertReviewResult({
      portfolioId: agent.id,
      log: 'log',
      rebalance: true,
      newAllocation: 50,
      shortReport: 's',
    });
    await insertLimitOrder({
      userId,
      planned: { symbol: 'BTCETH', side: 'BUY', quantity: 1, price: 1 },
      status: 'open',
      reviewResultId: rrId,
      orderId: '789',
    });
    const log = mockLogger();
    await reviewAgentPortfolio(log, agent.id);
    const orders = await getLimitOrdersByReviewResult(agent.id, rrId);
    expect(orders[0].status).toBe('filled');
    expect(orders[0].cancellation_reason).toBeNull();
  });
});
