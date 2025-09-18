export type LimitOrderStatus = 'open' | 'filled' | 'canceled';

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
}

export interface LimitOrderOpen extends LimitOrderOpenWorkflow {
  portfolioWorkflowId: string;
  workflowStatus: string;
}
