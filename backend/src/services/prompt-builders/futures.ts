import type { FastifyBaseLogger } from 'fastify';

import type { ActivePortfolioWorkflow } from '../../repos/portfolio-workflows.types.js';
import { getRecentReviewResults } from '../../repos/review-result.js';
import type { ReviewResultSummary } from '../../repos/review-result.types.js';
import type { FuturesTraderPrompt } from '../../agents/futures-trader.types.js';
import {
  getExchangeGateway,
  type SupportedExchange,
} from '../exchange-gateway.js';
import type {
  ExchangeFuturesWallet,
  ExchangeFuturesWalletCoin,
} from '../exchange-gateway.types.js';

const WALLET_CACHE_TTL_MS = 30_000;
const MARKET_CACHE_TTL_MS = 15_000;
const ERROR_CACHE_TTL_MS = 5_000;

interface WalletCacheEntry {
  expiresAt: number;
  value: ExchangeFuturesWallet | null;
}

interface MarketCacheEntry {
  expiresAt: number;
  value: number | null;
}

const walletCache = new Map<string, WalletCacheEntry>();
const pendingWalletFetch = new Map<string, Promise<ExchangeFuturesWallet | null>>();
const marketCache = new Map<string, MarketCacheEntry>();
const pendingMarketFetch = new Map<string, Promise<number | null>>();

function cacheKey(exchange: SupportedExchange, userId: string): string {
  return `${exchange}:${userId}`;
}

function marketKey(exchange: SupportedExchange, symbol: string): string {
  return `${exchange}:${symbol.toUpperCase()}`;
}

function toFinite(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
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
    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }
    return legacyMatch[2].toLowerCase() === 'h' ? amount * 60 : amount;
  }
  return null;
}

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

async function fetchWallet(
  exchange: SupportedExchange,
  userId: string,
  log: FastifyBaseLogger,
): Promise<ExchangeFuturesWallet | null> {
  const key = cacheKey(exchange, userId);
  const now = Date.now();
  const cached = walletCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const pending = pendingWalletFetch.get(key);
  if (pending) {
    return pending;
  }

  const gateway = getExchangeGateway(exchange);
  if (!gateway.futures || typeof gateway.futures.fetchWallet !== 'function') {
    log.error({ exchange }, 'exchange does not support futures wallet fetch');
    walletCache.set(key, { value: null, expiresAt: now + ERROR_CACHE_TTL_MS });
    return null;
  }

  const fetchPromise = gateway.futures
    .fetchWallet(userId)
    .then((value) => {
      walletCache.set(key, {
        value,
        expiresAt: Date.now() + WALLET_CACHE_TTL_MS,
      });
      return value;
    })
    .catch((err) => {
      log.error({ err, exchange }, 'failed to fetch futures wallet');
      walletCache.set(key, { value: null, expiresAt: Date.now() + ERROR_CACHE_TTL_MS });
      return null;
    })
    .finally(() => {
      pendingWalletFetch.delete(key);
    });

  pendingWalletFetch.set(key, fetchPromise);
  return fetchPromise;
}

async function fetchMarkPrice(
  exchange: SupportedExchange,
  symbol: string,
  log: FastifyBaseLogger,
): Promise<number | null> {
  const key = marketKey(exchange, symbol);
  const now = Date.now();
  const cached = marketCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const pending = pendingMarketFetch.get(key);
  if (pending) {
    return pending;
  }

  const gateway = getExchangeGateway(exchange);
  const fetchPromise = gateway.metadata
    .fetchTicker(symbol)
    .then((ticker) => {
      const price = toFinite(ticker.price) ?? null;
      marketCache.set(key, {
        value: price,
        expiresAt: Date.now() + MARKET_CACHE_TTL_MS,
      });
      return price;
    })
    .catch((err) => {
      log.error({ err, exchange, symbol }, 'failed to fetch mark price');
      marketCache.set(key, {
        value: null,
        expiresAt: Date.now() + ERROR_CACHE_TTL_MS,
      });
      return null;
    })
    .finally(() => {
      pendingMarketFetch.delete(key);
    });

  pendingMarketFetch.set(key, fetchPromise);
  return fetchPromise;
}

