import { LimitOrderStatus } from '../src/repos/limit-orders.types.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockLogger } from './helpers.js';
import type { ActivePortfolioWorkflow } from '../src/repos/portfolio-workflows.js';
import {
  collectPromptData,
  __resetNewsContextCacheForTest,
} from '../src/agents/main-trader.js';
import {
  fetchAccount,
  fetchPairInfo,
  fetchPairPrice,
} from '../src/services/binance-client.js';

const getNewsByTokenMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const getUsdPriceMock = vi.hoisted(() =>
  vi.fn().mockImplementation(async (symbol: 'USDT' | 'USDC') => ({
    symbol,
    price: symbol === 'USDT' ? 0.999 : 1.001,
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  })),
);

function defaultFetchPairPrice(t1: string, t2: string) {
  if (t1 === 'USDT') {
    return Promise.resolve({ symbol: `${t2}USDT`, currentPrice: 20000 });
  }
  if (t2 === 'USDT') {
    return Promise.resolve({ symbol: `${t1}USDT`, currentPrice: 20000 });
  }
  return Promise.resolve({ symbol: `${t1}${t2}`, currentPrice: 20000 });
}

function defaultFetchPairInfo(t1: string, t2: string) {
  if (t1 === 'USDT') {
    return Promise.resolve({
      symbol: `${t2}USDT`,
      baseAsset: t2,
      quoteAsset: 'USDT',
      quantityPrecision: 8,
      pricePrecision: 2,
      minNotional: 10,
    });
  }
  if (t2 === 'USDT') {
    return Promise.resolve({
      symbol: `${t1}USDT`,
      baseAsset: t1,
      quoteAsset: 'USDT',
      quantityPrecision: 8,
      pricePrecision: 2,
      minNotional: 10,
    });
  }
  return Promise.resolve({
    symbol: `${t1}${t2}`,
    baseAsset: t1,
    quoteAsset: t2,
    quantityPrecision: 8,
    pricePrecision: 2,
    minNotional: 10,
  });
}

vi.mock('../src/services/binance-client.js', () => ({
  fetchAccount: vi.fn().mockResolvedValue({
    balances: [
      { asset: 'BTC', free: '1', locked: '0' },
      { asset: 'USDT', free: '1000', locked: '0' },
      { asset: 'ETH', free: '5', locked: '0' },
    ],
  }),
  fetchPairPrice: vi.fn().mockImplementation(defaultFetchPairPrice),
  fetchPairInfo: vi.fn().mockImplementation(defaultFetchPairInfo),
  fetchOrder: vi.fn().mockResolvedValue(undefined),
  isInvalidSymbolError: vi
    .fn((err: unknown) =>
      err instanceof Error && /Invalid symbol/i.test(err.message),
    )
    .mockName('isInvalidSymbolError'),
}));

vi.mock('../src/repos/review-result.js', () => ({
  getRecentReviewResults: vi.fn().mockImplementation(async (_workflowId, limit) =>
    Array.from({ length: 5 }, (_, i) => {
      const day = 5 - i;
      return {
        id: `r${day}`,
        createdAt: new Date(`2025-01-0${day}T00:00:00.000Z`),
        shortReport: `p${day}`,
        log: JSON.stringify({ strategyName: `Strategy ${day}` }),
      };
    }).slice(0, limit),
  ),
}));

vi.mock('../src/repos/limit-orders.js', () => ({
  getLimitOrdersByReviewResult: vi
    .fn()
    .mockImplementation(async (_workflowId, reviewId) => {
      const i = Number(reviewId.slice(1));
      return [
        {
          plannedJson: JSON.stringify({
            symbol: 'BTCUSDT',
            side: 'BUY',
            qty: i,
            limitPrice: 50_000 + i,
          }),
          status: LimitOrderStatus.Filled,
          createdAt: new Date(`2025-01-0${i}T00:00:00.000Z`),
          orderId: String(i),
          cancellationReason: 'price limit',
        },
      ];
    }),
}));

vi.mock('../src/repos/news.js', () => ({
  getNewsByToken: getNewsByTokenMock,
}));

vi.mock('../src/repos/review-raw-log.js', () => ({
  getPromptForReviewResult: vi
    .fn()
    .mockImplementation(async (_workflowId: string, resultId: string) => {
      const idx = Number(resultId.slice(1));
      return JSON.stringify({ portfolio: { pnlUsd: idx * 100 } });
    }),
}));

vi.mock('../src/services/price-oracle.js', () => ({
  getUsdPrice: getUsdPriceMock,
}));

