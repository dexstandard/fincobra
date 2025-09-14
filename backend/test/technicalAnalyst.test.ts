import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockLogger } from './helpers.js';

const insertReviewRawLogMock = vi.hoisted(() => vi.fn());
const fetchTokenIndicatorsMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    ret: {},
    sma_dist: {},
    macd_hist: 0,
    vol: {},
    range: {},
    volume: {},
    corr: {},
    regime: {},
    osc: {},
  }),
);
const callAiMock = vi.hoisted(() => vi.fn().mockResolvedValue('res'));

vi.mock('../src/services/derivatives.js', () => ({
  fetchOrderBook: vi.fn().mockResolvedValue({ bid: [0, 0], ask: [0, 0] }),
}));
vi.mock('../src/repos/agent-review-raw-log.js', () => ({
  insertReviewRawLog: insertReviewRawLogMock,
}));
vi.mock('../src/services/indicators.js', () => ({
  fetchTokenIndicators: fetchTokenIndicatorsMock,
}));
vi.mock('../src/util/ai.js', () => ({
  callAi: callAiMock,
  extractJson: () => ({ comment: 'outlook for BTC', score: 2 }),
}));

import {
  getTechnicalOutlook,
  getTechnicalOutlookCached,
  runTechnicalAnalyst,
  resetTechnicalAnalystCache,
} from '../src/agents/technical-analyst.js';

const responseJson = JSON.stringify({
  object: 'response',
  output: [
    {
      id: 'msg_1',
      content: [
        {
          type: 'output_text',
          text: JSON.stringify({ comment: 'outlook text', score: 5 }),
        },
      ],
    },
  ],
});

const indicators = {
  ret: {},
  sma_dist: {},
  macd_hist: 0,
  vol: {},
  range: {},
  volume: {},
  corr: {},
  regime: {},
  osc: {},
} as const;

describe('technical analyst', () => {
  it('returns outlook', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, text: async () => responseJson });
    const orig = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;
    const res = await getTechnicalOutlook('BTC', indicators, 'gpt', 'key', mockLogger());
    expect(res.analysis?.comment).toBe('outlook text');
    expect(res.prompt).toBeTruthy();
    expect(res.response).toBe(responseJson);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    (globalThis as any).fetch = orig;
  });

  it('falls back when AI response is malformed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, text: async () => '{"output":[]}' });
    const orig = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;
    const res = await getTechnicalOutlook('BTC', indicators, 'gpt', 'key', mockLogger());
    expect(res.analysis?.comment).toBe('Analysis unavailable');
    expect(res.analysis?.score).toBe(0);
    (globalThis as any).fetch = orig;
  });

  it('falls back when AI request fails', async () => {
    const orig = globalThis.fetch;
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'));
    (globalThis as any).fetch = fetchMock;
    const res = await getTechnicalOutlook('BTC', indicators, 'gpt', 'key', mockLogger());
    expect(res.analysis?.comment).toBe('Analysis unavailable');
    expect(res.analysis?.score).toBe(0);
    (globalThis as any).fetch = orig;
  });

  it('caches token outlooks and dedupes concurrent calls', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, text: async () => responseJson });
    const orig = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;
    const p1 = getTechnicalOutlookCached('BTC', indicators, 'gpt', 'key', mockLogger());
    const p2 = getTechnicalOutlookCached('BTC', indicators, 'gpt', 'key', mockLogger());
    await Promise.all([p1, p2]);
    await getTechnicalOutlookCached('BTC', indicators, 'gpt', 'key', mockLogger());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    (globalThis as any).fetch = orig;
  });
});

describe('technical analyst step', () => {
  beforeEach(() => {
    resetTechnicalAnalystCache();
    insertReviewRawLogMock.mockClear();
    fetchTokenIndicatorsMock.mockClear();
    callAiMock.mockClear();
  });

  it('fetches technical outlook per token', async () => {
    const prompt: any = {
      marketData: {},
      reports: [
        { token: 'BTC', news: null, tech: null },
        { token: 'USDC', news: null, tech: null },
      ],
    };
    await runTechnicalAnalyst(
      {
        log: mockLogger(),
        model: 'gpt',
        apiKey: 'key',
        portfolioId: 'agent1',
      },
      prompt,
    );
    const report = prompt.reports?.find((r: any) => r.token === 'BTC');
    expect(report?.tech?.comment).toBe('outlook for BTC');
    expect(prompt.reports?.find((r: any) => r.token === 'USDC')?.tech).toBeNull();
    expect(prompt.marketData.indicators.BTC).toBeDefined();
    expect(insertReviewRawLogMock).toHaveBeenCalled();
    expect(callAiMock).toHaveBeenCalledTimes(1);
  });

  it('dedupes tokens and caches indicators', async () => {
    const prompt: any = {
      marketData: {},
      reports: [
        { token: 'BTC', news: null, tech: null },
        { token: 'BTC', news: null, tech: null },
      ],
    };
    await runTechnicalAnalyst(
      {
        log: mockLogger(),
        model: 'gpt',
        apiKey: 'key',
        portfolioId: 'agent1',
      },
      prompt,
    );
    expect(callAiMock).toHaveBeenCalledTimes(1);
    expect(fetchTokenIndicatorsMock).toHaveBeenCalledTimes(1);
    expect(prompt.reports[0].tech?.comment).toBe('outlook for BTC');
    expect(prompt.reports[1].tech?.comment).toBe('outlook for BTC');
  });
});
