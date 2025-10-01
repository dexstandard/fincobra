import NodeCache from 'node-cache';

import { fetchPairData } from './binance-client.js';
import type { Kline } from './binance-client.types.js';
import type {
  MarketOverviewPayload,
  MarketOverviewToken,
  MarketOverviewTrendFrame,
} from './indicators.types.js';

const HOUR_INTERVAL_LIMIT = 1000;
const HOUR_BASELINE = 24 * 30;

const TIMEFRAME: MarketOverviewPayload['timeframe'] = {
  candle_interval: '1h',
  review_interval: '30m',
  semantics:
    'All base fields are computed on 1h candles for a 30m decision cadence. Higher-timeframe (HTF) context adds 4h/1d/1w trend and 30d/90d/180d/365d returns.',
};

const DERIVATIONS: MarketOverviewPayload['derivations'] = {
  trend_slope_rule:
    "Compute SMA50 and SMA200 on 1h candles. gap_pct = (SMA50 - SMA200) / SMA200 * 100. trend_slope = 'up' if gap_pct > +0.5, 'down' if gap_pct < -0.5, else 'flat'.",
  ret1h_rule: 'ret1h = (last_price / price_1h_ago) - 1 (decimal).',
  ret24h_rule: 'ret24h = (last_price / price_24h_ago) - 1 (decimal).',
  vol_atr_pct_rule: 'vol_atr_pct = ATR(14) / last_price * 100 (percent).',
  vol_anomaly_z_rule: 'Z-score of last 1h volume vs a 30-day hourly baseline.',
  rsi14_rule: 'Standard 14-period RSI on 1h candles.',
  orderbook_spread_bps_rule:
    '((best_ask - best_bid) / mid_price) * 10_000 (basis points).',
  orderbook_depth_ratio_rule:
    'bid_top_qty / ask_top_qty (top-of-book sizes).',
  htf_returns_rule:
    'On daily closes (UTC): ret_30d = (close_t / close_t-30d) - 1, similarly for 90d/180d/365d (decimals).',
  htf_trend_rule:
    "For each frame f in {4h,1d,1w}, compute SMA_fast and SMA_slow on that frame and set: gap_pct_f = (SMA_fast - SMA_slow) / SMA_slow * 100. slope_f = 'up' if gap_pct_f > +0.5, 'down' if gap_pct_f < -0.5, else 'flat'. Recommended pairs: 4h:[50,200], 1d:[20,100], 1w:[13,52].",
  regime_vol_state_rule:
    "Compute realized volatility (stdev of log returns) on daily closes over a 30-day lookback. Rank it within a 365-day window to get vol_rank_1y in [0,1]. vol_state = 'depressed' if vol_rank_1y < 0.2, 'normal' if 0.2–0.7, 'elevated' if > 0.7.",
  regime_corr_beta_rule:
    'corr_btc_90d = Pearson correlation of daily log returns versus BTC over last 90 days. market_beta_90d from OLS: r_asset = alpha + beta * r_btc using daily log returns over last 90 days.',
  risk_flags_rules: {
    overbought: 'rsi14 >= 75',
    oversold: 'rsi14 <= 25',
    vol_spike: 'vol_atr_pct >= 3.0',
    thin_book: 'orderbook_spread_bps > 10 OR orderbook_depth_ratio < 0.5',
  },
};

const SPEC: MarketOverviewPayload['_spec'] = {
  units: {
    ret1h: 'decimal (e.g., -0.012 = -1.2%)',
    ret24h: 'decimal',
    vol_atr_pct: 'percent',
    vol_anomaly_z: 'z-score',
    rsi14: '0–100',
    orderbook_spread_bps: 'basis points',
    orderbook_depth_ratio: 'ratio',
    'htf.returns.30d|90d|180d|365d': 'decimal',
    'htf.trend.gap_pct_(4h|1d|1w)': 'percent',
    "htf.trend.slope_(4h|1d|1w)": "enum('up','flat','down')",
    'htf.regime.vol_state': "enum('depressed','normal','elevated')",
    'htf.regime.vol_rank_1y': '0–1 (percentile)',
    'htf.regime.corr_btc_90d': '[-1,1]',
    'htf.regime.market_beta_90d': 'float',
  },
  interpretation: {
    trend_slope: 'Multi-day trend on 1h timeframe (SMA50 vs SMA200).',
    risk_flags: 'Boolean guards for sizing/filters; not trade triggers.',
    htf: 'Condensed month/quarter/half-year/year context to gate strategies and sizing.',
  },
};

