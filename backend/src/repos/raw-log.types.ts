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
