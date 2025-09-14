import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { mockLogger } from './helpers.js';
import { insertUser } from './repos/users.js';
import { insertAgent } from './repos/portfolio-workflow.js';
import { setAiKey } from '../src/repos/api-keys.js';
import { getPortfolioReviewRawPromptsResponses } from './repos/agent-review-raw-log.js';
import { getRecentReviewResults } from '../src/repos/agent-review-result.js';
import * as mainTrader from '../src/agents/main-trader.js';
import * as newsAnalyst from '../src/agents/news-analyst.js';
import * as techAnalyst from '../src/agents/technical-analyst.js';

const { sampleIndicators, sampleTimeseries } = vi.hoisted(() => ({
  sampleIndicators: {
    ret: { '1h': 0, '4h': 0, '24h': 0, '7d': 0, '30d': 0 },
    sma_dist: { '20': 0, '50': 0, '200': 0 },
    macd_hist: 0,
    vol: { rv_7d: 0, rv_30d: 0, atr_pct: 0 },
    range: { bb_bw: 0, donchian20: 0 },
    volume: { z_1h: 0, z_24h: 0 },
    corr: { BTC_30d: 0 },
    regime: { BTC: 'range' },
    osc: { rsi_14: 0, stoch_k: 0, stoch_d: 0 },
  },
  sampleTimeseries: {
    minute_60: [[1, 2, 3, 4]],
    hourly_24h: [[5, 6, 7, 8]],
    monthly_24m: [[9, 10, 11]],
  },
}));

const flatIndicators = {
  ret_1h: 0,
  ret_4h: 0,
  ret_24h: 0,
  ret_7d: 0,
  ret_30d: 0,
  sma_dist_20: 0,
  sma_dist_50: 0,
  sma_dist_200: 0,
  macd_hist: 0,
  vol_rv_7d: 0,
  vol_rv_30d: 0,
  vol_atr_pct: 0,
  range_bb_bw: 0,
  range_donchian20: 0,
  volume_z_1h: 0,
  volume_z_24h: 0,
  corr_BTC_30d: 0,
  regime_BTC: 'range',
  osc_rsi_14: 0,
  osc_stoch_k: 0,
  osc_stoch_d: 0,
};

const flatTimeseries = {
  ret_60m: ((3 - 2) / 2) * 100,
  ret_24h: ((7 - 6) / 6) * 100,
  ret_24m: ((11 - 10) / 10) * 100,
};

const runMainTrader = vi.fn();
vi.spyOn(mainTrader, 'run').mockImplementation(runMainTrader);

const runNewsAnalyst = vi.fn((_params: any, prompt: any) => {
  const report = prompt.reports?.find((r: any) => r.token === 'BTC');
  if (report) report.news = { comment: 'news', score: 1 };
  return Promise.resolve();
});
vi.spyOn(newsAnalyst, 'runNewsAnalyst').mockImplementation(runNewsAnalyst);

const runTechnicalAnalyst = vi.fn((_params: any, prompt: any) => {
  const report = prompt.reports?.find((r: any) => r.token === 'BTC');
  if (report) report.tech = { comment: 'tech', score: 2 };
  return Promise.resolve();
});
vi.spyOn(techAnalyst, 'runTechnicalAnalyst').mockImplementation(runTechnicalAnalyst);

import {
  reviewAgentPortfolio,
  removeWorkflowFromSchedule,
} from '../src/workflows/portfolio-review.js';

vi.mock('../src/util/crypto.js', () => ({
  decrypt: vi.fn().mockReturnValue('key'),
}));

vi.mock('../src/services/binance.js', () => ({
  fetchAccount: vi.fn().mockResolvedValue({
    balances: [
      { asset: 'BTC', free: '1', locked: '0.5' },
      { asset: 'ETH', free: '2', locked: '0' },
    ],
  }),
  fetchPairData: vi.fn().mockResolvedValue({ symbol: 'BTCUSDT', currentPrice: 100 }),
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
  parseBinanceError: vi.fn().mockReturnValue(null),
  fetchFearGreedIndex: vi
    .fn()
    .mockResolvedValue({ value: 50, classification: 'Neutral' }),
}));

