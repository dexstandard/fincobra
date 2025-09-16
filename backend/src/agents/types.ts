import type { FastifyBaseLogger } from 'fastify';

export interface Analysis {
  comment: string;
  score: number;
}

export const analysisSchema = {
  type: 'object',
  properties: {
    comment: { type: 'string' },
    score: { type: 'number' },
  },
  required: ['comment', 'score'],
  additionalProperties: false,
} as const;

export interface AnalysisLog {
  analysis: Analysis | null;
  prompt?: unknown;
  response?: string;
}

export interface RunParams {
  log: FastifyBaseLogger;
  model: string;
  apiKey: string;
  portfolioId: string;
}

export interface TokenMetrics {
  ret_1h: number;
  ret_4h: number;
  ret_24h: number;
  ret_7d: number;
  ret_30d: number;
  sma_dist_20: number;
  sma_dist_50: number;
  sma_dist_200: number;
  macd_hist: number;
  vol_rv_7d: number;
  vol_rv_30d: number;
  vol_atr_pct: number;
  range_bb_bw: number;
  range_donchian20: number;
  volume_z_1h: number;
  volume_z_24h: number;
  corr_BTC_30d: number;
  regime_BTC: string;
}

export interface MarketTimeseries {
  ret_60m: number;
  ret_24h: number;
  ret_24m: number;
}

export interface OrderBookSnapshot {
  bid: [number, number];
  ask: [number, number];
}

export interface RebalancePosition {
  sym: string;
  qty: number;
  price_usdt: number;
  value_usdt: number;
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

export interface RebalancePrompt {
  instructions: string;
  reviewInterval: string;
  policy: { floor: Record<string, number> };
  cash: string;
  portfolio: {
    ts: string;
    positions: RebalancePosition[];
    start_balance_usd?: number;
    start_balance_ts?: string;
    pnl_usd?: number;
  };
  routes: RoutePrice[];
  marketData: {
    indicators?: Record<string, TokenMetrics>;
    market_timeseries?: Record<string, MarketTimeseries>;
    fearGreedIndex?: { value: number; classification: string };
    orderBooks?: Record<string, OrderBookSnapshot>;
    openInterest?: number;
    fundingRate?: number;
  };
  previous_reports?: PreviousReport[];
  reports?: {
    token: string;
    news: Analysis | null;
    tech: Analysis | null;
  }[];
}
