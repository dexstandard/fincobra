import type { FastifyBaseLogger } from 'fastify';
import type { AiApiProvider } from '../repos/ai-api-key.types.js';
import type { MarketOverviewPayload } from '../services/indicators.types.js';

export interface RunParams {
  log: FastifyBaseLogger;
  model: string;
  apiKey: string;
  portfolioId: string;
  aiProvider: AiApiProvider;
}

export interface SpotRebalancePosition {
  sym: string;
  qty: number;
  priceUsdt: number;
  valueUsdt: number;
}

export interface SpotPreviousReportOrder {
  symbol: string;
  side: string;
  qty: number;
  status: string;
  price?: number;
  reason?: string;
}

export interface SpotPreviousReport {
  ts: string;
  orders?: SpotPreviousReportOrder[];
  shortReport?: string;
  error?: unknown;
  strategyName?: string;
  pnlShiftUsd?: number;
}

export interface SpotRoutePrice {
  pair: string;
  price: number;
  [token: string]: { minNotional: number } | string | number;
}

export interface SpotMarketTimeseries {
  ret60m: number;
  ret24h: number;
  ret24m: number;
}

export interface SpotNewsContextItem {
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

export interface SpotNewsContext {
  version: 'news_context.v1';
  bias: number;
  maxSev: number;
  maxConf: number;
  bull: number;
  bear: number;
  top: string | null;
  warning: string;
  items: SpotNewsContextItem[];
}

export interface SpotStablecoinOracleQuoteReport {
  usdPrice: number;
  updatedAt: string;
}

export interface SpotStablecoinOracleReport {
  pair: 'USDT/USD' | 'USDC/USD';
  quote: SpotStablecoinOracleQuoteReport;
}

export interface SpotPromptReport {
  token: string;
  news?: SpotNewsContext;
  stablecoinOracle?: SpotStablecoinOracleReport;
}

export interface SpotRebalancePrompt {
  reviewInterval: string;
  policy: { floor: Record<string, number> };
  cash: string;
  portfolio: {
    ts: string;
    positions: SpotRebalancePosition[];
    startBalanceUsd?: number;
    startBalanceTs?: string;
    pnlUsd?: number;
    pnlPct?: number;
  };
  routes: SpotRoutePrice[];
  marketData: {
    marketOverview?: MarketOverviewPayload;
    marketTimeseries?: Record<string, SpotMarketTimeseries>;
    fearGreedIndex?: { value: number; classification: string };
    openInterest?: number;
    fundingRate?: number;
  };
  previousReports?: SpotPreviousReport[];
  reports?: SpotPromptReport[];
}

export interface SpotTraderOrder {
  pair: string;
  token: string;
  side: string;
  qty: number;
  limitPrice: number;
  basePrice: number;
  maxPriceDriftPct: number;
  exchange?: 'binance' | 'bybit';
}

export interface SpotTraderDecision {
  orders: SpotTraderOrder[];
  shortReport: string;
  strategyName?: string;
  strategyRationale?: string;
}

export type SpotTraderPrompt = SpotRebalancePrompt;
export type SpotTraderNewsContext = SpotNewsContext;
export type SpotTraderPromptReport = SpotPromptReport;
export type SpotTraderPreviousReport = SpotPreviousReport;
export type SpotTraderPreviousReportOrder = SpotPreviousReportOrder;
export type SpotTraderRoutePrice = SpotRoutePrice;
export type SpotTraderRebalancePosition = SpotRebalancePosition;
export type SpotTraderStablecoinOracleReport = SpotStablecoinOracleReport;
export type SpotTraderStablecoinOracleQuoteReport = SpotStablecoinOracleQuoteReport;
