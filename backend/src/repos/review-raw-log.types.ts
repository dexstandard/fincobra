export interface ReviewRawLogInsert {
  portfolioWorkflowId: string;
  prompt: unknown;
  response: unknown;
}

export interface ReviewRawLog {
  id: string;
  portfolioWorkflowId: string;
  prompt: string;
  response: string | null;
  createdAt: Date;
}
