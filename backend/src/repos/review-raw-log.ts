import { db } from '../db/index.js';
import { convertKeysToCamelCase } from '../util/objectCase.js';
import type { ReviewRawLogInsert, ReviewRawLog } from './raw-log.types.js';

export async function insertReviewRawLog(entry: ReviewRawLogInsert): Promise<string> {
  const { rows } = await db.query(
    'INSERT INTO agent_review_raw_log (portfolio_workflow_id, prompt, response) VALUES ($1, $2, $3) RETURNING id',
    [
      entry.portfolioWorkflowId,
      JSON.stringify(entry.prompt),
      JSON.stringify(entry.response),
    ],
  );
  return rows[0].id as string;
}

export async function getPromptForReviewResult(
  portfolioWorkflowId: string,
  resultId: string,
): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT rl.prompt FROM agent_review_result rr
     JOIN agent_review_raw_log rl ON rr.raw_log_id = rl.id
     WHERE rr.id = $1 AND rr.portfolio_workflow_id = $2`,
    [resultId, portfolioWorkflowId],
  );
  const entity = rows[0]
    ? (convertKeysToCamelCase(rows[0]) as Pick<ReviewRawLog, 'prompt'>)
    : undefined;
  return entity?.prompt ?? null;
}
