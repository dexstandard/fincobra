import type { AiApiProvider } from './ai-api-key.types.js';

export type PortfolioWorkflowMode = 'spot' | 'futures';

export type PortfolioWorkflowFuturesMarginMode = 'cross' | 'isolated';

export interface PortfolioWorkflowToken {
  token: string;
  minAllocation: number;
}

export interface PortfolioWorkflow {
  id: string;
  userId: string;
  model: string | null;
  aiProvider: AiApiProvider;
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
  mode: PortfolioWorkflowMode;
  futuresDefaultLeverage: number | null;
  futuresMarginMode: PortfolioWorkflowFuturesMarginMode | null;
  aiApiKeyId: string | null;
  exchangeApiKeyId: string | null;
  ownerEmailEnc: string | null;
}

export interface PortfolioWorkflowInsert {
  userId: string;
  model: string | null;
  aiProvider: AiApiProvider;
  status: string;
  startBalance: number | null;
  cashToken: string;
  tokens: PortfolioWorkflowToken[];
  risk: string;
  reviewInterval: string;
  agentInstructions: string;
  manualRebalance: boolean;
  useEarn: boolean;
  exchangeKeyId: string | null;
  mode?: PortfolioWorkflowMode;
  futuresDefaultLeverage?: number | null;
  futuresMarginMode?: PortfolioWorkflowFuturesMarginMode | null;
}

export interface PortfolioWorkflowUpdate {
  id: string;
  model: string | null;
  aiProvider: AiApiProvider;
  status: string;
  cashToken: string;
  tokens: PortfolioWorkflowToken[];
  risk: string;
  reviewInterval: string;
  agentInstructions: string;
  startBalance: number | null;
  manualRebalance: boolean;
  useEarn: boolean;
  exchangeKeyId: string | null;
  mode?: PortfolioWorkflowMode;
  futuresDefaultLeverage?: number | null;
  futuresMarginMode?: PortfolioWorkflowFuturesMarginMode | null;
}

export interface PortfolioWorkflowInactiveSearch {
  userId: string;
  model: string | null;
  aiProvider: AiApiProvider;
  cashToken: string;
  tokens: PortfolioWorkflowToken[];
  risk: string;
  reviewInterval: string;
  agentInstructions: string;
  manualRebalance: boolean;
  useEarn: boolean;
  mode: PortfolioWorkflowMode;
}

export interface PortfolioWorkflowUserApiKeys {
  aiApiKeyEnc?: string | null;
  groqAiApiKeyEnc?: string | null;
  binanceApiKeyEnc?: string | null;
  binanceApiSecretEnc?: string | null;
  binanceKeyId?: string | null;
  bybitApiKeyEnc?: string | null;
  bybitApiSecretEnc?: string | null;
  bybitKeyId?: string | null;
}

export interface ActivePortfolioWorkflow {
  id: string;
  userId: string;
  model: string | null;
  aiProvider: AiApiProvider;
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
  mode: PortfolioWorkflowMode;
  futuresDefaultLeverage: number | null;
  futuresMarginMode: PortfolioWorkflowFuturesMarginMode | null;
}
