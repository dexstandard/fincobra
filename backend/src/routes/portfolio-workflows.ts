import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  getAgent,
  getAgentsPaginated,
  toApi,
  insertAgent,
  updateAgent,
  deleteAgent as repoDeleteAgent,
  startAgent as repoStartAgent,
  stopAgent as repoStopAgent,
} from '../repos/portfolio-workflow.js';
import { getPortfolioReviewResults, getRebalanceInfo } from '../repos/review-result.js';
import { errorResponse, ERROR_MESSAGES } from '../util/errorMessages.js';
import {
  reviewAgentPortfolio,
  removeWorkflowFromSchedule,
} from '../workflows/portfolio-review.js';
import { requireUserId } from '../util/auth.js';
import { RATE_LIMITS } from '../rate-limit.js';
import {
  AgentStatus,
  type AgentInput,
  prepareAgentForUpsert,
  validateTokenConflicts,
  ensureApiKeys,
  getStartBalance,
} from '../util/agents.js';
import { getLimitOrdersByReviewResult } from '../repos/limit-orders.js';
import { LimitOrderStatus } from '../repos/limit-orders.types.js';
import { createDecisionLimitOrders } from '../services/rebalance.js';
import { getPromptForReviewResult } from '../repos/review-raw-log.js';
import { parseParams } from '../util/validation.js';
import { cancelLimitOrder } from '../services/limit-order.js';
import {
  CANCEL_ORDER_REASONS,
  cancelOrdersForWorkflow,
} from '../services/order-orchestrator.js';
import { parseBinanceError } from '../services/binance.js';
import type { MainTraderDecision, MainTraderOrder } from '../agents/main-trader.js';
import {
  getWorkflowContext,
  workflowPreHandlers,
  type WorkflowRequestContext,
} from './_shared/workflows.js';
import { workflowLogIdParams, workflowOrderIdParams } from './_shared/validation.js';

interface WorkflowPaginationQuery {
  page?: string;
  pageSize?: string;
  status?: string;
}

interface ExecLogQuery {
  page?: string;
  pageSize?: string;
  rebalanceOnly?: string;
}

const manualRebalanceBodySchema = z
  .object({
    price: z.number().optional(),
    quantity: z.number().optional(),
    manuallyEdited: z.unknown().optional(),
    orderIndex: z.number().optional(),
  })
  .strict();

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseStatus(value: string | undefined): AgentStatus | undefined {
  if (!value) return undefined;
  return (Object.values(AgentStatus) as string[]).includes(value)
    ? (value as AgentStatus)
    : undefined;
}

function parseRebalanceFlag(value: string | undefined): boolean {
  return value === 'true';
}

function ensureManualRebalanceEnabled(
  context: WorkflowRequestContext,
  reply: FastifyReply,
): boolean {
  if (!context.workflow.manualRebalance) {
    context.log.error('workflow not in manual mode');
    reply.code(400).send(errorResponse('manual rebalance disabled'));
    return false;
  }
  return true;
}

function resolveManualBodyError(
  body: Record<string, unknown> | undefined,
): string {
  if (!body) return 'invalid request body';
  if ('orderIndex' in body && typeof body.orderIndex !== 'number')
    return 'invalid order index';
  if ('price' in body && typeof body.price !== 'number') return 'invalid price';
  if ('quantity' in body && typeof body.quantity !== 'number')
    return 'invalid quantity';
  return 'invalid request body';
}

