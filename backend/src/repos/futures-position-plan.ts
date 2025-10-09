import { db } from '../db/index.js';
import { convertKeysToCamelCase } from '../util/object-case.js';
import {
  FuturesPositionPlanStatus,
  type FuturesPositionPlanByReviewResult,
  type FuturesPositionPlanInsert,
} from './futures-position-plan.types.js';

export async function insertFuturesPositionPlan(
  entry: FuturesPositionPlanInsert,
): Promise<void> {
  await db.query(
    'INSERT INTO futures_position_plan (user_id, planned_json, status, review_result_id, position_id, cancellation_reason) VALUES ($1, $2, $3, $4, $5, $6)',
    [
      entry.userId,
      JSON.stringify(entry.planned),
      entry.status,
      entry.reviewResultId,
      entry.positionId,
      entry.cancellationReason ?? null,
    ],
  );
}

export async function getFuturesPositionsByReviewResult(
  portfolioWorkflowId: string,
  reviewResultId: string,
): Promise<FuturesPositionPlanByReviewResult[]> {
  const { rows } = await db.query(
    `SELECT f.planned_json, f.status, f.created_at, f.position_id, f.cancellation_reason
       FROM futures_position_plan f
       JOIN review_result r ON f.review_result_id = r.id
      WHERE r.portfolio_workflow_id = $1 AND f.review_result_id = $2`,
    [portfolioWorkflowId, reviewResultId],
  );
  return convertKeysToCamelCase(rows) as FuturesPositionPlanByReviewResult[];
}

export async function clearFuturesPlansForReviewResult(
  reviewResultId: string,
): Promise<void> {
  await db.query(
    'DELETE FROM futures_position_plan WHERE review_result_id = $1',
    [reviewResultId],
  );
}

