import type { FastifyBaseLogger } from 'fastify';
import NodeCache from 'node-cache';
import { callAi } from '../services/openai-client.js';
import { isStablecoin } from '../util/tokens.js';
import {
  fetchMarketOverview,
  createEmptyMarketOverview,
} from '../services/indicators.js';
import {
  fetchAccount,
  fetchPairInfo,
  fetchPairPrice,
} from '../services/binance-client.js';
import { getRecentReviewResults } from '../repos/review-result.js';
import { getLimitOrdersByReviewResult } from '../repos/limit-orders.js';
import { getNewsByToken } from '../repos/news.js';
import type { ActivePortfolioWorkflow } from '../repos/portfolio-workflows.types.js';
import type {
  RunParams,
  RebalancePosition,
  PreviousReport,
  RebalancePrompt,
  MainTraderDecision,
  MainTraderOrder,
  NewsContext,
} from './main-trader.types.js';
import {
  computeDerivedItem,
  sortDerivedItems,
  computeWeight,
  computeTimeDecay,
} from './news-analyst.js';
import type { DerivedItem } from './news-analyst.js';

export const developerInstructions = [
  '- You are a day-trading portfolio manager who sets target allocations autonomously, trimming highs and buying dips.',
  '- Interpret the shared market_overview.v2 dataset for technical context and the structured news_context feeds for event risk.',
  '- Consult marketData.marketOverview (market_overview.v2) for price action, HTF trend, returns, and risk flags before sizing orders.',
  '- Decide which limit orders to place based on portfolio, market data, and news context.',
  '- Make sure to size limit orders higher then minNotional values to avoid order cancellations.',
  '- Use precise quantities and prices that fit available balances; avoid rounding up and oversizing orders.',
  '- Trading pairs in the prompt may include asset-to-asset combos (e.g. BTCSOL); you are not limited to cash pairs.',
  '- The prompt lists all supported trading pairs with their current prices for easy reference.',
  '- Use news_context.biasScore to tilt sizing alongside market_overview; cite top_event_summary in shortReport.',
  '- If any bearish Hack|StablecoinDepeg|Outage with severity ≥ 0.75, allow protective action even if technicals are neutral.',
  '- Return {orders:[{pair:"TOKEN1TOKEN2",token:"TOKEN",side:"BUY"|"SELL",quantity:number,limitPrice:number,basePrice:number,maxPriceDivergencePct:number},...],shortReport}.',
  '- maxPriceDivergencePct is expressed as a percentage drift allowance (e.g. 0.01 = 1%) between basePrice and the live market price before cancelation;',
  '- maxPriceDivergencePct must be at least 0.0001 (0.01%) to avoid premature cancelations;',
  '- Keep limit targets realistic for the stated review interval so orders can fill within that window; avoid extreme prices unlikely to execute within interval.',
  '- Unfilled orders are canceled before the next review; the review interval is provided in the prompt.',
  '- shortReport ≤255 chars.',
  '- On error, return {error:"message"}.',
].join('\n');

export const rebalanceResponseSchema = {
  type: 'object',
  properties: {
    result: {
      anyOf: [
        {
          type: 'object',
          properties: {
            orders: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  pair: { type: 'string' },
                  token: { type: 'string' },
                  side: { type: 'string', enum: ['BUY', 'SELL'] },
                  quantity: { type: 'number' },
                  limitPrice: { type: 'number' },
                  basePrice: { type: 'number' },
                  maxPriceDivergencePct: { type: 'number' },
                },
                required: [
                  'pair',
                  'token',
                  'side',
                  'quantity',
                  'limitPrice',
                  'basePrice',
                  'maxPriceDivergencePct',
                ],
                additionalProperties: false,
              },
            },
            shortReport: { type: 'string' },
          },
          required: ['orders', 'shortReport'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
          required: ['error'],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ['result'],
  additionalProperties: false,
};

interface DerivedItemWithTime extends DerivedItem {
  timeDecay: number;
}

const BIAS_DENOMINATOR_EPSILON = 1e-6;
const NEWS_CONTEXT_CACHE_TTL_MS = 60_000;

interface NewsContextCacheEntry {
  value: NewsContext;
  expires: number;
}

const newsContextCache = new NodeCache({
  stdTTL: 0,
  checkperiod: 0,
  useClones: false,
});

const pendingNewsContexts = new Map<string, Promise<NewsContext>>();

function getCachedNewsContext(token: string, now: number): NewsContext | null {
  const cached = newsContextCache.get<NewsContextCacheEntry>(token);
  if (cached && now < cached.expires) {
    return cached.value;
  }
  return null;
}

async function getNewsContextWithCache(
  token: string,
  log: FastifyBaseLogger,
): Promise<NewsContext> {
  const now = Date.now();
  const cached = getCachedNewsContext(token, now);
  if (cached) {
    return cached;
  }

  const existing = pendingNewsContexts.get(token);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      const value = await buildNewsContext(token, log);
      const entry: NewsContextCacheEntry = {
        value,
        expires: Date.now() + NEWS_CONTEXT_CACHE_TTL_MS,
      };
      newsContextCache.set<NewsContextCacheEntry>(token, entry);
      return value;
    } catch (err) {
      log.error({ err, token }, 'news context cache refresh failed');
      newsContextCache.del(token);
      throw err;
    } finally {
      pendingNewsContexts.delete(token);
    }
  })().catch(() => createEmptyNewsContext());

  pendingNewsContexts.set(token, promise);
  return promise;
}

