import { describe, it, expect, vi, beforeEach } from 'vitest';
import { insertUser } from './repos/users.js';
import { insertPortfolioWorkflow } from './repos/portfolio-workflows.js';
import { insertReviewResult } from './repos/review-result.js';
import { mockLogger } from './helpers.js';
import {
  insertLimitOrder,
  getLimitOrdersByReviewResult,
} from '../src/repos/limit-orders.js';
import { LimitOrderStatus } from '../src/repos/limit-orders.types.js';
import { setAiKey } from '../src/repos/ai-api-key.js';
import { reviewWorkflowPortfolio } from '../src/workflows/portfolio-review.js';

const sampleMarketOverview = vi.hoisted(() => ({
  schema_version: 'market_overview.v2' as const,
  as_of: '2024-01-01T00:00:00Z',
  timeframe: { candle_interval: '1h', review_interval: '30m', semantics: '' },
  derivations: {
    trend_slope_rule: '',
    ret1h_rule: '',
    ret24h_rule: '',
    vol_atr_pct_rule: '',
    vol_anomaly_z_rule: '',
    rsi14_rule: '',
    orderbook_spread_bps_rule: '',
    orderbook_depth_ratio_rule: '',
    htf_returns_rule: '',
    htf_trend_rule: '',
    regime_vol_state_rule: '',
    regime_corr_beta_rule: '',
    risk_flags_rules: {
      overbought: '',
      oversold: '',
      vol_spike: '',
      thin_book: '',
    },
  },
  _spec: { units: {}, interpretation: {} },
  market_overview: {
    BTC: {
      trend_slope: 'flat' as const,
      trend_basis: { sma_periods: [50, 200] as [number, number], gap_pct: 0 },
      ret1h: 0,
      ret24h: 0,
      vol_atr_pct: 0,
      vol_anomaly_z: 0,
      rsi14: 50,
      orderbook_spread_bps: 0,
      orderbook_depth_ratio: 1,
      risk_flags: {
        overbought: false,
        oversold: false,
        vol_spike: false,
        thin_book: false,
      },
      htf: {
        returns: { '30d': 0, '90d': 0, '180d': 0, '365d': 0 },
        trend: {
          '4h': { sma_periods: [50, 200], gap_pct: 0, slope: 'flat' },
          '1d': { sma_periods: [20, 100], gap_pct: 0, slope: 'flat' },
          '1w': { sma_periods: [13, 52], gap_pct: 0, slope: 'flat' },
        },
        regime: {
          vol_state: 'normal' as const,
          vol_rank_1y: 0,
          corr_btc_90d: 0,
          market_beta_90d: 0,
        },
      },
    },
  },
}));

