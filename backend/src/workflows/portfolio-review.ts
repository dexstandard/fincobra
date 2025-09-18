import type { FastifyBaseLogger } from 'fastify';
import {
  getActivePortfolioWorkflowById,
  getActivePortfolioWorkflowsByInterval,
  getActivePortfolioWorkflowsByUser,
  deactivateWorkflowsByUser,
  type ActivePortfolioWorkflowRow,
} from '../repos/portfolio-workflow.js';
import {
  run as runMainTrader,
  collectPromptData,
  type MainTraderDecision,
} from '../agents/main-trader.js';
import { runNewsAnalyst } from '../agents/news-analyst.js';
import { runTechnicalAnalyst } from '../agents/technical-analyst.js';
import { insertReviewRawLog } from '../repos/review-raw-log.js';
import { getOpenLimitOrdersForWorkflow } from '../repos/limit-orders.js';
import { env } from '../util/env.js';
import { decrypt } from '../util/crypto.js';
import { insertReviewResult } from '../repos/review-result.js';
import type {
  ReviewResultInsert
} from '../repos/review-result.types.js';
import { parseExecLog, validateExecResponse } from '../util/parse-exec-log.js';
import { cancelLimitOrder } from '../services/limit-order.js';
import {
  CANCEL_ORDER_REASONS,
  cancelOrdersForWorkflow,
} from '../services/order-orchestrator.js';
import { createDecisionLimitOrders } from '../services/rebalance.js';
import { type RebalancePrompt } from '../agents/main-trader.types.js';
import pLimit from 'p-limit';
import { randomUUID } from 'crypto';

/** Workflows currently running. Used to avoid concurrent runs. */
const runningWorkflows = new Set<string>();

export function removeWorkflowFromSchedule(id: string) {
  runningWorkflows.delete(id);
}

interface DisableUserWorkflowsParams {
  log: FastifyBaseLogger;
  userId: string;
  aiKeyId?: string | null;
}

export async function disableUserWorkflows({
  log,
  userId,
  aiKeyId,
}: DisableUserWorkflowsParams): Promise<string[]> {
  const workflows = await getActivePortfolioWorkflowsByUser(userId);
  const relevant = aiKeyId
    ? workflows.filter((wf) => wf.aiApiKeyId === aiKeyId)
    : workflows;

  if (!relevant.length) return [];

  for (const workflow of relevant) {
    try {
      await cancelOrdersForWorkflow({
        workflowId: workflow.id,
        reason: CANCEL_ORDER_REASONS.API_KEY_REMOVED,
        log,
      });
    } catch (err) {
      log.error({ err, workflowId: workflow.id }, 'failed to cancel orders');
    }
  }

  await deactivateWorkflowsByUser(userId, aiKeyId);

  return relevant.map((workflow) => workflow.id);
}

export async function reviewPortfolio(
  log: FastifyBaseLogger,
  workflowId: string,
): Promise<void> {
  const workflow = await getActivePortfolioWorkflowById(workflowId);
  if (!workflow) return;
  const { toRun, skipped } = filterRunningWorkflows([workflow]);
  if (skipped.length) throw new Error('Agent is already reviewing portfolio');
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
  workflowRows: ActivePortfolioWorkflowRow[],
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

function filterRunningWorkflows(workflowRows: ActivePortfolioWorkflowRow[]) {
  const toRun: ActivePortfolioWorkflowRow[] = [];
  const skipped: ActivePortfolioWorkflowRow[] = [];
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
  wf: ActivePortfolioWorkflowRow,
  log: FastifyBaseLogger,
) {
  const orders = await getOpenLimitOrdersForWorkflow(wf.id);
  const limit = (pLimit as any)(5);
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
            res === 'canceled' ? 'canceled stale order' : 'order already filled',
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

export async function executeWorkflow(
  wf: ActivePortfolioWorkflowRow,
  log: FastifyBaseLogger,
) {
  const execLogId = randomUUID();
  const runLog = log.child({ execLogId });
  runLog.info('workflow run start');

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
      return;
    }
    if (!wf.model) {
      runLog.error('workflow run failed: missing model');
      return;
    }

    const key = decrypt(wf.aiApiKeyEnc, env.KEY_PASSWORD);

    prompt = await runStep('collectPromptData', () => collectPromptData(wf, runLog));
    if (!prompt) {
      runLog.error('workflow run failed: could not collect prompt data');
      return;
    }

    const params = { log: runLog, model: wf.model, apiKey: key, portfolioId: wf.id };
    await Promise.all([
      runStep('runNewsAnalyst', () => runNewsAnalyst(params, prompt!)),
      runStep('runTechnicalAnalyst', () => runTechnicalAnalyst(params, prompt!)),
    ]);

    const decision = await runStep('runMainTrader', () => runMainTrader(params, prompt!));
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
    if (validationError) runLog.error({ err: validationError }, 'validation failed');
    const resultEntry = buildReviewResultEntry({
      workflowId: wf.id,
      decision,
      logId,
      validationError,
    });
    const resultId = await runStep('insertReviewResult', () => insertReviewResult(resultEntry));
    if (
      decision &&
      !validationError &&
      !wf.manualRebalance &&
      decision.orders.length
    ) {
      await createDecisionLimitOrders({
        userId: wf.userId,
        orders: decision.orders,
        reviewResultId: resultId,
        log: runLog,
      });
    }
    runLog.info('workflow run complete');
  } catch (err) {
    await saveFailure(wf, String(err), prompt!);
    runLog.error({ err }, 'workflow run failed');
  }
}

async function saveFailure(
  row: ActivePortfolioWorkflowRow,
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
    Array.isArray(parsed.response?.orders) && parsed.response!.orders.length > 0;

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

export { reviewPortfolio as reviewAgentPortfolio };

