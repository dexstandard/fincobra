import { LimitOrderStatus } from '../src/repos/limit-orders.types.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockLogger } from './helpers.js';
import type { ActivePortfolioWorkflow } from '../src/repos/portfolio-workflows.js';
import {
  collectPromptData,
  __resetNewsContextCacheForTest,
} from '../src/agents/main-trader.js';
import { fetchAccount } from '../src/services/binance-client.js';

const getNewsByTokenMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('../src/services/binance-client.js', () => ({
  fetchAccount: vi.fn().mockResolvedValue({
    balances: [
      { asset: 'BTC', free: '1', locked: '0' },
      { asset: 'USDT', free: '1000', locked: '0' },
      { asset: 'ETH', free: '5', locked: '0' },
    ],
  }),
  fetchPairPrice: vi.fn().mockImplementation((t1: string, t2: string) => {
    if (t1 === 'USDT') {
      return Promise.resolve({ symbol: `${t2}USDT`, currentPrice: 20000 });
    }
    if (t2 === 'USDT') {
      return Promise.resolve({ symbol: `${t1}USDT`, currentPrice: 20000 });
    }
    return Promise.resolve({ symbol: `${t1}${t2}`, currentPrice: 20000 });
  }),
  fetchPairInfo: vi.fn().mockImplementation((t1: string, t2: string) => {
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
  }),
  fetchOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/repos/review-result.js', () => ({
  getRecentReviewResults: vi.fn().mockResolvedValue(
    Array.from({ length: 5 }, (_, i) => ({
      id: `r${i + 1}`,
      createdAt: new Date(`2025-01-0${i + 1}T00:00:00.000Z`),
      shortReport: `p${i + 1}`,
    })),
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
            quantity: i,
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

describe('collectPromptData', () => {
  beforeEach(() => {
    __resetNewsContextCacheForTest();
    getNewsByTokenMock.mockReset();
    getNewsByTokenMock.mockResolvedValue([]);
    vi.mocked(fetchAccount).mockResolvedValue({
      balances: [
        { asset: 'BTC', free: '1', locked: '0' },
        { asset: 'USDT', free: '1000', locked: '0' },
        { asset: 'ETH', free: '5', locked: '0' },
        { asset: 'DOGE', free: '100', locked: '0' },
      ],
    });
  });

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
    };

    const prompt = await collectPromptData(row, mockLogger());
    expect(prompt?.portfolio.startBalanceUsd).toBe(20000);
    expect(prompt?.portfolio.startBalanceTs).toBe('2025-01-01T00:00:00.000Z');
    expect(prompt?.portfolio.pnlUsd).toBeCloseTo(1000);
    expect(prompt?.reviewInterval).toBe('1h');
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
    };

    const prompt = await collectPromptData(row, mockLogger());
    expect(prompt?.previousReports).toHaveLength(5);
    expect(prompt?.previousReports?.[0]).toMatchObject({
      datetime: '2025-01-01T00:00:00.000Z',
      orders: [
        {
          symbol: 'BTCUSDT',
          side: 'BUY',
          quantity: 1,
          status: LimitOrderStatus.Filled,
          datetime: '2025-01-01T00:00:00.000Z',
          cancellationReason: 'price limit',
        },
      ],
      shortReport: 'p1',
    });
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
    };

    const prompt = await collectPromptData(row, mockLogger());
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

    const prompt = await collectPromptData(row, mockLogger());
    const btc = prompt?.portfolio.positions.find((p) => p.sym === 'BTC');
    const usdt = prompt?.portfolio.positions.find((p) => p.sym === 'USDT');
    expect(btc?.qty).toBe(1);
    expect(usdt?.qty).toBe(1000);
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
      };

      const prompt = await collectPromptData(row, mockLogger());
      const news = prompt?.reports?.find((r) => r.token === 'BTC')?.news;

      expect(news?.version).toBe('news_context.v1');
      expect(news?.items.length).toBe(5);
      expect(news?.biasScore).toBeLessThan(0);
      expect(news?.maxSeverity ?? 0).toBeGreaterThan(0.7);
      expect(news?.bearCount ?? 0).toBeGreaterThan(0);
      expect(news?.bullCount ?? 0).toBeGreaterThan(0);
      expect(news?.topEventSummary).toMatch(/^Hack — bearish \(sev=\d\.\d{2}\)/);
      expect(news?.items[0]).toMatchObject({
        tierHints: expect.any(Object),
        numbers: expect.any(Object),
      });
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
      };

      const firstPrompt = await collectPromptData(row, mockLogger());
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

      const secondPrompt = await collectPromptData(row, mockLogger());
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

      const thirdPrompt = await collectPromptData(row, mockLogger());
      expect(getNewsByTokenMock).toHaveBeenCalledTimes(2);
      const thirdContext = thirdPrompt?.reports?.find((r) => r.token === 'DOGE')?.news;
      expect(thirdContext).not.toEqual(firstContext);
    } finally {
      vi.useRealTimers();
    }
  });
});
