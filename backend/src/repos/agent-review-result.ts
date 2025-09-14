import { db } from '../db/index.js';

export interface ReviewResultError {
  message: string;
}

export interface ReviewResultInsert {
  portfolioId: string;
  log: string;
  rebalance?: boolean;
  newAllocation?: number;
  shortReport?: string;
  error?: ReviewResultError;
  rawLogId?: string;
}

export async function insertReviewResult(entry: ReviewResultInsert): Promise<string> {
  const { rows } = await db.query(
    'INSERT INTO agent_review_result (agent_id, log, rebalance, new_allocation, short_report, error, raw_log_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [
      entry.portfolioId,
      entry.log,
      entry.rebalance ?? false,
      entry.newAllocation ?? null,
      entry.shortReport ?? null,
      entry.error ? JSON.stringify(entry.error) : null,
      entry.rawLogId ?? null,
    ],
  );
  return rows[0].id as string;
}

export async function getRecentReviewResults(portfolioId: string, limit: number) {
  const { rows } = await db.query(
    'SELECT id, created_at, rebalance, new_allocation, short_report, error FROM agent_review_result WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2',
    [portfolioId, limit],
  );
  return (rows as {
    id: string;
    created_at: Date;
    rebalance: boolean | null;
    new_allocation: number | null;
    short_report: string | null;
    error: string | null;
  }[]).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    ...(r.rebalance !== null ? { rebalance: r.rebalance } : {}),
    ...(r.new_allocation !== null ? { newAllocation: r.new_allocation } : {}),
    ...(r.short_report !== null ? { shortReport: r.short_report } : {}),
    ...(r.error !== null
      ? { error: JSON.parse(r.error) as ReviewResultError }
      : {}),
  }));
}

export async function getAgentReviewResults(
  portfolioId: string,
  limit: number,
  offset: number,
  rebalanceOnly = false,
) {
  const filter = rebalanceOnly ? ' AND rebalance IS TRUE' : '';
  const totalRes = await db.query(
    `SELECT COUNT(*) as count FROM agent_review_result WHERE agent_id = $1${filter}`,
    [portfolioId],
  );
  const { rows } = await db.query(
    `SELECT id, log, rebalance, new_allocation, short_report, error, created_at FROM agent_review_result WHERE agent_id = $1${filter} ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [portfolioId, limit, offset],
  );
  return { rows: rows as any[], total: Number(totalRes.rows[0].count) };
}

export async function getRebalanceInfo(portfolioId: string, id: string) {
  const { rows } = await db.query(
    'SELECT rebalance, new_allocation FROM agent_review_result WHERE id = $1 AND agent_id = $2',
    [id, portfolioId],
  );
  const row = rows[0] as { rebalance: boolean | null; new_allocation: number | null } | undefined;
  if (!row) return undefined;
  return {
    rebalance: row.rebalance ?? null,
    newAllocation: row.new_allocation,
  } as { rebalance: boolean | null; newAllocation: number | null };
}