vi.mock('../src/services/indicators.js', () => ({
  fetchTokenIndicators: vi.fn().mockResolvedValue(sampleIndicators),
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

async function setupAgent(tokens: string[], manual = false) {
  const userId = await insertUser();
  await setAiKey(userId, 'enc');
  const agent = await insertAgent({
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
  return { userId, agentId: agent.id };
}

describe('reviewPortfolio', () => {
  it('saves decision and logs', async () => {
    const { agentId } = await setupAgent(['BTC']);
    const decision = {
      orders: [{ pair: 'BTCUSDT', token: 'BTC', side: 'SELL', quantity: 1 }],
      shortReport: 'ok',
    };
    runMainTrader.mockResolvedValue(decision);
    const log = mockLogger();
    await reviewAgentPortfolio(log, agentId);
    expect(runMainTrader).toHaveBeenCalledTimes(1);
    expect(runNewsAnalyst).toHaveBeenCalled();
    expect(runTechnicalAnalyst).toHaveBeenCalled();
    const rows = await getPortfolioReviewRawPromptsResponses(agentId);
    const row = rows[0];
    expect(JSON.parse(row.response!)).toEqual(decision);
    const [res] = await getRecentReviewResults(agentId, 1);
    expect(res.rebalance).toBe(true);
    expect(res.shortReport).toBe('ok');
  });

  it('calls createDecisionLimitOrders when orders requested', async () => {
    const { userId: user2, agentId: agent2 } = await setupAgent(['BTC', 'ETH']);
    const decision = {
      orders: [
        { pair: 'BTCUSDT', token: 'BTC', side: 'BUY', quantity: 1 },
        { pair: 'ETHBTC', token: 'ETH', side: 'SELL', quantity: 0.5 },
      ],
      shortReport: 's',
    };
    runMainTrader.mockResolvedValue(decision);
    const log = mockLogger();
    await reviewAgentPortfolio(log, agent2);
    expect(createDecisionLimitOrders).toHaveBeenCalledTimes(1);
    const args = createDecisionLimitOrders.mock.calls[0][0];
    expect(args.userId).toBe(user2);
    expect(args.orders).toHaveLength(2);
  });

  it('skips createDecisionLimitOrders when manualRebalance is enabled', async () => {
    const { agentId: agent3 } = await setupAgent(['BTC'], true);
    const decision = {
      orders: [{ pair: 'BTCUSDT', token: 'BTC', side: 'BUY', quantity: 1 }],
      shortReport: 's',
    };
    runMainTrader.mockResolvedValue(decision);
    const log = mockLogger();
    await reviewAgentPortfolio(log, agent3);
    expect(createDecisionLimitOrders).not.toHaveBeenCalled();
  });

  it('records error when pair is invalid', async () => {
    const { agentId: agent4 } = await setupAgent(['BTC']);
    const decision = {
      orders: [{ pair: 'FOO', token: 'BTC', side: 'BUY', quantity: 1 }],
      shortReport: 's',
    };
    runMainTrader.mockResolvedValue(decision);
    const log = mockLogger();
    await reviewAgentPortfolio(log, agent4);
    const [row] = await getRecentReviewResults(agent4, 1);
    expect(row.error).toBeTruthy();
  });

  it('records error when quantity is invalid', async () => {
    const { agentId: agent5 } = await setupAgent(['BTC']);
    const decision = {
      orders: [{ pair: 'BTCUSDT', token: 'BTC', side: 'BUY', quantity: 0 }],
      shortReport: 's',
    };
    runMainTrader.mockResolvedValue(decision);
    const log = mockLogger();
    await reviewAgentPortfolio(log, agent5);
    const [row] = await getRecentReviewResults(agent5, 1);
    expect(row.error).toBeTruthy();
  });
});

