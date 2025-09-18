import type { FastifyBaseLogger } from 'fastify';
import { fetchTokenIndicators, type TokenIndicators } from '../services/indicators.js';
import { fetchOrderBook } from '../services/derivatives.js';
import { fetchFearGreedIndex, type FearGreedIndex } from '../services/binance.js';
import { insertReviewRawLog } from '../repos/review-raw-log.js';
import { callAi, extractJson } from '../util/ai.js';
import { isStablecoin } from '../util/tokens.js';
import {
  type RebalancePrompt,
  type RunParams,
  type PromptReport,
} from './main-trader.types.js';
import {
  type AnalysisLog,
  type Analysis,
  analysisSchema,
} from './news-analyst.types.js';
import { type TokenMetrics, type OrderBookSnapshot } from './technical-analyst.types.js';

const CACHE_MS = 3 * 60 * 1000;
const cache = new Map<string, { promise: Promise<AnalysisLog>; expires: number }>();
const indicatorCache = new Map<
  string,
  { promise: Promise<TokenIndicators>; expires: number }
>();

function toTokenMetrics(indicators: TokenIndicators): TokenMetrics {
  const {
    ret,
    sma_dist: smaDist,
    macd_hist: macdHist,
    vol,
    range,
    volume,
    corr,
    regime,
    osc,
  } = indicators;

  return {
    ret1h: ret['1h'],
    ret4h: ret['4h'],
    ret24h: ret['24h'],
    ret7d: ret['7d'],
    ret30d: ret['30d'],
    smaDist20: smaDist['20'],
    smaDist50: smaDist['50'],
    smaDist200: smaDist['200'],
    macdHist,
    volRv7d: vol.rv_7d,
    volRv30d: vol.rv_30d,
    volAtrPct: vol.atr_pct,
    rangeBbBw: range.bb_bw,
    rangeDonchian20: range.donchian20,
    volumeZ1h: volume.z_1h,
    volumeZ24h: volume.z_24h,
    corrBtc30d: corr.BTC_30d,
    regimeBtc: regime.BTC,
    oscRsi14: osc.rsi_14,
    oscStochK: osc.stoch_k,
    oscStochD: osc.stoch_d,
  };
}

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
  orderBook: OrderBookSnapshot,
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
  indicators: TokenIndicators,
  orderBook: OrderBookSnapshot,
  fearGreedIndex: FearGreedIndex | undefined,
  model: string,
  apiKey: string,
  log: FastifyBaseLogger,
): Promise<AnalysisLog> {
  const metrics = toTokenMetrics(indicators);
  const prompt = { indicators: metrics, orderBook, fearGreedIndex };
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

  const tokenReports = new Map<string, PromptReport[]>();
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

  const indicatorsMap = prompt.marketData.indicators as Record<
    string,
    TokenMetrics
  >;
  const orderBooksMap =
    prompt.marketData.orderBooks as Record<string, OrderBookSnapshot>;

  const fearGreedIndex = await fetchFearGreedIndex().catch((err) => {
    log.error({ err }, 'failed to fetch fear & greed index');
    return undefined;
  });
  if (fearGreedIndex) prompt.marketData.fearGreedIndex = fearGreedIndex;

  await Promise.all(
    [...tokenReports.entries()].map(async ([token, reports]) => {
      const [rawIndicators, orderBook] = await Promise.all([
        fetchTokenIndicatorsCached(token, log),
        fetchOrderBook(`${token}USDT`),
      ]);
      const { analysis, prompt: p, response } = await getTechnicalOutlookCached(
        token,
        rawIndicators,
        orderBook,
        fearGreedIndex,
        model,
        apiKey,
        log,
      );
      if (p && response)
        await insertReviewRawLog({ portfolioWorkflowId: portfolioId, prompt: p, response });
      indicatorsMap[token] = toTokenMetrics(rawIndicators);
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
