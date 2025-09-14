import type { FastifyBaseLogger } from 'fastify';
import { fetchTokenIndicators, type TokenIndicators } from '../services/indicators.js';
import { fetchOrderBook } from '../services/derivatives.js';
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
  { promise: Promise<TokenIndicators>; expires: number }
>();

export function fetchTokenIndicatorsCached(
  token: string,
  log: FastifyBaseLogger,
): Promise<TokenIndicators> {
  const now = Date.now();
  const cached = indicatorCache.get(token);
  if (cached && cached.expires > now) {
    log.info({ token }, 'indicator cache hit');
    return cached.promise;
  }
  log.info({ token }, 'indicator cache miss');
  const promise = fetchTokenIndicators(token);
  indicatorCache.set(token, { promise, expires: now + CACHE_MS });
  promise.catch(() => indicatorCache.delete(token));
  return promise;
}

export function getTechnicalOutlookCached(
  token: string,
  indicators: TokenIndicators,
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
  const promise = getTechnicalOutlook(token, indicators, model, apiKey, log);
  cache.set(token, { promise, expires: now + CACHE_MS });
  promise.catch(() => cache.delete(token));
  return promise;
}

export async function getTechnicalOutlook(
  token: string,
  indicators: TokenIndicators,
  model: string,
  apiKey: string,
  log: FastifyBaseLogger,
): Promise<AnalysisLog> {
  const orderBook = await fetchOrderBook(`${token}USDT`);
  const prompt = { indicators, orderBook };
  const instructions = `You are a crypto technical analyst. Given the indicators and order book snapshot, write a short outlook for ${token} covering short, mid, and long-term timeframes. Include a bullishness score from 0-10 and key signals. - shortReport ≤255 chars.`;
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

  const tokenReports = new Map<string, any[]>();
  for (const report of prompt.reports) {
    const { token } = report;
    if (isStablecoin(token)) continue;
    const arr = tokenReports.get(token);
    if (arr) arr.push(report);
    else tokenReports.set(token, [report]);
  }

  if (tokenReports.size === 0) return;
  if (!prompt.marketData.indicators) prompt.marketData.indicators = {};

  await Promise.all(
    [...tokenReports.entries()].map(async ([token, reports]) => {
      const indicators = await fetchTokenIndicatorsCached(token, log);
      const { analysis, prompt: p, response } = await getTechnicalOutlookCached(
        token,
        indicators,
        model,
        apiKey,
        log,
      );
      if (p && response)
        await insertReviewRawLog({ portfolioId, prompt: p, response });
      (prompt.marketData.indicators as Record<string, any>)[token] = indicators;
      for (const r of reports) r.tech = analysis;
    }),
  );
}

// Used only in tests to ensure cache isolation
export function resetTechnicalAnalystCache(): void {
  cache.clear();
  indicatorCache.clear();
}
