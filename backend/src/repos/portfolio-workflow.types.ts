export interface PortfolioWorkflowToken {
  token: string;
  minAllocation: number;
}

export interface PortfolioWorkflowRow {
  id: string;
  userId: string;
  model: string | null;
  status: string;
  createdAt: string;
  startBalance: number | null;
  name: string;
  cashToken: string;
  tokens: PortfolioWorkflowToken[];
  risk: string;
  reviewInterval: string;
  agentInstructions: string;
  manualRebalance: boolean;
  useEarn: boolean;
  aiApiKeyId: string | null;
  exchangeApiKeyId: string | null;
}

export interface PortfolioWorkflowInsert {
  userId: string;
  model: string | null;
  status: string;
  startBalance: number | null;
  name: string;
  cashToken: string;
  tokens: PortfolioWorkflowToken[];
  risk: string;
  reviewInterval: string;
  agentInstructions: string;
  manualRebalance: boolean;
  useEarn: boolean;
}

export interface PortfolioWorkflowUpdate {
  id: string;
  model: string | null;
  status: string;
  name: string;
  cashToken: string;
  tokens: PortfolioWorkflowToken[];
  risk: string;
  reviewInterval: string;
  agentInstructions: string;
  startBalance: number | null;
  manualRebalance: boolean;
  useEarn: boolean;
}

export interface PortfolioWorkflowDraftSearch {
  userId: string;
  model: string | null;
  name: string;
  cashToken: string;
  tokens: PortfolioWorkflowToken[];
  risk: string;
  reviewInterval: string;
  agentInstructions: string;
  manualRebalance: boolean;
  useEarn: boolean;
}

export interface PortfolioWorkflowUserApiKeys {
  aiApiKeyEnc?: string | null;
  binanceApiKeyEnc?: string | null;
  binanceApiSecretEnc?: string | null;
}

export interface ActivePortfolioWorkflowRow {
  id: string;
  userId: string;
  model: string | null;
  cashToken: string;
  tokens: PortfolioWorkflowToken[];
  risk: string;
  reviewInterval: string;
  agentInstructions: string;
  aiApiKeyEnc: string | null;
  manualRebalance: boolean;
  useEarn: boolean;
  startBalance: number | null;
  createdAt: string;
  portfolioId: string;
}
