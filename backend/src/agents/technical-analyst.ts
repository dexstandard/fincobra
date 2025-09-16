import type { FastifyBaseLogger } from 'fastify';
import { fetchTokenIndicators, type TokenIndicators } from '../services/indicators.js';
import { fetchOrderBook } from '../services/derivatives.js';
import { fetchFearGreedIndex, type FearGreedIndex } from '../services/binance.js';
import { insertReviewRawLog } from '../repos/agent-review-raw-log.js';
import { callAi, extractJson } from '../util/ai.js';
import { isStablecoin } from '../util/tokens.js';
import {
  type RebalancePrompt,
  type AnalysisLog,
  type Analysis,
  analysisSchema,
  type RunParams,
} from './types.js';

const CACHE_MS = 3 * 60 * 1000;
const cache = new Map<string, { promise: Promise<AnalysisLog>; expires: number }>();
const indicatorCache = new Map<
  string,
  { promise: Promise<Indicators>; expires: number }
>();

interface TokenReport {
  token: string;
  news: Analysis | null;
  tech: Analysis | null;
}

interface Indicators extends TokenIndicators {}

interface OrderBook {
  bid: [number, number];
  ask: [number, number];
}

export function fetchTokenIndicatorsCached(
  token: string,
  log: FastifyBaseLogger,
): Promise<Indicators> {
  const now = Date.now();
  const cached = indicatorCache.get(token);
  if (cached && cached.expires > now) {
    log.info({ token }, 'indicator cache hit');
    return cached.promise;
  }
  log.info({ token }, 'indicator cache miss');
  const promise = fetchTokenIndicators(token) as Promise<Indicators>;
  indicatorCache.set(token, { promise, expires: now + CACHE_MS });
  promise.catch(() => indicatorCache.delete(token));
  return promise;
}

export function getTechnicalOutlookCached(
  token: string,
  indicators: Indicators,
  orderBook: OrderBook,
  fearGreedIndex: FearGreedIndex | undefined,
  model: string,
  apiKey: string,
  log: FastifyBaseLogger,
): Promise<AnalysisLog> {
  const now = Date.now();
  const cached = cache.get(token);
  if (cached && cached.expires > now) {
    log.info({ token }, 'technical outlook cache hit');
    return cached.promise;
  }
  log.info({ token }, 'technical outlook cache miss');
  const promise = getTechnicalOutlook(
    token,
    indicators,
    orderBook,
    fearGreedIndex,
    model,
    apiKey,
    log,
  );
  cache.set(token, { promise, expires: now + CACHE_MS });
  promise.catch(() => cache.delete(token));
  return promise;
}

export async function getTechnicalOutlook(
  token: string,
  indicators: Indicators,
  orderBook: OrderBook,
  fearGreedIndex: FearGreedIndex | undefined,
  model: string,
  apiKey: string,
  log: FastifyBaseLogger,
): Promise<AnalysisLog> {
  const prompt = { indicators, orderBook, fearGreedIndex };
  const instructions = `You are a crypto technical analyst. Given the indicators, order book snapshot, and fear & greed index, write a short outlook for ${token} covering short, mid, and long-term timeframes. Include a bullishness score from 0-10 and key signals. - shortReport ≤255 chars.`;
  const fallback: Analysis = { comment: 'Analysis unavailable', score: 0 };
  try {
    const res = await callAi(model, instructions, analysisSchema, prompt, apiKey);
    const analysis = extractJson<Analysis>(res);
    if (!analysis) {
      log.error({ token, response: res }, 'technical analyst returned invalid response');
      return { analysis: fallback, prompt: { instructions, input: prompt }, response: res };
    }
    return { analysis, prompt: { instructions, input: prompt }, response: res };
  } catch (err) {
    log.error({ err, token }, 'technical analyst call failed');
    return { analysis: fallback };
  }
}

export async function runTechnicalAnalyst(
  { log, model, apiKey, portfolioId }: RunParams,
  prompt: RebalancePrompt,
): Promise<void> {
  if (!prompt.reports) return;

  const tokenReports = new Map<string, TokenReport[]>();
  for (const report of prompt.reports) {
    const { token } = report;
    if (isStablecoin(token)) continue;
    const arr = tokenReports.get(token);
    if (arr) arr.push(report);
    else tokenReports.set(token, [report]);
  }

  if (tokenReports.size === 0) return;
  if (!prompt.marketData.indicators) prompt.marketData.indicators = {};
  if (!prompt.marketData.orderBooks) prompt.marketData.orderBooks = {};

  const indicatorsMap =
    prompt.marketData.indicators as unknown as Record<string, Indicators>;
  const orderBooksMap =
    prompt.marketData.orderBooks as unknown as Record<string, OrderBook>;

  const fearGreedIndex = await fetchFearGreedIndex().catch((err) => {
    log.error({ err }, 'failed to fetch fear & greed index');
    return undefined;
  });
  if (fearGreedIndex) prompt.marketData.fearGreedIndex = fearGreedIndex;

  await Promise.all(
    [...tokenReports.entries()].map(async ([token, reports]) => {
      const [indicators, orderBook] = await Promise.all([
        fetchTokenIndicatorsCached(token, log),
        fetchOrderBook(`${token}USDT`),
      ]);
      const { analysis, prompt: p, response } = await getTechnicalOutlookCached(
        token,
        indicators,
        orderBook,
        fearGreedIndex,
        model,
        apiKey,
        log,
      );
      if (p && response)
        await insertReviewRawLog({ portfolioId, prompt: p, response });
      indicatorsMap[token] = indicators;
      orderBooksMap[token] = orderBook;
      for (const r of reports) r.tech = analysis;
    }),
  );
}

// Used only in tests to ensure cache isolation
export function resetTechnicalAnalystCache(): void {
  cache.clear();
  indicatorCache.clear();
}