const MARKET_OVERVIEW_CACHE_TTL_SEC = 60;
const MARKET_OVERVIEW_CACHE_CHECK_PERIOD = Math.max(
  1,
  Math.ceil(MARKET_OVERVIEW_CACHE_TTL_SEC / 2),
);

interface CachedTokenOverview {
  overview: MarketOverviewToken;
  generatedAt: string;
  contextKey: string;
}

type PairData = Awaited<ReturnType<typeof fetchPairData>>;

interface CachedBtcContext {
  pair: PairData;
  dailyCloses: number[];
  dailyLogs: number[];
  generatedAt: string;
  cacheKey: string;
}

const tokenOverviewCache = new NodeCache({
  stdTTL: MARKET_OVERVIEW_CACHE_TTL_SEC,
  checkperiod: MARKET_OVERVIEW_CACHE_CHECK_PERIOD,
  useClones: false,
});

const btcContextCache = new NodeCache({
  stdTTL: MARKET_OVERVIEW_CACHE_TTL_SEC,
  checkperiod: MARKET_OVERVIEW_CACHE_CHECK_PERIOD,
  useClones: false,
});

const pendingTokenFetches = new Map<string, Promise<CachedTokenOverview>>();
let pendingBtcContext: Promise<CachedBtcContext> | null = null;

function buildTokenPendingKey(token: string, contextKey: string): string {
  return `${token}|${contextKey}`;
}

function setTokenCache(token: string, value: CachedTokenOverview) {
  tokenOverviewCache.set<CachedTokenOverview>(token, value);
}

async function getBtcContext(): Promise<CachedBtcContext> {
  const cacheKey = 'BTC_CONTEXT';
  const cached = btcContextCache.get<CachedBtcContext>(cacheKey);
  if (cached) {
    return cached;
  }
  if (!pendingBtcContext) {
    pendingBtcContext = (async () => {
      const pair = await fetchPairData('BTC', 'USDT');
      const dailyCloses = pair.year.map((k) => Number(k[4]));
      const dailyLogs = logReturns(dailyCloses);
      const generatedAt = new Date().toISOString();
      const context: CachedBtcContext = {
        pair,
        dailyCloses,
        dailyLogs,
        generatedAt,
        cacheKey: `${generatedAt}:${pair.year[pair.year.length - 1]?.[0] ?? ''}`,
      };
      btcContextCache.set<CachedBtcContext>(cacheKey, context);
      return context;
    })().finally(() => {
      pendingBtcContext = null;
    });
  }
  return pendingBtcContext!;
}

async function computeTokenOverview(
  token: string,
  btcContext: CachedBtcContext,
): Promise<CachedTokenOverview> {
  const pair =
    token === 'BTC' ? btcContext.pair : await fetchPairData(token, 'USDT');
  const symbol = pair.symbol;
  const [hourKlines, h4Klines, dayKlines, weekKlines] = await Promise.all([
    fetchIntervalKlines(symbol, '1h', HOUR_INTERVAL_LIMIT),
    fetchIntervalKlines(symbol, '4h', 210),
    fetchIntervalKlines(symbol, '1d', 150),
    fetchIntervalKlines(symbol, '1w', 60),
  ]);
  const tokenDailyCloses = pair.year.map((k) => Number(k[4]));
  const overview = buildTokenOverview(
    pair.currentPrice,
    hourKlines,
    h4Klines,
    dayKlines,
    weekKlines,
    tokenDailyCloses,
    btcContext.dailyLogs,
  );

  const bestBid = pair.orderBook.bids[0] as [number, number] | undefined;
  const bestAsk = pair.orderBook.asks[0] as [number, number] | undefined;
  const bidPrice = bestBid?.[0] ?? pair.currentPrice;
  const askPrice = bestAsk?.[0] ?? pair.currentPrice;
  const bidQty = bestBid?.[1] ?? 0;
  const askQty = bestAsk?.[1] ?? 1;
  const mid = (bidPrice + askPrice) / 2 || pair.currentPrice || 1;
  overview.orderbook_spread_bps = mid
    ? ((askPrice - bidPrice) / mid) * 10_000
    : 0;
  overview.orderbook_depth_ratio = askQty === 0 ? 0 : bidQty / askQty;
  overview.risk_flags = computeRiskFlags(overview);

  return {
    overview,
    generatedAt: new Date().toISOString(),
    contextKey: btcContext.cacheKey,
  };
}

