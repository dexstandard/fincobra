import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
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

const sampleTimeseries = {
  minute_60: [[1, 2, 3, 4]],
  hourly_24h: [[5, 6, 7, 8]],
  monthly_24m: [[9, 10, 11]],
};

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
vi.mock('../src/agents/main-trader.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, run: runMainTrader };
});

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
  fetchPairData: vi.fn().mockResolvedValue({ currentPrice: 100 }),
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

const createDecisionLimitOrders = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/services/rebalance.js', () => ({
  createDecisionLimitOrders,
}));

const runNewsAnalyst = vi.fn((_params: any, prompt: any) => {
  const report = prompt.reports?.find((r: any) => r.token === 'BTC');
  if (report) report.news = { comment: 'news', score: 1 };
  return Promise.resolve();
});
vi.mock('../src/agents/news-analyst.js', () => ({ runNewsAnalyst }));

const runTechnicalAnalyst = vi.fn((_params: any, prompt: any) => {
  const report = prompt.reports?.find((r: any) => r.token === 'BTC');
  if (report) report.tech = { comment: 'tech', score: 2 };
  return Promise.resolve();
});
vi.mock('../src/agents/technical-analyst.js', () => ({ runTechnicalAnalyst }));


let reviewAgentPortfolio: (log: FastifyBaseLogger, agentId: string) => Promise<void>;
let removeWorkflowFromSchedule: (id: string) => void;

beforeAll(async () => {
  ({ reviewAgentPortfolio, removeWorkflowFromSchedule } = await import(
    '../src/workflows/portfolio-review.js'
  ));
});

beforeEach(() => {
  vi.clearAllMocks();
  ['1', '2', '3', '4', '5'].forEach((id) => removeWorkflowFromSchedule(id));
});

async function setupAgent(id: string, tokens: string[], manual = false) {
  await db.query('INSERT INTO users (id) VALUES ($1)', [id]);
  await db.query(
    "INSERT INTO ai_api_keys (user_id, provider, api_key_enc) VALUES ($1, 'openai', $2)",
    [id, 'enc'],
  );
  await db.query(
    "INSERT INTO portfolio_workflow (id, user_id, model, status, name, cash_token, risk, review_interval, agent_instructions, manual_rebalance) VALUES ($1, $2, 'gpt', 'active', 'Agent', 'USDT', 'low', '1h', 'inst', $3)",
    [id, id, manual],
  );
  const params: any[] = [id];
  const values: string[] = [];
  tokens.forEach((t, i) => {
    values.push(`($1, $${i * 2 + 2}, $${i * 2 + 3}, ${i + 1})`);
    params.push(t, (i + 1) * 10);
  });
  if (values.length)
    await db.query(
      `INSERT INTO portfolio_workflow_tokens (portfolio_workflow_id, token, min_allocation, position) VALUES ${values.join(', ')}`,
      params,
    );
}

function createLogger(): FastifyBaseLogger {
  const log = { info: () => {}, error: () => {}, child: () => log } as unknown as FastifyBaseLogger;
  return log;
}

describe('reviewPortfolio', () => {
  it('saves decision and logs', async () => {
    await setupAgent('1', ['BTC']);
    const decision = {
      orders: [{ pair: 'BTCUSDT', token: 'BTC', side: 'SELL', quantity: 1 }],
      shortReport: 'ok',
    };
    runMainTrader.mockResolvedValue(decision);
    const log = createLogger();
    await reviewAgentPortfolio(log, '1');
    expect(runMainTrader).toHaveBeenCalledTimes(1);
    expect(runNewsAnalyst).toHaveBeenCalled();
    expect(runTechnicalAnalyst).toHaveBeenCalled();
    const { rows } = await db.query(
      'SELECT prompt, response FROM agent_review_raw_log WHERE agent_id=$1',
      ['1'],
    );
    const row = rows[0] as { prompt: string; response: string };
    expect(JSON.parse(row.response)).toEqual(decision);
    const { rows: resRows } = await db.query(
      'SELECT rebalance, short_report FROM agent_review_result WHERE agent_id=$1',
      ['1'],
    );
    const res = resRows[0] as { rebalance: boolean; short_report: string };
    expect(res.rebalance).toBe(true);
    expect(res.short_report).toBe('ok');
  });

  it('calls createDecisionLimitOrders when orders requested', async () => {
    await setupAgent('2', ['BTC', 'ETH']);
    const decision = {
      orders: [
        { pair: 'BTCUSDT', token: 'BTC', side: 'BUY', quantity: 1 },
        { pair: 'ETHBTC', token: 'ETH', side: 'SELL', quantity: 0.5 },
      ],
      shortReport: 's',
    };
    runMainTrader.mockResolvedValue(decision);
    const log = createLogger();
    await reviewAgentPortfolio(log, '2');
    expect(createDecisionLimitOrders).toHaveBeenCalledTimes(1);
    const args = createDecisionLimitOrders.mock.calls[0][0];
    expect(args.userId).toBe('2');
    expect(args.orders).toHaveLength(2);
  });

  it('skips createDecisionLimitOrders when manualRebalance is enabled', async () => {
    await setupAgent('3', ['BTC'], true);
    const decision = {
      orders: [{ pair: 'BTCUSDT', token: 'BTC', side: 'BUY', quantity: 1 }],
      shortReport: 's',
    };
    runMainTrader.mockResolvedValue(decision);
    const log = createLogger();
    await reviewAgentPortfolio(log, '3');
    expect(createDecisionLimitOrders).not.toHaveBeenCalled();
  });

  it('records error when pair is invalid', async () => {
    await setupAgent('4', ['BTC']);
    const decision = {
      orders: [{ pair: 'FOO', token: 'BTC', side: 'BUY', quantity: 1 }],
      shortReport: 's',
    };
    runMainTrader.mockResolvedValue(decision);
    const log = createLogger();
    await reviewAgentPortfolio(log, '4');
    const { rows } = await db.query(
      'SELECT error FROM agent_review_result WHERE agent_id=$1',
      ['4'],
    );
    const row = rows[0] as { error: string | null };
    expect(row.error).not.toBeNull();
  });

  it('records error when quantity is invalid', async () => {
    await setupAgent('5', ['BTC']);
    const decision = {
      orders: [{ pair: 'BTCUSDT', token: 'BTC', side: 'BUY', quantity: 0 }],
      shortReport: 's',
    };
    runMainTrader.mockResolvedValue(decision);
    const log = createLogger();
    await reviewAgentPortfolio(log, '5');
    const { rows } = await db.query(
      'SELECT error FROM agent_review_result WHERE agent_id=$1',
      ['5'],
    );
    const row = rows[0] as { error: string | null };
    expect(row.error).not.toBeNull();
  });
});

