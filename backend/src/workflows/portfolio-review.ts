import type { FastifyBaseLogger } from 'fastify';
import {
  getActivePortfolioWorkflowById,
  getActivePortfolioWorkflowsByInterval,
} from '../repos/portfolio-workflows.js';
import type {
  ActivePortfolioWorkflow,
  PortfolioWorkflowMode,
} from '../repos/portfolio-workflows.types.js';
import {
  run as runMainTrader,
  collectPromptData,
  clearMainTraderCaches,
} from '../agents/main-trader.js';
import type {
  TraderPromptResult,
  SpotTraderDecision,
  FuturesTraderDecision,
} from '../agents/main-trader.types.js';
import { insertReviewRawLog } from '../repos/review-raw-log.js';
import { getOpenLimitOrdersForWorkflow } from '../repos/limit-orders.js';
import { LimitOrderStatus } from '../repos/limit-orders.types.js';
import { env } from '../util/env.js';
import { decrypt } from '../util/crypto.js';
import { insertReviewResult } from '../repos/review-result.js';
import type { ReviewResultInsert } from '../repos/review-result.types.js';
import { parseExecLog, validateExecResponse } from '../util/parse-exec-log.js';
import { cancelLimitOrder } from '../services/limit-order.js';
import { executeSpotDecision } from '../services/rebalance.js';
import { executeFuturesDecision } from '../services/futures-execution.js';
import { ensureApiKeys } from '../services/portfolio-workflows.js';
import type { SpotRebalancePrompt } from '../agents/main-trader.types.js';
import pLimit from 'p-limit';
import { randomUUID } from 'crypto';
import type { SupportedExchange } from '../services/exchange-gateway.js';
import * as timeUtils from '../util/time.js';

/** Workflows currently running. Used to avoid concurrent runs. */
const runningWorkflows = new Set<string>();

const PRICE_DIVERGENCE_RETRY_LIMIT = 1;
const DEFAULT_GROQ_PRICE_DIVERGENCE_RETRY_DELAY_MS = 60_000;

