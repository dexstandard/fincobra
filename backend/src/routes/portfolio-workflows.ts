import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { z } from 'zod';
import {
  getPortfolioWorkflow,
  getPortfolioWorkflowsPaginated,
  getPortfolioWorkflowsPaginatedAdmin,
  toApi,
  insertPortfolioWorkflow,
  updatePortfolioWorkflow,
  deletePortfolioWorkflow as repoDeleteWorkflow,
  startPortfolioWorkflow as repoStartWorkflow,
  stopPortfolioWorkflow as repoStopWorkflow,
} from '../repos/portfolio-workflows.js';
import type { PortfolioWorkflow } from '../repos/portfolio-workflows.types.js';
import { getPortfolioReviewResults } from '../repos/review-result.js';
import { errorResponse, ERROR_MESSAGES } from '../util/error-messages.js';
import {
  reviewWorkflowPortfolio,
  removeWorkflowFromSchedule,
} from '../workflows/portfolio-review.js';
import { requireAdmin, requireUserId } from '../util/auth.js';
import { RATE_LIMITS } from '../rate-limit.js';
import {
  PortfolioWorkflowStatus,
  preparePortfolioWorkflowForUpsert,
  validateTokenConflicts,
  validateTradingPairs,
  ensureApiKeys,
  getStartBalance,
} from '../services/portfolio-workflows.js';
import { getLimitOrdersByReviewResult } from '../repos/limit-orders.js';
import { LimitOrderStatus } from '../repos/limit-orders.types.js';
import { createDecisionLimitOrders } from '../services/rebalance.js';
import { getRebalanceInfo } from '../repos/review-result.js';
import { getPromptForReviewResult } from '../repos/review-raw-log.js';
import { cancelLimitOrder } from '../services/limit-order.js';
import { cancelOrdersForWorkflow } from '../services/order-orchestrator.js';
import { CANCEL_ORDER_REASONS } from '../services/order-orchestrator.types.js';
import { parseBinanceError } from '../services/binance-client.js';
import type {
  MainTraderDecision,
  MainTraderOrder,
} from '../agents/main-trader.types.js';
import { developerInstructions } from '../agents/main-trader.js';
import { adminOnlyPreHandlers, getValidatedUserId } from './_shared/guards.js';
import { parseBody, parseRequestParams } from './_shared/validation.js';

const idParams = z.object({ id: z.string().regex(/^\d+$/) });
const logIdParams = z.object({ logId: z.string().regex(/^\d+$/) });
const orderIdParams = z.object({
  logId: z.string().regex(/^\d+$/),
  orderId: z.string(),
});

const workflowTokenSchema = z.object({
  token: z.string(),
  minAllocation: z.number(),
});

const workflowUpsertSchema = z
  .object({
    model: z
      .string()
      .optional()
      .transform((value) => value ?? ''),
    cash: z
      .string()
      .optional()
      .transform((value) => value ?? ''),
    tokens: z.array(workflowTokenSchema),
    risk: z.string(),
    reviewInterval: z.string(),
    agentInstructions: z.string(),
    manualRebalance: z.boolean().optional().default(false),
    useEarn: z.boolean().optional().default(false),
    useFutures: z.boolean().optional().default(false),
    status: z.nativeEnum(PortfolioWorkflowStatus),
  })
  .strip();

const paginationQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).optional(),
  pageSize: z.string().regex(/^\d+$/).optional(),
  status: z.nativeEnum(PortfolioWorkflowStatus).optional(),
});

const adminPaginationQuerySchema = paginationQuerySchema.extend({
  userId: z.string().regex(/^\d+$/).optional(),
});

const execLogQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).optional(),
  pageSize: z.string().regex(/^\d+$/).optional(),
  rebalanceOnly: z.string().optional(),
});

const manualPreviewQuerySchema = z.object({
  orderIndex: z.string().optional(),
});

interface ManualRebalanceBody {
  price?: number;
  qty?: number;
  manuallyEdited?: boolean;
  orderIndex?: number;
}

const manualRebalanceBodySchema = z
  .object({
    price: z.number().optional(),
    qty: z.number().optional(),
    manuallyEdited: z.boolean().optional(),
    orderIndex: z.number().int().nonnegative().optional(),
  })
  .strip()
  .optional()
  .transform((body): ManualRebalanceBody => body ?? {});

