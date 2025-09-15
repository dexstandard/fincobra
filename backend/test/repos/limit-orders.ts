import { db } from '../../src/db/index.js';

export async function insertLimitOrder(args: {
  userId: string;
  planned: unknown;
  status: string;
  reviewResultId: string;
  orderId: string;
}) {
  await db.query(
    'INSERT INTO limit_order (user_id, planned_json, status, review_result_id, order_id) VALUES ($1, $2, $3, $4, $5)',
    [
      args.userId,
      JSON.stringify(args.planned),
      args.status,
      args.reviewResultId,
      args.orderId,
    ],
  );
}

export async function getLimitOrder(orderId: string) {
  const { rows } = await db.query(
    'SELECT status, cancellation_reason FROM limit_order WHERE order_id = $1',
    [orderId],
  );
  return rows[0] as
    | { status: string; cancellation_reason: string | null }
    | undefined;
}

export async function getLimitOrdersByReviewResult(reviewResultId: string) {
  const { rows } = await db.query(
    'SELECT * FROM limit_order WHERE review_result_id = $1',
    [reviewResultId],
  );
  return rows as any[];
}

export async function clearLimitOrders() {
  await db.query('TRUNCATE limit_order RESTART IDENTITY CASCADE');
}

export async function getLimitOrders() {
  const { rows } = await db.query(
    'SELECT user_id, planned_json, status, review_result_id, order_id, cancellation_reason FROM limit_order',
  );
  return rows as {
    user_id: string;
    planned_json: string;
    status: string;
    review_result_id: string;
    order_id: string;
    cancellation_reason: string | null;
  }[];
}