async function loadTokenOverview(
  token: string,
  btcContext: CachedBtcContext,
): Promise<CachedTokenOverview> {
  const cacheKey = token.toUpperCase();
  const cached = tokenOverviewCache.get<CachedTokenOverview>(cacheKey);
  if (cached && cached.contextKey === btcContext.cacheKey) {
    return cached;
  }

  const pendingKey = buildTokenPendingKey(cacheKey, btcContext.cacheKey);
  let pending = pendingTokenFetches.get(pendingKey);
  if (!pending) {
    pending = computeTokenOverview(cacheKey, btcContext)
      .then((result) => {
        setTokenCache(cacheKey, result);
        return result;
      })
      .finally(() => {
        pendingTokenFetches.delete(pendingKey);
      });
    pendingTokenFetches.set(pendingKey, pending);
  }
  const result = await pending;
  if (result.contextKey !== btcContext.cacheKey) {
    return loadTokenOverview(token, btcContext);
  }
  return result;
}

export function createEmptyMarketOverview(
  asOf: Date = new Date(),
): MarketOverviewPayload {
  return {
    schema_version: 'market_overview.v2',
    as_of: asOf.toISOString(),
    timeframe: TIMEFRAME,
    derivations: DERIVATIONS,
    _spec: SPEC,
    market_overview: {},
  };
}

async function fetchIntervalKlines(
  symbol: string,
  interval: string,
  limit: number,
): Promise<Kline[]> {
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`failed to fetch ${interval} klines: ${res.status} ${body}`);
  }
  return (await res.json()) as Kline[];
}

function sliceMean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((sum, value) => sum + value, 0) / arr.length;
}

function calcSma(series: number[], period: number): number {
  if (series.length < period) {
    return sliceMean(series);
  }
  const slice = series.slice(series.length - period);
  return sliceMean(slice);
}

function calcReturn(series: number[], periodsAgo: number, current: number): number {
  if (series.length <= periodsAgo) return 0;
  const past = series[series.length - 1 - periodsAgo];
  if (past === 0) return 0;
  return current / past - 1;
}

function calcAtr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number {
  if (highs.length < 2 || lows.length < 2 || closes.length < 2) return 0;
  const start = Math.max(1, highs.length - period);
  const trs: number[] = [];
  for (let i = start; i < highs.length; i++) {
    const h = highs[i];
    const l = lows[i];
    const prev = closes[i - 1];
    const tr = Math.max(h - l, Math.abs(h - prev), Math.abs(l - prev));
    trs.push(tr);
  }
  return sliceMean(trs);
}

function calcRsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function volumeZ(volumes: number[], lookback: number): number {
  const window = Math.min(lookback, volumes.length - 1);
  if (window <= 1) return 0;
  const slice = volumes.slice(volumes.length - 1 - window, volumes.length - 1);
  const mean = sliceMean(slice);
  const variance = sliceMean(slice.map((v) => (v - mean) ** 2));
  const std = Math.sqrt(variance) || 1;
  const last = volumes[volumes.length - 1];
  return (last - mean) / std;
}