async function requireAuthenticatedUser(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void | FastifyReply> {
  const userId = requireUserId(req, reply);
  if (!userId) return reply;
  req.validatedUserId = userId;
}

const sessionPreHandlers = [requireAuthenticatedUser];

type WorkflowRequestContext = {
  userId: string;
  sessionUserId: string;
  id: string;
  log: FastifyBaseLogger;
  workflow: PortfolioWorkflow;
  adminId?: string;
};

interface WorkflowRequestOptions {
  allowAdmin?: boolean;
}

async function getWorkflowForRequest(
  req: FastifyRequest,
  reply: FastifyReply,
  options: WorkflowRequestOptions = {},
): Promise<WorkflowRequestContext | undefined> {
  const sessionUserId = getValidatedUserId(req);
  const params = parseRequestParams(idParams, req, reply);
  if (!params) return;
  const { id } = params;
  const workflow = await getPortfolioWorkflow(id);
  if (!workflow || workflow.status === PortfolioWorkflowStatus.Retired) {
    req.log
      .child({ workflowId: id, userId: sessionUserId })
      .error('workflow not found');
    reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
    return;
  }
  const baseLogContext = {
    workflowId: id,
    userId: workflow.userId,
  } as Record<string, unknown>;
  if (workflow.userId !== sessionUserId) {
    if (!options.allowAdmin) {
      req.log
        .child({ ...baseLogContext, requesterId: sessionUserId })
        .error('forbidden');
      reply.code(403).send(errorResponse(ERROR_MESSAGES.forbidden));
      return;
    }
    const adminId = await requireAdmin(req, reply);
    if (!adminId) return;
    const log = req.log.child({
      ...baseLogContext,
      adminUserId: adminId,
      requesterId: sessionUserId,
    });
    return {
      userId: workflow.userId,
      sessionUserId,
      id,
      log,
      workflow,
      adminId,
    };
  }
  const log = req.log.child(baseLogContext);
  return { userId: workflow.userId, sessionUserId, id, log, workflow };
}

async function loadManualDecision(
  log: FastifyBaseLogger,
  workflowId: string,
  logId: string,
): Promise<
  { decision: MainTraderDecision } | { code: number; body: { error: string } }
> {
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
      return { code: 400, body: errorResponse('decision contains no orders') };
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
    typeof record.qty === 'number' &&
    typeof record.limitPrice === 'number' &&
    typeof record.basePrice === 'number' &&
    typeof record.maxPriceDriftPct === 'number'
  );
}

function parsePaginationQuery(
  req: FastifyRequest,
  reply: FastifyReply,
):
  | { page: number; pageSize: number; status?: PortfolioWorkflowStatus }
  | undefined {
  const result = paginationQuerySchema.safeParse(req.query);
  if (!result.success) {
    reply.code(400).send(errorResponse('invalid query parameter'));
    return undefined;
  }
  const { page = '1', pageSize = '10', status } = result.data;
  const pageNumber = Math.max(Number.parseInt(page, 10), 1);
  const pageSizeNumber = Math.max(Number.parseInt(pageSize, 10), 1);
  return { page: pageNumber, pageSize: pageSizeNumber, status };
}

function parseAdminPaginationQuery(
  req: FastifyRequest,
  reply: FastifyReply,
):
  | {
      page: number;
      pageSize: number;
      status?: PortfolioWorkflowStatus;
      userId?: string;
    }
  | undefined {
  const result = adminPaginationQuerySchema.safeParse(req.query);
  if (!result.success) {
    reply.code(400).send(errorResponse('invalid query parameter'));
    return undefined;
  }
  const { page = '1', pageSize = '10', status, userId } = result.data;
  const pageNumber = Math.max(Number.parseInt(page, 10), 1);
  const pageSizeNumber = Math.max(Number.parseInt(pageSize, 10), 1);
  return { page: pageNumber, pageSize: pageSizeNumber, status, userId };
}

