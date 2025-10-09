import type { FastifyBaseLogger } from 'fastify';
import NodeCache from 'node-cache';
import { callAi } from '../services/openai-client.js';
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
import { getFuturesPositionsByReviewResult } from '../repos/futures-position-plan.js';
import { getNewsByToken } from '../repos/news.js';
import { getPromptForReviewResult } from '../repos/review-raw-log.js';
import type {
  ActivePortfolioWorkflow,
  TradeMode,
} from '../repos/portfolio-workflows.types.js';
import type {
  RunParams,
  RebalancePosition,
  PreviousReport,
  PreviousReportOrder,
  PreviousReportFuturesPosition,
  RebalancePrompt,
  MainTraderDecision,
  MainTraderOrder,
  MainTraderFuturesPosition,
  NewsContext,
  FuturesPromptPosition,
} from './main-trader.types.js';
import {
  computeDerivedItem,
  sortDerivedItems,
  computeWeight,
} from './news-analyst.js';

const sharedStrategyInstructions = [
  'Primary Goal: Grow total portfolio USD value and monitor PnL every decision cycle.',
  'Strategy & Decision Rules',
  '- You are a day-trading portfolio manager. Autonomously choose ANY trading strategy, set target allocations, and optionally place trades consistent with those targets.',
  '- Use the market overview dataset for price action, higher-timeframe trend, returns, and risk flags.',
  '- Use the structured news feed for event risks.',
  '- If a bearish Hack | StablecoinDepeg | Outage with severity ≥ 0.75 appears, allow protective action even if technicals are neutral.',
  '- If your chosen strategy overlaps with any recent strategies, do not follow it blindly; provide evidence of expected alpha inside the rationale.',
  'Execution Rules',
];

const spotExecutionRules = [
  '- Always check portfolio balances and policy floors before placing orders.',
  '- Supported order books are listed in the prompt (may include asset-to-asset combos like BTCSOL, not just cash pairs).',
  '- Place limit orders sized precisely to available balances. Avoid oversizing and rounding errors.',
  '- Ensure orders exceed min notional values to prevent cancellations.',
  '- Keep limit targets realistic for the review interval so orders can fill; avoid extreme/unlikely prices.',
  '- Unfilled orders are canceled before the next review (interval is provided in the prompt).',
  '- Use maxPriceDriftPct to allow a small % drift from basePrice (≥0.0001 = 0.01%) to prevent premature cancellations.',
];

const futuresExecutionRules = [
  '- Always check portfolio balances and policy floors before opening or adjusting positions.',
  '- Size leverage so margin requirements remain comfortably satisfied; avoid over-levered exposure.',
  '- Specify entryType (MARKET or LIMIT) and entryPrice for limit entries.',
  '- Provide stopLoss and takeProfit levels to bound risk for every position.',
  '- Use reduceOnly=true when closing or trimming positions so you do not accidentally flip direction.',
];

const sharedResponseInstructions = [
  'Response Specification',
  '- Return the chosen strategy name, a short report (≤255 chars), and a rationale explaining expected alpha.',
  '- On error, return error message.',
];

const spotResponseInstructions = [
  '- Return an array `orders` describing each desired limit order.',
  '- If no trade is taken, return an empty orders array.',
];

const futuresResponseInstructions = [
  '- Return an array `futures` describing each desired perpetual futures position adjustment (symbol, positionSide, qty, leverage, entryType, entryPrice for limits, stopLoss, takeProfit, reduceOnly).',
  '- If no trade is taken, return an empty futures array.',
];

export const developerInstructionsSpot = [
  ...sharedStrategyInstructions,
  ...spotExecutionRules,
  ...sharedResponseInstructions,
  ...spotResponseInstructions,
].join('\n');

export const developerInstructionsFutures = [
  ...sharedStrategyInstructions,
  ...futuresExecutionRules,
  ...sharedResponseInstructions,
  ...futuresResponseInstructions,
].join('\n');

export const developerInstructions = developerInstructionsSpot;

export function getDeveloperInstructionsForMode(mode: TradeMode): string {
  return mode === 'futures' ? developerInstructionsFutures : developerInstructionsSpot;
}

const baseDecisionProperties = {
  shortReport: { type: 'string' },
  strategyName: { type: 'string' },
  strategyRationale: { type: 'string' },
  tradeMode: { type: 'string', enum: ['spot', 'futures'] },
};

const spotDecisionSchema = {
  type: 'object',
  properties: {
    ...baseDecisionProperties,
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
  },
  required: ['orders', 'shortReport', 'strategyName', 'strategyRationale'],
  additionalProperties: false,
};

const futuresDecisionSchema = {
  type: 'object',
  properties: {
    ...baseDecisionProperties,
    futures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          positionSide: { type: 'string', enum: ['LONG', 'SHORT'] },
          qty: { type: 'number' },
          leverage: { type: 'number' },
          entryType: { type: 'string', enum: ['MARKET', 'LIMIT'] },
          entryPrice: { type: 'number' },
          reduceOnly: { type: 'boolean' },
          stopLoss: { type: 'number' },
          takeProfit: { type: 'number' },
        },
        required: ['symbol', 'positionSide', 'qty', 'leverage', 'entryType'],
        additionalProperties: false,
      },
    },
  },
  required: ['futures', 'shortReport', 'strategyName', 'strategyRationale'],
  additionalProperties: false,
};

const errorDecisionSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
  required: ['error'],
  additionalProperties: false,
};

