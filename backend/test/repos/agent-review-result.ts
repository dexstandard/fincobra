import { insertReviewResult as insertReviewResultProd } from '../../src/repos/agent-review-result.js';

export function insertReviewResult(entry: any) {
  return insertReviewResultProd({
    portfolioId: entry.portfolioId,
    log: entry.log,
    rebalance: entry.rebalance,
    shortReport: entry.shortReport,
    error: entry.error,
    rawLogId: entry.rawLogId,
  });
}
