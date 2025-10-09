import type { FastifyBaseLogger } from 'fastify';
import type { MarketOverviewPayload } from '../services/indicators.types.js';
import type { TradeMode } from '../repos/portfolio-workflows.types.js';
export interface RunParams {
  log: FastifyBaseLogger;
  model: string;
  apiKey: string;
  portfolioId: string;
  tradeMode: TradeMode;
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
  futures?: PreviousReportFuturesPosition[];
  shortReport?: string;
  error?: unknown;
  strategyName?: string;
  pnlShiftUsd?: number;
}

export interface PreviousReportFuturesPosition {
  symbol: string;
  positionSide: string;
  qty: number;
  leverage?: number;
  entryType?: string;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  status?: string;
  positionId?: string;
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
  tradeMode: TradeMode;
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
  futures?: RebalancePromptFuturesContext;
}

export interface RebalancePromptFuturesContext {
  positions: FuturesPromptPosition[];
  walletBalanceUsd?: number;
}

export interface FuturesPromptPosition {
  symbol: string;
  positionSide: 'LONG' | 'SHORT';
  qty: number;
  entryPrice?: number;
  leverage?: number;
  unrealizedPnlUsd?: number;
}

export interface MainTraderOrder {
  pair: string;
  token: string;
  side: string;
  qty: number;
  limitPrice: number;
  basePrice: number;
  maxPriceDriftPct: number;
}

export interface MainTraderFuturesPosition {
  symbol: string;
  positionSide: 'LONG' | 'SHORT';
  qty: number;
  leverage: number;
  entryType: 'MARKET' | 'LIMIT';
  entryPrice?: number;
  reduceOnly?: boolean;
  stopLoss?: number;
  takeProfit?: number;
}

interface MainTraderBaseDecision {
  shortReport: string;
  strategyName?: string;
  strategyRationale?: string;
}

export interface MainTraderSpotDecision extends MainTraderBaseDecision {
  tradeMode: 'spot';
  orders: MainTraderOrder[];
}

export interface MainTraderFuturesDecision extends MainTraderBaseDecision {
  tradeMode: 'futures';
  futures: MainTraderFuturesPosition[];
}

export type MainTraderDecision =
  | MainTraderSpotDecision
  | MainTraderFuturesDecision;
