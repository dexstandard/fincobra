import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  createEmptyMarketOverview,
  fetchMarketOverview,
  clearMarketOverviewCache,
  buildTimeframe,
} from '../src/services/indicators.js';
import { fetchPairData } from '../src/services/binance-client.js';

vi.mock('../src/services/binance-client.js', () => ({
  fetchPairData: vi.fn(),
  fetchPairInfo: vi.fn().mockResolvedValue({ minNotional: 0 }),
  fetchOrder: vi.fn().mockResolvedValue(undefined),
}));

type NumericKline = [number, number, number, number, number, number];

const HOUR_LIMIT = 1_000;
const FOUR_HOUR_LIMIT = 210;
const DAY_LIMIT = 150;
const WEEK_LIMIT = 60;
const RSI_PERIOD = 14;
const ATR_PERIOD = 14;
const VOLUME_LOOKBACK = 24 * 30;
const VOL_WINDOW = 30;

interface IntervalConfig {
  closeStart: number;
  closeStep: number;
  volumeStart: number;
  volumeStep: number;
}

interface SyntheticPair {
  symbol: string;
  currentPrice: number;
  orderBook: { bids: [number, number][]; asks: [number, number][] };
  year: NumericKline[];
}

function buildKlines(length: number, config: IntervalConfig): NumericKline[] {
  return Array.from({ length }, (_, idx) => {
    const close = config.closeStart + config.closeStep * idx;
    const open = close - config.closeStep;
    const high = close + config.closeStep / 2;
    const low = close - config.closeStep / 2;
    const volume = config.volumeStart + config.volumeStep * idx;
    return [
      idx,
      Number(open.toFixed(6)),
      Number(high.toFixed(6)),
      Number(low.toFixed(6)),
      Number(close.toFixed(6)),
      Number(volume.toFixed(6)),
    ];
  });
}

function buildYearSeries(length: number, start: number, step: number) {
  return Array.from({ length }, (_, idx) => {
    const close = start + step * idx;
    return [
      idx,
      Number((close - step / 2).toFixed(6)),
      Number((close + step / 2).toFixed(6)),
      Number((close - step / 2).toFixed(6)),
      Number(close.toFixed(6)),
      1_000 + idx,
    ];
  });
}

function sliceMean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calcReturn(series: number[], periodsAgo: number, current: number) {
  const index = series.length - 1 - periodsAgo;
  const past = index >= 0 ? series[index] : series[0];
  return current / past - 1;
}

function calcSma(series: number[], period: number) {
  const slice = series.slice(-Math.min(period, series.length));
  return sliceMean(slice);
}

function computeTrendFrame(
  closes: number[],
  fast: number,
  slow: number,
  periods: [number, number],
) {
  const smaFast = calcSma(closes, fast);
  const smaSlow = calcSma(closes, slow) || 1;
  const gap = ((smaFast - smaSlow) / smaSlow) * 100;
  let slope: 'up' | 'flat' | 'down' = 'flat';
  if (gap > 0.5) slope = 'up';
  else if (gap < -0.5) slope = 'down';
  return { smaPeriods: periods, gapPct: gap, slope };
}

function calcAtr(highs: number[], lows: number[], closes: number[]) {
  const start = Math.max(1, closes.length - ATR_PERIOD);
  const ranges: number[] = [];
  for (let i = start; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    ranges.push(tr);
  }
  return sliceMean(ranges);
}

function calcRsi(closes: number[]) {
  if (closes.length < RSI_PERIOD + 1) {
    return 50;
  }
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= RSI_PERIOD; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / RSI_PERIOD;
  let avgLoss = lossSum / RSI_PERIOD;
  for (let i = RSI_PERIOD + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (RSI_PERIOD - 1) + gain) / RSI_PERIOD;
    avgLoss = (avgLoss * (RSI_PERIOD - 1) + loss) / RSI_PERIOD;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function volumeZ(volumes: number[], lookback: number) {
  const window = Math.min(lookback, volumes.length - 1);
  const slice = volumes.slice(volumes.length - 1 - window, volumes.length - 1);
  const mean = sliceMean(slice);
  const variance = sliceMean(slice.map((value) => (value - mean) ** 2));
  const std = Math.sqrt(variance) || 1;
  const last = volumes[volumes.length - 1];
  return (last - mean) / std;
}

function logReturns(closes: number[]) {
  const logs: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    logs.push(Math.log(closes[i] / closes[i - 1]));
  }
  return logs;
}

