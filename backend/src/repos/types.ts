export interface ReviewRawLogInsert {
  portfolioId: string;
  prompt: unknown;
  response: unknown;
}

export interface ReviewRawLogEntity {
  id: string;
  agentId: string;
  prompt: string;
  response: string | null;
  createdAt: Date;
}

export interface ReviewResultError {
  message: string;
}

export interface ReviewResultInsert {
  portfolioId: string;
  log: string;
  rebalance: boolean;
  shortReport?: string;
  error?: ReviewResultError;
  rawLogId: string;
}

export interface ReviewResultEntity {
  id: string;
  log: string;
  rebalance: boolean;
  shortReport: string | null;
  error: string | null;
  rawLogId: string;
  createdAt: Date;
}

export interface ReviewResultSummary {
  id: string;
  createdAt: Date;
  rebalance: boolean;
  shortReport?: string;
  error?: ReviewResultError;
}

export interface ReviewRebalanceInfo {
  rebalance: boolean;
  log: string;
}
