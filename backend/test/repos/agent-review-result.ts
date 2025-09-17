import { insertReviewResult as insertReviewResultProd } from '../../src/repos/review-result';

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
