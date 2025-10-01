import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { mockLogger } from './helpers.js';
import { insertUser } from './repos/users.js';
import { insertPortfolioWorkflow } from './repos/portfolio-workflows.js';
import { setAiKey } from '../src/repos/ai-api-key.js';
import { getPortfolioReviewRawPromptsResponses } from './repos/review-raw-log.js';
import { getRecentReviewResults } from '../src/repos/review-result.js';
import * as mainTrader from '../src/agents/main-trader.js';
import * as newsAnalyst from '../src/agents/news-analyst.js';

const sampleTimeseries = vi.hoisted(() => ({
  minute_60: [[1, 2, 3, 4]],
  hourly_24h: [[5, 6, 7, 8]],
  monthly_24m: [[9, 10, 11]],
}));

const runMainTrader = vi.fn();
vi.spyOn(mainTrader, 'run').mockImplementation(runMainTrader);

const runNewsAnalyst = vi.fn((_params: any, prompt: any) => {
  const report = prompt.reports?.find((r: any) => r.token === 'BTC');
  if (report) report.news = { comment: 'news', score: 1 };
  return Promise.resolve();
});
vi.spyOn(newsAnalyst, 'runNewsAnalyst').mockImplementation(runNewsAnalyst);

import {
  reviewWorkflowPortfolio,
  removeWorkflowFromSchedule,
} from '../src/workflows/portfolio-review.js';

vi.mock('../src/util/crypto.js', () => ({
  decrypt: vi.fn().mockReturnValue('key'),
}));

vi.mock('../src/services/binance-client.js', () => ({
  fetchAccount: vi.fn().mockResolvedValue({
    balances: [
      { asset: 'BTC', free: '1', locked: '0.5' },
      { asset: 'ETH', free: '2', locked: '0' },
    ],
  }),
  fetchPairData: vi
    .fn()
    .mockResolvedValue({ symbol: 'BTCUSDT', currentPrice: 100 }),
  fetchPairPrice: vi
    .fn()
    .mockResolvedValue({ symbol: 'BTCUSDT', currentPrice: 100 }),
  fetchMarketTimeseries: vi.fn().mockResolvedValue(sampleTimeseries),
  fetchPairInfo: vi.fn().mockResolvedValue({
    symbol: 'BTCETH',
    baseAsset: 'BTC',
    quoteAsset: 'ETH',
    quantityPrecision: 8,
    pricePrecision: 8,
    minNotional: 0,
  }),
  cancelOrder: vi.fn().mockResolvedValue(undefined),
  parseBinanceError: vi.fn().mockReturnValue({}),
  fetchOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/services/sentiment.js', () => ({
  fetchFearGreedIndex: vi
    .fn()
    .mockResolvedValue({ value: 50, classification: 'Neutral' }),
}));

