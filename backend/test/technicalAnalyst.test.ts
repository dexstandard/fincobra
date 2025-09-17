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
const callAiMock = vi.hoisted(() => vi.fn());
const fetchFearGreedIndexMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ value: 50, classification: 'Neutral' }),
);
const extractJson = vi.hoisted(() => (res: string) => {
  try {
    const json = JSON.parse(res);
    const text = json.output?.[0]?.content?.[0]?.text;
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
});

vi.mock('../src/services/derivatives.js', () => ({
  fetchOrderBook: vi.fn().mockResolvedValue({ bid: [0, 0], ask: [0, 0] }),
}));
vi.mock('../src/services/binance.js', () => ({
  fetchFearGreedIndex: fetchFearGreedIndexMock,
  fetchOrder: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/repos/review-raw-log.js', () => ({
  insertReviewRawLog: insertReviewRawLogMock,
}));
vi.mock('../src/services/indicators.js', () => ({
  fetchTokenIndicators: fetchTokenIndicatorsMock,
}));
vi.mock('../src/util/ai.js', () => ({
  callAi: callAiMock,
  extractJson: extractJson,
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
  beforeEach(() => {
    callAiMock.mockReset();
    resetTechnicalAnalystCache();
  });

  it('returns outlook', async () => {
    callAiMock.mockResolvedValue(responseJson);
    const res = await getTechnicalOutlook(
      'BTC',
      indicators,
      { bid: [0, 0], ask: [0, 0] },
      { value: 50, classification: 'Neutral' },
      'gpt',
      'key',
      mockLogger(),
    );
    expect(res.analysis?.comment).toBe('outlook text');
    expect(res.prompt).toBeTruthy();
    expect(res.response).toBe(responseJson);
    expect(callAiMock).toHaveBeenCalledTimes(1);
  });

  it('falls back when AI response is malformed', async () => {
    callAiMock.mockResolvedValue('{"output":[]}');
    const res = await getTechnicalOutlook(
      'BTC',
      indicators,
      { bid: [0, 0], ask: [0, 0] },
      { value: 50, classification: 'Neutral' },
      'gpt',
      'key',
      mockLogger(),
    );
    expect(res.analysis?.comment).toBe('Analysis unavailable');
    expect(res.analysis?.score).toBe(0);
  });

  it('caches token outlooks and dedupes concurrent calls', async () => {
    callAiMock.mockResolvedValue(responseJson);
    const p1 = getTechnicalOutlookCached(
      'BTC',
      indicators,
      { bid: [0, 0], ask: [0, 0] },
      { value: 50, classification: 'Neutral' },
      'gpt',
      'key',
      mockLogger(),
    );
    const p2 = getTechnicalOutlookCached(
      'BTC',
      indicators,
      { bid: [0, 0], ask: [0, 0] },
      { value: 50, classification: 'Neutral' },
      'gpt',
      'key',
      mockLogger(),
    );
    await Promise.all([p1, p2]);
    await getTechnicalOutlookCached(
      'BTC',
      indicators,
      { bid: [0, 0], ask: [0, 0] },
      { value: 50, classification: 'Neutral' },
      'gpt',
      'key',
      mockLogger(),
    );
    expect(callAiMock).toHaveBeenCalledTimes(1);
  });
});

describe('technical analyst step', () => {
  beforeEach(() => {
    resetTechnicalAnalystCache();
    insertReviewRawLogMock.mockClear();
    fetchTokenIndicatorsMock.mockClear();
    fetchFearGreedIndexMock.mockClear();
    callAiMock.mockClear();
    callAiMock.mockResolvedValue(responseJson);
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
    expect(report?.tech?.comment).toBe('outlook text');
    expect(prompt.reports?.find((r: any) => r.token === 'USDC')?.tech).toBeNull();
    expect(prompt.marketData.indicators.BTC).toBeDefined();
    expect(prompt.marketData.orderBooks.BTC).toEqual({ bid: [0, 0], ask: [0, 0] });
    expect(prompt.marketData.fearGreedIndex).toEqual({
      value: 50,
      classification: 'Neutral',
    });
    const aiPrompt = callAiMock.mock.calls[0][3];
    expect(aiPrompt.orderBook).toEqual({ bid: [0, 0], ask: [0, 0] });
    expect(aiPrompt.fearGreedIndex).toEqual({
      value: 50,
      classification: 'Neutral',
    });
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
    expect(prompt.reports[0].tech?.comment).toBe('outlook text');
    expect(prompt.reports[1].tech?.comment).toBe('outlook text');
  });
});
