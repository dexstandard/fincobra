import { insertReviewResult as insertReviewResultProd } from '../../src/repos/review-result.js';

export function insertReviewResult(entry: any) {
  return insertReviewResultProd({
    portfolioWorkflowId: entry.portfolioWorkflowId,
    log: entry.log,
    rebalance: entry.rebalance,
    shortReport: entry.shortReport,
    error: entry.error,
    rawLogId: entry.rawLogId,
  });
}
