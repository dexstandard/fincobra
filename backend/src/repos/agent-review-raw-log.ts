import { db } from '../db/index.js';
import { convertKeysToCamelCase } from '../util/objectCase.js';
import type { ReviewRawLogInsert, ReviewRawLogEntity } from './types.js';

export async function insertReviewRawLog(entry: ReviewRawLogInsert): Promise<string> {
  const { rows } = await db.query(
    'INSERT INTO agent_review_raw_log (agent_id, prompt, response) VALUES ($1, $2, $3) RETURNING id',
    [entry.portfolioId, JSON.stringify(entry.prompt), JSON.stringify(entry.response)],
  );
  return rows[0].id as string;
}

export async function getPromptForReviewResult(
  portfolioId: string,
  resultId: string,
): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT rl.prompt FROM agent_review_result rr
     JOIN agent_review_raw_log rl ON rr.raw_log_id = rl.id
     WHERE rr.id = $1 AND rr.agent_id = $2`,
    [resultId, portfolioId],
  );
  const entity = rows[0]
    ? (convertKeysToCamelCase(rows[0]) as Pick<ReviewRawLogEntity, 'prompt'>)
    : undefined;
  return entity?.prompt ?? null;
}
