import { db } from '../db/index.js';
import { convertKeysToCamelCase } from '../util/object-case.js';
import {
  FuturesOrderStatus,
  type FuturesOrderByReviewResult,
  type FuturesOrderInsert,
} from './futures-orders.types.js';

export async function insertFuturesOrder(
  entry: FuturesOrderInsert,
): Promise<void> {
  await db.query(
    `INSERT INTO futures_order (
        user_id,
        planned_json,
        status,
        review_result_id,
        order_id,
        failure_reason
      )
      VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entry.userId,
      JSON.stringify(entry.planned),
      entry.status,
      entry.reviewResultId,
      entry.orderId,
      entry.failureReason ?? null,
    ],
  );
}

export async function getFuturesOrdersByReviewResult(
  portfolioWorkflowId: string,
  reviewResultId: string,
): Promise<FuturesOrderByReviewResult[]> {
  const { rows } = await db.query(
    `SELECT o.planned_json, o.status, o.order_id, o.failure_reason, o.created_at
       FROM futures_order o
       JOIN review_result r ON o.review_result_id = r.id
      WHERE r.portfolio_workflow_id = $1 AND o.review_result_id = $2
      ORDER BY o.created_at ASC, o.order_id ASC`,
    [portfolioWorkflowId, reviewResultId],
  );
  return convertKeysToCamelCase(rows) as FuturesOrderByReviewResult[];
}

export { FuturesOrderStatus };
