import { describe, it, expect, vi } from 'vitest';
import { mockLogger } from './helpers.js';
import { insertNews } from '../src/repos/news.js';
import {
  getTokenNewsSummary,
  getTokenNewsSummaryCached,
} from '../src/agents/news-analyst.js';

const responseJson = JSON.stringify({
  object: 'response',
  output: [
    {
      id: 'msg_1',
      content: [
        {
          type: 'output_text',
          text: JSON.stringify({ comment: 'summary text', score: 1 }),
        },
      ],
    },
  ],
});

describe('news analyst', () => {
  it('returns summary and raw data', async () => {
    await insertNews([
      {
        title: 't',
        link: 'l',
        pubDate: new Date().toISOString(),
        tokens: ['BTC'],
        domain: 'coindesk.com',
        simhash: '1',
      },
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, text: async () => responseJson });
    const orig = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;
    const res = await getTokenNewsSummary('BTC', 'gpt', 'key', mockLogger());
    expect(res.analysis?.comment).toBe('summary text');
    expect(res.prompt).toBeTruthy();
    expect(res.response).toBe(responseJson);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    (globalThis as any).fetch = orig;
  });

  it('returns null when no news available', async () => {
    const orig = globalThis.fetch;
    const fetchMock = vi.fn();
    (globalThis as any).fetch = fetchMock;
    const res = await getTokenNewsSummary('DOGE', 'gpt', 'key', mockLogger());
    expect(res.analysis).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    (globalThis as any).fetch = orig;
  });

  it('falls back when AI response is malformed', async () => {
    await insertNews([
      {
        title: 't2',
        link: 'l2',
        pubDate: new Date().toISOString(),
        tokens: ['BTC'],
        domain: 'coindesk.com',
        simhash: '2',
      },
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, text: async () => '{"output":[]}' });
    const orig = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;
    const res = await getTokenNewsSummary('BTC', 'gpt', 'key', mockLogger());
    expect(res.analysis?.comment).toBe('Analysis unavailable');
    expect(res.analysis?.score).toBe(0);
    (globalThis as any).fetch = orig;
  });

  it('falls back when AI request fails', async () => {
    await insertNews([
      {
        title: 't3',
        link: 'l3',
        pubDate: new Date().toISOString(),
        tokens: ['BTC'],
        domain: 'coindesk.com',
        simhash: '3',
      },
    ]);
    const orig = globalThis.fetch;
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'));
    (globalThis as any).fetch = fetchMock;
    const res = await getTokenNewsSummary('BTC', 'gpt', 'key', mockLogger());
    expect(res.analysis?.comment).toBe('Analysis unavailable');
    expect(res.analysis?.score).toBe(0);
    (globalThis as any).fetch = orig;
  });

  it('caches token reviews and dedupes concurrent calls', async () => {
    await insertNews([
      {
        title: 't4',
        link: 'l4',
        pubDate: new Date().toISOString(),
        tokens: ['BTC'],
        domain: 'coindesk.com',
        simhash: '4',
      },
    ]);
    const orig = globalThis.fetch;
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, text: async () => responseJson });
    (globalThis as any).fetch = fetchMock;
    const p1 = getTokenNewsSummaryCached('BTC', 'gpt', 'key', mockLogger());
    const p2 = getTokenNewsSummaryCached('BTC', 'gpt', 'key', mockLogger());
    await Promise.all([p1, p2]);
    await getTokenNewsSummaryCached('BTC', 'gpt', 'key', mockLogger());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    (globalThis as any).fetch = orig;
  });

  it('selects top headlines by weighted score', async () => {
    vi.useFakeTimers();
    try {
      const now = new Date('2024-01-01T12:00:00Z');
      vi.setSystemTime(now);

      await insertNews([
        {
          title: 'Fresh High',
          link: 'link-fresh-high',
          pubDate: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
          tokens: ['BTC'],
          domain: 'coindesk.com',
          simhash: '5',
        },
        {
          title: 'Cointelegraph New',
          link: 'link-cointelegraph-new',
          pubDate: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
          tokens: ['BTC'],
          domain: 'cointelegraph.com',
          simhash: '6',
        },
        {
          title: 'Bitcoinist New',
          link: 'link-bitcoinist-new',
          pubDate: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
          tokens: ['BTC'],
          domain: 'bitcoinist.com',
          simhash: '7',
        },
        {
          title: 'News Bitcoin New',
          link: 'link-news-bitcoin-new',
          pubDate: new Date(now.getTime() - 20 * 60 * 1000).toISOString(),
          tokens: ['BTC'],
          domain: 'news.bitcoin.com',
          simhash: '8',
        },
        {
          title: 'Older High',
          link: 'link-older-high',
          pubDate: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(),
          tokens: ['BTC'],
          domain: 'coindesk.com',
          simhash: '9',
        },
        {
          title: 'Very Old Cointelegraph',
          link: 'link-very-old-cointelegraph',
          pubDate: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
          tokens: ['BTC'],
          domain: 'cointelegraph.com',
          simhash: '10',
        },
      ]);

      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, text: async () => responseJson });
      const orig = globalThis.fetch;
      (globalThis as any).fetch = fetchMock;

      try {
        const res = await getTokenNewsSummary('BTC', 'gpt', 'key', mockLogger());
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const headlines = res.prompt?.input.headlines ?? '';
        const lines = headlines.split('\n').filter(Boolean);
        expect(lines).toHaveLength(5);
        expect(lines[0]).toContain('Fresh High');
        expect(lines.some((line) => line.includes('Very Old Cointelegraph'))).toBe(false);
        expect(lines.some((line) => line.includes('Older High'))).toBe(true);
      } finally {
        (globalThis as any).fetch = orig;
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
