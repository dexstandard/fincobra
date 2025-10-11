import { db } from '../../src/db/index.js';
import { FuturesOrderStatus } from '../../src/repos/futures-orders.types.js';

export async function getFuturesOrders() {
  const { rows } = await db.query(
    'SELECT user_id, planned_json, status, review_result_id, order_id, failure_reason FROM futures_order',
  );
  return rows as {
    user_id: string;
    planned_json: string;
    status: FuturesOrderStatus;
    review_result_id: string;
    order_id: string;
    failure_reason: string | null;
  }[];
}

export async function getFuturesOrdersByReviewResult(reviewResultId: string) {
  const { rows } = await db.query(
    'SELECT * FROM futures_order WHERE review_result_id = $1 ORDER BY created_at ASC, order_id ASC',
    [reviewResultId],
  );
  return rows as {
    user_id: string;
    planned_json: string;
    status: FuturesOrderStatus;
    order_id: string;
    failure_reason: string | null;
  }[];
}

export async function clearFuturesOrders() {
  await db.query('TRUNCATE futures_order RESTART IDENTITY CASCADE');
}