export const rebalanceResponseSchema = {
  type: 'object',
  properties: {
    result: {
      anyOf: [spotDecisionSchema, futuresDecisionSchema, errorDecisionSchema],
    },
  },
  required: ['result'],
  additionalProperties: false,
};

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
  const isFutures = row.tradeMode === 'futures';
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

  const previousReports: PreviousReport[] = [];
  for (let index = 0; index < prevRows.length; index += 1) {
    const r = prevRows[index];
    const ordersRows = await getLimitOrdersByReviewResult(row.id, r.id);
    const orders: PreviousReportOrder[] = [];
    const futures: PreviousReportFuturesPosition[] = [];
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

    if (isFutures) {
      const futuresRows = await getFuturesPositionsByReviewResult(row.id, r.id);
      for (const fRow of futuresRows) {
        try {
          const parsedPlanned = JSON.parse(
            fRow.plannedJson,
          ) as Record<string, unknown>;
          const symbol = parsedPlanned.symbol;
          const positionSide = parsedPlanned.positionSide;
          const qty = parsedPlanned.qty;
          if (
            typeof symbol === 'string' &&
            (positionSide === 'LONG' || positionSide === 'SHORT') &&
            typeof qty === 'number'
          ) {
            futures.push({
              symbol,
              positionSide,
              qty,
              leverage:
                typeof parsedPlanned.leverage === 'number'
                  ? parsedPlanned.leverage
                  : undefined,
              entryType:
                typeof parsedPlanned.entryType === 'string'
                  ? parsedPlanned.entryType
                  : undefined,
              entryPrice:
                typeof parsedPlanned.entryPrice === 'number'
                  ? parsedPlanned.entryPrice
                  : undefined,
              stopLoss:
                typeof parsedPlanned.stopLoss === 'number'
                  ? parsedPlanned.stopLoss
                  : undefined,
              takeProfit:
                typeof parsedPlanned.takeProfit === 'number'
                  ? parsedPlanned.takeProfit
                  : undefined,
              status: fRow.status,
              positionId: fRow.positionId,
            });
          }
        } catch (err) {
          log.warn(
            { err, reviewResultId: r.id },
            'failed to parse previous futures position',
          );
        }
      }
    }

    const report: PreviousReport = {
      ts: r.createdAt.toISOString(),
      ...(r.shortReport !== undefined ? { shortReport: r.shortReport } : {}),
      ...(r.error !== undefined ? { error: r.error } : {}),
      ...(orders.length ? { orders } : {}),
      ...(futures.length ? { futures } : {}),
      ...(strategyName ? { strategyName } : {}),
    };
    const currentSnapshot = promptSnapshots[index];
    const previousSnapshot = promptSnapshots[index + 1];
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
  const reports = await Promise.all(
    nonStableTokens.map(async (token) => ({
      token,
      news: await getNewsContextWithCache(token, log),
    })),
  );

  const prompt: RebalancePrompt = {
    tradeMode: row.tradeMode,
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
  if (isFutures) {
    const futuresPositions: FuturesPromptPosition[] = [];
    prompt.futures = { positions: futuresPositions };
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

function isMainTraderOrderValue(value: unknown): value is MainTraderOrder {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.pair === 'string' &&
    typeof record.token === 'string' &&
    typeof record.side === 'string' &&
    typeof record.qty === 'number' &&
    typeof record.limitPrice === 'number' &&
    typeof record.basePrice === 'number' &&
    typeof record.maxPriceDriftPct === 'number'
  );
}

function isMainTraderFuturesPositionValue(
  value: unknown,
): value is MainTraderFuturesPosition {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.symbol === 'string' &&
    (record.positionSide === 'LONG' || record.positionSide === 'SHORT') &&
    typeof record.qty === 'number' &&
    typeof record.leverage === 'number' &&
    (record.entryType === 'MARKET' || record.entryType === 'LIMIT')
  );
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
    const result = (parsed as Record<string, unknown>).result as
      | Record<string, unknown>
      | undefined;
    if (!result) return null;

    if (typeof result.error === 'string') {
      return null;
    }

    const shortReport = result.shortReport;
    const strategyName = result.strategyName;
    const strategyRationale = result.strategyRationale;
    if (
      typeof shortReport !== 'string' ||
      typeof strategyName !== 'string' ||
      typeof strategyRationale !== 'string'
    ) {
      return null;
    }

    const requestedMode =
      result.tradeMode === 'futures' ? 'futures' : 'spot';

    if (Array.isArray(result.orders)) {
      const orders = result.orders.filter(isMainTraderOrderValue);
      return {
        tradeMode: 'spot',
        orders,
        shortReport,
        strategyName,
        strategyRationale,
      };
    }

    if (Array.isArray(result.futures)) {
      const futures = result.futures.filter(isMainTraderFuturesPositionValue);
      return {
        tradeMode: 'futures',
        futures,
        shortReport,
        strategyName,
        strategyRationale,
      };
    }

    if (requestedMode === 'futures') {
      return {
        tradeMode: 'futures',
        futures: [],
        shortReport,
        strategyName,
        strategyRationale,
      };
    }

    return {
      tradeMode: 'spot',
      orders: [],
      shortReport,
      strategyName,
      strategyRationale,
    };
  } catch {
    return null;
  }
}

export async function run(
  { log, model, apiKey, tradeMode }: RunParams,
  prompt: RebalancePrompt,
  instructionsOverride?: string,
): Promise<MainTraderDecision | null> {
  const mode = prompt.tradeMode ?? tradeMode;
  const instructions = instructionsOverride?.trim()
    ? instructionsOverride
    : getDeveloperInstructionsForMode(mode ?? 'spot');
  const res = await callAi(
    model,
    instructions,
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
