import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '../src/db/index.js';

const sampleIndicators = {
  ret: { '1h': 0, '4h': 0, '24h': 0, '7d': 0, '30d': 0 },
  sma_dist: { '20': 0, '50': 0, '200': 0 },
  macd_hist: 0,
  vol: { rv_7d: 0, rv_30d: 0, atr_pct: 0 },
  range: { bb_bw: 0, donchian20: 0 },
  volume: { z_1h: 0, z_24h: 0 },
  corr: { BTC_30d: 0 },
  regime: { BTC: 'range' },
  osc: { rsi_14: 0, stoch_k: 0, stoch_d: 0 },
};

vi.mock('../src/util/ai.js', () => ({
  callAi: vi.fn().mockResolvedValue('ok'),
  developerInstructions: '',
  rebalanceResponseSchema: {},
}));

vi.mock('../src/util/crypto.js', () => ({
  decrypt: vi.fn().mockReturnValue('key'),
}));

const cancelOrder = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/services/binance.js', () => ({
  fetchAccount: vi.fn().mockResolvedValue({
    balances: [
      { asset: 'BTC', free: '1', locked: '0' },
      { asset: 'ETH', free: '1', locked: '0' },
    ],
  }),
  fetchPairData: vi.fn().mockResolvedValue({ symbol: 'BTCETH', currentPrice: 100 }),
  fetchMarketTimeseries: vi.fn().mockResolvedValue({ minute_60: [], hourly_24h: [], monthly_24m: [] }),
  fetchPairInfo: vi.fn().mockResolvedValue({
    symbol: 'BTCETH',
    baseAsset: 'BTC',
    quoteAsset: 'ETH',
    quantityPrecision: 8,
    pricePrecision: 8,
    minNotional: 0,
  }),
  cancelOrder,
  parseBinanceError: vi.fn().mockReturnValue(null),
}));

vi.mock('../src/services/indicators.js', () => ({
  fetchTokenIndicators: vi.fn().mockResolvedValue(sampleIndicators),
}));

vi.mock('../src/services/rebalance.js', () => ({
  createRebalanceLimitOrder: vi.fn().mockResolvedValue(undefined),
}));

let reviewAgentPortfolio: (log: FastifyBaseLogger, agentId: string) => Promise<void>;

beforeAll(async () => {
  ({ reviewAgentPortfolio } = await import('../src/workflows/portfolio-review.js'));
});

describe('cleanup open orders', () => {
  it('cancels open orders before running agent', async () => {
    await db.query('INSERT INTO users (id) VALUES ($1)', ['1']);
    await db.query("INSERT INTO ai_api_keys (user_id, provider, api_key_enc) VALUES ($1, 'openai', $2)", ['1', 'enc']);
    await db.query(
      "INSERT INTO portfolio_workflow (id, user_id, model, status, name, risk, review_interval, agent_instructions, manual_rebalance) VALUES ($1, $2, 'gpt', 'active', 'A', 'low', '1h', 'inst', false)",
      ['1', '1'],
    );
    await db.query(
      "INSERT INTO portfolio_workflow_tokens (portfolio_workflow_id, token, min_allocation, position) VALUES ($1, 'BTC', 10, 1), ($1, 'ETH', 20, 2)",
      ['1'],
    );
    const rr = await db.query(
      "INSERT INTO agent_review_result (agent_id, log, rebalance, new_allocation, short_report) VALUES ($1, $2, true, 50, 's') RETURNING id",
      ['1', 'log'],
    );
    await db.query(
      "INSERT INTO limit_order (user_id, planned_json, status, review_result_id, order_id) VALUES ($1, $2, 'open', $3, $4)",
      ['1', JSON.stringify({ symbol: 'BTCETH', side: 'BUY', quantity: 1, price: 1 }), rr.rows[0].id, '123'],
    );
    const log = { child: () => log, info: () => {}, error: () => {} } as unknown as FastifyBaseLogger;
    await reviewAgentPortfolio(log, '1');
    expect(cancelOrder).toHaveBeenCalledTimes(1);
    const { rows } = await db.query("SELECT status FROM limit_order WHERE order_id = '123'");
    expect(rows[0].status).toBe('canceled');
  });

  it('cancels multiple open orders in parallel', async () => {
    cancelOrder.mockReset();
    const resolves: (() => void)[] = [];
    cancelOrder.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolves.push(resolve);
        }),
    );

    await db.query('INSERT INTO users (id) VALUES ($1)', ['1']);
    await db.query("INSERT INTO ai_api_keys (user_id, provider, api_key_enc) VALUES ($1, 'openai', $2)", ['1', 'enc']);
    await db.query(
      "INSERT INTO portfolio_workflow (id, user_id, model, status, name, risk, review_interval, agent_instructions, manual_rebalance) VALUES ($1, $2, 'gpt', 'active', 'A', 'low', '1h', 'inst', false)",
      ['1', '1'],
    );
    await db.query(
      "INSERT INTO portfolio_workflow_tokens (portfolio_workflow_id, token, min_allocation, position) VALUES ($1, 'BTC', 10, 1), ($1, 'ETH', 20, 2)",
      ['1'],
    );
    const rr = await db.query(
      "INSERT INTO agent_review_result (agent_id, log, rebalance, new_allocation, short_report) VALUES ($1, $2, true, 50, 's') RETURNING id",
      ['1', 'log'],
    );
    await db.query(
      "INSERT INTO limit_order (user_id, planned_json, status, review_result_id, order_id) VALUES ($1, $2, 'open', $3, $4), ($1, $2, 'open', $3, $5)",
      ['1', JSON.stringify({ symbol: 'BTCETH', side: 'BUY', quantity: 1, price: 1 }), rr.rows[0].id, '123', '456'],
    );

    const log = { child: () => log, info: () => {}, error: () => {} } as unknown as FastifyBaseLogger;
    const runPromise = reviewAgentPortfolio(log, '1');
    await vi.waitUntil(() => cancelOrder.mock.calls.length === 2);
    resolves.forEach((r) => r());
    await runPromise;
    const { rows } = await db.query(
      "SELECT order_id, status FROM limit_order ORDER BY order_id",
    );
    expect(rows).toEqual([
      { order_id: '123', status: 'canceled' },
      { order_id: '456', status: 'canceled' },
    ]);
  });
});
