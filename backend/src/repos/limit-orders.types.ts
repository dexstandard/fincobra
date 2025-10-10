export enum LimitOrderStatus {
  Open = 'open',
  Filled = 'filled',
  Canceled = 'canceled',
}

export interface LimitOrderInsert {
  userId: string;
  planned: Record<string, unknown>;
  status: LimitOrderStatus;
  reviewResultId: string;
  orderId: string;
  cancellationReason?: string;
}

export interface LimitOrderByReviewResult {
  plannedJson: string;
  status: LimitOrderStatus;
  createdAt: Date;
  orderId: string;
  cancellationReason: string | null;
}

export interface LimitOrderOpenWorkflow {
  userId: string;
  orderId: string;
  plannedJson: string;
  exchangeProvider: 'binance' | 'bybit' | null;
}

export interface LimitOrderOpen extends LimitOrderOpenWorkflow {
  portfolioWorkflowId: string;
  workflowStatus: string;
}
