import type {
  PortfolioWorkflowFuturesMarginMode,
  PortfolioWorkflowMode,
} from '../repos/portfolio-workflows.types.js';

export interface PortfolioWorkflowTokenInput {
  token: string;
  minAllocation: number;
}

export interface PortfolioWorkflowInput {
  model: string;
  aiProvider: 'openai' | 'groq';
  cash: string;
  tokens: PortfolioWorkflowTokenInput[];
  risk: string;
  reviewInterval: string;
  agentInstructions: string;
  manualRebalance: boolean;
  useEarn: boolean;
  status: 'active' | 'inactive' | 'retired';
  exchangeKeyId: string | null;
  mode: PortfolioWorkflowMode;
  futuresDefaultLeverage: number | null;
  futuresMarginMode: PortfolioWorkflowFuturesMarginMode | null;
}