function mapWalletBalances(
  wallet: ExchangeFuturesWallet | null,
): FuturesTraderPrompt['portfolio']['balances'] {
  if (!wallet) return [];
  return wallet.coins
    .map((coin) => mapWalletCoin(coin))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

function mapWalletCoin(
  coin: ExchangeFuturesWalletCoin,
): FuturesTraderPrompt['portfolio']['balances'][number] | null {
  const balance =
    toFinite(coin.walletBalance) ?? toFinite(coin.equity) ?? toFinite(coin.availableToTrade);
  const available =
    toFinite(coin.availableBalance) ??
    toFinite(coin.availableToTrade) ??
    toFinite(coin.availableToWithdraw);
  if (balance === undefined || available === undefined) {
    return null;
  }
  return {
    asset: coin.asset,
    balance,
    availableBalance: available,
    ...(toFinite(coin.unrealizedPnl) !== undefined
      ? { unrealizedPnl: toFinite(coin.unrealizedPnl) }
      : {}),
  };
}

function pickWalletBalanceUsd(wallet: ExchangeFuturesWallet | null): number {
  if (!wallet) return 0;
  const preferred =
    toFinite(wallet.totalEquity) ??
    toFinite(wallet.totalWalletBalance) ??
    toFinite(wallet.totalMarginBalance) ??
    toFinite(wallet.totalAvailableBalance);
  if (preferred !== undefined) {
    return preferred;
  }
  return wallet.coins.reduce((sum, coin) => {
    const balance = toFinite(coin.walletBalance) ?? toFinite(coin.equity);
    if (balance === undefined) {
      return sum;
    }
    return sum + balance;
  }, 0);
}

function mapPreviousReports(rows: ReviewResultSummary[]): FuturesTraderPrompt['previousReports'] {
  if (!rows.length) return undefined;
  return rows.map((row) => {
    const entry: NonNullable<FuturesTraderPrompt['previousReports']>[number] = {
      ts: row.createdAt.toISOString(),
    };
    if (row.shortReport) {
      entry.shortReport = row.shortReport;
    }
    if (row.error?.message) {
      entry.error = row.error.message;
    }
    if (row.log) {
      try {
        const parsed = JSON.parse(row.log) as { strategyName?: string };
        if (parsed && typeof parsed.strategyName === 'string') {
          entry.strategyName = parsed.strategyName;
        }
      } catch {
        // ignore malformed logs
      }
    }
    return entry;
  });
}

async function fetchMarkPrices(
  row: ActivePortfolioWorkflow,
  exchange: SupportedExchange,
  log: FastifyBaseLogger,
): Promise<Record<string, number>> {
  if (!row.tokens.length) {
    return {};
  }
  const cash = row.cashToken.toUpperCase();
  const symbols = row.tokens
    .map((token) => `${token.token.toUpperCase()}${cash}`)
    .map((symbol) => symbol.toUpperCase());

  const results = await Promise.all(
    symbols.map(async (symbol) => ({
      symbol,
      price: await fetchMarkPrice(exchange, symbol, log),
    })),
  );

  return results.reduce<Record<string, number>>((acc, result) => {
    if (result.price !== null) {
      acc[result.symbol] = result.price;
    }
    return acc;
  }, {});
}

export async function buildFuturesPrompt(
  row: ActivePortfolioWorkflow,
  exchange: SupportedExchange,
  log: FastifyBaseLogger,
): Promise<FuturesTraderPrompt | undefined> {
  const decisionInterval = normalizeDecisionInterval(row.reviewInterval);

  const [wallet, previousResults] = await Promise.all([
    fetchWallet(exchange, row.userId, log),
    getRecentReviewResults(row.id, 5),
  ]);

  if (!wallet) {
    log.error('missing futures wallet data');
    return undefined;
  }

  const balances = mapWalletBalances(wallet);
  const markPrices = await fetchMarkPrices(row, exchange, log);

  const prompt: FuturesTraderPrompt = {
    reviewInterval: decisionInterval,
    portfolio: {
      ts: new Date().toISOString(),
      walletBalanceUsd: pickWalletBalanceUsd(wallet),
      balances,
      positions: [],
    },
    fundingRates: [],
    riskLimits: [],
    policy: {
      ...(row.futuresDefaultLeverage !== null
        ? { maxLeverage: row.futuresDefaultLeverage }
        : {}),
      ...(row.startBalance !== null ? { maxExposureUsd: row.startBalance } : {}),
    },
  };

  if (Object.keys(markPrices).length) {
    prompt.marketData = { markPrices };
  }

  const prevReports = mapPreviousReports(previousResults);
  if (prevReports) {
    prompt.previousReports = prevReports;
  }

  return prompt;
}

export function clearFuturesPromptCaches(): void {
  walletCache.clear();
  pendingWalletFetch.clear();
  marketCache.clear();
  pendingMarketFetch.clear();
}