describe('collectPromptData', () => {
  beforeEach(() => {
    __resetNewsContextCacheForTest();
    getNewsByTokenMock.mockReset();
    getNewsByTokenMock.mockResolvedValue([]);
    getUsdPriceMock.mockClear();
    vi.mocked(fetchAccount).mockResolvedValue({
      balances: [
        { asset: 'BTC', free: '1', locked: '0' },
        { asset: 'USDT', free: '1000', locked: '0' },
        { asset: 'ETH', free: '5', locked: '0' },
        { asset: 'DOGE', free: '100', locked: '0' },
      ],
    });
    vi.mocked(fetchPairPrice).mockImplementation(defaultFetchPairPrice);
    vi.mocked(fetchPairInfo).mockImplementation(defaultFetchPairInfo);
  });

  async function getSpotPrompt(row: ActivePortfolioWorkflow) {
    const result = await collectPromptData(row, mockLogger());
    expect(result?.mode).toBe('spot');
    return result?.prompt;
  }

  it('includes start balance and PnL in prompt', async () => {
    const row: ActivePortfolioWorkflow = {
      id: '1',
      userId: 'u1',
      model: 'm',
      cashToken: 'USDT',
      tokens: [{ token: 'BTC', minAllocation: 50 }],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      aiApiKeyId: null,
      aiApiKeyEnc: '',
      manualRebalance: false,
      useEarn: false,
      startBalance: 20000,
      createdAt: '2025-01-01T00:00:00.000Z',
      portfolioId: '1',
      mode: 'spot',
      futuresDefaultLeverage: null,
      futuresMarginMode: null,
    };

    const prompt = await getSpotPrompt(row);
    expect(prompt?.portfolio.startBalanceUsd).toBe(20000);
    expect(prompt?.portfolio.startBalanceTs).toBe('2025-01-01T00:00:00.000Z');
    expect(prompt?.portfolio.pnlUsd).toBeCloseTo(1000);
    expect(prompt?.portfolio.pnlPct).toBeCloseTo(0.05);
    expect(prompt?.reviewInterval).toBe('PT1H');
    expect(prompt).not.toHaveProperty('instructions');
  });

  it('adds stablecoin oracle report when using stable cash token', async () => {
    const row: ActivePortfolioWorkflow = {
      id: 'stable-report',
      userId: 'stable-user',
      model: 'm',
      cashToken: 'USDT',
      tokens: [{ token: 'BTC', minAllocation: 50 }],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      aiApiKeyId: null,
      aiApiKeyEnc: '',
      manualRebalance: false,
      useEarn: false,
      startBalance: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      portfolioId: 'stable-report',
      mode: 'spot',
      futuresDefaultLeverage: null,
      futuresMarginMode: null,
    };

    const prompt = await getSpotPrompt(row);
    expect(getUsdPriceMock).toHaveBeenCalledTimes(1);
    expect(getUsdPriceMock).toHaveBeenCalledWith('USDT');
    const stableReport = prompt?.reports?.find(
      (r) => r.token === 'USDT/USD',
    );
    expect(stableReport?.stablecoinOracle?.pair).toBe('USDT/USD');
    expect(stableReport?.stablecoinOracle?.quote.usdPrice ?? 0).toBeCloseTo(
      0.999,
    );
    expect(stableReport?.stablecoinOracle?.quote.updatedAt).toBe(
      '2025-01-01T00:00:00.000Z',
    );
  });

  it('requests matching oracle quote for USDC cash token', async () => {
    const row: ActivePortfolioWorkflow = {
      id: 'stable-report-usdc',
      userId: 'stable-user-usdc',
      model: 'm',
      cashToken: 'USDC',
      tokens: [{ token: 'BTC', minAllocation: 50 }],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      aiApiKeyId: null,
      aiApiKeyEnc: '',
      manualRebalance: false,
      useEarn: false,
      startBalance: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      portfolioId: 'stable-report-usdc',
      mode: 'spot',
      futuresDefaultLeverage: null,
      futuresMarginMode: null,
    };

    const prompt = await getSpotPrompt(row);
    expect(getUsdPriceMock).toHaveBeenCalledTimes(1);
    expect(getUsdPriceMock).toHaveBeenCalledWith('USDC');
    const stableReport = prompt?.reports?.find((r) => r.token === 'USDC/USD');
    expect(stableReport?.stablecoinOracle?.pair).toBe('USDC/USD');
    expect(stableReport?.stablecoinOracle?.quote.usdPrice ?? 0).toBeCloseTo(
      1.001,
    );
  });

  it('throws descriptive error when a token pair is unsupported', async () => {
    const row: ActivePortfolioWorkflow = {
      id: '1',
      userId: 'u1',
      model: 'm',
      cashToken: 'USDC',
      tokens: [{ token: 'BTC', minAllocation: 50 }],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      aiApiKeyId: null,
      aiApiKeyEnc: '',
      manualRebalance: false,
      useEarn: false,
      startBalance: 20000,
      createdAt: '2025-01-01T00:00:00.000Z',
      portfolioId: '1',
      mode: 'spot',
      futuresDefaultLeverage: null,
      futuresMarginMode: null,
    };

    vi.mocked(fetchPairPrice).mockImplementationOnce(() => {
      throw new Error(
        'failed to fetch symbol price: 400 {"code":-1121,"msg":"Invalid symbol."}',
      );
    });

    await expect(collectPromptData(row, mockLogger())).rejects.toThrow(
      'unsupported trading pair: BTC/USDC',
    );
  });

  it('includes recent limit orders in prompt', async () => {
    const row: ActivePortfolioWorkflow = {
      id: '1',
      userId: 'u1',
      model: 'm',
      cashToken: 'USDT',
      tokens: [{ token: 'BTC', minAllocation: 50 }],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      aiApiKeyId: null,
      aiApiKeyEnc: '',
      manualRebalance: false,
      useEarn: false,
      startBalance: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      portfolioId: '1',
      mode: 'spot',
      futuresDefaultLeverage: null,
      futuresMarginMode: null,
    };

    const prompt = await getSpotPrompt(row);
    expect(prompt?.previousReports).toHaveLength(3);
    expect(prompt?.previousReports?.[0]).toMatchObject({
      ts: '2025-01-05T00:00:00.000Z',
      orders: [
        {
          symbol: 'BTCUSDT',
          side: 'BUY',
          qty: 5,
          price: 50005,
          status: LimitOrderStatus.Filled,
          reason: 'price limit',
        },
      ],
      shortReport: 'p5',
      strategyName: 'Strategy 5',
    });
    expect(prompt?.previousReports?.[0]?.pnlShiftUsd).toBeCloseTo(100);
  });

  it('computes pnl shifts for all previous reports when current pnl is available', async () => {
    const row: ActivePortfolioWorkflow = {
      id: '1',
      userId: 'u1',
      model: 'm',
      cashToken: 'USDT',
      tokens: [{ token: 'BTC', minAllocation: 50 }],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      aiApiKeyId: null,
      aiApiKeyEnc: '',
      manualRebalance: false,
      useEarn: false,
      startBalance: 20000,
      createdAt: '2025-01-01T00:00:00.000Z',
      portfolioId: '1',
      mode: 'spot',
      futuresDefaultLeverage: null,
      futuresMarginMode: null,
    };

    const prompt = await getSpotPrompt(row);

    expect(prompt?.previousReports).toHaveLength(3);
    expect(prompt?.previousReports?.[0]?.pnlShiftUsd).toBeCloseTo(500);
    expect(prompt?.previousReports?.[1]?.pnlShiftUsd).toBeCloseTo(100);
    expect(prompt?.previousReports?.[2]?.pnlShiftUsd).toBeCloseTo(100);
  });

  it('handles three-token portfolio', async () => {
    const row: ActivePortfolioWorkflow = {
      id: '1',
      userId: 'u1',
      model: 'm',
      cashToken: 'USDT',
      tokens: [
        { token: 'BTC', minAllocation: 40 },
        { token: 'ETH', minAllocation: 30 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      aiApiKeyId: null,
      aiApiKeyEnc: '',
      manualRebalance: false,
      useEarn: false,
      startBalance: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      portfolioId: '1',
      mode: 'spot',
      futuresDefaultLeverage: null,
      futuresMarginMode: null,
    };

    const prompt = await getSpotPrompt(row);
    expect(prompt?.portfolio.positions).toHaveLength(3);
    expect(prompt?.cash).toBe('USDT');
    expect(prompt?.routes).toHaveLength(3);
    const route = prompt!.routes[0];
    expect(route).toMatchObject({
      pair: 'BTCUSDT',
      price: 20000,
      USDT: { minNotional: 10 },
      BTC: { minNotional: 10 / 20000 },
    });
    expect(prompt?.policy.floor.USDT).toBe(0);
  });

  it('excludes locked balances for current positions', async () => {
    vi.mocked(fetchAccount).mockResolvedValueOnce({
      balances: [
        { asset: 'BTC', free: '1', locked: '2' },
        { asset: 'USDT', free: '1000', locked: '500' },
      ],
    });

    const row: ActivePortfolioWorkflow = {
      id: '1',
      userId: 'u1',
      model: 'm',
      cashToken: 'USDT',
      tokens: [{ token: 'BTC', minAllocation: 50 }],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      aiApiKeyId: null,
      aiApiKeyEnc: '',
      manualRebalance: false,
      useEarn: false,
      startBalance: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      portfolioId: '1',
    };

    const prompt = await getSpotPrompt(row);
    const btc = prompt?.portfolio.positions.find((p) => p.sym === 'BTC');
    const usdt = prompt?.portfolio.positions.find((p) => p.sym === 'USDT');
    expect(btc?.qty).toBe(1);
    expect(usdt?.qty).toBe(1000);
  });

  it('skips malformed routes with zero price', async () => {
    const priceMock = vi.mocked(fetchPairPrice);
    priceMock.mockImplementation((t1: string, t2: string) => {
      if (t1 === 'BTC' && t2 === 'ETH') {
        return Promise.resolve({ symbol: 'BTCETH', currentPrice: 0 });
      }
      return defaultFetchPairPrice(t1, t2);
    });

    const row: ActivePortfolioWorkflow = {
      id: 'route-skip',
      userId: 'user',
      model: 'model',
      cashToken: 'USDT',
      tokens: [
        { token: 'BTC', minAllocation: 40 },
        { token: 'ETH', minAllocation: 30 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      aiApiKeyId: null,
      aiApiKeyEnc: '',
      manualRebalance: false,
      useEarn: false,
      startBalance: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      portfolioId: 'route-skip',
      mode: 'spot',
      futuresDefaultLeverage: null,
      futuresMarginMode: null,
    };

    const prompt = await getSpotPrompt(row);
    expect(prompt?.routes).toHaveLength(2);
    expect(prompt?.routes?.map((r) => r.pair)).toEqual(
      expect.arrayContaining(['BTCUSDT', 'ETHUSDT']),
    );
  });

  it('throws when every attempted route is malformed', async () => {
    const priceMock = vi.mocked(fetchPairPrice);
    priceMock.mockImplementation(() =>
      Promise.resolve({ symbol: 'BTCUSDT', currentPrice: 0 }),
    );

    const row: ActivePortfolioWorkflow = {
      id: 'route-fail',
      userId: 'user',
      model: 'model',
      cashToken: 'USDT',
      tokens: [{ token: 'BTC', minAllocation: 40 }],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      aiApiKeyId: null,
      aiApiKeyEnc: '',
      manualRebalance: false,
      useEarn: false,
      startBalance: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      portfolioId: 'route-fail',
      mode: 'spot',
      futuresDefaultLeverage: null,
      futuresMarginMode: null,
    };

    await expect(collectPromptData(row, mockLogger())).rejects.toThrow(
      'no valid trading routes available',
    );
  });

  it('throws when review interval is missing', async () => {
    const row: ActivePortfolioWorkflow = {
      id: 'missing-interval',
      userId: 'user',
      model: 'model',
      cashToken: 'USDT',
      tokens: [{ token: 'BTC', minAllocation: 40 }],
      risk: 'low',
      reviewInterval: '  ',
      agentInstructions: 'inst',
      aiApiKeyId: null,
      aiApiKeyEnc: '',
      manualRebalance: false,
      useEarn: false,
      startBalance: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      portfolioId: 'missing-interval',
      mode: 'spot',
      futuresDefaultLeverage: null,
      futuresMarginMode: null,
    };

    await expect(collectPromptData(row, mockLogger())).rejects.toThrow(
      'workflow review interval is required',
    );
  });

  it('builds structured news context with aggregates', async () => {
    vi.useFakeTimers();
    try {
      const now = new Date('2025-02-01T12:00:00Z');
      vi.setSystemTime(now);
      getNewsByTokenMock.mockImplementationOnce(async () => [
        {
          title: 'Bridge XYZ hacked for $8M; withdrawals paused',
          link: 'hack-link',
          pubDate: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
          domain: 'coindesk.com',
        },
        {
          title: 'Binance lists ABC token with USDT pair',
          link: 'listing-link',
          pubDate: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
          domain: 'coindesk.com',
        },
        {
          title: 'USDC depegs to $0.97 amid market stress',
          link: 'depeg-link',
          pubDate: new Date(now.getTime() - 45 * 60 * 1000).toISOString(),
          domain: 'coindesk.com',
        },
        {
          title: 'Report: ETF approval expected (rumor)',
          link: 'rumor-link',
          pubDate: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
          domain: 'news.bitcoin.com',
        },
        {
          title: 'General market update from Cointelegraph',
          link: 'general-link',
          pubDate: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(),
          domain: 'cointelegraph.com',
        },
        {
          title: 'Partnership announced with Coinbase',
          link: 'partnership-link',
          pubDate: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(),
          domain: 'coindesk.com',
        },
      ]);

      const row: ActivePortfolioWorkflow = {
        id: 'news-wf',
        userId: 'user-news',
        model: 'm',
        cashToken: 'USDT',
        tokens: [{ token: 'BTC', minAllocation: 50 }],
        risk: 'low',
        reviewInterval: '1h',
        agentInstructions: 'inst',
        aiApiKeyId: null,
        aiApiKeyEnc: '',
        manualRebalance: false,
        useEarn: false,
        startBalance: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        portfolioId: 'news-wf',
        mode: 'spot',
        futuresDefaultLeverage: null,
        futuresMarginMode: null,
      };

      const prompt = await getSpotPrompt(row);
      const news = prompt?.reports?.find((r) => r.token === 'BTC')?.news;

      expect(news?.version).toBe('news_context.v1');
      expect(news?.items.length).toBe(5);
      expect(news?.bias).toBeLessThan(0);
      expect(news?.maxSev ?? 0).toBeGreaterThan(0.7);
      expect(news?.bear ?? 0).toBeGreaterThan(0);
      expect(news?.bull ?? 0).toBeGreaterThan(0);
      expect(news?.top).toMatch(/^StablecoinDepeg — bearish \(sev=\d\.\d{2}\)/);
      expect(news?.warning).toBe(
        'Machine-estimated news risk. Verify the headlines and source links before reacting to avoid panic selling.',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('caches structured news context per token for 60 seconds', async () => {
    vi.useFakeTimers();
    try {
      const baseTime = new Date('2025-03-01T00:00:00Z');
      vi.setSystemTime(baseTime);

      const firstNews = [
        {
          title: 'Dogecoin hack drains bridge',
          link: 'doge-hack',
          pubDate: new Date(baseTime.getTime() - 10 * 60 * 1000).toISOString(),
          domain: 'coindesk.com',
        },
      ];
      getNewsByTokenMock.mockResolvedValueOnce(firstNews);

      const row: ActivePortfolioWorkflow = {
        id: 'wf-cache',
        userId: 'user-cache',
        model: 'model',
        cashToken: 'USDT',
        tokens: [{ token: 'DOGE', minAllocation: 20 }],
        risk: 'medium',
        reviewInterval: '1h',
        agentInstructions: 'inst',
        aiApiKeyId: null,
        aiApiKeyEnc: '',
        manualRebalance: false,
        useEarn: false,
        startBalance: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        portfolioId: 'wf-cache',
        mode: 'spot',
        futuresDefaultLeverage: null,
        futuresMarginMode: null,
      };

      const firstPrompt = await getSpotPrompt(row);
      expect(getNewsByTokenMock).toHaveBeenCalledTimes(1);
      const firstContext = firstPrompt?.reports?.find((r) => r.token === 'DOGE')?.news;

      getNewsByTokenMock.mockResolvedValueOnce([
        {
          title: 'Dogecoin partnership announced',
          link: 'doge-partnership',
          pubDate: new Date(baseTime.getTime() - 5 * 60 * 1000).toISOString(),
          domain: 'cointelegraph.com',
        },
      ]);

      const secondPrompt = await getSpotPrompt(row);
      expect(getNewsByTokenMock).toHaveBeenCalledTimes(1);
      const secondContext = secondPrompt?.reports?.find((r) => r.token === 'DOGE')?.news;
      expect(secondContext).toEqual(firstContext);

      vi.setSystemTime(new Date(baseTime.getTime() + 61_000));

      const refreshedNews = [
        {
          title: 'Dogecoin outage triggers concern',
          link: 'doge-outage',
          pubDate: new Date(baseTime.getTime() + 1 * 1000).toISOString(),
          domain: 'coindesk.com',
        },
      ];
      getNewsByTokenMock.mockResolvedValueOnce(refreshedNews);

      const thirdPrompt = await getSpotPrompt(row);
      expect(getNewsByTokenMock).toHaveBeenCalledTimes(2);
      const thirdContext = thirdPrompt?.reports?.find((r) => r.token === 'DOGE')?.news;
      expect(thirdContext).not.toEqual(firstContext);
    } finally {
      vi.useRealTimers();
    }
  });
});
