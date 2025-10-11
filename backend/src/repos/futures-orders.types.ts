export enum FuturesOrderStatus {
  Executed = 'executed',
  Failed = 'failed',
  Skipped = 'skipped',
}

export interface FuturesOrderInsert {
  userId: string;
  planned: Record<string, unknown>;
  status: FuturesOrderStatus;
  reviewResultId: string;
  orderId: string;
  failureReason?: string | null;
}

export interface FuturesOrderByReviewResult {
  plannedJson: string;
  status: FuturesOrderStatus;
  orderId: string;
  failureReason: string | null;
  createdAt: string;
}
