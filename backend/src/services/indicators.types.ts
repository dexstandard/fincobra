export interface MarketOverviewRiskFlags {
  overbought: boolean;
  oversold: boolean;
  volSpike: boolean;
  thinBook: boolean;
}

export interface MarketOverviewTrendBasis {
  smaPeriods: [number, number];
  gapPct: number;
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
  volState: 'depressed' | 'normal' | 'elevated';
  volRank1y: number;
  corrBtc90d: number;
  marketBeta90d: number;
}

export interface MarketOverviewHtf {
  returns: MarketOverviewReturns;
  trend: MarketOverviewTrend;
  regime: MarketOverviewRegime;
}

export interface MarketOverviewToken {
  trendSlope: 'up' | 'flat' | 'down';
  trendBasis: MarketOverviewTrendBasis;
  ret1h: number;
  ret24h: number;
  volAtrPct: number;
  volAnomalyZ: number;
  rsi14: number;
  orderbookSpreadBps: number;
  orderbookDepthRatio: number;
  riskFlags: MarketOverviewRiskFlags;
  htf: MarketOverviewHtf;
}

export interface MarketOverviewTimeframe {
  candleInterval: string;
  reviewInterval: string;
  semantics: string;
}

export interface MarketOverviewDerivations {
  trendSlopeRule: string;
  ret1hRule: string;
  ret24hRule: string;
  volAtrPctRule: string;
  volAnomalyZRule: string;
  rsi14Rule: string;
  orderbookSpreadBpsRule: string;
  orderbookDepthRatioRule: string;
  htfReturnsRule: string;
  htfTrendRule: string;
  regimeVolStateRule: string;
  regimeCorrBetaRule: string;
  riskFlagsRules: {
    overbought: string;
    oversold: string;
    volSpike: string;
    thinBook: string;
  };
}

export interface MarketOverviewSpec {
  units: Record<string, string>;
  interpretation: Record<string, string>;
}

export interface MarketOverviewPayload {
  schema: 'market_overview.v2';
  asOf: string;
  timeframe: MarketOverviewTimeframe;
  derivations: MarketOverviewDerivations;
  spec: MarketOverviewSpec;
  marketOverview: Record<string, MarketOverviewToken>;
}
