import { describe, it, expect, vi } from 'vitest';
import { mockLogger } from './helpers.js';
import type { ActivePortfolioWorkflowRow } from '../src/repos/portfolio-workflow.js';
import { collectPromptData } from '../src/agents/main-trader.js';
import { fetchAccount } from '../src/services/binance.js';

vi.mock('../src/services/binance.js', () => ({
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
}));

vi.mock('../src/repos/agent-review-result.js', () => ({
  getRecentReviewResults: vi.fn().mockResolvedValue(
    Array.from({ length: 5 }, (_, i) => ({
      id: `r${i + 1}`,
      created_at: new Date(`2025-01-0${i + 1}T00:00:00.000Z`),
      shortReport: `p${i + 1}`,
      error: null,
    })),
  ),
}));

vi.mock('../src/repos/limit-orders.js', () => ({
  getLimitOrdersByReviewResult: vi.fn().mockImplementation(async (_agentId, reviewId) => {
    const i = Number(reviewId.slice(1));
    return [
      {
        planned_json: JSON.stringify({ symbol: 'BTCUSDT', side: 'BUY', quantity: i }),
        status: 'filled',
        created_at: new Date(`2025-01-0${i}T00:00:00.000Z`),
        order_id: String(i),
        cancellation_reason: 'price limit',
      },
    ];
  }),
}));

describe('collectPromptData', () => {
  it('includes start balance and PnL in prompt', async () => {
    const row: ActivePortfolioWorkflowRow = {
      id: '1',
      user_id: 'u1',
      model: 'm',
      cash_token: 'USDT',
      tokens: [{ token: 'BTC', min_allocation: 50 }],
      risk: 'low',
      review_interval: '1h',
      agent_instructions: 'inst',
      ai_api_key_enc: '',
      manual_rebalance: false,
      start_balance: 20000,
      created_at: '2025-01-01T00:00:00.000Z',
      portfolio_id: '1',
    };

    const prompt = await collectPromptData(row, mockLogger());
    expect(prompt?.portfolio.start_balance_usd).toBe(20000);
    expect(prompt?.portfolio.start_balance_ts).toBe('2025-01-01T00:00:00.000Z');
    expect(prompt?.portfolio.pnl_usd).toBeCloseTo(1000);
    expect(prompt?.reviewInterval).toBe('1h');
  });

  it('includes recent limit orders in prompt', async () => {
    const row: ActivePortfolioWorkflowRow = {
      id: '1',
      user_id: 'u1',
      model: 'm',
      cash_token: 'USDT',
      tokens: [{ token: 'BTC', min_allocation: 50 }],
      risk: 'low',
      review_interval: '1h',
      agent_instructions: 'inst',
      ai_api_key_enc: '',
      manual_rebalance: false,
      start_balance: null,
      created_at: '2025-01-01T00:00:00.000Z',
      portfolio_id: '1',
    };

    const prompt = await collectPromptData(row, mockLogger());
    expect(prompt?.previous_reports).toHaveLength(5);
    expect(prompt?.previous_reports?.[0]).toMatchObject({
      datetime: '2025-01-01T00:00:00.000Z',
      orders: [
        {
          symbol: 'BTCUSDT',
          side: 'BUY',
          quantity: 1,
          status: 'filled',
          datetime: '2025-01-01T00:00:00.000Z',
          cancellationReason: 'price limit',
        },
      ],
      shortReport: 'p1',
    });
  });

  it('handles three-token portfolio', async () => {
    const row: ActivePortfolioWorkflowRow = {
      id: '1',
      user_id: 'u1',
      model: 'm',
      cash_token: 'USDT',
      tokens: [
        { token: 'BTC', min_allocation: 40 },
        { token: 'ETH', min_allocation: 30 },
      ],
      risk: 'low',
      review_interval: '1h',
      agent_instructions: 'inst',
      ai_api_key_enc: '',
      manual_rebalance: false,
      start_balance: null,
      created_at: '2025-01-01T00:00:00.000Z',
      portfolio_id: '1',
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

    const row: ActivePortfolioWorkflowRow = {
      id: '1',
      user_id: 'u1',
      model: 'm',
      cash_token: 'USDT',
      tokens: [{ token: 'BTC', min_allocation: 50 }],
      risk: 'low',
      review_interval: '1h',
      agent_instructions: 'inst',
      ai_api_key_enc: '',
      manual_rebalance: false,
      start_balance: null,
      created_at: '2025-01-01T00:00:00.000Z',
      portfolio_id: '1',
    };

    const prompt = await collectPromptData(row, mockLogger());
    const btc = prompt?.portfolio.positions.find((p) => p.sym === 'BTC');
    const usdt = prompt?.portfolio.positions.find((p) => p.sym === 'USDT');
    expect(btc?.qty).toBe(1);
    expect(usdt?.qty).toBe(1000);
  });
});