function parseManualRebalanceBody(
  req: FastifyRequest,
  reply: FastifyReply,
  context: WorkflowRequestContext,
  logId: string,
  decision: MainTraderDecision,
): (MainTraderOrder & { manuallyEdited?: boolean }) | undefined {
  const rawBody =
    req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : undefined;
  const result = manualRebalanceBodySchema.safeParse(
    req.body === undefined ? {} : req.body,
  );
  if (!result.success) {
    const message = resolveManualBodyError(rawBody);
    if (message === 'invalid order index') {
      context.log.error(
        { execLogId: logId, orderIndex: rawBody?.orderIndex },
        'invalid order index',
      );
    } else if (message === 'invalid price') {
      context.log.error({ execLogId: logId }, 'invalid manual price');
    } else if (message === 'invalid quantity') {
      context.log.error({ execLogId: logId }, 'invalid manual quantity');
    } else {
      context.log.error({ execLogId: logId }, 'invalid manual order payload');
    }
    reply.code(400).send(errorResponse(message));
    return undefined;
  }
  const { price, quantity, manuallyEdited } = result.data;
  const orderIndex = result.data.orderIndex ?? 0;
  if (
    !Number.isInteger(orderIndex) ||
    orderIndex < 0 ||
    orderIndex >= decision.orders.length
  ) {
    context.log.error({ execLogId: logId, orderIndex }, 'invalid order index');
    reply.code(400).send(errorResponse('invalid order index'));
    return undefined;
  }
  const baseOrder = decision.orders[orderIndex];
  const updatedOrder = {
    ...baseOrder,
  } as MainTraderOrder & { manuallyEdited?: boolean };
  let manualFlag = manuallyEdited !== undefined ? Boolean(manuallyEdited) : false;

  if (price !== undefined) {
    if (!Number.isFinite(price) || price <= 0) {
      context.log.error({ execLogId: logId }, 'invalid manual price');
      reply.code(400).send(errorResponse('invalid price'));
      return undefined;
    }
    updatedOrder.limitPrice = price;
    updatedOrder.basePrice = price;
    manualFlag = true;
  }
  if (quantity !== undefined) {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      context.log.error({ execLogId: logId }, 'invalid manual quantity');
      reply.code(400).send(errorResponse('invalid quantity'));
      return undefined;
    }
    updatedOrder.quantity = quantity;
    manualFlag = true;
  }
  if (manualFlag) updatedOrder.manuallyEdited = true;
  return updatedOrder;
}

function parseOrderIndexQuery(
  req: FastifyRequest,
  reply: FastifyReply,
  context: WorkflowRequestContext,
  logId: string,
  decision: MainTraderDecision,
): number | undefined {
  const { orderIndex: rawOrderIndex } = (req.query ?? {}) as {
    orderIndex?: string;
  };
  const orderIndex = rawOrderIndex
    ? Number.parseInt(rawOrderIndex, 10)
    : 0;
  if (
    !Number.isInteger(orderIndex) ||
    orderIndex < 0 ||
    orderIndex >= decision.orders.length
  ) {
    context.log.error({ execLogId: logId, orderIndex }, 'invalid order index');
    reply.code(400).send(errorResponse('invalid order index'));
    return undefined;
  }
  return orderIndex;
}

function formatExecLogItem(row: {
  id: string;
  log: string;
  rebalance: unknown;
  shortReport: string | null;
  error: string | null;
  createdAt: Date;
}) {
  let orders: unknown[] | undefined;
  try {
    const parsed = JSON.parse(row.log) as { orders?: unknown };
    if (parsed && Array.isArray(parsed.orders)) {
      orders = parsed.orders;
    }
  } catch {
    // ignore JSON parse errors
  }
  const response =
    row.rebalance === null
      ? undefined
      : {
          rebalance: Boolean(row.rebalance),
          shortReport: row.shortReport ?? '',
          ...(orders ? { orders } : {}),
        };
  return {
    id: row.id,
    log: row.log,
    ...(response ? { response } : {}),
    ...(row.error ? { error: JSON.parse(row.error) } : {}),
    createdAt: row.createdAt,
  };
}

function toApiOrder(row: {
  orderId: string;
  plannedJson: string;
  status: LimitOrderStatus;
  createdAt: Date;
  cancellationReason: string | null;
}) {
  const planned = JSON.parse(row.plannedJson) as {
    side: string;
    quantity: number;
    price: number;
    symbol: string;
  };
  return {
    id: row.orderId,
    side: planned.side,
    quantity: planned.quantity,
    price: planned.price,
    symbol: planned.symbol,
    status: row.status,
    createdAt: row.createdAt.getTime(),
    cancellationReason: row.cancellationReason ?? undefined,
  } as const;
}

