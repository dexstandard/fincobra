export interface ReviewResultError {
  message: string;
}

export interface ReviewResultInsert {
  portfolioWorkflowId: string;
  log: string;
  rebalance: boolean;
  shortReport?: string;
  error?: ReviewResultError;
  rawLogId: string;
}

export interface ReviewResult {
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