function logReturns(closes: number[]): number[] {
  const res: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const current = closes[i];
    if (prev === 0) res.push(0);
    else res.push(Math.log(current / prev));
  }
  return res;
}

function stddev(values: number[]): number {
  if (!values.length) return 0;
  const mean = sliceMean(values);
  const variance = sliceMean(values.map((v) => (v - mean) ** 2));
  return Math.sqrt(variance);
}

function realizedVol(logs: number[]): number {
  if (!logs.length) return 0;
  return stddev(logs) * Math.sqrt(365);
}

function percentileRank(series: number[], value: number): number {
  if (!series.length) return 0;
  const count = series.filter((v) => v <= value).length;
  return count / series.length;
}

function computeTrendFrame(
  closes: number[],
  fast: number,
  slow: number,
  periods: [number, number],
): MarketOverviewTrendFrame {
  if (closes.length < slow) {
    return { sma_periods: periods, gap_pct: 0, slope: 'flat' };
  }
  const smaFast = calcSma(closes, fast);
  const smaSlow = calcSma(closes, slow) || 1;
  const gap = ((smaFast - smaSlow) / smaSlow) * 100;
  let slope: MarketOverviewTrendFrame['slope'] = 'flat';
  if (gap > 0.5) slope = 'up';
  else if (gap < -0.5) slope = 'down';
  return { sma_periods: periods, gap_pct: gap, slope };
}

function calcCorrelation(asset: number[], market: number[]): number {
  const n = Math.min(asset.length, market.length);
  if (n === 0) return 0;
  const a = asset.slice(asset.length - n);
  const b = market.slice(market.length - n);
  const meanA = sliceMean(a);
  const meanB = sliceMean(b);
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  if (denA === 0 || denB === 0) return 0;
  return num / Math.sqrt(denA * denB);
}

function calcBeta(asset: number[], market: number[]): number {
  const n = Math.min(asset.length, market.length);
  if (n === 0) return 0;
  const a = asset.slice(asset.length - n);
  const b = market.slice(market.length - n);
  const meanA = sliceMean(a);
  const meanB = sliceMean(b);
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varB += db * db;
  }
  if (varB === 0) return 0;
  return cov / varB;
}

function computeRiskFlags(token: MarketOverviewToken): MarketOverviewToken['risk_flags'] {
  return {
    overbought: token.rsi14 >= 75,
    oversold: token.rsi14 <= 25,
    vol_spike: token.vol_atr_pct >= 3,
    thin_book:
      token.orderbook_spread_bps > 10 || token.orderbook_depth_ratio < 0.5,
  };
}