vi.mock('../src/services/openai-client.js', () => ({
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
vi.mock('../src/services/binance-client.js', () => ({
  fetchAccount: vi.fn().mockResolvedValue({
    balances: [
      { asset: 'BTC', free: '1', locked: '0' },
      { asset: 'ETH', free: '1', locked: '0' },
    ],
  }),
  fetchPairData: vi
    .fn()
    .mockResolvedValue({ symbol: 'BTCETH', currentPrice: 100 }),
  fetchPairPrice: vi
    .fn()
    .mockResolvedValue({ symbol: 'BTCETH', currentPrice: 100 }),
  fetchMarketTimeseries: vi
    .fn()
    .mockResolvedValue({ minute_60: [], hourly_24h: [], monthly_24m: [] }),
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
  fetchMarketOverview: vi.fn().mockResolvedValue(sampleMarketOverview),
  createEmptyMarketOverview: vi
    .fn()
    .mockReturnValue(JSON.parse(JSON.stringify(sampleMarketOverview))),
}));

vi.mock('../src/services/rebalance.js', () => ({
  createDecisionLimitOrders: vi.fn().mockResolvedValue(undefined),
}));

describe('cleanup open orders', () => {
  beforeEach(() => {
    cancelOrder.mockReset();
    cancelOrder.mockResolvedValue(undefined);
    parseBinanceError.mockReset();
    parseBinanceError.mockReturnValue({});
    fetchOrder.mockReset();
    fetchOrder.mockResolvedValue(undefined);
  });

  it('cancels open orders before running agent', async () => {
    const userId = await insertUser();
    await setAiKey({ userId, apiKeyEnc: 'enc' });
    const agent = await insertPortfolioWorkflow({
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
      portfolioWorkflowId: agent.id,
      log: 'log',
      rebalance: true,
      shortReport: 's',
    });
    await insertLimitOrder({
      userId,
      planned: { symbol: 'BTCETH', side: 'BUY', quantity: 1, price: 1 },
      status: LimitOrderStatus.Open,
      reviewResultId: rrId,
      orderId: '123',
    });
    const log = mockLogger();
    await reviewWorkflowPortfolio(log, agent.id);
    expect(cancelOrder).toHaveBeenCalledTimes(1);
    const orders = await getLimitOrdersByReviewResult(agent.id, rrId);
    expect(orders[0].status).toBe(LimitOrderStatus.Canceled);
  });

  it('cancels multiple open orders in parallel', async () => {
    const resolves: (() => void)[] = [];
    cancelOrder.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolves.push(resolve);
        }),
    );

    const userId = await insertUser();
    await setAiKey({ userId, apiKeyEnc: 'enc' });
    const agent = await insertPortfolioWorkflow({
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
      portfolioWorkflowId: agent.id,
      log: 'log',
      rebalance: true,
      shortReport: 's',
    });
    await insertLimitOrder({
      userId,
      planned: { symbol: 'BTCETH', side: 'BUY', quantity: 1, price: 1 },
      status: LimitOrderStatus.Open,
      reviewResultId: rrId,
      orderId: '123',
    });
    await insertLimitOrder({
      userId,
      planned: { symbol: 'BTCETH', side: 'BUY', quantity: 1, price: 1 },
      status: LimitOrderStatus.Open,
      reviewResultId: rrId,
      orderId: '456',
    });

    const log = mockLogger();
    const runPromise = reviewWorkflowPortfolio(log, agent.id);
    await vi.waitUntil(() => cancelOrder.mock.calls.length === 2);
    resolves.forEach((r) => r());
    await runPromise;
    const orders = await getLimitOrdersByReviewResult(agent.id, rrId);
    expect(
      orders.map((o) => ({ orderId: o.orderId, status: o.status })),
    ).toEqual([
      { orderId: '123', status: LimitOrderStatus.Canceled },
      { orderId: '456', status: LimitOrderStatus.Canceled },
    ]);
  });

  it('marks order filled when Binance reports unknown order with filled status', async () => {
    cancelOrder.mockRejectedValueOnce(new Error('err'));
    parseBinanceError.mockReturnValueOnce({ code: -2013 });
    fetchOrder.mockResolvedValueOnce({ status: 'FILLED' });
    const userId = await insertUser();
    await setAiKey({ userId, apiKeyEnc: 'enc' });
    const agent = await insertPortfolioWorkflow({
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
      portfolioWorkflowId: agent.id,
      log: 'log',
      rebalance: true,
      shortReport: 's',
    });
    await insertLimitOrder({
      userId,
      planned: { symbol: 'BTCETH', side: 'BUY', quantity: 1, price: 1 },
      status: LimitOrderStatus.Open,
      reviewResultId: rrId,
      orderId: '123',
    });
    const log = mockLogger();
    await reviewWorkflowPortfolio(log, agent.id);
    const orders = await getLimitOrdersByReviewResult(agent.id, rrId);
    expect(orders[0].status).toBe(LimitOrderStatus.Filled);
    expect(orders[0].cancellationReason).toBeNull();
  });

  it('marks order canceled when Binance reports unknown order with canceled status', async () => {
    cancelOrder.mockRejectedValueOnce(new Error('err'));
    parseBinanceError.mockReturnValueOnce({ code: -2013 });
    fetchOrder.mockResolvedValueOnce({ status: 'CANCELED' });
    const userId = await insertUser();
    await setAiKey({ userId, apiKeyEnc: 'enc' });
    const agent = await insertPortfolioWorkflow({
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
      portfolioWorkflowId: agent.id,
      log: 'log',
      rebalance: true,
      shortReport: 's',
    });
    await insertLimitOrder({
      userId,
      planned: { symbol: 'BTCETH', side: 'BUY', quantity: 1, price: 1 },
      status: LimitOrderStatus.Open,
      reviewResultId: rrId,
      orderId: '123',
    });
    const log = mockLogger();
    await reviewWorkflowPortfolio(log, agent.id);
    const orders = await getLimitOrdersByReviewResult(agent.id, rrId);
    expect(orders[0].status).toBe(LimitOrderStatus.Canceled);
    expect(orders[0].cancellationReason).toBe('Could not fill within interval');
  });

  it('marks order filled when cancel returns FILLED', async () => {
    cancelOrder.mockResolvedValueOnce({ status: 'FILLED' } as any);
    const userId = await insertUser();
    await setAiKey({ userId, apiKeyEnc: 'enc' });
    const agent = await insertPortfolioWorkflow({
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
      portfolioWorkflowId: agent.id,
      log: 'log',
      rebalance: true,
      shortReport: 's',
    });
    await insertLimitOrder({
      userId,
      planned: { symbol: 'BTCETH', side: 'BUY', quantity: 1, price: 1 },
      status: LimitOrderStatus.Open,
      reviewResultId: rrId,
      orderId: '789',
    });
    const log = mockLogger();
    await reviewWorkflowPortfolio(log, agent.id);
    const orders = await getLimitOrdersByReviewResult(agent.id, rrId);
    expect(orders[0].status).toBe(LimitOrderStatus.Filled);
    expect(orders[0].cancellationReason).toBeNull();
  });
});
