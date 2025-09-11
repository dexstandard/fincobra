import { db } from '../db/index.js';

export type LimitOrderStatus = 'open' | 'filled' | 'canceled';

export interface LimitOrderEntry {
  userId: string;
  planned: Record<string, unknown>;
  status: LimitOrderStatus;
  reviewResultId: string;
  orderId: string;
}

export async function insertLimitOrder(entry: LimitOrderEntry): Promise<void> {
  await db.query(
    'INSERT INTO limit_order (user_id, planned_json, status, review_result_id, order_id) VALUES ($1, $2, $3, $4, $5)',
    [
      entry.userId,
      JSON.stringify(entry.planned),
      entry.status,
      entry.reviewResultId,
      entry.orderId,
    ],
  );
}

export async function cancelOpenLimitOrdersByAgent(
  agentId: string,
): Promise<void> {
  await db.query(
    `UPDATE limit_order e
        SET status = 'canceled'
       FROM agent_review_result r
      WHERE e.status = 'open'
        AND e.review_result_id = r.id
        AND r.agent_id = $1`,
    [agentId],
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
}[]> {
  const { rows } = await db.query(
    `SELECT e.planned_json, e.status, e.created_at, e.order_id
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
  }[];
}

export async function getRecentLimitOrders(agentId: string, limit: number) {
  const { rows } = await db.query(
    `SELECT e.planned_json, e.status, e.created_at
       FROM limit_order e
       JOIN agent_review_result r ON e.review_result_id = r.id
      WHERE r.agent_id = $1
      ORDER BY e.created_at DESC
      LIMIT $2`,
    [agentId, limit],
  );
  return rows as {
    planned_json: string;
    status: LimitOrderStatus;
    created_at: Date;
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
) {
  await db.query(
    `UPDATE limit_order SET status = $3 WHERE user_id = $1 AND order_id = $2`,
    [userId, orderId, status],
  );
}
