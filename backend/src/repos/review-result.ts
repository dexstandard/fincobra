import { db } from '../db/index.js';
import { convertKeysToCamelCase } from '../util/object-case.js';
import type {
  ReviewRebalanceInfo,
  ReviewResult,
  ReviewResultError,
  ReviewResultInsert,
  ReviewResultSummary,
} from './review-result.types.js';

export async function insertReviewResult(entry: ReviewResultInsert): Promise<string> {
  const { rows } = await db.query(
    'INSERT INTO review_result (portfolio_workflow_id, log, rebalance, short_report, error, raw_log_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [
      entry.portfolioWorkflowId,
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
  portfolioWorkflowId: string,
  limit: number,
): Promise<ReviewResultSummary[]> {
  const { rows } = await db.query(
    'SELECT id, created_at, rebalance, short_report, error, raw_log_id FROM review_result WHERE portfolio_workflow_id = $1 ORDER BY created_at DESC LIMIT $2',
    [portfolioWorkflowId, limit],
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

export async function getPortfolioReviewResults(
  portfolioWorkflowId: string,
  limit: number,
  offset: number,
  rebalanceOnly = false,
) {
  const filter = rebalanceOnly ? ' AND rebalance IS TRUE' : '';
  const totalRes = await db.query(
    `SELECT COUNT(*) as count FROM review_result WHERE portfolio_workflow_id = $1${filter}`,
    [portfolioWorkflowId],
  );
  const { rows } = await db.query(
    `SELECT id, log, rebalance, short_report, error, created_at, raw_log_id FROM review_result WHERE portfolio_workflow_id = $1${filter} ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [portfolioWorkflowId, limit, offset],
  );
  const entities = rows.map(
    (row) => convertKeysToCamelCase(row) as ReviewResult,
  );
  return { rows: entities, total: Number(totalRes.rows[0].count) };
}

export async function getRebalanceInfo(portfolioWorkflowId: string, id: string) {
  const { rows } = await db.query(
    'SELECT rebalance, log FROM review_result WHERE id = $1 AND portfolio_workflow_id = $2',
    [id, portfolioWorkflowId],
  );
  if (!rows[0]) return undefined;
  return convertKeysToCamelCase(rows[0]) as ReviewRebalanceInfo;
}