function parseExecLogQuery(
  req: FastifyRequest,
  reply: FastifyReply,
): { page: number; pageSize: number; rebalanceOnly: boolean } | undefined {
  const result = execLogQuerySchema.safeParse(req.query);
  if (!result.success) {
    reply.code(400).send(errorResponse('invalid query parameter'));
    return undefined;
  }
  const { page = '1', pageSize = '10', rebalanceOnly } = result.data;
  const pageNumber = Math.max(Number.parseInt(page, 10), 1);
  const pageSizeNumber = Math.max(Number.parseInt(pageSize, 10), 1);
  return {
    page: pageNumber,
    pageSize: pageSizeNumber,
    rebalanceOnly: rebalanceOnly === 'true',
  };
}

function parseManualPreviewQuery(
  req: FastifyRequest,
  reply: FastifyReply,
): { orderIndex: number } | undefined {
  const result = manualPreviewQuerySchema.safeParse(req.query);
  if (!result.success) {
    reply.code(400).send(errorResponse('invalid query parameter'));
    return undefined;
  }
  const { orderIndex } = result.data;
  if (orderIndex === undefined) return { orderIndex: 0 };
  return { orderIndex: Number.parseInt(orderIndex, 10) };
}

export default async function portfolioWorkflowRoutes(app: FastifyInstance) {
  app.get(
    '/portfolio-workflows/paginated',
    {
      config: { rateLimit: RATE_LIMITS.RELAXED },
      preHandler: sessionPreHandlers,
    },
    async (req, reply) => {
      const userId = getValidatedUserId(req);
      const pagination = parsePaginationQuery(req, reply);
      if (!pagination) return;
      const { page, pageSize, status } = pagination;
      const offset = (page - 1) * pageSize;
      const log = req.log.child({ userId });
      const { rows, total } = await getPortfolioWorkflowsPaginated(
        userId,
        status,
        pageSize,
        offset,
      );
      log.info('listed workflows');
      return {
        items: rows.map(toApi),
        total,
        page,
        pageSize,
      };
    },
  );

  app.get(
    '/portfolio-workflows/admin/paginated',
    {
      config: { rateLimit: RATE_LIMITS.RELAXED },
      preHandler: adminOnlyPreHandlers,
    },
    async (req, reply) => {
      const pagination = parseAdminPaginationQuery(req, reply);
      if (!pagination) return;
      const { page, pageSize, status, userId } = pagination;
      const offset = (page - 1) * pageSize;
      const log = req.log.child({
        userId: req.adminUserId,
        targetUserId: userId,
      });
      const { rows, total } = await getPortfolioWorkflowsPaginatedAdmin(
        status,
        pageSize,
        offset,
        userId,
      );
      log.info('admin listed workflows');
      return {
        items: rows.map(toApi),
        total,
        page,
        pageSize,
      };
    },
  );

  app.post(
    '/portfolio-workflows',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: sessionPreHandlers,
    },
    async (req, reply) => {
      const body = parseBody(workflowUpsertSchema, req, reply);
      if (!body) return;
      const userId = getValidatedUserId(req);
      const log = req.log.child({ userId });
      const res = await preparePortfolioWorkflowForUpsert(log, userId, body);
      if ('code' in res) return reply.code(res.code).send(res.body);
      const { body: validated, startBalance } = res;
      const status = validated.status;
      const row = await insertPortfolioWorkflow({
        userId,
        model: validated.model,
        status,
        startBalance,
        cashToken: validated.cash,
        tokens: validated.tokens,
        risk: validated.risk,
        reviewInterval: validated.reviewInterval,
        agentInstructions: validated.agentInstructions,
        manualRebalance: validated.manualRebalance,
        useEarn: validated.useEarn,
        useFutures: validated.useFutures,
      });
      if (status === PortfolioWorkflowStatus.Active)
        reviewWorkflowPortfolio(req.log, row.id).catch((err) =>
          log.error({ err, workflowId: row.id }, 'initial review failed'),
        );
      log.info({ workflowId: row.id }, 'created workflow');
      return toApi(row);
    },
  );

  app.get(
    '/portfolio-workflows/:id/exec-log',
    {
      config: { rateLimit: RATE_LIMITS.RELAXED },
      preHandler: sessionPreHandlers,
    },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply, { allowAdmin: true });
      if (!ctx) return;
      const { id, log } = ctx;
      const query = parseExecLogQuery(req, reply);
      if (!query) return;
      const { page, pageSize, rebalanceOnly } = query;
      const offset = (page - 1) * pageSize;
      const { rows, total } = await getPortfolioReviewResults(
        id,
        pageSize,
        offset,
        rebalanceOnly,
      );
      log.info('fetched exec log');
      return {
        items: rows.map((r) => {
          let orders: unknown[] | undefined;
          try {
            const parsed = JSON.parse(r.log);
            if (parsed && Array.isArray(parsed.orders)) {
              orders = parsed.orders;
            }
          } catch {
            // ignore JSON parse errors and leave orders undefined
          }
          const resp =
            r.rebalance === null
              ? undefined
              : {
                  rebalance: !!r.rebalance,
                  shortReport: r.shortReport ?? '',
                  ...(orders ? { orders } : {}),
                };
          return {
            id: r.id,
            log: r.log,
            ...(resp ? { response: resp } : {}),
            ...(r.error ? { error: JSON.parse(r.error) } : {}),
            createdAt: r.createdAt,
          };
        }),
        total,
        page,
        pageSize,
      };
    },
  );

  app.get(
    '/developer-instructions',
    {
      config: { rateLimit: RATE_LIMITS.RELAXED },
      preHandler: sessionPreHandlers,
    },
    async (req) => {
      req.log.info('fetched developer instructions');
      return { instructions: developerInstructions };
    },
  );

  app.get(
    '/portfolio-workflows/:id/exec-log/:logId/prompt',
    {
      config: { rateLimit: RATE_LIMITS.RELAXED },
      preHandler: sessionPreHandlers,
    },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply, { allowAdmin: true });
      if (!ctx) return;
      const { id, log } = ctx;
      const lp = parseRequestParams(logIdParams, req, reply);
      if (!lp) return;
      const prompt = await getPromptForReviewResult(id, lp.logId);
      if (!prompt) {
        log.error({ execLogId: lp.logId }, 'prompt not found');
        return reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
      }
      log.info({ execLogId: lp.logId }, 'fetched exec prompt');
      return { prompt: JSON.parse(prompt) };
    },
  );

  app.get(
    '/portfolio-workflows/:id/exec-log/:logId/orders',
    {
      config: { rateLimit: RATE_LIMITS.RELAXED },
      preHandler: sessionPreHandlers,
    },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply, { allowAdmin: true });
      if (!ctx) return;
      const { id, log } = ctx;
      const lp = parseRequestParams(logIdParams, req, reply);
      if (!lp) return;
      const { logId } = lp;
      const rows = await getLimitOrdersByReviewResult(id, logId);
      log.info({ execLogId: logId }, 'fetched exec orders');
      return {
        orders: rows.map((r) => {
          const planned = JSON.parse(r.plannedJson);
          return {
            id: r.orderId,
            side: planned.side,
            qty: planned.qty,
            price: planned.price,
            symbol: planned.symbol,
            status: r.status,
            createdAt: r.createdAt.getTime(),
            reason: r.cancellationReason ?? undefined,
          } as const;
        }),
      };
    },
  );

  app.post(
    '/portfolio-workflows/:id/exec-log/:logId/rebalance',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: sessionPreHandlers,
    },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply);
      if (!ctx) return;
      const { id, userId, log, workflow } = ctx;
      if (!workflow.manualRebalance) {
        log.error('workflow not in manual mode');
        return reply.code(400).send(errorResponse('manual rebalance disabled'));
      }
      const lp = parseRequestParams(logIdParams, req, reply);
      if (!lp) return;
      const { logId } = lp;
      const decisionResult = await loadManualDecision(log, id, logId);
      if ('code' in decisionResult)
        return reply.code(decisionResult.code).send(decisionResult.body);
      const body = parseBody(manualRebalanceBodySchema, req, reply);
      if (!body) return;
      const { decision } = decisionResult;
      const orderIndex = body.orderIndex ?? 0;
      if (
        !Number.isInteger(orderIndex) ||
        orderIndex < 0 ||
        orderIndex >= decision.orders.length
      ) {
        log.error({ execLogId: logId, orderIndex }, 'invalid order index');
        return reply.code(400).send(errorResponse('invalid order index'));
      }
      const baseOrder = decision.orders[orderIndex];
      const updatedOrder = { ...baseOrder } as MainTraderOrder & {
        manuallyEdited?: boolean;
      };
      let manuallyEdited = body.manuallyEdited ?? false;
      if (body.price !== undefined) {
        if (!Number.isFinite(body.price) || body.price <= 0) {
          log.error({ execLogId: logId }, 'invalid manual price');
          return reply.code(400).send(errorResponse('invalid price'));
        }
        updatedOrder.limitPrice = body.price;
        updatedOrder.basePrice = body.price;
        manuallyEdited = true;
      }
      if (body.qty !== undefined) {
        if (!Number.isFinite(body.qty) || body.qty <= 0) {
          log.error({ execLogId: logId }, 'invalid manual qty');
          return reply.code(400).send(errorResponse('invalid qty'));
        }
        updatedOrder.qty = body.qty;
        manuallyEdited = true;
      }
      if (manuallyEdited) updatedOrder.manuallyEdited = true;
      await createDecisionLimitOrders({
        userId,
        orders: [updatedOrder],
        reviewResultId: logId,
        log: log.child({ execLogId: logId }),
        useFutures: workflow.useFutures,
      });
      const orders = await getLimitOrdersByReviewResult(id, logId);
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
        return reply.code(400).send(errorResponse(latest.cancellationReason));
      }
      log.info({ execLogId: logId }, 'created manual order');
      return reply.code(201).send({ ok: true });
    },
  );

  app.post(
    '/portfolio-workflows/:id/exec-log/:logId/orders/:orderId/cancel',
    {
      config: { rateLimit: RATE_LIMITS.RELAXED },
      preHandler: sessionPreHandlers,
    },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply);
      if (!ctx) return;
      const { id, userId, log } = ctx;
      const lp = parseRequestParams(orderIdParams, req, reply);
      if (!lp) return;
      const { logId, orderId } = lp;
      const rows = await getLimitOrdersByReviewResult(id, logId);
      const row = rows.find((r) => r.orderId === orderId);
      if (!row) {
        log.error({ execLogId: logId, orderId }, 'order not found');
        return reply.code(404).send(errorResponse('order not found'));
      }
      if (row.status !== LimitOrderStatus.Open) {
        log.error({ execLogId: logId, orderId }, 'order not open');
        return reply.code(400).send(errorResponse('order not open'));
      }
      const planned = JSON.parse(row.plannedJson);
      if (planned.execution === 'futures') {
        log.error(
          { execLogId: logId, orderId },
          'futures order cancellation not supported',
        );
        return reply
          .code(400)
          .send(errorResponse('futures order cancellation not supported'));
      }
      try {
        await cancelLimitOrder(userId, {
          symbol: planned.symbol,
          orderId,
          reason: 'Canceled by user',
        });
        log.info({ execLogId: logId, orderId }, 'canceled order');
        return { ok: true } as const;
      } catch (err) {
        log.error({ err, execLogId: logId, orderId }, 'failed to cancel order');
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
      preHandler: sessionPreHandlers,
    },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply);
      if (!ctx) return;
      const { id, userId, log, workflow } = ctx;
      if (!workflow.manualRebalance) {
        log.error('workflow not in manual mode');
        return reply.code(400).send(errorResponse('manual rebalance disabled'));
      }
      const lp = parseRequestParams(logIdParams, req, reply);
      if (!lp) return;
      const { logId } = lp;
      const decisionResult = await loadManualDecision(log, id, logId);
      if ('code' in decisionResult)
        return reply.code(decisionResult.code).send(decisionResult.body);
      const { decision } = decisionResult;
      const previewQuery = parseManualPreviewQuery(req, reply);
      if (!previewQuery) return;
      const { orderIndex } = previewQuery;
      if (
        !Number.isInteger(orderIndex) ||
        orderIndex < 0 ||
        orderIndex >= decision.orders.length
      ) {
        log.error({ execLogId: logId, orderIndex }, 'invalid order index');
        return reply.code(400).send(errorResponse('invalid order index'));
      }
      const order = decision.orders[orderIndex];
      log.info({ execLogId: logId }, 'previewed manual order');
      return {
        order: {
          side: order.side,
          qty: order.qty,
          price: order.limitPrice,
        },
      };
    },
  );

  app.get(
    '/portfolio-workflows/:id',
    {
      config: { rateLimit: RATE_LIMITS.RELAXED },
      preHandler: sessionPreHandlers,
    },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply, { allowAdmin: true });
      if (!ctx) return;
      const { log, workflow: row } = ctx;
      log.info('fetched workflow');
      return toApi(row);
    },
  );

  app.put(
    '/portfolio-workflows/:id',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: sessionPreHandlers,
    },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply);
      if (!ctx) return;
      const { userId, id, log } = ctx;
      const body = parseBody(workflowUpsertSchema, req, reply);
      if (!body) return;
      const res = await preparePortfolioWorkflowForUpsert(
        log,
        userId,
        body,
        id,
      );
      if ('code' in res) return reply.code(res.code).send(res.body);
      const { body: validated, startBalance } = res;
      const status = validated.status;
      await updatePortfolioWorkflow({
        id,
        model: validated.model,
        status,
        cashToken: validated.cash,
        tokens: validated.tokens,
        risk: validated.risk,
        reviewInterval: validated.reviewInterval,
        agentInstructions: validated.agentInstructions,
        startBalance,
        manualRebalance: validated.manualRebalance,
        useEarn: validated.useEarn,
        useFutures: validated.useFutures,
      });
      const row = (await getPortfolioWorkflow(id))!;
      if (status === PortfolioWorkflowStatus.Active)
        await reviewWorkflowPortfolio(req.log, id);
      log.info('updated workflow');
      return toApi(row);
    },
  );

  app.delete(
    '/portfolio-workflows/:id',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: sessionPreHandlers,
    },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply);
      if (!ctx) return;
      const { id, log } = ctx;
      await repoDeleteWorkflow(id);
      removeWorkflowFromSchedule(id);
      await cancelOrdersForWorkflow({
        workflowId: id,
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
      preHandler: sessionPreHandlers,
    },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply);
      if (!ctx) return;
      const { userId, id, log, workflow: existing } = ctx;
      if (!existing.model) {
        log.error('missing model');
        return reply.code(400).send(errorResponse('model required'));
      }
      const tokens = existing.tokens.map((t: { token: string }) => t.token);
      const pairErr = await validateTradingPairs(
        log,
        existing.cashToken,
        tokens,
      );
      if (pairErr) return reply.code(pairErr.code).send(pairErr.body);
      const conflict = await validateTokenConflicts(log, userId, tokens, id);
      if (conflict) return reply.code(conflict.code).send(conflict.body);
      const keyErr = await ensureApiKeys(log, userId);
      if (keyErr) return reply.code(keyErr.code).send(keyErr.body);
      const bal = await getStartBalance(log, userId, tokens);
      if (typeof bal !== 'number') return reply.code(bal.code).send(bal.body);
      await repoStartWorkflow(id, bal);
      reviewWorkflowPortfolio(req.log, id).catch((err) =>
        log.error({ err }, 'initial review failed'),
      );
      const row = (await getPortfolioWorkflow(id))!;
      log.info('started workflow');
      return toApi(row);
    },
  );

  app.post(
    '/portfolio-workflows/:id/stop',
    {
      config: { rateLimit: RATE_LIMITS.VERY_TIGHT },
      preHandler: sessionPreHandlers,
    },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply);
      if (!ctx) return;
      const { id, log } = ctx;
      await repoStopWorkflow(id);
      try {
        await cancelOrdersForWorkflow({
          workflowId: id,
          reason: CANCEL_ORDER_REASONS.WORKFLOW_STOPPED,
          log,
        });
      } catch (err) {
        log.error({ err }, 'failed to cancel open orders after stop');
      }
      const row = (await getPortfolioWorkflow(id))!;
      log.info('stopped workflow');
      return toApi(row);
    },
  );

  app.post(
    '/portfolio-workflows/:id/review',
    {
      config: { rateLimit: RATE_LIMITS.VERY_TIGHT },
      preHandler: sessionPreHandlers,
    },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply);
      if (!ctx) return;
      const { id, log, workflow } = ctx;
      if (workflow.status !== PortfolioWorkflowStatus.Active) {
        log.error('workflow not active');
        return reply.code(400).send(errorResponse('workflow not active'));
      }
      try {
        await reviewWorkflowPortfolio(req.log, id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'manual review failed';
        log.error({ err: msg }, 'manual review failed');
        return reply.code(400).send(errorResponse(msg));
      }
      log.info('manual review triggered');
      return { ok: true };
    },
  );
}
