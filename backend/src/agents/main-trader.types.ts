import type { FastifyBaseLogger } from 'fastify';
import type { MarketOverviewPayload } from '../services/indicators.types.js';
export interface RunParams {
  log: FastifyBaseLogger;
  model: string;
  apiKey: string;
  portfolioId: string;
}

export interface RebalancePosition {
  sym: string;
  qty: number;
  priceUsdt: number;
  valueUsdt: number;
}

export interface PreviousReportOrder {
  symbol: string;
  side: string;
  qty: number;
  status: string;
  price?: number;
  reason?: string;
}

export interface PreviousReport {
  ts: string;
  orders?: PreviousReportOrder[];
  shortReport?: string;
  error?: unknown;
  strategyName?: string;
  pnlShiftUsd?: number;
}

export interface RoutePrice {
  pair: string;
  price: number;
  [token: string]: { minNotional: number } | string | number;
}

export interface MarketTimeseries {
  ret60m: number;
  ret24h: number;
  ret24m: number;
}

export interface NewsContextItem {
  title: string;
  link: string | null;
  pubDate: string | null;
  domain: string | null;
  eventType: string;
  polarity: 'bullish' | 'bearish' | 'neutral';
  severity: number;
  eventConfidence: number;
  headlineScore: number;
}

export interface NewsContext {
  version: 'news_context.v1';
  bias: number;
  maxSev: number;
  maxConf: number;
  bull: number;
  bear: number;
  top: string | null;
  items: NewsContextItem[];
}

export interface PromptReport {
  token: string;
  news: NewsContext;
}

export interface RebalancePrompt {
  reviewInterval: string;
  policy: { floor: Record<string, number> };
  cash: string;
  portfolio: {
    ts: string;
    positions: RebalancePosition[];
    startBalanceUsd?: number;
    startBalanceTs?: string;
    pnlUsd?: number;
    pnlPct?: number;
  };
  routes: RoutePrice[];
  marketData: {
    marketOverview?: MarketOverviewPayload;
    marketTimeseries?: Record<string, MarketTimeseries>;
    fearGreedIndex?: { value: number; classification: string };
    openInterest?: number;
    fundingRate?: number;
  };
  previousReports?: PreviousReport[];
  reports?: PromptReport[];
  tradingMode: 'spot' | 'futures';
}

export interface MainTraderFuturesConfig {
  leverage?: number;
  positionSide: 'LONG' | 'SHORT';
  type?: 'MARKET' | 'LIMIT';
  stopLoss?: number;
  takeProfit?: number;
  reduceOnly?: boolean;
}

export interface MainTraderOrder {
  pair: string;
  token: string;
  side: string;
  qty: number;
  limitPrice: number;
  basePrice: number;
  maxPriceDriftPct: number;
  futures?: MainTraderFuturesConfig;
}

export interface MainTraderDecision {
  orders: MainTraderOrder[];
  shortReport: string;
  strategyName?: string;
  strategyRationale?: string;
}
