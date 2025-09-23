import {fetchPairData, type Kline} from './binance.js';
import type {TokenIndicators} from './indicators.types.js';

function pctChange(current: number, past: number) {
  return ((current - past) / past) * 100;
}

function sliceMean(arr: number[]) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function calcRet(series: number[], periodsAgo: number, current: number) {
  const past = series[series.length - 1 - periodsAgo];
  return pctChange(current, past);
}

function calcSmaDist(series: number[], period: number, current: number) {
  const slice = series.slice(-period);
  const sma = sliceMean(slice);
  return pctChange(current, sma);
}

function emaSeries(values: number[], period: number) {
  const k = 2 / (period + 1);
  const ema: number[] = [];
  let prev = values[0];
  ema.push(prev);
  for (let i = 1; i < values.length; i++) {
    const val = values[i] * k + prev * (1 - k);
    ema.push(val);
    prev = val;
  }
  return ema;
}

function calcMacdHist(closes: number[]) {
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macd = ema12.map((v, i) => v - ema26[i]);
  const signal = emaSeries(macd, 9);
  return macd[macd.length - 1] - signal[signal.length - 1];
}

function realizedVol(closes: number[], days: number) {
  const returns: number[] = [];
  for (let i = closes.length - days; i < closes.length; i++) {
    const prev = closes[i - 1];
    returns.push(Math.log(closes[i] / prev));
  }
  const mean = sliceMean(returns);
  const variance = sliceMean(returns.map((r) => (r - mean) ** 2));
  return Math.sqrt(variance) * Math.sqrt(365) * 100;
}

function calcAtr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
) {
  const trs: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    const h = highs[i];
    const l = lows[i];
    const prev = closes[i - 1];
    const tr = Math.max(h - l, Math.abs(h - prev), Math.abs(l - prev));
    trs.push(tr);
  }
  return sliceMean(trs);
}

function bollingerBandwidth(closes: number[], period: number) {
  const slice = closes.slice(-period);
  const sma = sliceMean(slice);
  const variance = sliceMean(slice.map((v) => (v - sma) ** 2));
  const std = Math.sqrt(variance);
  const upper = sma + 2 * std;
  const lower = sma - 2 * std;
  return ((upper - lower) / sma) * 100;
}

function donchian(
  highs: number[],
  lows: number[],
  current: number,
  period: number,
) {
  const h = Math.max(...highs.slice(-period));
  const l = Math.min(...lows.slice(-period));
  return ((h - l) / current) * 100;
}

function volumeZ(volumes: number[], lookback: number) {
  const slice = volumes.slice(-lookback - 1, -1);
  const mean = sliceMean(slice);
  const variance = sliceMean(slice.map((v) => (v - mean) ** 2));
  const std = Math.sqrt(variance) || 1;
  const last = volumes[volumes.length - 1];
  return (last - mean) / std;
}

function dailyReturns(closes: number[], periods: number) {
  const res: number[] = [];
  for (let i = closes.length - periods - 1; i < closes.length - 1; i++) {
    res.push((closes[i + 1] - closes[i]) / closes[i]);
  }
  return res;
}

function correlation(a: number[], b: number[]) {
  const meanA = sliceMean(a);
  const meanB = sliceMean(b);
  let num = 0,
    denA = 0,
    denB = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  return num / Math.sqrt(denA * denB);
}

function calcRsi(closes: number[], period = 14) {
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      gains.push(diff);
      losses.push(0);
    } else {
      gains.push(0);
      losses.push(-diff);
    }
  }
  let avgGain = sliceMean(gains.slice(0, period));
  let avgLoss = sliceMean(losses.slice(0, period));
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcStoch(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
) {
  const kVals: number[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    const h = Math.max(...highs.slice(i - period + 1, i + 1));
    const l = Math.min(...lows.slice(i - period + 1, i + 1));
    const denom = h - l || 1;
    const k = ((closes[i] - l) / denom) * 100;
    kVals.push(k);
  }
  const k = kVals[kVals.length - 1];
  const d = sliceMean(kVals.slice(-3));
  return { k, d };
}

export async function fetchTokenIndicators(token: string): Promise<TokenIndicators> {
  const pair = await fetchPairData(token, 'USDT');
  const symbol = `${token}USDT`.toUpperCase();
  const hourRes = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=200`,
  );
  if (!hourRes.ok) {
    const body = await hourRes.text();
    throw new Error(`failed to fetch hourly data: ${hourRes.status} ${body}`);
  }
  const hourJson = (await hourRes.json()) as Kline[];
  const hourCloses = hourJson.map((k) => Number(k[4]));
  const hourVolumes = hourJson.map((k) => Number(k[5]));

  const dayCloses = pair.year.map((k) => Number(k[4]));
  const dayHighs = pair.year.map((k) => Number(k[2]));
  const dayLows = pair.year.map((k) => Number(k[3]));
  const dayVolumes = pair.year.map((k) => Number(k[5]));
  const current = pair.currentPrice;

  const btc = await fetchPairData('BTC', 'USDT');
  const btcCloses = btc.year.map((k) => Number(k[4]));

  const macdHist = calcMacdHist(dayCloses);
  const volAtrPct = (calcAtr(dayHighs, dayLows, dayCloses) / current) * 100;
  const volRv7d = realizedVol(dayCloses, 7);
  const volRv30d = realizedVol(dayCloses, 30);
  const rangeBbBw = bollingerBandwidth(dayCloses, 20);
  const rangeDonchian20 = donchian(dayHighs, dayLows, current, 20);
  const volumeZ1h = volumeZ(hourVolumes, 24);
  const volumeZ24h = volumeZ(dayVolumes, 30);
  const oscRsi14 = calcRsi(dayCloses);
  const { k: oscStochK, d: oscStochD } = calcStoch(dayHighs, dayLows, dayCloses);
  const corrBtc30d = correlation(
    dailyReturns(dayCloses, 30),
    dailyReturns(btcCloses, 30),
  );
  const regimeBtc = bollingerBandwidth(btcCloses, 20) < 10 ? 'range' : 'trend';

  return {
    ret1h: calcRet(hourCloses, 1, current),
    ret4h: calcRet(hourCloses, 4, current),
    ret24h: calcRet(dayCloses, 1, current),
    ret7d: calcRet(dayCloses, 7, current),
    ret30d: calcRet(dayCloses, 30, current),
    smaDist20: calcSmaDist(dayCloses, 20, current),
    smaDist50: calcSmaDist(dayCloses, 50, current),
    smaDist200: calcSmaDist(dayCloses, 200, current),
    macdHist,
    volRv7d,
    volRv30d,
    volAtrPct,
    rangeBbBw,
    rangeDonchian20,
    volumeZ1h,
    volumeZ24h,
    corrBtc30d,
    regimeBtc,
    oscRsi14,
    oscStochK,
    oscStochD,
  };
}

export type { TokenIndicators } from './indicators.types.js';