async function loadManualDecision(
  context: WorkflowRequestContext,
  logId: string,
): Promise<
  | { decision: MainTraderDecision }
  | { code: number; body: { error: string } }
> {
  const { workflowId, log } = context;
  const existing = await getLimitOrdersByReviewResult(workflowId, logId);
  if (existing.length) {
    log.error({ execLogId: logId }, 'manual order exists');
    return {
      code: 400,
      body: errorResponse('order already exists for log'),
    };
  }
  const result = await getRebalanceInfo(workflowId, logId);
  if (!result || !result.rebalance) {
    log.error({ execLogId: logId }, 'no rebalance info');
    return { code: 400, body: errorResponse('no rebalance info') };
  }
  try {
    const parsed = JSON.parse(result.log) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      log.error({ execLogId: logId }, 'invalid decision payload');
      return { code: 400, body: errorResponse('invalid decision payload') };
    }
    const maybeDecision = parsed as Partial<MainTraderDecision>;
    const orders = Array.isArray(maybeDecision.orders)
      ? maybeDecision.orders.filter(isValidManualOrder)
      : [];
    if (!orders.length) {
      log.error({ execLogId: logId }, 'decision contains no orders');
      return {
        code: 400,
        body: errorResponse('decision contains no orders'),
      };
    }
    const shortReport =
      typeof maybeDecision.shortReport === 'string'
        ? maybeDecision.shortReport
        : '';
    return { decision: { orders, shortReport } };
  } catch {
    log.error({ execLogId: logId }, 'failed to parse decision');
    return { code: 400, body: errorResponse('invalid decision payload') };
  }
}

function isValidManualOrder(value: unknown): value is MainTraderOrder {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.pair === 'string' &&
    typeof record.token === 'string' &&
    typeof record.side === 'string' &&
    typeof record.quantity === 'number' &&
    typeof record.limitPrice === 'number' &&
    typeof record.basePrice === 'number' &&
    typeof record.maxPriceDivergencePct === 'number'
  );
}

