import Parser from 'rss-parser';
import NodeCache from 'node-cache';
import type { FastifyBaseLogger } from 'fastify';
import { insertNews } from '../repos/news.js';
import { TOKENS } from '../util/tokens.js';
import type { NewsItem } from './news.types.js';

const parser = new Parser();

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TTL_SEC = DAY_MS / 1000; // 24h default TTL for seen keys & run summaries
const LONG_TTL_SEC = (30 * DAY_MS) / 1000; // keep lastActive for 30 days
const cache = new NodeCache({ stdTTL: DEFAULT_TTL_SEC, checkperiod: 600 });

export const FEEDS = [
  'https://www.coindesk.com/arc/outboundfeeds/rss/',
  'https://cointelegraph.com/rss',
  'https://bitcoinist.com/feed/',
  'https://cryptopotato.com/feed/',
  'https://news.bitcoin.com/feed/',
];

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, (m) => `\\${m}`);
}

export function tagTokens(text: string): string[] {
  const out: string[] = [];
  for (const { symbol, tags } of TOKENS) {
    for (const tag of tags) {
      const re = new RegExp(`\\b${escapeRegex(tag)}\\b`, 'i');
      if (re.test(text)) {
        out.push(symbol);
        break;
      }
    }
  }
  return out;
}

export function isRecent(pubDate?: string, now: Date = new Date()): boolean {
  if (!pubDate) return false;
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() >= now.getTime() - DAY_MS;
}

function summarizeByToken(items: { tokens: string[] }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const it of items) for (const t of it.tokens) counts[t] = (counts[t] ?? 0) + 1;
  return counts;
}

export async function fetchNews(
    now: Date = new Date(),
    log?: FastifyBaseLogger,
    c: NodeCache = cache,
): Promise<NewsItem[]> {
  const nowMs = now.getTime();
  const collected: NewsItem[] = [];
  const perFeed: Record<string, number> = {};
  const failedFeeds: Record<string, string> = {};
  let rawItems = 0;
  let deduped = 0;

  for (const url of FEEDS) {
    try {
      const feed = await parser.parseURL(url);
      let added = 0;

      for (const item of feed.items) {
        rawItems++;
        if (!item.title || !item.link) continue;
        if (!isRecent(item.pubDate, now)) continue;

        const seenKey = `news:seen:${item.link}`;
        if (c.get(seenKey)) { deduped++; continue; }

        const tokens = tagTokens(item.title);
        if (!tokens.length) continue;

        c.set(seenKey, true);
        collected.push({
          title: item.title,
          link: item.link,
          pubDate: new Date(item.pubDate!).toISOString(),
          tokens,
        });
        added++;
      }

      perFeed[url] = added;

      c.set(`news:feed:lastOk:${url}`, now.toISOString());
      c.set(`news:feed:lastCount:${url}`, added);

      if (added > 0) {
        c.set(`news:feed:lastActive:${url}`, now.toISOString(), LONG_TTL_SEC);
      }
    } catch (err: any) {
      failedFeeds[url] = err?.message ?? 'unknown error';
    }
  }

  const quietNow = Object.entries(perFeed)
      .filter(([, count]) => count === 0)
      .map(([url]) => url);

  const silent24h: string[] = [];
  for (const url of FEEDS) {
    const lastActiveIso = c.get<string>(`news:feed:lastActive:${url}`);
    const lastActiveMs = lastActiveIso ? Date.parse(lastActiveIso) : 0;
    if (!lastActiveMs || nowMs - lastActiveMs > DAY_MS) {
      silent24h.push(url);
    }
  }

  if (log) {
    log.info(
        {
          totalRaw: rawItems,
          totalNew: collected.length,
          deduped,
          perFeed,
          failedFeeds,   // parse/network errors this run
          quietNow,      // 0 new items in this run
          silent24h,     // no new items for >24h (cumulative)
          perToken: summarizeByToken(collected),
        },
        'news fetch summary',
    );
  }

  return collected;
}

export async function fetchAndStoreNews(log: FastifyBaseLogger): Promise<void> {
  try {
    const news = await fetchNews(new Date(), log);
    await insertNews(news);
  } catch (err) {
    log.error({ err }, 'failed to fetch or store news');
  }
}

export type { NewsItem } from './news.types.js';
