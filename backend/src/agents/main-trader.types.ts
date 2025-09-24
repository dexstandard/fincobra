import type { FastifyBaseLogger } from 'fastify';
import type { Analysis } from './news-analyst.types.js';
import type { OrderBookSnapshot } from './technical-analyst.types.js';
import type { TokenIndicators } from '../services/indicators.types.js';

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

export interface PreviousReport {
  datetime: string;
  orders?: {
    symbol: string;
    side: string;
    quantity: number;
    status: string;
    datetime: string;
    cancellationReason?: string;
  }[];
  shortReport?: string;
  error?: unknown;
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

export interface PromptReport {
  token: string;
  news: Analysis | null;
  tech: Analysis | null;
}

export interface RebalancePrompt {
  instructions: string;
  reviewInterval: string;
  policy: { floor: Record<string, number> };
  cash: string;
  portfolio: {
    ts: string;
    positions: RebalancePosition[];
    startBalanceUsd?: number;
    startBalanceTs?: string;
    pnlUsd?: number;
  };
  routes: RoutePrice[];
  marketData: {
    indicators?: Record<string, TokenIndicators>;
    marketTimeseries?: Record<string, MarketTimeseries>;
    fearGreedIndex?: { value: number; classification: string };
    orderBooks?: Record<string, OrderBookSnapshot>;
    openInterest?: number;
    fundingRate?: number;
  };
  previousReports?: PreviousReport[];
  reports?: PromptReport[];
}

export interface MainTraderOrder {
  pair: string;
  token: string;
  side: string;
  quantity: number;
  limitPrice: number;
  basePrice: number;
  maxPriceDivergencePct: number;
}

export interface MainTraderDecision {
  orders: MainTraderOrder[];
  shortReport: string;
}
