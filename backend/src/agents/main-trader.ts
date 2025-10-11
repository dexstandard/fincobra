import type { FastifyBaseLogger } from 'fastify';
import NodeCache from 'node-cache';
import { callAi, extractJson as extractAiJson } from '../services/ai-service.js';
import { isStablecoin } from '../util/tokens.js';
import {
  fetchMarketOverview,
  createEmptyMarketOverview,
  clearMarketOverviewCache,
} from '../services/indicators.js';
import { fetchFearGreedIndex } from '../services/sentiment.js';
import {
  fetchAccount,
  fetchPairInfo,
  fetchPairPrice,
  isInvalidSymbolError,
} from '../services/binance-client.js';
import { getRecentReviewResults } from '../repos/review-result.js';
import { getLimitOrdersByReviewResult } from '../repos/limit-orders.js';
import { getNewsByToken } from '../repos/news.js';
import { getPromptForReviewResult } from '../repos/review-raw-log.js';
import type { ActivePortfolioWorkflow } from '../repos/portfolio-workflows.types.js';
import { getUsdPrice } from '../services/price-oracle.js';
import type { SupportedOracleSymbol } from '../services/price-oracle.types.js';
import type {
  RunParams,
  RebalancePosition,
  PreviousReport,
  PreviousReportOrder,
  RebalancePrompt,
  MainTraderDecision,
  MainTraderOrder,
  NewsContext,
  PromptReport,
  StablecoinOracleQuoteReport,
} from './main-trader.types.js';
import {
  computeDerivedItem,
  sortDerivedItems,
  computeWeight,
} from './news-analyst.js';

export const developerInstructions = [
  'Primary Goal: Grow total portfolio USD value and monitor PnL every decision cycle.',
  'Strategy & Decision Rules',
  '- You are a day-trading portfolio manager. Autonomously choose ANY trading strategy, set target allocations, and optionally place orders consistent with those targets.',
  '- Use the market overview dataset for price action, higher-timeframe trend, returns, and risk flags.',
  '- Use the structured news feed for event risks.',
  '- Verify critical news headlines (and their source links when needed) before acting so machine-tagged events do not trigger unnecessary panic selling.',
  '- If a bearish Hack | StablecoinDepeg | Outage with severity ≥ 0.75 appears, allow protective action even if technicals are neutral.',
  '- If your chosen strategy overlaps with any recent strategies, do not follow it blindly; provide evidence of expected alpha inside the rationale.',
  'Execution Rules',
  '- Always check portfolio balances and policy floors before placing orders.',
  '- Supported order books are listed in the prompt (may include asset-to-asset combos like BTCSOL, not just cash pairs).',
  '- Place limit orders sized precisely to available balances. Avoid oversizing and rounding errors.',
  '- Ensure orders exceed min notional values to prevent cancellations.',
  '- Keep limit targets realistic for the review interval so orders can fill; avoid extreme/unlikely prices.',
  '- Unfilled orders are canceled before the next review (interval is provided in the prompt).',
  '- Use maxPriceDriftPct to allow a small % drift from basePrice (≥0.0001 = 0.01%) to prevent premature cancellations.',
  'Response Specification',
  '- Return the chosen strategy name, a short report (≤255 chars), a rationale explaining expected alpha, and an array of orders.',
  '- If no trade is taken, return an empty orders array.',
  '- On error, return error message.',
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
                  qty: { type: 'number' },
                  limitPrice: { type: 'number' },
                  basePrice: { type: 'number' },
                  maxPriceDriftPct: { type: 'number' },
                },
                required: [
                  'pair',
                  'token',
                  'side',
                  'qty',
                  'limitPrice',
                  'basePrice',
                  'maxPriceDriftPct',
                ],
                additionalProperties: false,
              },
            },
            shortReport: { type: 'string' },
            strategyName: { type: 'string' },
            strategyRationale: { type: 'string' },
          },
          required: ['orders', 'shortReport', 'strategyName', 'strategyRationale'],
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

const BIAS_DENOMINATOR_EPSILON = 1e-6;
const NEWS_CONTEXT_WARNING =
  'Machine-estimated news risk. Verify the headlines and source links before reacting to avoid panic selling.';
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

function formatDecisionInterval(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error('decision interval must be a positive number of minutes');
  }
  const wholeMinutes = Math.floor(minutes);
  const hours = Math.floor(wholeMinutes / 60);
  const remainingMinutes = wholeMinutes % 60;
  let iso = 'PT';
  if (hours > 0) {
    iso += `${hours}H`;
  }
  if (remainingMinutes > 0) {
    iso += `${remainingMinutes}M`;
  }
  if (iso === 'PT') {
    throw new Error('decision interval must be at least one minute');
  }
  return iso;
}