export function __resetNewsContextCacheForTest(): void {
  newsContextCache.flushAll();
  pendingNewsContexts.clear();
}

function createEmptyNewsContext(): NewsContext {
  return {
    version: 'news_context.v1',
    biasScore: 0,
    maxSeverity: 0,
    maxEventConfidence: 0,
    bullCount: 0,
    bearCount: 0,
    topEventSummary: null,
    items: [],
  };
}

async function buildNewsContext(
  token: string,
  log: FastifyBaseLogger,
): Promise<NewsContext> {
  try {
    const items = await getNewsByToken(token, 20);
    if (!items.length) return createEmptyNewsContext();

    const now = new Date();
    const weighted = items
      .map((item) => {
        const timeDecay = computeTimeDecay(item.pubDate, now);
        const weight = computeWeight(item.domain, item.pubDate, now);
        return { ...item, weight, timeDecay };
      })
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5);

    if (!weighted.length) return createEmptyNewsContext();

    const derivedWithTime: DerivedItemWithTime[] = weighted.map((item) => {
      const derived = computeDerivedItem({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        domain: item.domain,
        weight: item.weight,
      });
      return { ...derived, timeDecay: item.timeDecay };
    });

    const ordered = sortDerivedItems(derivedWithTime) as DerivedItemWithTime[];

    let numerator = 0;
    let denominator = 0;
    let maxSeverity = 0;
    let maxEventConfidence = 0;
    let bullCount = 0;
    let bearCount = 0;

    for (const item of ordered) {
      denominator += item.weight;
      maxSeverity = Math.max(maxSeverity, item.severity);
      maxEventConfidence = Math.max(maxEventConfidence, item.eventConfidence);
      if (item.polarity === 'bullish') bullCount += 1;
      if (item.polarity === 'bearish') bearCount += 1;
      const dir = item.polarity === 'bullish' ? 1 : item.polarity === 'bearish' ? -1 : 0;
      numerator += dir * item.severity * item.eventConfidence * item.timeDecay;
    }

    const biasScoreRaw = numerator / (denominator + BIAS_DENOMINATOR_EPSILON);
    const biasScore = Math.max(-1, Math.min(1, biasScoreRaw));

    const top = ordered[0];
    let topEventSummary: string | null = null;
    if (top) {
      topEventSummary = `${top.eventType} — ${top.polarity} (sev=${top.severity.toFixed(2)})`;
      if (top.tierHints.exchangeTier !== 'none') {
        let tier = top.tierHints.exchangeTier;
        if (top.tierHints.exchange) {
          tier += `/${top.tierHints.exchange}`;
        }
        topEventSummary += ` [${tier}]`;
      }
    }

    return {
      version: 'news_context.v1',
      biasScore,
      maxSeverity,
      maxEventConfidence,
      bullCount,
      bearCount,
      topEventSummary,
      items: ordered.map((item) => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        domain: item.domain,
        eventType: item.eventType,
        polarity: item.polarity,
        severity: item.severity,
        eventConfidence: item.eventConfidence,
        headlineScore: item.headlineScore,
        tierHints: item.tierHints,
        numbers: item.numbers,
      })),
    };
  } catch (err) {
    log.error({ err, token }, 'failed to build news context');
    return createEmptyNewsContext();
  }
}

