export interface PortfolioWorkflowTokenInput {
  token: string;
  minAllocation: number;
}

import type { TradeMode } from '../repos/portfolio-workflows.types.js';

export interface PortfolioWorkflowInput {
  model: string;
  cash: string;
  tokens: PortfolioWorkflowTokenInput[];
  risk: string;
  reviewInterval: string;
  agentInstructions: string;
  manualRebalance: boolean;
  useEarn: boolean;
  status: 'active' | 'inactive' | 'retired';
  tradeMode: TradeMode;
}
