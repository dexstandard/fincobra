import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { mockLogger } from './helpers.js';
import { insertUser } from './repos/users.js';
import { insertPortfolioWorkflow } from './repos/portfolio-workflows.js';
import { setAiKey, setGroqKey } from '../src/repos/ai-api-key.js';
import { setBybitKey } from '../src/repos/exchange-api-keys.js';
import { getPortfolioReviewRawPromptsResponses } from './repos/review-raw-log.js';
import { getRecentReviewResults } from '../src/repos/review-result.js';
import * as mainTrader from '../src/agents/main-trader.js';

const sampleTimeseries = vi.hoisted(() => ({
  minute_60: [[1, 2, 3, 4]],
  hourly_24h: [[5, 6, 7, 8]],
  monthly_24m: [[9, 10, 11]],
}));

const runMainTrader = vi.fn();
vi.spyOn(mainTrader, 'run').mockImplementation(runMainTrader);

const getNewsByTokenMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock('../src/repos/news.js', () => ({
  getNewsByToken: getNewsByTokenMock,
}));

const waitMock = vi.hoisted(() => vi.fn());
vi.mock('../src/util/time.js', () => ({
  wait: waitMock,
}));

import {
  reviewWorkflowPortfolio,
  removeWorkflowFromSchedule,
  executeWorkflow,
} from '../src/workflows/portfolio-review.js';
import type { ActivePortfolioWorkflow } from '../src/repos/portfolio-workflows.types.js';

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
  isInvalidSymbolError: vi
    .fn((err: unknown) =>
      err instanceof Error && /Invalid symbol/i.test(err.message),
    )
    .mockName('isInvalidSymbolError'),
}));

vi.mock('../src/services/sentiment.js', () => ({
  fetchFearGreedIndex: vi
    .fn()
    .mockResolvedValue({ value: 50, classification: 'Neutral' }),
}));

