import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { ActivePortfolioWorkflowRow } from '../src/repos/portfolio-workflow.js';

vi.mock('../src/services/binance.js', () => ({
  fetchAccount: vi.fn().mockResolvedValue({
    balances: [
      { asset: 'BTC', free: '1', locked: '0' },
      { asset: 'USDT', free: '1000', locked: '0' },
      { asset: 'ETH', free: '5', locked: '0' },
    ],
  }),
  fetchPairData: vi.fn().mockResolvedValue({ currentPrice: 20000 }),
}));

vi.mock('../src/repos/agent-review-result.js', () => ({
  getRecentReviewResults: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/repos/limit-orders.js', () => ({
  getRecentLimitOrders: vi.fn().mockResolvedValue(
    Array.from({ length: 5 }, (_, i) => ({
      planned_json: JSON.stringify({ symbol: 'BTCUSDT', side: 'BUY', quantity: i + 1 }),
      status: 'filled',
      created_at: new Date(`2025-01-0${i + 1}T00:00:00.000Z`),
    })),
  ),
}));

function createLogger(): FastifyBaseLogger {
  return { info: () => {}, error: () => {} } as unknown as FastifyBaseLogger;
}

describe('collectPromptData', () => {
  it('includes start balance and PnL in prompt', async () => {
    const { collectPromptData } = await import('../src/agents/main-trader.js');
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

    const prompt = await collectPromptData(row, createLogger());
    expect(prompt?.portfolio.start_balance_usd).toBe(20000);
    expect(prompt?.portfolio.start_balance_ts).toBe('2025-01-01T00:00:00.000Z');
    expect(prompt?.portfolio.pnl_usd).toBeCloseTo(1000);
  });

  it('includes recent limit orders in prompt', async () => {
    const { collectPromptData } = await import('../src/agents/main-trader.js');
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

    const prompt = await collectPromptData(row, createLogger());
    expect(prompt?.prev_orders).toHaveLength(5);
    expect(prompt?.prev_orders?.[0]).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: 1,
      datetime: '2025-01-01T00:00:00.000Z',
      status: 'filled',
    });
  });

  it('handles three-token portfolio', async () => {
    const { collectPromptData } = await import('../src/agents/main-trader.js');
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

    const prompt = await collectPromptData(row, createLogger());
    expect(prompt?.portfolio.positions).toHaveLength(3);
    expect(prompt?.cash).toBe('USDT');
  });
});