function buildTokenOverview(
  current: number,
  hourKlines: Kline[],
  h4Klines: Kline[],
  dayKlines: Kline[],
  weekKlines: Kline[],
  dailyCloses: number[],
  btcDailyLogs: number[],
): MarketOverviewToken {
  const closes1h = hourKlines.map((k) => Number(k[4]));
  const highs1h = hourKlines.map((k) => Number(k[2]));
  const lows1h = hourKlines.map((k) => Number(k[3]));
  const volumes1h = hourKlines.map((k) => Number(k[5]));
  const latestHourClose = closes1h[closes1h.length - 1] ?? current;
  const ret1h = calcReturn(closes1h, 1, latestHourClose);
  const ret24h = calcReturn(closes1h, 24, latestHourClose);
  const sma50 = calcSma(closes1h, 50);
  const sma200 = calcSma(closes1h, 200) || 1;
  const gapPct = ((sma50 - sma200) / sma200) * 100;
  let trendSlope: MarketOverviewToken['trend_slope'] = 'flat';
  if (gapPct > 0.5) trendSlope = 'up';
  else if (gapPct < -0.5) trendSlope = 'down';
  const priceForVol = latestHourClose || current || 1;
  const volAtrPct = priceForVol
    ? (calcAtr(highs1h, lows1h, closes1h) / priceForVol) * 100
    : 0;
  const volAnomalyZ = volumeZ(volumes1h, HOUR_BASELINE);
  const rsi14 = calcRsi(closes1h);

  const latestDailyClose = dailyCloses[dailyCloses.length - 1] ?? current;

  const token: MarketOverviewToken = {
    trend_slope: trendSlope,
    trend_basis: { sma_periods: [50, 200], gap_pct: gapPct },
    ret1h,
    ret24h,
    vol_atr_pct: volAtrPct,
    vol_anomaly_z: volAnomalyZ,
    rsi14,
    orderbook_spread_bps: 0,
    orderbook_depth_ratio: 0,
    risk_flags: { overbought: false, oversold: false, vol_spike: false, thin_book: false },
    htf: {
      returns: {
        '30d': calcReturn(dailyCloses, 30, latestDailyClose),
        '90d': calcReturn(dailyCloses, 90, latestDailyClose),
        '180d': calcReturn(dailyCloses, 180, latestDailyClose),
        '365d': calcReturn(dailyCloses, 365, latestDailyClose),
      },
      trend: {
        '4h': computeTrendFrame(
          h4Klines.map((k) => Number(k[4])),
          50,
          200,
          [50, 200],
        ),
        '1d': computeTrendFrame(
          dayKlines.map((k) => Number(k[4])),
          20,
          100,
          [20, 100],
        ),
        '1w': computeTrendFrame(
          weekKlines.map((k) => Number(k[4])),
          13,
          52,
          [13, 52],
        ),
      },
      regime: {
        vol_state: 'normal',
        vol_rank_1y: 0,
        corr_btc_90d: 0,
        market_beta_90d: 0,
      },
    },
  };

  const dailyLogs = logReturns(dailyCloses);
  const volSeries: number[] = [];
  const window = 30;
  for (let i = window; i <= dailyLogs.length; i++) {
    const slice = dailyLogs.slice(i - window, i);
    volSeries.push(realizedVol(slice));
  }
  const currentVol = volSeries[volSeries.length - 1] ?? realizedVol(dailyLogs);
  const volRank = percentileRank(volSeries, currentVol);
  let volState: MarketOverviewToken['htf']['regime']['vol_state'] = 'normal';
  if (volRank < 0.2) volState = 'depressed';
  else if (volRank > 0.7) volState = 'elevated';

  const assetLogs = dailyLogs.slice(-90);
  const btcLogs = btcDailyLogs.slice(-90);
  const corr = calcCorrelation(assetLogs, btcLogs);
  const beta = calcBeta(assetLogs, btcLogs);

  token.htf.regime = {
    vol_state: volState,
    vol_rank_1y: volRank,
    corr_btc_90d: corr,
    market_beta_90d: beta,
  };

  token.risk_flags = computeRiskFlags(token);

  return token;
}

export async function fetchMarketOverview(
  tokens: string[],
): Promise<MarketOverviewPayload> {
  if (!tokens.length) {
    return createEmptyMarketOverview();
  }

  const dedupedSet = new Set(tokens.map((t) => t.toUpperCase()));
  dedupedSet.add('BTC');
  const deduped = Array.from(dedupedSet);
  const btcContext = await getBtcContext();
  const entries = await Promise.all(
    deduped.map(async (token) => {
      const data = await loadTokenOverview(token, btcContext);
      return [token, data] as const;
    }),
  );

  const marketOverview = Object.fromEntries(
    entries.map(([token, data]) => [token, data.overview]),
  );

  const latestAsOf = entries.reduce<Date>((latest, [, data]) => {
    const ts = new Date(data.generatedAt);
    return ts > latest ? ts : latest;
  }, new Date(0));

  return {
    schema_version: 'market_overview.v2',
    as_of:
      latestAsOf.getTime() > 0 ? latestAsOf.toISOString() : new Date().toISOString(),
    timeframe: TIMEFRAME,
    derivations: DERIVATIONS,
    _spec: SPEC,
    market_overview: marketOverview,
  };
}

export function clearMarketOverviewCache(): void {
  tokenOverviewCache.flushAll();
  btcContextCache.flushAll();
  pendingTokenFetches.clear();
  pendingBtcContext = null;
}
