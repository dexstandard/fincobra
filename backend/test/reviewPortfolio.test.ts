import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { mockLogger } from './helpers.js';
import { insertUser } from './repos/users.js';
import { insertAgent } from './repos/portfolio-workflow.js';
import { setAiKey } from '../src/repos/ai-api-key.js';
import { getPortfolioReviewRawPromptsResponses } from './repos/review-raw-log.js';
import { getRecentReviewResults } from '../src/repos/review-result.js';
import * as mainTrader from '../src/agents/main-trader.js';
import * as newsAnalyst from '../src/agents/news-analyst.js';
import * as techAnalyst from '../src/agents/technical-analyst.js';

const { sampleIndicators, sampleTimeseries } = vi.hoisted(() => ({
  sampleIndicators: {
    ret1h: 0,
    ret4h: 0,
    ret24h: 0,
    ret7d: 0,
    ret30d: 0,
    smaDist20: 0,
    smaDist50: 0,
    smaDist200: 0,
    macdHist: 0,
    volRv7d: 0,
    volRv30d: 0,
    volAtrPct: 0,
    rangeBbBw: 0,
    rangeDonchian20: 0,
    volumeZ1h: 0,
    volumeZ24h: 0,
    corrBtc30d: 0,
    regimeBtc: 'range',
    oscRsi14: 0,
    oscStochK: 0,
    oscStochD: 0,
  },
  sampleTimeseries: {
    minute_60: [[1, 2, 3, 4]],
    hourly_24h: [[5, 6, 7, 8]],
    monthly_24m: [[9, 10, 11]],
  },
}));

const flatIndicators = {
  ret1h: 0,
  ret4h: 0,
  ret24h: 0,
  ret7d: 0,
  ret30d: 0,
  smaDist20: 0,
  smaDist50: 0,
  smaDist200: 0,
  macdHist: 0,
  volRv7d: 0,
  volRv30d: 0,
  volAtrPct: 0,
  rangeBbBw: 0,
  rangeDonchian20: 0,
  volumeZ1h: 0,
  volumeZ24h: 0,
  corrBtc30d: 0,
  regimeBtc: 'range',
  oscRsi14: 0,
  oscStochK: 0,
  oscStochD: 0,
};

const flatTimeseries = {
  ret60m: ((3 - 2) / 2) * 100,
  ret24h: ((7 - 6) / 6) * 100,
  ret24m: ((11 - 10) / 10) * 100,
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

vi.mock('../src/services/binance-client.js', () => ({
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
  parseBinanceError: vi.fn().mockReturnValue({}),
  fetchOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/services/sentiment.js', () => ({
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
  await setAiKey({ userId, apiKeyEnc: 'enc' });
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

