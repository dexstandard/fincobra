import { db } from '../db/index.js';
import { convertKeysToCamelCase } from '../util/objectCase.js';
import type {
  ReviewRebalanceInfo,
  ReviewResult,
  ReviewResultError,
  ReviewResultInsert,
  ReviewResultSummary,
} from './review-result.types.js';

export async function insertReviewResult(entry: ReviewResultInsert): Promise<string> {
  const { rows } = await db.query(
    'INSERT INTO agent_review_result (agent_id, log, rebalance, short_report, error, raw_log_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [
      entry.portfolioId,
      entry.log,
      entry.rebalance ?? false,
      entry.shortReport ?? null,
      entry.error ? JSON.stringify(entry.error) : null,
      entry.rawLogId ?? null,
    ],
  );
  return rows[0].id as string;
}

export async function getRecentReviewResults(
  portfolioId: string,
  limit: number,
): Promise<ReviewResultSummary[]> {
  const { rows } = await db.query(
    'SELECT id, created_at, rebalance, short_report, error, raw_log_id FROM agent_review_result WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2',
    [portfolioId, limit],
  );
  return rows.map((row) => {
    const entity = convertKeysToCamelCase(row) as Pick<
      ReviewResult,
      'id' | 'createdAt' | 'rebalance' | 'shortReport' | 'error'
    >;
    const summary: ReviewResultSummary = {
      id: entity.id,
      createdAt: entity.createdAt,
      rebalance: entity.rebalance ?? false,
      ...(entity.shortReport !== null
        ? { shortReport: entity.shortReport }
        : {}),
    };
    if (entity.error !== null) {
      try {
        summary.error = JSON.parse(entity.error) as ReviewResultError;
      } catch {
        summary.error = { message: entity.error };
      }
    }
    return summary;
  });
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
    `SELECT id, log, rebalance, short_report, error, created_at, raw_log_id FROM agent_review_result WHERE agent_id = $1${filter} ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [portfolioId, limit, offset],
  );
  const entities = rows.map(
    (row) => convertKeysToCamelCase(row) as ReviewResult,
  );
  return { rows: entities, total: Number(totalRes.rows[0].count) };
}

export async function getRebalanceInfo(portfolioId: string, id: string) {
  const { rows } = await db.query(
    'SELECT rebalance, log FROM agent_review_result WHERE id = $1 AND agent_id = $2',
    [id, portfolioId],
  );
  if (!rows[0]) return undefined;
  return convertKeysToCamelCase(rows[0]) as ReviewRebalanceInfo;
}