export default async function portfolioWorkflowRoutes(app: FastifyInstance) {
  app.get(
    '/portfolio-workflows/paginated',
    { config: { rateLimit: RATE_LIMITS.RELAXED } },
    async (req, reply) => {
      const userId = requireUserId(req, reply);
      if (!userId) return;
      const log = req.log.child({ userId });
      const { page, pageSize, status } = (req.query ??
        {}) as WorkflowPaginationQuery;
      const p = parsePositiveInt(page, 1);
      const ps = parsePositiveInt(pageSize, 10);
      const offset = (p - 1) * ps;
      const parsedStatus = parseStatus(status);
      const { rows, total } = await getAgentsPaginated(
        userId,
        parsedStatus,
        ps,
        offset,
      );
      log.info('listed workflows');
      return {
        items: rows.map(toApi),
        total,
        page: p,
        pageSize: ps,
      };
    },
  );

  app.post(
    '/portfolio-workflows',
    { config: { rateLimit: RATE_LIMITS.TIGHT } },
    async (req, reply) => {
      const body = req.body as AgentInput;
      const userId = requireUserId(req, reply);
      if (!userId) return;
      const log = req.log.child({ userId });
      const res = await prepareAgentForUpsert(log, userId, body);
      if ('code' in res) return reply.code(res.code).send(res.body);
      const { body: validated, startBalance } = res;
      const status = validated.status;
      const row = await insertAgent({
        userId,
        model: validated.model,
        status,
        startBalance,
        name: validated.name,
        cashToken: validated.cash,
        tokens: validated.tokens,
        risk: validated.risk,
        reviewInterval: validated.reviewInterval,
        agentInstructions: validated.agentInstructions,
        manualRebalance: validated.manualRebalance,
        useEarn: validated.useEarn,
      });
      if (status === AgentStatus.Active) {
        reviewAgentPortfolio(req.log, row.id).catch((err) =>
          log.error({ err, workflowId: row.id }, 'initial review failed'),
        );
      }
      log.info({ workflowId: row.id }, 'created workflow');
      return toApi(row);
    },
  );

  app.get(
    '/portfolio-workflows/:id/exec-log',
    {
      config: { rateLimit: RATE_LIMITS.RELAXED },
      preHandler: workflowPreHandlers,
    },
    async (req) => {
      const context = getWorkflowContext(req);
      const { workflowId, log } = context;
      const { page, pageSize, rebalanceOnly } = (req.query ??
        {}) as ExecLogQuery;
      const p = parsePositiveInt(page, 1);
      const ps = parsePositiveInt(pageSize, 10);
      const offset = (p - 1) * ps;
      const ro = parseRebalanceFlag(rebalanceOnly);
      const { rows, total } = await getPortfolioReviewResults(
        workflowId,
        ps,
        offset,
        ro,
      );
      log.info('fetched exec log');
      return {
        items: rows.map(formatExecLogItem),
        total,
        page: p,
        pageSize: ps,
      };
    },
  );

  app.get(
    '/portfolio-workflows/:id/exec-log/:logId/prompt',
    {
      config: { rateLimit: RATE_LIMITS.RELAXED },
      preHandler: workflowPreHandlers,
    },
    async (req, reply) => {
      const context = getWorkflowContext(req);
      const { workflowId, log } = context;
      const params = parseParams(workflowLogIdParams, req.params, reply);
      if (!params) return;
      const { logId } = params;
      const prompt = await getPromptForReviewResult(workflowId, logId);
      if (!prompt) {
        log.error({ execLogId: logId }, 'prompt not found');
        return reply
          .code(404)
          .send(errorResponse(ERROR_MESSAGES.notFound));
      }
      log.info({ execLogId: logId }, 'fetched exec prompt');
      return { prompt: JSON.parse(prompt) };
    },
  );

  app.get(
    '/portfolio-workflows/:id/exec-log/:logId/orders',
    {
      config: { rateLimit: RATE_LIMITS.RELAXED },
      preHandler: workflowPreHandlers,
    },
    async (req, reply) => {
      const context = getWorkflowContext(req);
      const { workflowId, log } = context;
      const params = parseParams(workflowLogIdParams, req.params, reply);
      if (!params) return;
      const { logId } = params;
      const rows = await getLimitOrdersByReviewResult(workflowId, logId);
      log.info({ execLogId: logId }, 'fetched exec orders');
      return {
        orders: rows.map(toApiOrder),
      };
    },
  );

  app.post(
    '/portfolio-workflows/:id/exec-log/:logId/rebalance',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: workflowPreHandlers,
    },
    async (req, reply) => {
      const context = getWorkflowContext(req);
      if (!ensureManualRebalanceEnabled(context, reply)) return;
      const { workflowId, userId, log } = context;
      const params = parseParams(workflowLogIdParams, req.params, reply);
      if (!params) return;
      const { logId } = params;
      const decisionResult = await loadManualDecision(context, logId);
      if ('code' in decisionResult)
        return reply.code(decisionResult.code).send(decisionResult.body);
      const { decision } = decisionResult;
      const order = parseManualRebalanceBody(
        req,
        reply,
        context,
        logId,
        decision,
      );
      if (!order) return;
      await createDecisionLimitOrders({
        userId,
        orders: [order],
        reviewResultId: logId,
        log: log.child({ execLogId: logId }),
      });
      const orders = await getLimitOrdersByReviewResult(workflowId, logId);
      if (!orders.length) {
        log.error({ execLogId: logId }, 'manual order not created');
        return reply
          .code(400)
          .send(errorResponse('failed to create limit order'));
      }
      const latest = orders[orders.length - 1];
      if (
        latest.status === LimitOrderStatus.Canceled &&
        latest.cancellationReason
      ) {
        log.error(
          { execLogId: logId, reason: latest.cancellationReason },
          'manual order canceled',
        );
        return reply
          .code(400)
          .send(errorResponse(latest.cancellationReason));
      }
      log.info({ execLogId: logId }, 'created manual order');
      return reply.code(201).send({ ok: true });
    },
  );

  app.post(
    '/portfolio-workflows/:id/exec-log/:logId/orders/:orderId/cancel',
    {
      config: { rateLimit: RATE_LIMITS.RELAXED },
      preHandler: workflowPreHandlers,
    },
    async (req, reply) => {
      const context = getWorkflowContext(req);
      const { workflowId, userId, log } = context;
      const params = parseParams(workflowOrderIdParams, req.params, reply);
      if (!params) return;
      const { logId, orderId } = params;
      const rows = await getLimitOrdersByReviewResult(workflowId, logId);
      const row = rows.find((r) => r.orderId === orderId);
      if (!row) {
        log.error({ execLogId: logId, orderId }, 'order not found');
        return reply.code(404).send(errorResponse('order not found'));
      }
      if (row.status !== LimitOrderStatus.Open) {
        log.error({ execLogId: logId, orderId }, 'order not open');
        return reply.code(400).send(errorResponse('order not open'));
      }
      const planned = JSON.parse(row.plannedJson) as {
        symbol: string;
      };
      try {
        await cancelLimitOrder(userId, {
          symbol: planned.symbol,
          orderId,
          reason: 'Canceled by user',
        });
        log.info({ execLogId: logId, orderId }, 'canceled order');
        return { ok: true } as const;
      } catch (err) {
        log.error(
          { err, execLogId: logId, orderId },
          'failed to cancel order',
        );
        const { msg } = parseBinanceError(err);
        return reply
          .code(500)
          .send(errorResponse(msg || 'failed to cancel order'));
      }
    },
  );

  app.get(
    '/portfolio-workflows/:id/exec-log/:logId/rebalance/preview',
    {
      config: { rateLimit: RATE_LIMITS.RELAXED },
      preHandler: workflowPreHandlers,
    },
    async (req, reply) => {
      const context = getWorkflowContext(req);
      if (!ensureManualRebalanceEnabled(context, reply)) return;
      const { workflowId, log } = context;
      const params = parseParams(workflowLogIdParams, req.params, reply);
      if (!params) return;
      const { logId } = params;
      const decisionResult = await loadManualDecision(context, logId);
      if ('code' in decisionResult)
        return reply.code(decisionResult.code).send(decisionResult.body);
      const { decision } = decisionResult;
      const orderIndex = parseOrderIndexQuery(
        req,
        reply,
        context,
        logId,
        decision,
      );
      if (orderIndex === undefined) return;
      const order = decision.orders[orderIndex];
      log.info({ execLogId: logId }, 'previewed manual order');
      return {
        order: {
          side: order.side,
          quantity: order.quantity,
          price: order.limitPrice,
        },
      };
    },
  );

  app.get(
    '/portfolio-workflows/:id',
    {
      config: { rateLimit: RATE_LIMITS.RELAXED },
      preHandler: workflowPreHandlers,
    },
    async (req) => {
      const context = getWorkflowContext(req);
      context.log.info('fetched workflow');
      return toApi(context.workflow);
    },
  );

  app.put(
    '/portfolio-workflows/:id',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: workflowPreHandlers,
    },
    async (req, reply) => {
      const context = getWorkflowContext(req);
      const { userId, workflowId, log } = context;
      const body = req.body as AgentInput;
      const res = await prepareAgentForUpsert(log, userId, body, workflowId);
      if ('code' in res) return reply.code(res.code).send(res.body);
      const { body: validated, startBalance } = res;
      const status = validated.status;
      await updateAgent({
        id: workflowId,
        model: validated.model,
        status,
        name: validated.name,
        cashToken: validated.cash,
        tokens: validated.tokens,
        risk: validated.risk,
        reviewInterval: validated.reviewInterval,
        agentInstructions: validated.agentInstructions,
        startBalance,
        manualRebalance: validated.manualRebalance,
        useEarn: validated.useEarn,
      });
      const row = (await getAgent(workflowId))!;
      if (status === AgentStatus.Active) {
        await reviewAgentPortfolio(req.log, workflowId);
      }
      log.info('updated workflow');
      return toApi(row);
    },
  );

  app.delete(
    '/portfolio-workflows/:id',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: workflowPreHandlers,
    },
    async (req) => {
      const context = getWorkflowContext(req);
      const { workflowId, log } = context;
      await repoDeleteAgent(workflowId);
      removeWorkflowFromSchedule(workflowId);
      await cancelOrdersForWorkflow({
        workflowId,
        reason: CANCEL_ORDER_REASONS.WORKFLOW_DELETED,
        log,
      });
      log.info('deleted workflow');
      return { ok: true };
    },
  );

  app.post(
    '/portfolio-workflows/:id/start',
    {
      config: { rateLimit: RATE_LIMITS.VERY_TIGHT },
      preHandler: workflowPreHandlers,
    },
    async (req, reply) => {
      const context = getWorkflowContext(req);
      const { userId, workflowId, log, workflow: existing } = context;
      if (!existing.model) {
        log.error('missing model');
        return reply.code(400).send(errorResponse('model required'));
      }
      const tokens = existing.tokens.map((t: { token: string }) => t.token);
      const conflict = await validateTokenConflicts(
        log,
        userId,
        tokens,
        workflowId,
      );
      if (conflict) return reply.code(conflict.code).send(conflict.body);
      const keyErr = await ensureApiKeys(log, userId);
      if (keyErr) return reply.code(keyErr.code).send(keyErr.body);
      const bal = await getStartBalance(log, userId, tokens);
      if (typeof bal !== 'number') return reply.code(bal.code).send(bal.body);
      await repoStartAgent(workflowId, bal);
      reviewAgentPortfolio(req.log, workflowId).catch((err) =>
        log.error({ err }, 'initial review failed'),
      );
      const row = (await getAgent(workflowId))!;
      log.info('started workflow');
      return toApi(row);
    },
  );

  app.post(
    '/portfolio-workflows/:id/stop',
    {
      config: { rateLimit: RATE_LIMITS.VERY_TIGHT },
      preHandler: workflowPreHandlers,
    },
    async (req) => {
      const context = getWorkflowContext(req);
      const { workflowId, log } = context;
      await repoStopAgent(workflowId);
      try {
        await cancelOrdersForWorkflow({
          workflowId,
          reason: CANCEL_ORDER_REASONS.WORKFLOW_STOPPED,
          log,
        });
      } catch (err) {
        log.error({ err }, 'failed to cancel open orders after stop');
      }
      const row = (await getAgent(workflowId))!;
      log.info('stopped workflow');
      return toApi(row);
    },
  );

  app.post(
    '/portfolio-workflows/:id/review',
    {
      config: { rateLimit: RATE_LIMITS.VERY_TIGHT },
      preHandler: workflowPreHandlers,
    },
    async (req, reply) => {
      const context = getWorkflowContext(req);
      const { workflowId, log, workflow } = context;
      if (workflow.status !== AgentStatus.Active) {
        log.error('workflow not active');
        return reply
          .code(400)
          .send(errorResponse('workflow not active'));
      }
      try {
        await reviewAgentPortfolio(req.log, workflowId);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'manual review failed';
        log.error({ err: msg }, 'manual review failed');
        return reply.code(400).send(errorResponse(msg));
      }
      log.info('manual review triggered');
      return { ok: true };
    },
  );
}