export async function collectPromptData(
  row: ActivePortfolioWorkflow,
  log: FastifyBaseLogger,
): Promise<RebalancePrompt | undefined> {
  const cash = row.cashToken;
  const tokens = row.tokens.map((t) => t.token);
  const allTokens = [cash, ...tokens];

  const account = await fetchAccount(row.userId).catch((err) => {
    log.error({ err }, 'failed to fetch balance');
    return null;
  });
  if (!account) return undefined;

  const floor: Record<string, number> = { [cash]: 0 };
  const positions: RebalancePosition[] = [];
  const routes: RebalancePrompt['routes'] = [];

  const balCash = account.balances.find((b) => b.asset === cash);
  const cashQty = balCash ? Number(balCash.free) : 0;
  positions.push({ sym: cash, qty: cashQty, priceUsdt: 1, valueUsdt: cashQty });

  for (const t of row.tokens) {
    const bal = account.balances.find((b) => b.asset === t.token);
    const qty = bal ? Number(bal.free) : undefined;
    if (qty === undefined) {
      log.error('failed to fetch token balances');
      return undefined;
    }
    const { currentPrice } = await fetchPairPrice(t.token, cash);
    positions.push({
      sym: t.token,
      qty,
      priceUsdt: currentPrice,
      valueUsdt: currentPrice * qty,
    });
    floor[t.token] = t.minAllocation;
  }

  for (let i = 0; i < allTokens.length; i++) {
    for (let j = i + 1; j < allTokens.length; j++) {
      try {
        const [info, data] = await Promise.all([
          fetchPairInfo(allTokens[i], allTokens[j]),
          fetchPairPrice(allTokens[i], allTokens[j]),
        ]);
        const baseMin = data.currentPrice
          ? info.minNotional / data.currentPrice
          : 0;
        routes.push({
          pair: data.symbol,
          price: data.currentPrice,
          [info.quoteAsset]: { minNotional: info.minNotional },
          [info.baseAsset]: { minNotional: baseMin },
        });
      } catch (err) {
        log.error({ err }, 'failed to fetch pair data');
      }
    }
  }

  const portfolio: RebalancePrompt['portfolio'] = {
    ts: new Date().toISOString(),
    positions,
  };

  const totalValue = positions.reduce((sum, p) => sum + p.valueUsdt, 0);
  if (row.startBalance !== null) {
    portfolio.startBalanceUsd = row.startBalance;
    portfolio.startBalanceTs = row.createdAt;
    portfolio.pnlUsd = totalValue - row.startBalance;
  }

  const prevRows = await getRecentReviewResults(row.id, 5);
  const previousReports: PreviousReport[] = [];
  for (const r of prevRows) {
    const ordersRows = await getLimitOrdersByReviewResult(row.id, r.id);
    const orders = ordersRows.map((o) => {
      const planned = JSON.parse(o.plannedJson);
      return {
        symbol: planned.symbol,
        side: planned.side,
        quantity: planned.quantity,
        status: o.status,
        datetime: o.createdAt.toISOString(),
        ...(o.cancellationReason
          ? { cancellationReason: o.cancellationReason }
          : {}),
      } as const;
    });
    const report: PreviousReport = {
      datetime: r.createdAt.toISOString(),
      ...(r.shortReport !== undefined ? { shortReport: r.shortReport } : {}),
      ...(r.error !== undefined ? { error: r.error } : {}),
      ...(orders.length ? { orders } : {}),
    };
    previousReports.push(report);
  }

  const nonStableTokens = tokens.filter((t) => !isStablecoin(t));
  const reports = await Promise.all(
    nonStableTokens.map(async (token) => ({
      token,
      news: await getNewsContextWithCache(token, log),
    })),
  );

  const prompt: RebalancePrompt = {
    instructions: row.agentInstructions,
    reviewInterval: row.reviewInterval,
    policy: { floor },
    cash,
    portfolio,
    routes,
    marketData: {},
    reports,
  };
  if (previousReports.length) {
    prompt.previousReports = previousReports;
  }

  let marketOverview = createEmptyMarketOverview();
  if (nonStableTokens.length) {
    try {
      marketOverview = await fetchMarketOverview(nonStableTokens);
    } catch (err) {
      log.error({ err }, 'failed to fetch market overview');
    }
  }
  prompt.marketData.marketOverview = marketOverview;

  return prompt;
}

function extractResult(res: string): MainTraderDecision | null {
  try {
    const json = JSON.parse(res);
    const outputs = Array.isArray((json as any).output)
      ? (json as any).output
      : [];
    const msg = outputs.find(
      (o: any) => o.type === 'message' || o.id?.startsWith('msg_'),
    );
    const text = msg?.content?.[0]?.text;
    if (typeof text !== 'string') return null;
    const parsed = JSON.parse(text);
    return parsed.result ?? null;
  } catch {
    return null;
  }
}

export async function run(
  { log, model, apiKey }: RunParams,
  prompt: RebalancePrompt,
): Promise<MainTraderDecision | null> {
  const res = await callAi(
    model,
    developerInstructions,
    rebalanceResponseSchema,
    prompt,
    apiKey,
    true,
  );
  const decision = extractResult(res);
  if (!decision) {
    log.error('main trader returned invalid response');
    return null;
  }
  return decision;
}
