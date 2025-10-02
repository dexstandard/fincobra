import { describe, it, expect, vi } from 'vitest';
import Parser from 'rss-parser';

import { tagTokens, isRecent, fetchNews, FEEDS } from '../src/services/news.js';
import { insertNews } from '../src/repos/news.js';
import { db } from '../src/db/index.js';

describe('tagTokens', () => {
  it('detects token tags case-insensitively', () => {
    const res = tagTokens('Bitcoin and HeDeRa rally while eth falls');
    expect(res.sort()).toEqual(['BTC', 'HBAR', 'ETH'].sort());
  });
});

describe('isRecent', () => {
  it('filters out items older than 24 hours', () => {
    const now = new Date('2023-01-02T00:00:00Z');
    const recent = new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString();
    const old = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
    expect(isRecent(recent, now)).toBe(true);
    expect(isRecent(old, now)).toBe(false);
  });

  it('returns false for invalid or missing dates', () => {
    expect(isRecent(undefined)).toBe(false);
    expect(isRecent('not a date')).toBe(false);
  });
});

describe('fetchNews', () => {
  it('returns only recent items with token matches', async () => {
    const now = new Date('2023-01-02T00:00:00Z');
    const recent = new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString();
    const old = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
    const parseURL = vi.spyOn(Parser.prototype, 'parseURL');
    parseURL.mockResolvedValue({ items: [] });
    parseURL.mockResolvedValueOnce({
      items: [
        {
          title: 'BTC surges',
          link: 'https://example.com/btc',
          pubDate: recent,
        },
        { title: 'ETH old', link: 'https://example.com/eth', pubDate: old },
        {
          title: 'General news',
          link: 'https://example.com/general',
          pubDate: recent,
        },
      ],
    });
    const res = await fetchNews(now);
    expect(parseURL).toHaveBeenCalledTimes(FEEDS.length);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      link: 'https://example.com/btc',
      tokens: ['BTC'],
      domain: 'example.com',
    });
    parseURL.mockRestore();
  });
});

describe('insertNews', () => {
  it('avoids inserting duplicates by link', async () => {
    const item = {
      title: 'BTC rises',
      link: 'https://example.com/btc',
      pubDate: new Date().toISOString(),
      tokens: ['BTC'],
      domain: 'example.com',
    };
    await insertNews([item]);
    await insertNews([item]);
    const { rows } = await db.query('SELECT title, link, tokens FROM news');
    expect(rows).toHaveLength(1);
    expect(rows[0].tokens).toEqual(['BTC']);
  });

  it('skips items without token matches', async () => {
    const item = {
      title: 'General market news',
      link: 'https://example.com/general',
      pubDate: new Date().toISOString(),
      tokens: [],
      domain: 'example.com',
    };
    await insertNews([item]);
    const { rows } = await db.query('SELECT 1 FROM news WHERE link = $1', [
      item.link,
    ]);
    expect(rows).toHaveLength(0);
  });
});
