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
  rebalance?: boolean;
  newAllocation?: number;
  shortReport?: string;
  error?: ReviewResultError;
  rawLogId?: string;
}

export interface ReviewResultEntity {
  id: string;
  log: string;
  rebalance: boolean | null;
  newAllocation: number | null;
  shortReport: string | null;
  error: string | null;
  rawLogId: string | null;
  createdAt: Date;
}
