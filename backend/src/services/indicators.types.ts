export interface MarketOverviewRiskFlags {
  overbought: boolean;
  oversold: boolean;
  vol_spike: boolean;
  thin_book: boolean;
}

export interface MarketOverviewTrendBasis {
  sma_periods: [number, number];
  gap_pct: number;
}

export interface MarketOverviewTrendFrame extends MarketOverviewTrendBasis {
  slope: 'up' | 'flat' | 'down';
}

export interface MarketOverviewReturns {
  '30d': number;
  '90d': number;
  '180d': number;
  '365d': number;
}

export interface MarketOverviewTrend {
  '4h': MarketOverviewTrendFrame;
  '1d': MarketOverviewTrendFrame;
  '1w': MarketOverviewTrendFrame;
}

export interface MarketOverviewRegime {
  vol_state: 'depressed' | 'normal' | 'elevated';
  vol_rank_1y: number;
  corr_btc_90d: number;
  market_beta_90d: number;
}

export interface MarketOverviewHtf {
  returns: MarketOverviewReturns;
  trend: MarketOverviewTrend;
  regime: MarketOverviewRegime;
}

export interface MarketOverviewToken {
  trend_slope: 'up' | 'flat' | 'down';
  trend_basis: MarketOverviewTrendBasis;
  ret1h: number;
  ret24h: number;
  vol_atr_pct: number;
  vol_anomaly_z: number;
  rsi14: number;
  orderbook_spread_bps: number;
  orderbook_depth_ratio: number;
  risk_flags: MarketOverviewRiskFlags;
  htf: MarketOverviewHtf;
}

export interface MarketOverviewTimeframe {
  candle_interval: string;
  review_interval: string;
  semantics: string;
}

export interface MarketOverviewDerivations {
  trend_slope_rule: string;
  ret1h_rule: string;
  ret24h_rule: string;
  vol_atr_pct_rule: string;
  vol_anomaly_z_rule: string;
  rsi14_rule: string;
  orderbook_spread_bps_rule: string;
  orderbook_depth_ratio_rule: string;
  htf_returns_rule: string;
  htf_trend_rule: string;
  regime_vol_state_rule: string;
  regime_corr_beta_rule: string;
  risk_flags_rules: {
    overbought: string;
    oversold: string;
    vol_spike: string;
    thin_book: string;
  };
}

export interface MarketOverviewSpec {
  units: Record<string, string>;
  interpretation: Record<string, string>;
}

export interface MarketOverviewPayload {
  schema_version: 'market_overview.v2';
  as_of: string;
  timeframe: MarketOverviewTimeframe;
  derivations: MarketOverviewDerivations;
  _spec: MarketOverviewSpec;
  market_overview: Record<string, MarketOverviewToken>;
}
