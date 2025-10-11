import { describe, it, expect } from 'vitest';
import {
  computeDerivedItem,
  sortDerivedItems,
  computeWeight,
  computeTimeDecay,
} from '../src/agents/news-heuristics.js';

describe('news analyst helpers', () => {
  it('computes weight with reputation and time decay', () => {
    const now = new Date('2025-01-02T12:00:00Z');
    const recent = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
    const older = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();

    const weightRecent = computeWeight('coindesk.com', recent, now);
    const weightOlder = computeWeight('coindesk.com', older, now);
    const zeroWeight = computeWeight('unknown.com', recent, now);

    expect(weightRecent).toBeGreaterThan(weightOlder);
    expect(weightRecent).toBeGreaterThan(0);
    expect(weightOlder).toBeGreaterThan(0);
    expect(zeroWeight).toBe(0);
  });

  it('derives event metadata from headlines', () => {
    const now = new Date('2025-01-03T00:00:00Z');
    const base = {
      link: 'l',
      pubDate: now.toISOString(),
      weight: 0.8,
    };

    const hack = computeDerivedItem({
      title: 'Bridge hacked for $8M, withdrawals paused',
      domain: 'coindesk.com',
      ...base,
    });
    const listing = computeDerivedItem({
      title: 'Binance lists ABC token today',
      domain: 'coindesk.com',
      ...base,
    });
    const rumor = computeDerivedItem({
      title: 'Rumor: ETF approval expected soon',
      domain: 'news.bitcoin.com',
      ...base,
    });

    expect(hack.eventType).toBe('Hack');
    expect(hack.polarity).toBe('bearish');
    expect(hack.severity).toBeGreaterThan(0.8);
    expect(hack.eventConfidence).toBeGreaterThan(0.8);
    expect(listing.eventType).toBe('Listing');
    expect(listing.polarity).toBe('bullish');

    expect(rumor.eventType).toBe('Rumor');
    expect(rumor.polarity).toBe('neutral');
    expect(rumor.eventConfidence).toBeLessThan(0.6);
  });

  it('sorts derived items by score, severity, and recency', () => {
    const now = new Date('2025-01-04T00:00:00Z');
    const shared = { domain: 'coindesk.com', link: 'x', weight: 0.9 };
    const derived = [
      computeDerivedItem({
        title: 'Macro update keeps markets calm',
        pubDate: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
        ...shared,
      }),
      computeDerivedItem({
        title: 'Binance halts withdrawals amid outage',
        pubDate: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
        ...shared,
      }),
      computeDerivedItem({
        title: 'Whale moves 10,000 BTC to Coinbase',
        pubDate: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
        ...shared,
      }),
    ];

    const ordered = sortDerivedItems(derived);
    expect(ordered[0].eventType).toBe('Outage');
    expect(ordered[1].eventType).toBe('WhaleMove');
    expect(ordered[2].eventType).toBe('Upgrade');
  });

  it('computes time decay helper', () => {
    const now = new Date('2025-01-05T00:00:00Z');
    const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const distant = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

    expect(computeTimeDecay(recent, now)).toBeGreaterThan(0.4);
    expect(computeTimeDecay(distant, now)).toBeLessThan(0.05);
  });
});
