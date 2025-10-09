export type TradeMode = 'spot' | 'futures';

export interface PortfolioWorkflowToken {
  token: string;
  minAllocation: number;
}

export interface PortfolioWorkflow {
  id: string;
  userId: string;
  model: string | null;
  status: string;
  createdAt: string;
  startBalance: number | null;
  cashToken: string;
  tokens: PortfolioWorkflowToken[];
  risk: string;
  reviewInterval: string;
  agentInstructions: string;
  manualRebalance: boolean;
  useEarn: boolean;
  tradeMode: TradeMode;
  aiApiKeyId: string | null;
  exchangeApiKeyId: string | null;
  ownerEmailEnc: string | null;
}

export interface PortfolioWorkflowInsert {
  userId: string;
  model: string | null;
  status: string;
  startBalance: number | null;
  cashToken: string;
  tokens: PortfolioWorkflowToken[];
  risk: string;
  reviewInterval: string;
  agentInstructions: string;
  manualRebalance: boolean;
  useEarn: boolean;
  tradeMode: TradeMode;
}

export interface PortfolioWorkflowUpdate {
  id: string;
  model: string | null;
  status: string;
  cashToken: string;
  tokens: PortfolioWorkflowToken[];
  risk: string;
  reviewInterval: string;
  agentInstructions: string;
  startBalance: number | null;
  manualRebalance: boolean;
  useEarn: boolean;
  tradeMode: TradeMode;
}

export interface PortfolioWorkflowInactiveSearch {
  userId: string;
  model: string | null;
  cashToken: string;
  tokens: PortfolioWorkflowToken[];
  risk: string;
  reviewInterval: string;
  agentInstructions: string;
  manualRebalance: boolean;
  useEarn: boolean;
  tradeMode: TradeMode;
}

export interface PortfolioWorkflowUserApiKeys {
  aiApiKeyEnc?: string | null;
  binanceApiKeyEnc?: string | null;
  binanceApiSecretEnc?: string | null;
}

export interface ActivePortfolioWorkflow {
  id: string;
  userId: string;
  model: string | null;
  cashToken: string;
  tokens: PortfolioWorkflowToken[];
  risk: string;
  reviewInterval: string;
  agentInstructions: string;
  aiApiKeyId: string | null;
  aiApiKeyEnc: string | null;
  exchangeApiKeyId: string | null;
  manualRebalance: boolean;
  useEarn: boolean;
  startBalance: number | null;
  createdAt: string;
  portfolioId: string;
  tradeMode: TradeMode;
}