const sampleMarketOverview = vi.hoisted(() => ({
  schema: 'market_overview.v2.1' as const,
  asOf: '2024-01-01T00:00:00Z',
  timeframe: {
    candleInterval: '1h',
    decisionInterval: 'PT30M',
    semantics: '',
  },
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
    ETH: {
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

vi.mock('../src/services/indicators.js', () => ({
  fetchMarketOverview: vi.fn().mockResolvedValue(sampleMarketOverview),
  createEmptyMarketOverview: vi
    .fn()
    .mockReturnValue(JSON.parse(JSON.stringify(sampleMarketOverview))),
  clearMarketOverviewCache: vi.fn(),
}));

const executeSpotDecision = vi.hoisted(() =>
  vi
    .fn()
    .mockResolvedValue({
      placed: 0,
      canceled: 0,
      priceDivergenceCancellations: 0,
      needsPriceDivergenceRetry: false,
    }),
);
const executeFuturesDecision = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ executed: 0, failed: 0, skipped: 0 }),
);
vi.mock('../src/services/rebalance.js', () => ({
  executeSpotDecision,
}));
vi.mock('../src/services/futures-execution.js', () => ({
  executeFuturesDecision,
}));

beforeEach(() => {
  vi.clearAllMocks();
  waitMock.mockReset();
  waitMock.mockResolvedValue(undefined);
  ['1', '2', '3', '4', '5'].forEach((id) => removeWorkflowFromSchedule(id));
});

async function setupWorkflow(
  tokens: string[],
  manual = false,
  aiProvider: 'openai' | 'groq' = 'openai',
) {
  const userId = await insertUser();
  if (aiProvider === 'groq') {
    await setGroqKey({ userId, apiKeyEnc: 'enc' });
  } else {
    await setAiKey({ userId, apiKeyEnc: 'enc' });
  }
  const agent = await insertPortfolioWorkflow({
    userId,
    model: 'gpt',
    status: 'active',
    startBalance: null,
    cashToken: 'USDT',
    tokens: tokens.map((t, i) => ({ token: t, minAllocation: (i + 1) * 10 })),
    risk: 'low',
    reviewInterval: '1h',
    agentInstructions: 'inst',
    manualRebalance: manual,
    useEarn: false,
    aiProvider,
  });
  return { userId, workflowId: agent.id };
}

describe('reviewPortfolio', () => {
  it('saves decision and logs', async () => {
    const { workflowId } = await setupWorkflow(['BTC']);
    const decision = {
      orders: [{ pair: 'BTCUSDT', token: 'BTC', side: 'SELL', qty: 1 }],
      shortReport: 'ok',
    };
    runMainTrader.mockResolvedValue({ mode: 'spot', decision });
    const log = mockLogger();
    await reviewWorkflowPortfolio(log, workflowId);
    expect(runMainTrader).toHaveBeenCalledTimes(1);
    const rows = await getPortfolioReviewRawPromptsResponses(workflowId);
    const row = rows[0];
    const promptPayload = JSON.parse(row.prompt!);
    const btcReport = promptPayload.reports.find(
      (r: any) => r.token === 'BTC',
    );
    expect(btcReport?.news?.version).toBe('news_context.v1');
    const passedPrompt = runMainTrader.mock.calls[0]?.[1];
    expect(passedPrompt?.mode).toBe('spot');
    expect(
      passedPrompt?.prompt?.reports?.find((r: any) => r.token === 'BTC')?.news,
    )
      .toBeDefined();
    expect(JSON.parse(row.response!)).toEqual(decision);
    const [res] = await getRecentReviewResults(workflowId, 1);
    expect(res.rebalance).toBe(true);
    expect(res.shortReport).toBe('ok');
  });

  it('calls executeSpotDecision when orders requested', async () => {
    const { userId: user2, workflowId: agent2 } = await setupWorkflow([
      'BTC',
      'ETH',
    ]);
    const decision = {
      orders: [
        { pair: 'BTCUSDT', token: 'BTC', side: 'BUY', qty: 1 },
        { pair: 'ETHBTC', token: 'ETH', side: 'SELL', qty: 0.5 },
      ],
      shortReport: 's',
    };
    runMainTrader.mockResolvedValue({ mode: 'spot', decision });
    const log = mockLogger();
    await reviewWorkflowPortfolio(log, agent2);
    expect(executeSpotDecision).toHaveBeenCalledTimes(1);
    const args = executeSpotDecision.mock.calls[0][0];
    expect(args.userId).toBe(user2);
    expect(args.orders).toHaveLength(2);
  });

  it('routes futures actions to the futures executor', async () => {
    const userId = await insertUser();
    await setAiKey({ userId, apiKeyEnc: 'enc' });
    await setBybitKey({ userId, apiKeyEnc: 'key', apiSecretEnc: 'secret' });
    const workflow = await insertPortfolioWorkflow({
      userId,
      model: 'gpt',
      status: 'active',
      startBalance: null,
      cashToken: 'USDT',
      tokens: [{ token: 'BTC', minAllocation: 50 }],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      manualRebalance: false,
      useEarn: false,
      mode: 'futures',
      futuresDefaultLeverage: 3,
      futuresMarginMode: 'cross',
    });
    const promptSpy = vi
      .spyOn(mainTrader, 'collectPromptData')
      .mockResolvedValueOnce({ mode: 'futures', prompt: { foo: 'bar' } });
    const futuresDecision = {
      actions: [
        {
          symbol: 'BTCUSDT',
          positionSide: 'LONG',
          action: 'OPEN',
          type: 'MARKET',
          quantity: 0.5,
        },
      ],
      shortReport: 'futures',
    };
    runMainTrader.mockResolvedValue({
      mode: 'futures',
      decision: futuresDecision,
    });

    const log = mockLogger();
    await reviewWorkflowPortfolio(log, workflow.id);
    expect(executeFuturesDecision).toHaveBeenCalledTimes(1);
    const args = executeFuturesDecision.mock.calls[0][0];
    expect(args.userId).toBe(userId);
    expect(args.exchange).toBe('bybit');
    expect(args.actions).toEqual(futuresDecision.actions);
    promptSpy.mockRestore();
  });

  it('treats missing orders as a hold decision', async () => {
    const { workflowId } = await setupWorkflow(['BTC']);
    const decision = { shortReport: 'holding pattern' } as any;
    runMainTrader.mockResolvedValue({ mode: 'spot', decision });
    const log = mockLogger();
    await reviewWorkflowPortfolio(log, workflowId);
    expect(executeSpotDecision).not.toHaveBeenCalled();
    const [result] = await getRecentReviewResults(workflowId, 1);
    expect(result.rebalance).toBe(false);
    expect(result.shortReport).toBe('holding pattern');
    expect(result.error).toBeUndefined();
  });

  it('retries workflow when every order is canceled for price divergence', async () => {
    const { workflowId } = await setupWorkflow(['BTC']);
    const decision = {
      orders: [
        { pair: 'BTCUSDT', token: 'BTC', side: 'BUY', qty: 1 },
      ],
      shortReport: 'retry',
    };
    runMainTrader.mockResolvedValue({ mode: 'spot', decision });
    const clearCachesSpy = vi.spyOn(mainTrader, 'clearMainTraderCaches');
    const firstOrderPromise = new Promise<void>((resolve) => {
      executeSpotDecision.mockImplementationOnce(async () => {
        resolve();
        return {
          placed: 0,
          canceled: 1,
          priceDivergenceCancellations: 1,
          needsPriceDivergenceRetry: true,
        };
      });
    });
    executeSpotDecision.mockResolvedValueOnce({
      placed: 1,
      canceled: 0,
      priceDivergenceCancellations: 0,
      needsPriceDivergenceRetry: false,
    });
    const log = mockLogger();
    await reviewWorkflowPortfolio(log, workflowId);
    expect(runMainTrader).toHaveBeenCalledTimes(2);
    expect(executeSpotDecision).toHaveBeenCalledTimes(2);
    expect(clearCachesSpy).toHaveBeenCalledTimes(1);
  });

  it(
    'waits configured delay before retrying price divergence when using groq',
    async () => {
      const originalGroqDelay =
        process.env.GROQ_PRICE_DIVERGENCE_RETRY_DELAY_MS;
      const configuredDelayMs = 25;
      process.env.GROQ_PRICE_DIVERGENCE_RETRY_DELAY_MS = String(
        configuredDelayMs,
      );
      waitMock.mockReset();
      waitMock.mockResolvedValue(undefined);

      const workflow: ActivePortfolioWorkflow = {
        id: 'wf-1',
        userId: 'user-1',
        model: 'gpt',
        aiProvider: 'groq',
        cashToken: 'USDT',
        tokens: [],
        risk: 'low',
        reviewInterval: '1h',
        agentInstructions: 'inst',
        aiApiKeyId: 'ai',
        aiApiKeyEnc: 'enc',
        exchangeApiKeyId: null,
        manualRebalance: false,
        useEarn: false,
        startBalance: null,
        createdAt: new Date().toISOString(),
        portfolioId: 'wf-1',
        mode: 'spot',
        futuresDefaultLeverage: null,
        futuresMarginMode: null,
      };

      vi.useFakeTimers();
      vi.setSystemTime(0);
      const runAttempt = vi
        .fn<
          (
            wf: ActivePortfolioWorkflow,
            logger: FastifyBaseLogger,
          ) =>
            Promise<
              { kind: 'retry'; lastAiRequestAt: number } | { kind: 'success' }
            >
        >()
        .mockResolvedValueOnce({ kind: 'retry', lastAiRequestAt: 0 })
        .mockResolvedValueOnce({ kind: 'success' });

      try {
        const log = mockLogger();
        await executeWorkflow(workflow, log, {
          runWorkflowAttempt: runAttempt,
          wait: waitMock,
        });

        expect(runAttempt).toHaveBeenCalledTimes(2);
        expect(waitMock).toHaveBeenCalledTimes(1);
        const [delayMs] = waitMock.mock.calls[0] ?? [];
        expect(delayMs).toBe(configuredDelayMs);
      } finally {
        waitMock.mockReset();
        waitMock.mockResolvedValue(undefined);
        vi.useRealTimers();
        if (originalGroqDelay) {
          process.env.GROQ_PRICE_DIVERGENCE_RETRY_DELAY_MS = originalGroqDelay;
        } else {
          delete process.env.GROQ_PRICE_DIVERGENCE_RETRY_DELAY_MS;
        }
      }
    },
    10_000,
  );

  it('skips executeSpotDecision when manualRebalance is enabled', async () => {
    const { workflowId: agent3 } = await setupWorkflow(['BTC'], true);
    const decision = {
      orders: [{ pair: 'BTCUSDT', token: 'BTC', side: 'BUY', qty: 1 }],
      shortReport: 's',
    };
    runMainTrader.mockResolvedValue({ mode: 'spot', decision });
    const log = mockLogger();
    await reviewWorkflowPortfolio(log, agent3);
    expect(executeSpotDecision).not.toHaveBeenCalled();
  });

  it('records error when pair is invalid', async () => {
    const { workflowId: agent4 } = await setupWorkflow(['BTC']);
    const decision = {
      orders: [{ pair: 'FOO', token: 'BTC', side: 'BUY', qty: 1 }],
      shortReport: 's',
    };
    runMainTrader.mockResolvedValue({ mode: 'spot', decision });
    const log = mockLogger();
    await reviewWorkflowPortfolio(log, agent4);
    const [row] = await getRecentReviewResults(agent4, 1);
    expect(row.error).toBeTruthy();
  });

  it('records error when quantity is invalid', async () => {
    const { workflowId: agent5 } = await setupWorkflow(['BTC']);
    const decision = {
      orders: [{ pair: 'BTCUSDT', token: 'BTC', side: 'BUY', qty: 0 }],
      shortReport: 's',
    };
    runMainTrader.mockResolvedValue({ mode: 'spot', decision });
    const log = mockLogger();
    await reviewWorkflowPortfolio(log, agent5);
    const [row] = await getRecentReviewResults(agent5, 1);
    expect(row.error).toBeTruthy();
  });
});