function normalizeDecisionInterval(value?: string | null): string {
  const minutes = parseDecisionIntervalMinutes(value);
  if (minutes === null) {
    throw new Error('workflow review interval is required');
  }
  return formatDecisionInterval(minutes);
}

function parseDecisionIntervalMinutes(value?: string | null): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const isoMatch = trimmed.toUpperCase().match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/);
  if (isoMatch) {
    const hours = isoMatch[1] ? Number(isoMatch[1]) : 0;
    const minutes = isoMatch[2] ? Number(isoMatch[2]) : 0;
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return null;
    }
    const total = hours * 60 + minutes;
    return total > 0 ? total : null;
  }
  const legacyMatch = trimmed.match(/^(\d+)\s*([mh])$/i);
  if (legacyMatch) {
    const amount = Number(legacyMatch[1]);
    if (!Number.isFinite(amount)) return null;
    if (amount <= 0) {
      return null;
    }
    return legacyMatch[2].toLowerCase() === 'h' ? amount * 60 : amount;
  }
  return null;
}

function pickLtf(decisionInterval: string): Array<'10m' | '30m' | '1h'> {
  const minutes = parseDecisionIntervalMinutes(decisionInterval);
  if (minutes === null) {
    return [];
  }
  if (minutes <= 30) {
    return ['10m', '30m'];
  }
  if (minutes <= 90) {
    return ['30m', '1h'];
  }
  if (minutes <= 240) {
    return ['30m'];
  }
  return [];
}

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

async function buildStablecoinOracleReport(
  cashToken: string,
  log: FastifyBaseLogger,
): Promise<PromptReport | null> {
  const normalized = cashToken.toUpperCase();
  if (normalized !== 'USDT' && normalized !== 'USDC') {
    return null;
  }

  try {
    const symbol: SupportedOracleSymbol = normalized;
    const quote = await getUsdPrice(symbol);
    const quotes: Partial<
      Record<SupportedOracleSymbol, StablecoinOracleQuoteReport>
    > = {
      [symbol]: {
        usdPrice: quote.price,
        updatedAt: quote.updatedAt.toISOString(),
      },
    };
    return {
      token: 'USDC/USDT',
      stablecoinOracle: {
        pair: 'USDC/USDT',
        quotes,
      },
    };
  } catch (err) {
    log.error({ err }, 'failed to fetch stablecoin oracle quotes');
    return null;
  }
}

export function __resetNewsContextCacheForTest(): void {
  newsContextCache.flushAll();
  pendingNewsContexts.clear();
}

export function clearMainTraderCaches(): void {
  newsContextCache.flushAll();
  pendingNewsContexts.clear();
  clearMarketOverviewCache();
}

