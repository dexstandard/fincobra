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
  schema: 'market_overview.v2.1' as const,
  asOf: '2024-01-01T00:00:00Z',
  timeframe: { candleInterval: '1h', decisionInterval: 'PT30M', semantics: '' },
  derivations: {
    trendSlopeRule: '',
    ret1hRule: '',
    ret24hRule: '',
    volAtrPctRule: '',
    volAnomalyZRule: '',
    rsi14Rule: '',
    orderbookSpreadBpsRule: '',
    orderbookDepthRatioRule: '',
    htfReturnsRule: '',
    htfTrendRule: '',
    regimeVolStateRule: '',
    regimeCorrBetaRule: '',
    riskFlagsRules: {
      overbought: '',
      oversold: '',
      volSpike: '',
      thinBook: '',
    },
  },
  spec: { units: {}, interpretation: {} },
  marketOverview: {
    BTC: {
      trendSlope: 'flat' as const,
      trendBasis: { smaPeriods: [50, 200] as [number, number], gapPct: 0 },
      ret1h: 0,
      ret24h: 0,
      volAtrPct: 0,
      volAnomalyZ: 0,
      rsi14: 50,
      orderbookSpreadBps: 0,
      orderbookDepthRatio: 1,
      riskFlags: {
        overbought: false,
        oversold: false,
        volSpike: false,
        thinBook: false,
      },
      htf: {
        returns: { '30d': 0, '90d': 0, '180d': 0, '365d': 0 },
        trend: {
          '4h': { smaPeriods: [50, 200], gapPct: 0, slope: 'flat' },
          '1d': { smaPeriods: [20, 100], gapPct: 0, slope: 'flat' },
          '1w': { smaPeriods: [13, 52], gapPct: 0, slope: 'flat' },
        },
        regime: {
          volState: 'normal' as const,
          volRank1y: 0,
          corrBtc90d: 0,
          marketBeta90d: 0,
        },
      },
    },
  },
}));

vi.mock('../src/services/ai-service.js', async () => {
  const actual = await vi.importActual<
    typeof import('../src/services/ai-service.js')
  >('../src/services/ai-service.js');
  return {
    ...actual,
    callAi: vi.fn().mockResolvedValue('ok'),
  };
});

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
  isInvalidSymbolError: vi
    .fn((err: unknown) =>
      err instanceof Error && /Invalid symbol/i.test(err.message),
    )
    .mockName('isInvalidSymbolError'),
}));

vi.mock('../src/services/indicators.js', () => ({
  fetchMarketOverview: vi.fn().mockResolvedValue(sampleMarketOverview),
  createEmptyMarketOverview: vi
    .fn()
    .mockReturnValue(JSON.parse(JSON.stringify(sampleMarketOverview))),
  clearMarketOverviewCache: vi.fn(),
}));

vi.mock('../src/services/rebalance.js', () => ({
  createDecisionLimitOrders: vi.fn().mockResolvedValue({
    placed: 0,
    canceled: 0,
    priceDivergenceCancellations: 0,
    futuresExecuted: 0,
    futuresFailed: 0,
    needsPriceDivergenceRetry: false,
  }),
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
      planned: { symbol: 'BTCETH', side: 'BUY', qty: 1, price: 1 },
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
      planned: { symbol: 'BTCETH', side: 'BUY', qty: 1, price: 1 },
      status: LimitOrderStatus.Open,
      reviewResultId: rrId,
      orderId: '123',
    });
    await insertLimitOrder({
      userId,
      planned: { symbol: 'BTCETH', side: 'BUY', qty: 1, price: 1 },
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
      planned: { symbol: 'BTCETH', side: 'BUY', qty: 1, price: 1 },
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
      planned: { symbol: 'BTCETH', side: 'BUY', qty: 1, price: 1 },
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
      planned: { symbol: 'BTCETH', side: 'BUY', qty: 1, price: 1 },
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
