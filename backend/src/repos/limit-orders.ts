import { db } from '../db/index.js';

export type LimitOrderStatus = 'open' | 'filled' | 'canceled';

export interface LimitOrderEntry {
  userId: string;
  planned: Record<string, unknown>;
  status: LimitOrderStatus;
  reviewResultId: string;
  orderId: string;
  cancellationReason?: string;
}

export async function insertLimitOrder(entry: LimitOrderEntry): Promise<void> {
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
  agentId: string,
  reviewResultId: string,
): Promise<{
  planned_json: string;
  status: LimitOrderStatus;
  created_at: Date;
  order_id: string;
  cancellation_reason: string | null;
}[]> {
  const { rows } = await db.query(
    `SELECT e.planned_json, e.status, e.created_at, e.order_id, e.cancellation_reason
       FROM limit_order e
       JOIN agent_review_result r ON e.review_result_id = r.id
      WHERE r.agent_id = $1 AND e.review_result_id = $2`,
    [agentId, reviewResultId],
  );
  return rows as {
    planned_json: string;
    status: LimitOrderStatus;
    created_at: Date;
    order_id: string;
    cancellation_reason: string | null;
  }[];
}

export async function getOpenLimitOrdersForAgent(agentId: string) {
  const { rows } = await db.query(
    `SELECT e.user_id, e.order_id, e.planned_json
       FROM limit_order e
       JOIN agent_review_result r ON e.review_result_id = r.id
      WHERE r.agent_id = $1 AND e.status = 'open'`,
    [agentId],
  );
  return rows as { user_id: string; order_id: string; planned_json: string }[];
}

export async function getAllOpenLimitOrders() {
  const { rows } = await db.query(
    `SELECT e.user_id, e.order_id, e.planned_json, r.agent_id, a.status AS agent_status
       FROM limit_order e
       JOIN agent_review_result r ON e.review_result_id = r.id
       JOIN portfolio_workflow a ON r.agent_id = a.id
      WHERE e.status = 'open'`,
  );
  return rows as {
    user_id: string;
    order_id: string;
    planned_json: string;
    agent_id: string;
    agent_status: string;
  }[];
}

export async function updateLimitOrderStatus(
  userId: string,
  orderId: string,
  status: LimitOrderStatus,
  cancellationReason?: string,
) {
  await db.query(
    `UPDATE limit_order SET status = $3, cancellation_reason = $4 WHERE user_id = $1 AND order_id = $2`,
    [userId, orderId, status, cancellationReason ?? null],
  );
}