function createEmptyNewsContext(): NewsContext {
  return {
    version: 'news_context.v1',
    bias: 0,
    maxSev: 0,
    maxConf: 0,
    bull: 0,
    bear: 0,
    top: null,
    warning: NEWS_CONTEXT_WARNING,
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
      .map((item) => ({
        ...item,
        weight: computeWeight(item.domain, item.pubDate, now),
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5);

    if (!weighted.length) return createEmptyNewsContext();

    const derivedItems = weighted.map((item) =>
      computeDerivedItem({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        domain: item.domain,
        weight: item.weight,
      }),
    );

    const ordered = sortDerivedItems(derivedItems);

    let numerator = 0;
    let denominator = 0;
    let maxSev = 0;
    let maxConf = 0;
    let bull = 0;
    let bear = 0;

    for (const item of ordered) {
      denominator += item.weight;
      maxSev = Math.max(maxSev, item.severity);
      maxConf = Math.max(maxConf, item.eventConfidence);
      if (item.polarity === 'bullish') bull += 1;
      if (item.polarity === 'bearish') bear += 1;
      const dir =
        item.polarity === 'bullish' ? 1 : item.polarity === 'bearish' ? -1 : 0;
      numerator += dir * item.severity * item.eventConfidence * item.weight;
    }

    const biasRaw = numerator / (denominator + BIAS_DENOMINATOR_EPSILON);
    const bias = Math.max(-1, Math.min(1, biasRaw));

    const top = ordered[0];
    let topSummary: string | null = null;
    if (top) {
      topSummary = `${top.eventType} — ${top.polarity} (sev=${top.severity.toFixed(2)})`;
    }

    return {
      version: 'news_context.v1',
      bias,
      maxSev,
      maxConf,
      bull,
      bear,
      top: topSummary,
      warning: NEWS_CONTEXT_WARNING,
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
  let malformedRoutes = 0;
  let attemptedRoutes = 0;

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
    let priceData;
    try {
      priceData = await fetchPairPrice(t.token, cash);
    } catch (err) {
      if (isInvalidSymbolError(err)) {
        const error =
          err instanceof Error ? err : new Error(String(err ?? 'unknown error'));
        log.error({ token: t.token, cash, err: error }, 'unsupported trading pair');
        throw new Error(`unsupported trading pair: ${t.token}/${cash}`, {
          cause: error,
        });
      }
      throw err;
    }
    const { currentPrice } = priceData;
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
        attemptedRoutes += 1;
        const [infoResult, priceResult] = await Promise.allSettled([
          fetchPairInfo(allTokens[i], allTokens[j]),
          fetchPairPrice(allTokens[i], allTokens[j]),
        ]);
        if (infoResult.status === 'rejected') {
          const infoErr =
            infoResult.reason instanceof Error
              ? infoResult.reason
              : new Error(String(infoResult.reason));
          if (isInvalidSymbolError(infoErr)) {
            log.warn(
              { pair: `${allTokens[i]}/${allTokens[j]}`, err: infoErr },
              'skipping trading route: unsupported pair on Binance',
            );
            continue;
          }
          throw infoErr;
        }
        if (priceResult.status === 'rejected') {
          const priceErr =
            priceResult.reason instanceof Error
              ? priceResult.reason
              : new Error(String(priceResult.reason));
          if (isInvalidSymbolError(priceErr)) {
            log.warn(
              { pair: `${allTokens[i]}/${allTokens[j]}`, err: priceErr },
              'skipping trading route: unsupported pair on Binance',
            );
            continue;
          }
          throw priceErr;
        }
        const info = infoResult.value;
        const data = priceResult.value;
        if (!Number.isFinite(data.currentPrice) || data.currentPrice <= 0) {
          malformedRoutes += 1;
          log.warn(
            {
              pair: data.symbol,
              currentPrice: data.currentPrice,
            },
            'skipping trading route: received zero/invalid price from Binance',
          );
          continue;
        }
        const baseMin = info.minNotional / data.currentPrice;
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

  if (attemptedRoutes > 0 && routes.length === 0 && malformedRoutes === attemptedRoutes) {
    throw new Error('no valid trading routes available');
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
    if (row.startBalance !== 0) {
      portfolio.pnlPct = portfolio.pnlUsd / row.startBalance;
    }
  }

  const prevRows = await getRecentReviewResults(row.id, 3);
  const promptSnapshots = await Promise.all(
    prevRows.map(async (r) => {
      const promptJson = await getPromptForReviewResult(row.id, r.id);
      if (!promptJson) {
        return { pnlUsd: undefined };
      }
      try {
        const parsed = JSON.parse(promptJson) as any;
        const pnlUsd = parsed?.portfolio?.pnlUsd;
        return {
          pnlUsd: typeof pnlUsd === 'number' ? pnlUsd : undefined,
        };
      } catch (err) {
        log.warn(
          { err, reviewResultId: r.id },
          'failed to parse previous prompt payload',
        );
        return { pnlUsd: undefined };
      }
    }),
  );

  const snapshots = [
    ...(typeof portfolio.pnlUsd === 'number'
      ? [{ pnlUsd: portfolio.pnlUsd }]
      : []),
    ...promptSnapshots,
  ];

  const previousReports: PreviousReport[] = [];
  for (let index = 0; index < prevRows.length; index += 1) {
    const r = prevRows[index];
    const ordersRows = await getLimitOrdersByReviewResult(row.id, r.id);
    const orders: PreviousReportOrder[] = [];
    for (const o of ordersRows) {
      const planned = JSON.parse(o.plannedJson);
      // TODO: drop quantity fallback once legacy orders are migrated.
      const plannedQtyRaw = planned.qty ?? planned.quantity;
      if (plannedQtyRaw === undefined) {
        log.warn(
          { limitOrderId: o.orderId },
          'missing qty in planned limit order payload',
        );
        continue;
      }
      const plannedQty = Number(plannedQtyRaw);
      if (!Number.isFinite(plannedQty)) {
        log.warn(
          { limitOrderId: o.orderId },
          'non-numeric qty in planned limit order payload',
        );
        continue;
      }
      const order: PreviousReportOrder = {
        symbol: planned.symbol,
        side: planned.side,
        qty: plannedQty,
        status: o.status,
      };
      const priceRaw =
        planned.limitPrice !== undefined ? planned.limitPrice : planned.price;
      if (priceRaw !== undefined) {
        const price = Number(priceRaw);
        if (Number.isFinite(price)) {
          order.price = price;
        } else {
          log.warn(
            { limitOrderId: o.orderId },
            'non-numeric price in planned limit order payload',
          );
        }
      }
      if (o.cancellationReason) {
        order.reason = o.cancellationReason;
      }
      orders.push(order);
    }
    let strategyName: string | undefined;
    if (r.log) {
      try {
        const parsedLog = JSON.parse(r.log) as Partial<MainTraderDecision>;
        if (parsedLog && typeof parsedLog.strategyName === 'string') {
          strategyName = parsedLog.strategyName;
        }
      } catch (err) {
        log.warn(
          { err, reviewResultId: r.id },
          'failed to parse previous decision log',
        );
      }
    }

    const report: PreviousReport = {
      ts: r.createdAt.toISOString(),
      ...(r.shortReport !== undefined ? { shortReport: r.shortReport } : {}),
      ...(r.error !== undefined ? { error: r.error } : {}),
      ...(orders.length ? { orders } : {}),
      ...(strategyName ? { strategyName } : {}),
    };
    const currentSnapshot = snapshots[index];
    const previousSnapshot = snapshots[index + 1];
    if (
      currentSnapshot &&
      typeof currentSnapshot.pnlUsd === 'number' &&
      previousSnapshot &&
      typeof previousSnapshot.pnlUsd === 'number'
    ) {
      report.pnlShiftUsd = currentSnapshot.pnlUsd - previousSnapshot.pnlUsd;
    }
    previousReports.push(report);
  }

  const nonStableTokens = tokens.filter((t) => !isStablecoin(t));
  const decisionInterval = normalizeDecisionInterval(row.reviewInterval);
  const ltfFrames = pickLtf(decisionInterval);
  const reports: PromptReport[] = [];
  if (nonStableTokens.length) {
    const tokenReports = await Promise.all(
      nonStableTokens.map(async (token) => ({
        token,
        news: await getNewsContextWithCache(token, log),
      })),
    );
    reports.push(...tokenReports);
  }

  const stablecoinOracleReport = await buildStablecoinOracleReport(cash, log);
  if (stablecoinOracleReport) {
    reports.push(stablecoinOracleReport);
  }

  const prompt: RebalancePrompt = {
    reviewInterval: decisionInterval,
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

  let marketOverview = createEmptyMarketOverview(new Date(), decisionInterval);
  let fearGreedIndex: { value: number; classification: string } | undefined;
  if (nonStableTokens.length) {
    try {
      marketOverview = await fetchMarketOverview(nonStableTokens, {
        decisionInterval,
        ltfFrames,
      });
    } catch (err) {
      log.error({ err }, 'failed to fetch market overview');
    }
  }
  prompt.marketData.marketOverview = marketOverview;

  try {
    const res = await fetchFearGreedIndex();
    if (Number.isFinite(res.value)) {
      fearGreedIndex = res;
    }
  } catch (err) {
    log.error({ err }, 'failed to fetch fear & greed index');
  }
  if (fearGreedIndex) {
    prompt.marketData.fearGreedIndex = fearGreedIndex;
  }

  return prompt;
}

function extractResult(
  provider: RunParams['aiProvider'],
  res: string,
): MainTraderDecision | null {
  const parsed = extractAiJson<{ result?: MainTraderDecision }>(provider, res);
  if (!parsed) return null;
  return parsed.result ?? null;
}

export async function run(
  { log, model, apiKey, aiProvider }: RunParams,
  prompt: RebalancePrompt,
  instructionsOverride?: string,
): Promise<MainTraderDecision | null> {
  const instructions = instructionsOverride?.trim()
    ? instructionsOverride
    : developerInstructions;
  const res = await callAi(
    aiProvider,
    model,
    instructions,
    rebalanceResponseSchema,
    prompt,
    apiKey,
    true,
  );
  const decision = extractResult(aiProvider, res);
  if (!decision) {
    log.error('main trader returned invalid response');
    return null;
  }
  return decision;
}
