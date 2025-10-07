import type { FastifyBaseLogger } from 'fastify';
import {
  getActivePortfolioWorkflowById,
  getActivePortfolioWorkflowsByInterval,
} from '../repos/portfolio-workflows.js';
import type { ActivePortfolioWorkflow } from '../repos/portfolio-workflows.types.js';
import {
  run as runMainTrader,
  collectPromptData,
  clearMainTraderCaches,
} from '../agents/main-trader.js';
import type { MainTraderDecision } from '../agents/main-trader.types.js';
import { insertReviewRawLog } from '../repos/review-raw-log.js';
import { getOpenLimitOrdersForWorkflow } from '../repos/limit-orders.js';
import { LimitOrderStatus } from '../repos/limit-orders.types.js';
import { env } from '../util/env.js';
import { decrypt } from '../util/crypto.js';
import { insertReviewResult } from '../repos/review-result.js';
import type { ReviewResultInsert } from '../repos/review-result.types.js';
import { parseExecLog, validateExecResponse } from '../util/parse-exec-log.js';
import { cancelLimitOrder } from '../services/limit-order.js';
import { createDecisionLimitOrders } from '../services/rebalance.js';
import { type RebalancePrompt } from '../agents/main-trader.types.js';
import pLimit from 'p-limit';
import { randomUUID } from 'crypto';

/** Workflows currently running. Used to avoid concurrent runs. */
const runningWorkflows = new Set<string>();

const PRICE_DIVERGENCE_RETRY_LIMIT = 1;

export function removeWorkflowFromSchedule(id: string): boolean {
  return runningWorkflows.delete(id);
}

export async function reviewPortfolio(
  log: FastifyBaseLogger,
  workflowId: string,
): Promise<void> {
  const workflow = await getActivePortfolioWorkflowById(workflowId);
  if (!workflow) return;
  const { toRun, skipped } = filterRunningWorkflows([workflow]);
  if (skipped.length)
    throw new Error('Workflow is already reviewing portfolio');
  await runReviewWorkflows(log, toRun);
}

export default async function reviewPortfolios(
  log: FastifyBaseLogger,
  interval: string,
): Promise<void> {
  const workflows = await getActivePortfolioWorkflowsByInterval(interval);
  const { toRun } = filterRunningWorkflows(workflows);
  if (!toRun.length) return;
  await runReviewWorkflows(log, toRun);
}

async function runReviewWorkflows(
  log: FastifyBaseLogger,
  workflowRows: ActivePortfolioWorkflow[],
) {
  await Promise.all(
    workflowRows.map((wf) =>
      executeWorkflow(
        wf,
        log.child({ userId: wf.userId, portfolioId: wf.id }),
      ).finally(() => {
        runningWorkflows.delete(wf.id);
      }),
    ),
  );
}

function filterRunningWorkflows(workflowRows: ActivePortfolioWorkflow[]) {
  const toRun: ActivePortfolioWorkflow[] = [];
  const skipped: ActivePortfolioWorkflow[] = [];
  for (const row of workflowRows) {
    if (runningWorkflows.has(row.id)) skipped.push(row);
    else {
      runningWorkflows.add(row.id);
      toRun.push(row);
    }
  }
  return { toRun, skipped };
}

async function cleanupOpenOrders(
  wf: ActivePortfolioWorkflow,
  log: FastifyBaseLogger,
) {
  const orders = await getOpenLimitOrdersForWorkflow(wf.id);
  const limit = pLimit(5);
  await Promise.all(
    orders.map((o) =>
      limit(async () => {
        const planned = JSON.parse(o.plannedJson);
        try {
          const res = await cancelLimitOrder(o.userId, {
            symbol: planned.symbol,
            orderId: o.orderId,
            reason: 'Could not fill within interval',
          });
          log.info(
            { orderId: o.orderId },
            res === LimitOrderStatus.Canceled
              ? 'canceled stale order'
              : 'order already filled',
          );
        } catch (err) {
          log.error({ err }, 'failed to cancel order');
        }
      }),
    ),
  );
}

function buildReviewResultEntry({
  workflowId,
  decision,
  logId,
  validationError,
}: {
  workflowId: string;
  decision: MainTraderDecision | null;
  logId: string;
  validationError?: string;
}): ReviewResultInsert {
  const ok = !!decision && !validationError;

  return {
    portfolioWorkflowId: workflowId,
    log: decision ? JSON.stringify(decision) : '',
    rawLogId: logId,
    rebalance: ok ? decision.orders.length > 0 : false,
    ...(ok
      ? { shortReport: decision.shortReport }
      : { error: { message: validationError ?? 'decision unavailable' } }),
  };
}

interface WorkflowAttemptResult {
  kind: 'success' | 'retry' | 'error';
  canceledOrders?: number;
}