function getGroqPriceDivergenceRetryDelayMs(): number {
  const raw = process.env.GROQ_PRICE_DIVERGENCE_RETRY_DELAY_MS;
  if (!raw) {
    return DEFAULT_GROQ_PRICE_DIVERGENCE_RETRY_DELAY_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_GROQ_PRICE_DIVERGENCE_RETRY_DELAY_MS;
  }
  return parsed;
}

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
        const exchange =
          typeof planned.exchange === 'string' &&
          planned.exchange.toLowerCase() === 'bybit'
            ? 'bybit'
            : 'binance';
        try {
          const res = await cancelLimitOrder(o.userId, {
            symbol: planned.symbol,
            orderId: o.orderId,
            reason: 'Could not fill within interval',
            exchange,
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
  mode,
  decision,
  logId,
  validationError,
}: {
  workflowId: string;
  mode: PortfolioWorkflowMode;
  decision: SpotTraderDecision | FuturesTraderDecision | null;
  logId: string;
  validationError?: string;
}): ReviewResultInsert {
  if (mode === 'spot') {
    const spotDecision = decision as SpotTraderDecision | null;
    const ok = !!spotDecision && !validationError;
    const orders = spotDecision?.orders ?? [];

    return {
      portfolioWorkflowId: workflowId,
      log: spotDecision ? JSON.stringify(spotDecision) : '',
      rawLogId: logId,
      rebalance: ok ? orders.length > 0 : false,
      ...(ok && spotDecision
        ? { shortReport: spotDecision.shortReport }
        : { error: { message: validationError ?? 'decision unavailable' } }),
    };
  }

  const futuresDecision = decision as FuturesTraderDecision | null;
  const ok = !!futuresDecision;
  const actions = futuresDecision?.actions ?? [];

  return {
    portfolioWorkflowId: workflowId,
    log: futuresDecision ? JSON.stringify(futuresDecision) : '',
    rawLogId: logId,
    rebalance: ok ? actions.length > 0 : false,
    ...(ok && futuresDecision
      ? { shortReport: futuresDecision.shortReport }
      : { error: { message: validationError ?? 'decision unavailable' } }),
  };
}

interface WorkflowAttemptResult {
  kind: 'success' | 'retry' | 'error';
  canceledOrders?: number;
  lastAiRequestAt?: number;
}

type RunWorkflowAttemptFn = (
  wf: ActivePortfolioWorkflow,
  runLog: FastifyBaseLogger,
) => Promise<WorkflowAttemptResult>;

interface ExecuteWorkflowOverrides {
  runWorkflowAttempt?: RunWorkflowAttemptFn;
  wait?: (ms: number) => Promise<void>;
}

export async function executeWorkflow(
  wf: ActivePortfolioWorkflow,
  log: FastifyBaseLogger,
  overrides?: ExecuteWorkflowOverrides,
) {
  const execLogId = randomUUID();
  const baseLog = log.child({ execLogId });
  let lastRetry: WorkflowAttemptResult | null = null;
  let lastAiRequestAt: number | null = null;

  const runAttempt = overrides?.runWorkflowAttempt ?? runWorkflowAttempt;
  const waitFn = overrides?.wait ?? timeUtils.wait;

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

    const attemptStartedAt = Date.now();
    const result = await runAttempt(wf, attemptLog);
    if (typeof result.lastAiRequestAt === 'number') {
      lastAiRequestAt = result.lastAiRequestAt;
    }
    if (result.kind === 'success') {
      return;
    }
    if (result.kind === 'retry') {
      const referenceTime: number =
        typeof result.lastAiRequestAt === 'number'
          ? result.lastAiRequestAt
          : (lastAiRequestAt ?? attemptStartedAt);
      lastAiRequestAt = referenceTime;
      if (wf.aiProvider === 'groq') {
        const elapsed = Date.now() - referenceTime;
        const waitMs = Math.max(
          0,
          getGroqPriceDivergenceRetryDelayMs() - elapsed,
        );
        if (waitMs > 0) {
          attemptLog.info(
            { delayMs: waitMs },
            'delaying price divergence retry for groq rate limits',
          );
          await waitFn(waitMs);
        }
      }
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
  let lastAiRequestAt: number | null = null;
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

  let prompt: TraderPromptResult | undefined;
  let defaultExchange: SupportedExchange | undefined;
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

    const ensuredExchange = await ensureApiKeys(runLog, wf.userId, {
      exchangeKeyId: wf.exchangeApiKeyId,
      requireAi: false,
      requireExchange: false,
      aiProvider: wf.aiProvider,
    });
    if (!('code' in ensuredExchange)) {
      defaultExchange = ensuredExchange.exchangeProvider ?? undefined;
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
      aiProvider: wf.aiProvider,
    };
    lastAiRequestAt = Date.now();
    const decisionResult = await runStep('runMainTrader', () =>
      runMainTrader(params, prompt!, wf.agentInstructions),
    );

    let spotDecision: SpotTraderDecision | null = null;
    let futuresDecision: FuturesTraderDecision | null = null;

    if (decisionResult.mode === 'spot') {
      const decision = decisionResult.decision;
      spotDecision =
        decision && !Array.isArray(decision.orders)
          ? {
              ...decision,
              orders: [],
            }
          : decision;
      if (decision && !Array.isArray(decision.orders)) {
        runLog.info(
          { response: decision },
          'ai decision missing orders; treating as hold',
        );
      }
    } else {
      futuresDecision = decisionResult.decision;
    }
    const logId = await runStep('insertReviewRawLog', () =>
      insertReviewRawLog({
        portfolioWorkflowId: wf.id,
        prompt: prompt!.prompt,
        response: decisionResult.decision,
      }),
    );
    let validationError: string | undefined;
    if (prompt.mode === 'spot') {
      validationError = validateExecResponse(
        spotDecision ?? undefined,
        (prompt.prompt as SpotRebalancePrompt).portfolio.positions.map(
          (p) => p.sym,
        ),
      );
      if (validationError)
        runLog.error({ err: validationError }, 'validation failed');
    }
    const resultEntry = buildReviewResultEntry({
      workflowId: wf.id,
      mode: prompt.mode,
      decision: prompt.mode === 'spot' ? spotDecision : futuresDecision,
      logId,
      validationError,
    });
    const resultId = await runStep('insertReviewResult', () =>
      insertReviewResult(resultEntry),
    );
    if (prompt.mode === 'spot') {
      if (
        spotDecision &&
        !validationError &&
        !wf.manualRebalance &&
        spotDecision.orders.length
      ) {
        const orderResult = await executeSpotDecision({
          userId: wf.userId,
          orders: spotDecision.orders,
          reviewResultId: resultId,
          log: runLog,
          defaultExchange,
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
            ...(lastAiRequestAt !== null && {
              lastAiRequestAt,
            }),
          };
        }
      }
    } else if (
      futuresDecision &&
      !wf.manualRebalance &&
      futuresDecision.actions.length
    ) {
      if (!defaultExchange) {
        runLog.error('workflow run failed: missing exchange provider for futures execution');
      } else {
        const futuresOutcome = await executeFuturesDecision({
          userId: wf.userId,
          actions: futuresDecision.actions,
          reviewResultId: resultId,
          log: runLog,
          exchange: defaultExchange,
          defaultLeverage: wf.futuresDefaultLeverage,
          marginMode: wf.futuresMarginMode,
        });
        runLog.info(
          {
            executedFuturesActions: futuresOutcome.executed,
            failedFuturesActions: futuresOutcome.failed,
            skippedFuturesActions: futuresOutcome.skipped,
          },
          'completed futures execution',
        );
      }
    }
    runLog.info('workflow run complete');
    return {
      kind: 'success',
      ...(lastAiRequestAt !== null && { lastAiRequestAt }),
    };
  } catch (err) {
    if (prompt) {
      await saveFailure(wf, String(err), prompt);
    }
    runLog.error({ err }, 'workflow run failed');
    return {
      kind: 'error',
      ...(lastAiRequestAt !== null && { lastAiRequestAt }),
    };
  }
}

async function saveFailure(
  row: ActivePortfolioWorkflow,
  message: string,
  prompt: TraderPromptResult,
) {
  const rawLogId = await insertReviewRawLog({
    portfolioWorkflowId: row.id,
    prompt: prompt.prompt,
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
