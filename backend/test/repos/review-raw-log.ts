import { db } from '../../src/db/index.js';
import { insertReviewRawLog as insertReviewRawLogProd } from '../../src/repos/review-raw-log.js';

export function insertReviewRawLog(entry: any) {
  return insertReviewRawLogProd({
    portfolioWorkflowId: entry.portfolioWorkflowId,
    prompt: entry.prompt,
    response: entry.response,
  });
}

export async function getPortfolioReviewRawResponses(
  portfolioWorkflowId: string,
) {
  const { rows } = await db.query(
    'SELECT response FROM review_raw_log WHERE portfolio_workflow_id = $1',
    [portfolioWorkflowId],
  );
  return rows as { response: string | null }[];
}

export async function getPortfolioReviewRawPromptsResponses(
  portfolioWorkflowId: string,
) {
  const { rows } = await db.query(
    'SELECT prompt, response FROM review_raw_log WHERE portfolio_workflow_id = $1',
    [portfolioWorkflowId],
  );
  return rows as { prompt: string | null; response: string | null }[];
}