export async function executeWorkflow(
  wf: ActivePortfolioWorkflow,
  log: FastifyBaseLogger,
) {
  const execLogId = randomUUID();
  const baseLog = log.child({ execLogId });
  let lastRetry: WorkflowAttemptResult | null = null;

  let attempt = 0;
  while (attempt <= PRICE_DIVERGENCE_RETRY_LIMIT) {
    const attemptLog =
      attempt === 0 ? baseLog : baseLog.child({ attempt: attempt + 1 });
    if (attempt === 0) {
      attemptLog.info('workflow run start');
    } else {
      attemptLog.info(
        { attempt: attempt + 1 },
        'retrying workflow run after price divergence',
      );
      clearMainTraderCaches();
    }

    const result = await runWorkflowAttempt(wf, attemptLog);
    if (result.kind === 'success') {
      return;
    }
    if (result.kind === 'retry') {
      lastRetry = result;
      attempt += 1;
      continue;
    }
    return;
  }

  baseLog.error(
    {
      attempts: PRICE_DIVERGENCE_RETRY_LIMIT + 1,
      canceledOrders: lastRetry?.canceledOrders ?? 0,
    },
    'workflow run failed: price divergence retry limit reached',
  );
}

async function runWorkflowAttempt(
  wf: ActivePortfolioWorkflow,
  runLog: FastifyBaseLogger,
): Promise<WorkflowAttemptResult> {
  const runStep = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    runLog.info({ step: name }, 'step start');
    try {
      const res = await fn();
      runLog.info({ step: name }, 'step success');
      return res;
    } catch (err) {
      runLog.error({ err, step: name }, 'step failed');
      throw err;
    }
  };

  let prompt: RebalancePrompt | undefined;
  try {
    await runStep('cleanupOpenOrders', () => cleanupOpenOrders(wf, runLog));

    if (!wf.aiApiKeyEnc) {
      runLog.error('workflow run failed: missing AI API key');
      return { kind: 'error' };
    }
    if (!wf.model) {
      runLog.error('workflow run failed: missing model');
      return { kind: 'error' };
    }

    const key = decrypt(wf.aiApiKeyEnc, env.KEY_PASSWORD);

    prompt = await runStep('collectPromptData', () =>
      collectPromptData(wf, runLog),
    );
    if (!prompt) {
      runLog.error('workflow run failed: could not collect prompt data');
      return { kind: 'error' };
    }

    const params = {
      log: runLog,
      model: wf.model,
      apiKey: key,
      portfolioId: wf.id,
    };
    const decision = await runStep('runMainTrader', () =>
      runMainTrader(params, prompt!, wf.agentInstructions),
    );
    const logId = await runStep('insertReviewRawLog', () =>
      insertReviewRawLog({
        portfolioWorkflowId: wf.id,
        prompt: prompt!,
        response: decision,
      }),
    );
    const validationError = validateExecResponse(
      decision ?? undefined,
      prompt!.portfolio.positions.map((p) => p.sym),
    );
    if (validationError)
      runLog.error({ err: validationError }, 'validation failed');
    const resultEntry = buildReviewResultEntry({
      workflowId: wf.id,
      decision,
      logId,
      validationError,
    });
    const resultId = await runStep('insertReviewResult', () =>
      insertReviewResult(resultEntry),
    );
    if (
      decision &&
      !validationError &&
      !wf.manualRebalance &&
      decision.orders.length
    ) {
      const orderResult = await createDecisionLimitOrders({
        userId: wf.userId,
        orders: decision.orders,
        reviewResultId: resultId,
        log: runLog,
      });
      if (orderResult.needsPriceDivergenceRetry) {
        runLog.warn(
          {
            canceledOrders: orderResult.priceDivergenceCancellations,
          },
          'orders canceled due to price divergence',
        );
        return {
          kind: 'retry',
          canceledOrders: orderResult.priceDivergenceCancellations,
        };
      }
    }
    runLog.info('workflow run complete');
    return { kind: 'success' };
  } catch (err) {
    if (prompt) {
      await saveFailure(wf, String(err), prompt);
    }
    runLog.error({ err }, 'workflow run failed');
    return { kind: 'error' };
  }
}

async function saveFailure(
  row: ActivePortfolioWorkflow,
  message: string,
  prompt: RebalancePrompt,
) {
  const rawLogId = await insertReviewRawLog({
    portfolioWorkflowId: row.id,
    prompt,
    response: { error: message },
  });

  const parsed = parseExecLog({ error: message });

  const rebalance =
    Array.isArray(parsed.response?.orders) &&
    parsed.response!.orders.length > 0;

  const entry: ReviewResultInsert = {
    portfolioWorkflowId: row.id,
    log: parsed.text,
    rawLogId,
    rebalance,
    ...(parsed.response?.shortReport != null && {
      shortReport: parsed.response.shortReport,
    }),
    error: {
      message:
        typeof (parsed.error as any)?.message === 'string'
          ? String((parsed.error as any).message)
          : message,
    },
  };

  await insertReviewResult(entry);
}

export { reviewPortfolio as reviewWorkflowPortfolio };