function stddev(values: number[]) {
  if (values.length === 0) return 0;
  const mean = sliceMean(values);
  const variance = sliceMean(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function realizedVol(logs: number[]) {
  return stddev(logs) * Math.sqrt(365);
}

function percentileRank(series: number[], value: number) {
  if (series.length === 0) return 0;
  const count = series.filter((entry) => entry <= value).length;
  return count / series.length;
}

function correlation(asset: number[], market: number[]) {
  const length = Math.min(asset.length, market.length);
  if (length === 0) return 0;
  const a = asset.slice(asset.length - length);
  const b = market.slice(market.length - length);
  const meanA = sliceMean(a);
  const meanB = sliceMean(b);
  let numerator = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < length; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    numerator += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  if (varianceA === 0 || varianceB === 0) return 0;
  return numerator / Math.sqrt(varianceA * varianceB);
}

function beta(asset: number[], market: number[]) {
  const length = Math.min(asset.length, market.length);
  if (length === 0) return 0;
  const a = asset.slice(asset.length - length);
  const b = market.slice(market.length - length);
  const meanA = sliceMean(a);
  const meanB = sliceMean(b);
  let covariance = 0;
  let varianceB = 0;
  for (let i = 0; i < length; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    covariance += da * db;
    varianceB += db * db;
  }
  if (varianceB === 0) return 0;
  return covariance / varianceB;
}

describe('fetchMarketOverview', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-09-20T06:15:00Z'));
    clearMarketOverviewCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearMarketOverviewCache();
  });

  it('computes every indicator using the synthetic dataset', async () => {
    const syntheticIntervals: Record<string, Record<string, NumericKline[]>> = {
      SOLUSDT: {
        '1h': buildKlines(HOUR_LIMIT, {
          closeStart: 100,
          closeStep: 0.75,
          volumeStart: 5_000,
          volumeStep: 3,
        }),
        '4h': buildKlines(FOUR_HOUR_LIMIT, {
          closeStart: 150,
          closeStep: 1.1,
          volumeStart: 1_000,
          volumeStep: 2,
        }),
        '1d': buildKlines(DAY_LIMIT, {
          closeStart: 200,
          closeStep: 2.5,
          volumeStart: 800,
          volumeStep: 2,
        }),
        '1w': buildKlines(WEEK_LIMIT, {
          closeStart: 260,
          closeStep: 3,
          volumeStart: 400,
          volumeStep: 1,
        }),
      },
      BTCUSDT: {
        '1h': buildKlines(HOUR_LIMIT, {
          closeStart: 300,
          closeStep: 0.6,
          volumeStart: 8_000,
          volumeStep: 4,
        }),
        '4h': buildKlines(FOUR_HOUR_LIMIT, {
          closeStart: 360,
          closeStep: 0.9,
          volumeStart: 1_200,
          volumeStep: 1,
        }),
        '1d': buildKlines(DAY_LIMIT, {
          closeStart: 420,
          closeStep: 1.8,
          volumeStart: 1_100,
          volumeStep: 1,
        }),
        '1w': buildKlines(WEEK_LIMIT, {
          closeStart: 470,
          closeStep: 2.2,
          volumeStart: 700,
          volumeStep: 1,
        }),
      },
    };

    const syntheticPairs: Record<string, SyntheticPair> = {
      SOL: {
        symbol: 'SOLUSDT',
        year: buildYearSeries(366, 50, 0.85),
        currentPrice: Number((50 + 0.85 * (366 - 1)).toFixed(6)),
        orderBook: {
          bids: [[Number((50 + 0.85 * (366 - 1) - 0.5).toFixed(6)), 130]],
          asks: [[Number((50 + 0.85 * (366 - 1) + 0.5).toFixed(6)), 140]],
        },
      },
      BTC: {
        symbol: 'BTCUSDT',
        year: buildYearSeries(366, 100, 0.95),
        currentPrice: Number((100 + 0.95 * (366 - 1)).toFixed(6)),
        orderBook: {
          bids: [[Number((100 + 0.95 * (366 - 1) - 0.5).toFixed(6)), 220]],
          asks: [[Number((100 + 0.95 * (366 - 1) + 0.5).toFixed(6)), 200]],
        },
      },
    };

    (fetchPairData as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (token: string) => {
        const key = token.toUpperCase();
        const pair = syntheticPairs[key];
        if (!pair) throw new Error(`missing synthetic pair for ${token}`);
        return pair;
      },
    );

    const fetchStub = vi.fn(async (url: string) => {
      const parsed = new URL(url, 'https://api.binance.com');
      const symbol = parsed.searchParams.get('symbol');
      const interval = parsed.searchParams.get('interval');
      const limit = Number(parsed.searchParams.get('limit'));
      if (!symbol || !interval) throw new Error('missing params');
      const data = syntheticIntervals[symbol]?.[interval];
      if (!data) throw new Error(`no data for ${symbol} ${interval}`);
      expect(limit).toBe(data.length);
      return { ok: true, json: async () => data } as any;
    });
    vi.stubGlobal('fetch', fetchStub);

    const payload = await fetchMarketOverview(['SOL'], {
      decisionInterval: 'PT30M',
    });

    expect(payload.schema).toBe('market_overview.v2.1');
    expect(payload.asOf).toBe('2025-09-20T06:15:00.000Z');
    expect(Object.keys(payload.marketOverview)).toEqual(['SOL', 'BTC']);

    const btcDailyCloses = syntheticPairs.BTC.year.map((k) => Number(k[4]));
    const btcDailyLogs = logReturns(btcDailyCloses);

    for (const token of ['SOL', 'BTC'] as const) {
      const symbol = syntheticPairs[token].symbol;
      const overview = payload.marketOverview[token];
      const hourSeries = syntheticIntervals[symbol]['1h'];
      const fourHourSeries = syntheticIntervals[symbol]['4h'];
      const daySeries = syntheticIntervals[symbol]['1d'];
      const weekSeries = syntheticIntervals[symbol]['1w'];
      const hourCloses = hourSeries.map((kline) => Number(kline[4]));
      const hourHighs = hourSeries.map((kline) => Number(kline[2]));
      const hourLows = hourSeries.map((kline) => Number(kline[3]));
      const hourVolumes = hourSeries.map((kline) => Number(kline[5]));
      const fourHourCloses = fourHourSeries.map((kline) => Number(kline[4]));
      const dayCloses = daySeries.map((kline) => Number(kline[4]));
      const weekCloses = weekSeries.map((kline) => Number(kline[4]));
      const dailyCloses = syntheticPairs[token].year.map((kline) => Number(kline[4]));
      const latestHourClose = hourCloses[hourCloses.length - 1];

      const ret1h = calcReturn(hourCloses, 1, latestHourClose);
      const ret24h = calcReturn(hourCloses, 24, latestHourClose);
      const sma50 = calcSma(hourCloses, 50);
      const sma200 = calcSma(hourCloses, 200);
      const gap = ((sma50 - sma200) / sma200) * 100;
      const expectedTrendSlope = gap > 0.5 ? 'up' : gap < -0.5 ? 'down' : 'flat';
      const atr = calcAtr(hourHighs, hourLows, hourCloses);
      const volAtrPct = (atr / latestHourClose) * 100;
      const volZ = volumeZ(hourVolumes, VOLUME_LOOKBACK);
      const rsi = calcRsi(hourCloses);

      const bid = syntheticPairs[token].orderBook.bids[0];
      const ask = syntheticPairs[token].orderBook.asks[0];
      const mid = (bid[0] + ask[0]) / 2;
      const spreadBps = ((ask[0] - bid[0]) / mid) * 10_000;
      const depthRatio = bid[1] / ask[1];

      const ret30 = calcReturn(dailyCloses, 30, dailyCloses[dailyCloses.length - 1]);
      const ret90 = calcReturn(dailyCloses, 90, dailyCloses[dailyCloses.length - 1]);
      const ret180 = calcReturn(dailyCloses, 180, dailyCloses[dailyCloses.length - 1]);
      const ret365 = calcReturn(dailyCloses, 365, dailyCloses[dailyCloses.length - 1]);

      const trend4h = computeTrendFrame(fourHourCloses, 50, 200, [50, 200]);
      const trend1d = computeTrendFrame(dayCloses, 20, 100, [20, 100]);
      const trend1w = computeTrendFrame(weekCloses, 13, 52, [13, 52]);

      const dailyLogs = logReturns(dailyCloses);
      const volSeries: number[] = [];
      for (let i = VOL_WINDOW; i <= dailyLogs.length; i++) {
        volSeries.push(realizedVol(dailyLogs.slice(i - VOL_WINDOW, i)));
      }
      const currentVol =
        volSeries[volSeries.length - 1] ?? realizedVol(dailyLogs);
      const volRank = percentileRank(volSeries, currentVol);
      let volState: 'depressed' | 'normal' | 'elevated' = 'normal';
      if (volRank < 0.2) volState = 'depressed';
      else if (volRank > 0.7) volState = 'elevated';

      const assetLogs = dailyLogs.slice(-90);
      const btcLogsSlice = btcDailyLogs.slice(-90);
      const corr = correlation(assetLogs, btcLogsSlice);
      const betaVal = beta(assetLogs, btcLogsSlice);

      const expectedRiskFlags = {
        overbought: rsi >= 75,
        oversold: rsi <= 25,
        volSpike: volAtrPct >= 3,
        thinBook: spreadBps > 10 || depthRatio < 0.5,
      };

      expect(overview.trendSlope).toBe(expectedTrendSlope);
      expect(overview.trendBasis.smaPeriods).toEqual([50, 200]);
      expect(overview.trendBasis.gapPct).toBeCloseTo(gap, 10);
      expect(overview.ret1h).toBeCloseTo(ret1h, 10);
      expect(overview.ret24h).toBeCloseTo(ret24h, 10);
      expect(overview.volAtrPct).toBeCloseTo(volAtrPct, 10);
      expect(overview.volAnomalyZ).toBeCloseTo(volZ, 10);
      expect(overview.rsi14).toBeCloseTo(rsi, 10);
      expect(overview.orderbookSpreadBps).toBeCloseTo(spreadBps, 10);
      expect(overview.orderbookDepthRatio).toBeCloseTo(depthRatio, 10);
      expect(overview.riskFlags).toEqual(expectedRiskFlags);

      expect(overview.htf.returns['30d']).toBeCloseTo(ret30, 10);
      expect(overview.htf.returns['90d']).toBeCloseTo(ret90, 10);
      expect(overview.htf.returns['180d']).toBeCloseTo(ret180, 10);
      expect(overview.htf.returns['365d']).toBeCloseTo(ret365, 10);

      expect(overview.htf.trend['4h'].gapPct).toBeCloseTo(
        trend4h.gapPct,
        10,
      );
      expect(overview.htf.trend['4h'].slope).toBe(trend4h.slope);
      expect(overview.htf.trend['1d'].gapPct).toBeCloseTo(
        trend1d.gapPct,
        10,
      );
      expect(overview.htf.trend['1d'].slope).toBe(trend1d.slope);
      expect(overview.htf.trend['1w'].gapPct).toBeCloseTo(
        trend1w.gapPct,
        10,
      );
      expect(overview.htf.trend['1w'].slope).toBe(trend1w.slope);

      expect(overview.htf.regime.volState).toBe(volState);
      expect(overview.htf.regime.volRank1y).toBeCloseTo(volRank, 10);
      expect(overview.htf.regime.corrBtc90d).toBeCloseTo(corr, 10);
      expect(overview.htf.regime.marketBeta90d).toBeCloseTo(betaVal, 10);
    }

    expect(fetchStub).toHaveBeenCalled();
  });

  it('provides an empty overview when no tokens are requested', () => {
    const payload = createEmptyMarketOverview(
      new Date('2024-01-01T00:00:00Z'),
      'PT30M',
    );
    expect(payload.marketOverview).toEqual({});
    expect(payload.asOf).toBe('2024-01-01T00:00:00.000Z');
    expect(payload.timeframe).toEqual(buildTimeframe('PT30M'));
  });

  it('throws when decision interval is missing', async () => {
    await expect(fetchMarketOverview(['SOL'])).rejects.toThrow(
      'decisionInterval is required when fetching market overview',
    );
  });

  it('builds timeframe metadata for arbitrary decision intervals', () => {
    const timeframe = buildTimeframe('PT45M');
    expect(timeframe.candleInterval).toBe('1h');
    expect(timeframe.decisionInterval).toBe('PT45M');
    expect(timeframe.semantics).toContain('Base fields computed on candleInterval');
    expect(timeframe.semantics).toContain('decisions run every decisionInterval');
  });

  it('attaches low timeframe metrics when requested', async () => {
    const syntheticIntervals: Record<string, Record<string, NumericKline[]>> = {
      SOLUSDT: {
        '1h': buildKlines(HOUR_LIMIT, {
          closeStart: 100,
          closeStep: 0.8,
          volumeStart: 2_000,
          volumeStep: 3,
        }),
        '4h': buildKlines(FOUR_HOUR_LIMIT, {
          closeStart: 140,
          closeStep: 0.6,
          volumeStart: 900,
          volumeStep: 2,
        }),
        '1d': buildKlines(DAY_LIMIT, {
          closeStart: 180,
          closeStep: 1.4,
          volumeStart: 700,
          volumeStep: 2,
        }),
        '1w': buildKlines(WEEK_LIMIT, {
          closeStart: 220,
          closeStep: 1.2,
          volumeStart: 350,
          volumeStep: 1,
        }),
        '10m': buildKlines(64, {
          closeStart: 50,
          closeStep: 0.4,
          volumeStart: 500,
          volumeStep: 5,
        }),
        '30m': buildKlines(40, {
          closeStart: 75,
          closeStep: 0.6,
          volumeStart: 400,
          volumeStep: 4,
        }),
      },
      BTCUSDT: {
        '1h': buildKlines(HOUR_LIMIT, {
          closeStart: 300,
          closeStep: 0.3,
          volumeStart: 3_000,
          volumeStep: 2,
        }),
        '4h': buildKlines(FOUR_HOUR_LIMIT, {
          closeStart: 320,
          closeStep: 0.3,
          volumeStart: 1_200,
          volumeStep: 1,
        }),
        '1d': buildKlines(DAY_LIMIT, {
          closeStart: 340,
          closeStep: 0.3,
          volumeStart: 900,
          volumeStep: 1,
        }),
        '1w': buildKlines(WEEK_LIMIT, {
          closeStart: 360,
          closeStep: 0.3,
          volumeStart: 450,
          volumeStep: 1,
        }),
        '10m': buildKlines(64, {
          closeStart: 310,
          closeStep: 0.2,
          volumeStart: 1_500,
          volumeStep: 2,
        }),
        '30m': buildKlines(40, {
          closeStart: 315,
          closeStep: 0.2,
          volumeStart: 1_200,
          volumeStep: 2,
        }),
      },
    };

    const syntheticPairs: Record<string, SyntheticPair> = {
      SOL: {
        symbol: 'SOLUSDT',
        year: buildYearSeries(366, 100, 0.6),
        currentPrice: Number((100 + 0.6 * (366 - 1)).toFixed(6)),
        orderBook: {
          bids: [[Number((100 + 0.6 * (366 - 1) - 0.3).toFixed(6)), 40]],
          asks: [[Number((100 + 0.6 * (366 - 1) + 0.3).toFixed(6)), 36]],
        },
      },
      BTC: {
        symbol: 'BTCUSDT',
        year: buildYearSeries(366, 200, 0.4),
        currentPrice: Number((200 + 0.4 * (366 - 1)).toFixed(6)),
        orderBook: {
          bids: [[Number((200 + 0.4 * (366 - 1) - 0.4).toFixed(6)), 20]],
          asks: [[Number((200 + 0.4 * (366 - 1) + 0.4).toFixed(6)), 18]],
        },
      },
    };

    (fetchPairData as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (token: string) => {
        const key = token.toUpperCase();
        const pair = syntheticPairs[key];
        if (!pair) throw new Error(`missing synthetic pair for ${token}`);
        return pair;
      },
    );

    const fetchStub = vi.fn(async (url: string) => {
      const parsed = new URL(url, 'https://api.binance.com');
      const symbol = parsed.searchParams.get('symbol');
      const interval = parsed.searchParams.get('interval');
      const limit = Number(parsed.searchParams.get('limit'));
      if (!symbol || !interval) throw new Error('missing params');
      const data = syntheticIntervals[symbol]?.[interval];
      if (!data) throw new Error(`no data for ${symbol} ${interval}`);
      expect(limit).toBe(data.length);
      return { ok: true, json: async () => data } as any;
    });
    vi.stubGlobal('fetch', fetchStub);

    const payload = await fetchMarketOverview(['SOL'], {
      decisionInterval: 'PT15M',
      ltfFrames: ['30m', '10m'],
    });

    expect(payload.timeframe.decisionInterval).toBe('PT15M');
    const overview = payload.marketOverview.SOL;
    expect(overview.ltf?.frames).toEqual(['10m', '30m']);

    const closes10 = syntheticIntervals.SOLUSDT['10m'].map((k) => Number(k[4]));
    const closes30 = syntheticIntervals.SOLUSDT['30m'].map((k) => Number(k[4]));
    const last10 = closes10[closes10.length - 1];
    const last30 = closes30[closes30.length - 1];
    const expectedRet10 = calcReturn(closes10, 1, last10);
    const expectedRet30 = calcReturn(closes30, 1, last30);
    expect(overview.ltf?.ret10m).toBeCloseTo(expectedRet10, 10);
    expect(overview.ltf?.ret30m).toBeCloseTo(expectedRet30, 10);

    const expectedRsi10 = calcRsi(closes10);
    const expectedRsi30 = calcRsi(closes30);
    expect(overview.ltf?.rsi10m).toBeCloseTo(expectedRsi10, 10);
    expect(overview.ltf?.rsi30m).toBeCloseTo(expectedRsi30, 10);

    const trend10 = computeTrendFrame(closes10, 12, 48, [12, 48]);
    const trend30 = computeTrendFrame(closes30, 6, 24, [6, 24]);
    expect(overview.ltf?.slope10m).toBe(trend10.slope);
    expect(overview.ltf?.slope30m).toBe(trend30.slope);

    const slopeScore = (slope: 'up' | 'flat' | 'down', weight: number) => {
      if (slope === 'up') return weight;
      if (slope === 'down') return -weight;
      return 0;
    };
    const contributions = [
      slopeScore(overview.trendSlope, 1),
      slopeScore(overview.htf.trend['4h'].slope, 1),
      slopeScore(overview.ltf?.slope10m ?? 'flat', 0.5),
      slopeScore(overview.ltf?.slope30m ?? 'flat', 0.5),
    ];
    const expectedAlignment =
      contributions.reduce((sum, value) => sum + value, 0) / contributions.length;
    expect(overview.ltf?.alignmentScore).toBeCloseTo(expectedAlignment, 10);
  });

  it('caches token overviews to avoid duplicate fetches within the TTL', async () => {
    const syntheticIntervals: Record<string, Record<string, NumericKline[]>> = {
      SOLUSDT: {
        '1h': buildKlines(HOUR_LIMIT, {
          closeStart: 100,
          closeStep: 0.5,
          volumeStart: 1_000,
          volumeStep: 1,
        }),
        '4h': buildKlines(FOUR_HOUR_LIMIT, {
          closeStart: 120,
          closeStep: 0.5,
          volumeStart: 500,
          volumeStep: 1,
        }),
        '1d': buildKlines(DAY_LIMIT, {
          closeStart: 150,
          closeStep: 0.5,
          volumeStart: 400,
          volumeStep: 1,
        }),
        '1w': buildKlines(WEEK_LIMIT, {
          closeStart: 200,
          closeStep: 0.5,
          volumeStart: 200,
          volumeStep: 1,
        }),
        '10m': buildKlines(64, {
          closeStart: 60,
          closeStep: 0.2,
          volumeStart: 250,
          volumeStep: 2,
        }),
        '30m': buildKlines(40, {
          closeStart: 70,
          closeStep: 0.3,
          volumeStart: 220,
          volumeStep: 2,
        }),
      },
      BTCUSDT: {
        '1h': buildKlines(HOUR_LIMIT, {
          closeStart: 300,
          closeStep: 0.25,
          volumeStart: 2_000,
          volumeStep: 1,
        }),
        '4h': buildKlines(FOUR_HOUR_LIMIT, {
          closeStart: 320,
          closeStep: 0.25,
          volumeStart: 800,
          volumeStep: 1,
        }),
        '1d': buildKlines(DAY_LIMIT, {
          closeStart: 350,
          closeStep: 0.25,
          volumeStart: 600,
          volumeStep: 1,
        }),
        '1w': buildKlines(WEEK_LIMIT, {
          closeStart: 380,
          closeStep: 0.25,
          volumeStart: 300,
          volumeStep: 1,
        }),
        '10m': buildKlines(64, {
          closeStart: 305,
          closeStep: 0.1,
          volumeStart: 600,
          volumeStep: 1,
        }),
        '30m': buildKlines(40, {
          closeStart: 310,
          closeStep: 0.15,
          volumeStart: 550,
          volumeStep: 1,
        }),
      },
    };

    const syntheticPairs: Record<string, SyntheticPair> = {
      SOL: {
        symbol: 'SOLUSDT',
        year: buildYearSeries(366, 50, 0.5),
        currentPrice: Number((50 + 0.5 * (366 - 1)).toFixed(6)),
        orderBook: {
          bids: [[Number((50 + 0.5 * (366 - 1) - 0.25).toFixed(6)), 10]],
          asks: [[Number((50 + 0.5 * (366 - 1) + 0.25).toFixed(6)), 12]],
        },
      },
      BTC: {
        symbol: 'BTCUSDT',
        year: buildYearSeries(366, 100, 0.25),
        currentPrice: Number((100 + 0.25 * (366 - 1)).toFixed(6)),
        orderBook: {
          bids: [[Number((100 + 0.25 * (366 - 1) - 0.25).toFixed(6)), 20]],
          asks: [[Number((100 + 0.25 * (366 - 1) + 0.25).toFixed(6)), 18]],
        },
      },
    };

    const pairMock = fetchPairData as unknown as ReturnType<typeof vi.fn>;
    pairMock.mockImplementation(async (token: string) => {
      const key = token.toUpperCase();
      const pair = syntheticPairs[key];
      if (!pair) throw new Error(`missing synthetic pair for ${token}`);
      return pair;
    });

    const fetchStub = vi.fn(async (url: string) => {
      const parsed = new URL(url, 'https://api.binance.com');
      const symbol = parsed.searchParams.get('symbol');
      const interval = parsed.searchParams.get('interval');
      const data = symbol && interval ? syntheticIntervals[symbol]?.[interval] : null;
      if (!data) throw new Error(`no data for ${symbol} ${interval}`);
      return { ok: true, json: async () => data } as any;
    });
    vi.stubGlobal('fetch', fetchStub);

    await fetchMarketOverview(['SOL'], { decisionInterval: 'PT30M' });
    expect(pairMock).toHaveBeenCalledTimes(2);
    expect(fetchStub).toHaveBeenCalled();

    pairMock.mockClear();
    fetchStub.mockClear();

    await fetchMarketOverview(['SOL'], { decisionInterval: 'PT30M' });

    expect(pairMock).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();

    await fetchMarketOverview(['SOL'], { decisionInterval: 'PT1H' });
    expect(pairMock).toHaveBeenCalled();
    expect(fetchStub).toHaveBeenCalled();

    pairMock.mockClear();
    fetchStub.mockClear();

    await fetchMarketOverview(['SOL'], {
      decisionInterval: 'PT1H',
      ltfFrames: ['10m'],
    });
    expect(pairMock).toHaveBeenCalled();
    expect(fetchStub).toHaveBeenCalled();
  });
});
