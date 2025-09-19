import { db } from '../db/index.js';
import { convertKeysToCamelCase } from '../util/objectCase.js';
import {
  LimitOrderStatus,
  type LimitOrderByReviewResult,
  type LimitOrderInsert,
  type LimitOrderOpen,
  type LimitOrderOpenWorkflow,
} from './limit-orders.types.js';

export async function insertLimitOrder(entry: LimitOrderInsert): Promise<void> {
  await db.query(
    'INSERT INTO limit_order (user_id, planned_json, status, review_result_id, order_id, cancellation_reason) VALUES ($1, $2, $3, $4, $5, $6)',
    [
      entry.userId,
      JSON.stringify(entry.planned),
      entry.status,
      entry.reviewResultId,
      entry.orderId,
      entry.cancellationReason ?? null,
    ],
  );
}

export async function getLimitOrdersByReviewResult(
  portfolioWorkflowId: string,
  reviewResultId: string,
): Promise<LimitOrderByReviewResult[]> {
  const { rows } = await db.query(
    `SELECT e.planned_json, e.status, e.created_at, e.order_id, e.cancellation_reason
       FROM limit_order e
       JOIN review_result r ON e.review_result_id = r.id
      WHERE r.portfolio_workflow_id = $1 AND e.review_result_id = $2`,
    [portfolioWorkflowId, reviewResultId],
  );
  return convertKeysToCamelCase(rows) as LimitOrderByReviewResult[];
}

export async function getOpenLimitOrdersForWorkflow(
  portfolioWorkflowId: string,
): Promise<LimitOrderOpenWorkflow[]> {
  const { rows } = await db.query(
    `SELECT e.user_id, e.order_id, e.planned_json
       FROM limit_order e
       JOIN review_result r ON e.review_result_id = r.id
      WHERE r.portfolio_workflow_id = $1 AND e.status = $2`,
    [portfolioWorkflowId, LimitOrderStatus.Open],
  );
  return convertKeysToCamelCase(rows) as LimitOrderOpenWorkflow[];
}

export async function getAllOpenLimitOrders(): Promise<LimitOrderOpen[]> {
  const { rows } = await db.query(
    `SELECT e.user_id, e.order_id, e.planned_json, r.portfolio_workflow_id, pw.status AS workflow_status
       FROM limit_order e
       JOIN review_result r ON e.review_result_id = r.id
       JOIN portfolio_workflow pw ON r.portfolio_workflow_id = pw.id
      WHERE e.status = $1`,
    [LimitOrderStatus.Open],
  );
  return convertKeysToCamelCase(rows) as LimitOrderOpen[];
}

export async function updateLimitOrderStatus(
  userId: string,
  orderId: string,
  status: LimitOrderStatus,
  cancellationReason?: string,
): Promise<void> {
  await db.query(
    `UPDATE limit_order SET status = $3, cancellation_reason = $4 WHERE user_id = $1 AND order_id = $2`,
    [userId, orderId, status, cancellationReason ?? null],
  );
}
