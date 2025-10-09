export enum FuturesPositionPlanStatus {
  Planned = 'planned',
  Executed = 'executed',
  Canceled = 'canceled',
}

export interface FuturesPositionPlanInsert {
  userId: string;
  planned: Record<string, unknown>;
  status: FuturesPositionPlanStatus;
  reviewResultId: string;
  positionId: string;
  cancellationReason?: string;
}

export interface FuturesPositionPlanByReviewResult {
  plannedJson: string;
  status: FuturesPositionPlanStatus;
  createdAt: Date;
  positionId: string;
  cancellationReason: string | null;
}
