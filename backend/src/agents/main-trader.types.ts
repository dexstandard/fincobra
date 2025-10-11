import type { PortfolioWorkflowMode } from '../repos/portfolio-workflows.types.js';
import type {
  RunParams,
  SpotRebalancePrompt,
  SpotRebalancePosition,
  SpotPreviousReport,
  SpotPreviousReportOrder,
  SpotPromptReport,
  SpotNewsContext,
  SpotStablecoinOracleQuoteReport,
  SpotStablecoinOracleReport,
  SpotTraderDecision,
  SpotTraderOrder,
} from './spot-trader.types.js';
import type {
  FuturesTraderDecision,
  FuturesTraderPrompt,
  FuturesTraderAction,
  FuturesTraderWalletBalance,
  FuturesTraderPosition,
  FuturesTraderFundingRate,
  FuturesTraderRiskLimit,
} from './futures-trader.types.js';

export type {
  RunParams,
  SpotRebalancePrompt,
  SpotRebalancePosition,
  SpotPreviousReport,
  SpotPreviousReportOrder,
  SpotPromptReport,
  SpotNewsContext,
  SpotStablecoinOracleQuoteReport,
  SpotStablecoinOracleReport,
  SpotTraderDecision,
  SpotTraderOrder,
} from './spot-trader.types.js';

export type {
  FuturesTraderDecision,
  FuturesTraderPrompt,
  FuturesTraderAction,
  FuturesTraderWalletBalance,
  FuturesTraderPosition,
  FuturesTraderFundingRate,
  FuturesTraderRiskLimit,
} from './futures-trader.types.js';

export type RebalancePrompt = SpotRebalancePrompt;
export type RebalancePosition = SpotRebalancePosition;
export type PreviousReport = SpotPreviousReport;
export type PreviousReportOrder = SpotPreviousReportOrder;
export type PromptReport = SpotPromptReport;
export type NewsContext = SpotNewsContext;
export type StablecoinOracleQuoteReport = SpotStablecoinOracleQuoteReport;
export type StablecoinOracleReport = SpotStablecoinOracleReport;
export type MainTraderDecision = SpotTraderDecision;

export interface MainTraderFuturesOrder {
  positionSide: 'LONG' | 'SHORT';
  quantity?: number;
  type?: 'MARKET' | 'LIMIT';
  price?: number;
  reduceOnly?: boolean;
  leverage?: number;
  stopLoss?: number;
  takeProfit?: number;
  hedgeMode?: boolean;
  positionIdx?: 0 | 1 | 2;
}

export interface MainTraderOrder extends SpotTraderOrder {
  futures?: MainTraderFuturesOrder;
}

export type TraderPromptResult =
  | { mode: 'spot'; prompt: SpotRebalancePrompt }
  | { mode: 'futures'; prompt: FuturesTraderPrompt };

export type TraderRunResult =
  | { mode: 'spot'; decision: SpotTraderDecision | null }
  | { mode: 'futures'; decision: FuturesTraderDecision | null };

export type TraderMode = PortfolioWorkflowMode;
