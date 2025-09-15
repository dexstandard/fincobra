import type { FastifyBaseLogger } from 'fastify';
import {
  getActivePortfolioWorkflowById,
  getActivePortfolioWorkflowsByInterval,
  type ActivePortfolioWorkflowRow,
} from '../repos/portfolio-workflow.js';
import {
  run as runMainTrader,
  collectPromptData,
  type MainTraderDecision,
} from '../agents/main-trader.js';
import { runNewsAnalyst } from '../agents/news-analyst.js';
import { runTechnicalAnalyst } from '../agents/technical-analyst.js';
import { insertReviewRawLog } from '../repos/agent-review-raw-log.js';
import {
  getOpenLimitOrdersForAgent,
  updateLimitOrderStatus,
} from '../repos/limit-orders.js';
import { env } from '../util/env.js';
import { decrypt } from '../util/crypto.js';
import {
  insertReviewResult,
  type ReviewResultInsert,
  type ReviewResultError,
} from '../repos/agent-review-result.js';
import { parseExecLog, validateExecResponse } from '../util/parse-exec-log.js';
import {
  cancelOrder,
  parseBinanceError,
} from '../services/binance.js';
import { createDecisionLimitOrders } from '../services/rebalance.js';
import { type RebalancePrompt } from '../agents/types.js';
import pLimit from 'p-limit';
import { randomUUID } from 'crypto';

/** Workflows currently running. Used to avoid concurrent runs. */
const runningWorkflows = new Set<string>();

export function removeWorkflowFromSchedule(id: string) {
  runningWorkflows.delete(id);
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
        log.child({ userId: wf.user_id, portfolioId: wf.id }),
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
  const orders = await getOpenLimitOrdersForAgent(wf.id);
  const limit = (pLimit as any)(5);
  await Promise.all(
    orders.map((o) =>
      limit(async () => {
        const planned = JSON.parse(o.planned_json);
        try {
          await cancelOrder(o.user_id, {
            symbol: planned.symbol,
            orderId: Number(o.order_id),
          });
          await updateLimitOrderStatus(o.user_id, o.order_id, 'canceled');
          log.info({ orderId: o.order_id }, 'canceled stale order');
        } catch (err) {
          const { code } = parseBinanceError(err);
          if (code === -2013) {
            await updateLimitOrderStatus(o.user_id, o.order_id, 'filled');
          } else {
            log.error({ err }, 'failed to cancel order');
          }
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
  const entry: ReviewResultInsert = {
    portfolioId: workflowId,
    log: decision ? JSON.stringify(decision) : '',
    rawLogId: logId,
  };

  if (decision && !validationError) {
    entry.rebalance = decision.orders.length > 0;
    entry.shortReport = decision.shortReport;
  } else {
    entry.error = { message: validationError ?? 'decision unavailable' };
  }

  return entry;
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

    const key = decrypt(wf.ai_api_key_enc, env.KEY_PASSWORD);

    prompt = await runStep('collectPromptData', () => collectPromptData(wf, runLog));
    if (!prompt) {
      await saveFailure(wf, 'failed to collect prompt data');
      runLog.info('workflow run complete');
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
        portfolioId: wf.id,
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
      !wf.manual_rebalance &&
      decision.orders.length
    ) {
      await createDecisionLimitOrders({
        userId: wf.user_id,
        orders: decision.orders,
        reviewResultId: resultId,
        log: runLog,
      });
    }
    runLog.info('workflow run complete');
  } catch (err) {
    await saveFailure(wf, String(err), prompt);
    runLog.error({ err }, 'workflow run failed');
  }
}

async function saveFailure(
  row: ActivePortfolioWorkflowRow,
  message: string,
  prompt?: RebalancePrompt,
) {
  let rawId: string | undefined;
  if (prompt) {
    rawId = await insertReviewRawLog({
      portfolioId: row.id,
      prompt,
      response: { error: message },
    });
  }
  const parsed = parseExecLog({ error: message });
  const entry: ReviewResultInsert = {
    portfolioId: row.id,
    log: parsed.text,
  };
  if (rawId) entry.rawLogId = rawId;
  if (parsed.response) {
    entry.rebalance = (parsed.response.orders || []).length > 0;
    entry.shortReport = parsed.response.shortReport;
  }
  if (
    parsed.error &&
    typeof (parsed.error as any).message === 'string'
  ) {
    entry.error = {
      message: String((parsed.error as any).message),
    } as ReviewResultError;
  }
  await insertReviewResult(entry);
}

export { reviewPortfolio as reviewAgentPortfolio };

