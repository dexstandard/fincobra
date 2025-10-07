export interface PromptPosition {
  sym: string;
  qty: number;
  priceUsdt: number;
  valueUsdt: number;
}

export interface PromptPortfolio {
  ts?: string;
  positions?: PromptPosition[];
  startBalanceUsd?: number;
  startBalanceTs?: string;
  pnlUsd?: number;
}

export interface PromptRouteAsset {
  minNotional: number;
}

export interface PromptRoute {
  pair: string;
  price?: number;
  [asset: string]: unknown;
}

export interface PromptRiskFlags {
  overbought?: boolean;
  oversold?: boolean;
  volSpike?: boolean;
  thinBook?: boolean;
}

export interface PromptTrendFrame {
  gapPct?: number;
  slope?: string;
}

export interface PromptMarketOverviewAsset {
  trendSlope?: string;
  trendBasis?: {
    gapPct?: number;
  };
  ret1h?: number;
  ret24h?: number;
  volAtrPct?: number;
  volAnomalyZ?: number;
  rsi14?: number;
  orderbookSpreadBps?: number;
  orderbookDepthRatio?: number;
  riskFlags?: PromptRiskFlags;
  htf?: {
    trend?: {
      ['4h']?: PromptTrendFrame;
      ['1d']?: PromptTrendFrame;
      ['1w']?: PromptTrendFrame;
    };
    regime?: {
      volState?: string;
      volRank1y?: number;
      corrBtc90d?: number;
      marketBeta90d?: number;
    };
    returns?: {
      ['30d']?: number;
      ['90d']?: number;
      ['180d']?: number;
      ['365d']?: number;
    };
  };
}

export interface PromptMarketOverview {
  asOf?: string;
  timeframe?: {
    candleInterval?: string;
    decisionInterval?: string;
    semantics?: string;
  };
  marketOverview?: Record<string, PromptMarketOverviewAsset>;
}

export interface PromptNewsItem {
  title: string;
  link: string;
  pubDate?: string;
  domain?: string;
  eventType?: string;
  polarity?: string;
  severity?: number;
  eventConfidence?: number;
}

export interface PromptReport {
  token: string;
  news?: {
    top?: string;
    maxSev?: number;
    maxConf?: number;
    items?: PromptNewsItem[];
  };
}

export interface PromptFearGreedIndex {
  value?: number;
  classification?: string;
}

export interface PromptPreviousReportOrder {
  symbol: string;
  side: string;
  qty: number;
  status: string;
  price?: number;
  reason?: string;
}

export interface PromptPreviousReport {
  ts: string;
  shortReport?: string;
  orders?: PromptPreviousReportOrder[];
}

export interface PromptData {
  instructions?: string;
  reviewInterval?: string;
  policy?: {
    floor?: Record<string, number>;
  };
  cash?: string;
  portfolio?: PromptPortfolio;
  routes?: PromptRoute[];
  marketData?: {
    marketOverview?: PromptMarketOverview;
    fearGreedIndex?: PromptFearGreedIndex;
  };
  reports?: PromptReport[];
  previousReports?: PromptPreviousReport[];
}
