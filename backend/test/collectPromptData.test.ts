import { LimitOrderStatus } from '../src/repos/limit-orders.types.js';
import { describe, it, expect, vi } from 'vitest';
import { mockLogger } from './helpers.js';
import type { ActivePortfolioWorkflow } from '../src/repos/portfolio-workflows.js';
import { collectPromptData } from '../src/agents/main-trader.js';
import { fetchAccount } from '../src/services/binance-client.js';

vi.mock('../src/services/binance-client.js', () => ({
  fetchAccount: vi.fn().mockResolvedValue({
    balances: [
      { asset: 'BTC', free: '1', locked: '0' },
      { asset: 'USDT', free: '1000', locked: '0' },
      { asset: 'ETH', free: '5', locked: '0' },
    ],
  }),
  fetchPairData: vi
    .fn()
    .mockImplementation((t1: string, t2: string) => {
      if (t1 === 'USDT') return Promise.resolve({ symbol: `${t2}USDT`, currentPrice: 20000 });
      if (t2 === 'USDT') return Promise.resolve({ symbol: `${t1}USDT`, currentPrice: 20000 });
      return Promise.resolve({ symbol: `${t1}${t2}`, currentPrice: 20000 });
    }),
  fetchPairInfo: vi
    .fn()
    .mockImplementation((t1: string, t2: string) => {
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
  getLimitOrdersByReviewResult: vi.fn().mockImplementation(async (_workflowId, reviewId) => {
    const i = Number(reviewId.slice(1));
    return [
      {
        plannedJson: JSON.stringify({ symbol: 'BTCUSDT', side: 'BUY', quantity: i }),
        status: LimitOrderStatus.Filled,
        createdAt: new Date(`2025-01-0${i}T00:00:00.000Z`),
        orderId: String(i),
        cancellationReason: 'price limit',
      },
    ];
  }),
}));

describe('collectPromptData', () => {
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
});