const sampleMarketOverview = vi.hoisted(() => ({
  schema_version: 'market_overview.v2' as const,
  as_of: '2024-01-01T00:00:00Z',
  timeframe: {
    candle_interval: '1h',
    review_interval: '30m',
    semantics: '',
  },
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
    ETH: {
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

vi.mock('../src/services/indicators.js', () => ({
  fetchMarketOverview: vi.fn().mockResolvedValue(sampleMarketOverview),
  createEmptyMarketOverview: vi
    .fn()
    .mockReturnValue(JSON.parse(JSON.stringify(sampleMarketOverview))),
}));

const createDecisionLimitOrders = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
vi.mock('../src/services/rebalance.js', () => ({
  createDecisionLimitOrders,
}));

beforeEach(() => {
  vi.clearAllMocks();
  ['1', '2', '3', '4', '5'].forEach((id) => removeWorkflowFromSchedule(id));
});

async function setupWorkflow(tokens: string[], manual = false) {
  const userId = await insertUser();
  await setAiKey({ userId, apiKeyEnc: 'enc' });
  const agent = await insertPortfolioWorkflow({
    userId,
    model: 'gpt',
    status: 'active',
    startBalance: null,
    name: 'Agent',
    cashToken: 'USDT',
    tokens: tokens.map((t, i) => ({ token: t, minAllocation: (i + 1) * 10 })),
    risk: 'low',
    reviewInterval: '1h',
    agentInstructions: 'inst',
    manualRebalance: manual,
    useEarn: false,
  });
  return { userId, workflowId: agent.id };
}

describe('reviewPortfolio', () => {
  it('saves decision and logs', async () => {
    const { workflowId } = await setupWorkflow(['BTC']);
    const decision = {
      orders: [{ pair: 'BTCUSDT', token: 'BTC', side: 'SELL', quantity: 1 }],
      shortReport: 'ok',
    };
    runMainTrader.mockResolvedValue(decision);
    const log = mockLogger();
    await reviewWorkflowPortfolio(log, workflowId);
    expect(runMainTrader).toHaveBeenCalledTimes(1);
    expect(runNewsAnalyst).toHaveBeenCalled();
    const rows = await getPortfolioReviewRawPromptsResponses(workflowId);
    const row = rows[0];
    expect(JSON.parse(row.response!)).toEqual(decision);
    const [res] = await getRecentReviewResults(workflowId, 1);
    expect(res.rebalance).toBe(true);
    expect(res.shortReport).toBe('ok');
  });

  it('calls createDecisionLimitOrders when orders requested', async () => {
    const { userId: user2, workflowId: agent2 } = await setupWorkflow([
      'BTC',
      'ETH',
    ]);
    const decision = {
      orders: [
        { pair: 'BTCUSDT', token: 'BTC', side: 'BUY', quantity: 1 },
        { pair: 'ETHBTC', token: 'ETH', side: 'SELL', quantity: 0.5 },
      ],
      shortReport: 's',
    };
    runMainTrader.mockResolvedValue(decision);
    const log = mockLogger();
    await reviewWorkflowPortfolio(log, agent2);
    expect(createDecisionLimitOrders).toHaveBeenCalledTimes(1);
    const args = createDecisionLimitOrders.mock.calls[0][0];
    expect(args.userId).toBe(user2);
    expect(args.orders).toHaveLength(2);
  });

  it('skips createDecisionLimitOrders when manualRebalance is enabled', async () => {
    const { workflowId: agent3 } = await setupWorkflow(['BTC'], true);
    const decision = {
      orders: [{ pair: 'BTCUSDT', token: 'BTC', side: 'BUY', quantity: 1 }],
      shortReport: 's',
    };
    runMainTrader.mockResolvedValue(decision);
    const log = mockLogger();
    await reviewWorkflowPortfolio(log, agent3);
    expect(createDecisionLimitOrders).not.toHaveBeenCalled();
  });

  it('records error when pair is invalid', async () => {
    const { workflowId: agent4 } = await setupWorkflow(['BTC']);
    const decision = {
      orders: [{ pair: 'FOO', token: 'BTC', side: 'BUY', quantity: 1 }],
      shortReport: 's',
    };
    runMainTrader.mockResolvedValue(decision);
    const log = mockLogger();
    await reviewWorkflowPortfolio(log, agent4);
    const [row] = await getRecentReviewResults(agent4, 1);
    expect(row.error).toBeTruthy();
  });

  it('records error when quantity is invalid', async () => {
    const { workflowId: agent5 } = await setupWorkflow(['BTC']);
    const decision = {
      orders: [{ pair: 'BTCUSDT', token: 'BTC', side: 'BUY', quantity: 0 }],
      shortReport: 's',
    };
    runMainTrader.mockResolvedValue(decision);
    const log = mockLogger();
    await reviewWorkflowPortfolio(log, agent5);
    const [row] = await getRecentReviewResults(agent5, 1);
    expect(row.error).toBeTruthy();
  });
});
