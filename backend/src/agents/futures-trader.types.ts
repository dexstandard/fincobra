import type { RunParams } from './spot-trader.types.js';

export interface FuturesTraderWalletBalance {
  asset: string;
  balance: number;
  availableBalance: number;
  unrealizedPnl?: number;
}

export interface FuturesTraderPosition {
  symbol: string;
  positionSide: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice?: number;
  leverage: number;
  unrealizedPnl: number;
  marginMode: 'cross' | 'isolated';
}

export interface FuturesTraderFundingRate {
  symbol: string;
  rate: number;
  nextFundingTime: string;
}

export interface FuturesTraderRiskLimit {
  symbol: string;
  maxLeverage: number;
  initialMarginRate: number;
  maintenanceMarginRate: number;
}

export interface FuturesTraderPrompt {
  reviewInterval: string;
  portfolio: {
    ts: string;
    walletBalanceUsd: number;
    balances: FuturesTraderWalletBalance[];
    positions: FuturesTraderPosition[];
  };
  fundingRates: FuturesTraderFundingRate[];
  riskLimits: FuturesTraderRiskLimit[];
  policy: {
    maxLeverage?: number;
    maxExposureUsd?: number;
    stopLossBufferPct?: number;
  };
  marketData?: {
    markPrices?: Record<string, number>;
    openInterest?: Record<string, number>;
  };
  previousReports?: Array<{
    ts: string;
    shortReport?: string;
    error?: string;
    strategyName?: string;
  }>;
}

export type FuturesTraderRunParams = RunParams;

export interface FuturesTraderAction {
  symbol: string;
  positionSide: 'LONG' | 'SHORT';
  action: 'OPEN' | 'CLOSE' | 'SCALE' | 'HOLD';
  type: 'MARKET' | 'LIMIT';
  quantity: number;
  price?: number;
  reduceOnly?: boolean;
  leverage?: number;
  stopLoss?: number;
  takeProfit?: number;
  notes?: string;
}

export interface FuturesTraderDecision {
  actions: FuturesTraderAction[];
  shortReport: string;
  strategyName?: string;
  strategyRationale?: string;
}
