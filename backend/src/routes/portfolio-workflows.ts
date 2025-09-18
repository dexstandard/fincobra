import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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
  type PortfolioWorkflowRow,
} from '../repos/portfolio-workflow.js';
import { getPortfolioReviewResults } from '../repos/review-result.js';
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
import { createDecisionLimitOrders } from '../services/rebalance.js';
import { getRebalanceInfo } from '../repos/review-result.js';
import { getPromptForReviewResult } from '../repos/review-raw-log.js';
import { parseParams } from '../util/validation.js';
import { cancelLimitOrder } from '../services/limit-order.js';
import {
  CANCEL_ORDER_REASONS,
  cancelOrdersForWorkflow,
} from '../services/order-orchestrator.js';
import { parseBinanceError } from '../services/binance.js';
import type { MainTraderDecision, MainTraderOrder } from '../agents/main-trader.js';

const idParams = z.object({ id: z.string().regex(/^\d+$/) });
const logIdParams = z.object({ logId: z.string().regex(/^\d+$/) });


type WorkflowRequestContext = {
  userId: string;
  id: string;
  log: FastifyBaseLogger;
  workflow: PortfolioWorkflowRow;
};

async function getWorkflowForRequest(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<WorkflowRequestContext | undefined> {
  const userId = requireUserId(req, reply);
  if (!userId) return;
  const params = parseParams(idParams, req.params, reply);
  if (!params) return;
  const { id } = params;
  const log = req.log.child({ userId, workflowId: id });
  const workflow = await getAgent(id);
  if (!workflow || workflow.status === AgentStatus.Retired) {
    log.error('workflow not found');
    reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
    return;
  }
  if (workflow.user_id !== userId) {
    log.error('forbidden');
    reply.code(403).send(errorResponse(ERROR_MESSAGES.forbidden));
    return;
  }
  return { userId, id, log, workflow };
}

async function loadManualDecision(
  log: FastifyBaseLogger,
  workflowId: string,
  logId: string,
): Promise<{ decision: MainTraderDecision } | { code: number; body: { error: string } }>
{
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
    const shortReport = typeof maybeDecision.shortReport === 'string'
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
      const { page = '1', pageSize = '10', status } = req.query as {
        page?: string;
        pageSize?: string;
        status?: AgentStatus;
      };
      const p = Math.max(parseInt(page, 10), 1);
      const ps = Math.max(parseInt(pageSize, 10), 1);
      const offset = (p - 1) * ps;
      const { rows, total } = await getAgentsPaginated(userId, status, ps, offset);
      log.info('listed workflows');
      return {
        items: rows.map(toApi),
        total,
        page: p,
        pageSize: ps,
      };
    }
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
        if (status === AgentStatus.Active)
          reviewAgentPortfolio(req.log, row.id).catch((err) =>
            log.error({ err, workflowId: row.id }, 'initial review failed'),
          );
        log.info({ workflowId: row.id }, 'created workflow');
        return toApi(row);
      }
    );

  app.get(
    '/portfolio-workflows/:id/exec-log',
    { config: { rateLimit: RATE_LIMITS.RELAXED } },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply);
      if (!ctx) return;
      const { id, log } = ctx;
      const { page = '1', pageSize = '10', rebalanceOnly } = req.query as {
        page?: string;
        pageSize?: string;
        rebalanceOnly?: string;
      };
      const p = Math.max(parseInt(page, 10), 1);
      const ps = Math.max(parseInt(pageSize, 10), 1);
      const offset = (p - 1) * ps;
      const ro = rebalanceOnly === 'true';
      const { rows, total } = await getPortfolioReviewResults(id, ps, offset, ro);
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
        page: p,
        pageSize: ps,
      };
    }
  );

  app.get(
    '/portfolio-workflows/:id/exec-log/:logId/prompt',
    { config: { rateLimit: RATE_LIMITS.RELAXED } },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply);
      if (!ctx) return;
      const { id, log } = ctx;
      const lp = parseParams(logIdParams, req.params, reply);
      if (!lp) return;
      const prompt = await getPromptForReviewResult(id, lp.logId);
      if (!prompt) {
        log.error({ execLogId: lp.logId }, 'prompt not found');
        return reply
          .code(404)
          .send(errorResponse(ERROR_MESSAGES.notFound));
      }
      log.info({ execLogId: lp.logId }, 'fetched exec prompt');
      return { prompt: JSON.parse(prompt) };
    },
  );

  app.get(
    '/portfolio-workflows/:id/exec-log/:logId/orders',
    { config: { rateLimit: RATE_LIMITS.RELAXED } },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply);
      if (!ctx) return;
      const { id, log } = ctx;
      const lp = parseParams(logIdParams, req.params, reply);
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
            quantity: planned.quantity,
            price: planned.price,
            symbol: planned.symbol,
            status: r.status,
            createdAt: r.createdAt.getTime(),
            cancellationReason: r.cancellationReason ?? undefined,
          } as const;
        }),
      };
    },
  );

  app.post(
    '/portfolio-workflows/:id/exec-log/:logId/rebalance',
    { config: { rateLimit: RATE_LIMITS.TIGHT } },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply);
      if (!ctx) return;
      const { id, userId, log, workflow } = ctx;
      if (!workflow.manual_rebalance) {
        log.error('workflow not in manual mode');
        return reply
          .code(400)
          .send(errorResponse('manual rebalance disabled'));
      }
      const lp = parseParams(logIdParams, req.params, reply);
      if (!lp) return;
      const { logId } = lp;
      const decisionResult = await loadManualDecision(log, id, logId);
      if ('code' in decisionResult)
        return reply.code(decisionResult.code).send(decisionResult.body);
      const body = req.body as
        | {
            price?: number;
            quantity?: number;
            manuallyEdited?: boolean;
            orderIndex?: number;
          }
        | undefined;
      const { decision } = decisionResult;
      const orderIndex = body?.orderIndex ?? 0;
      if (!Number.isInteger(orderIndex) || orderIndex < 0 || orderIndex >= decision.orders.length) {
        log.error({ execLogId: logId, orderIndex }, 'invalid order index');
        return reply.code(400).send(errorResponse('invalid order index'));
      }
      const baseOrder = decision.orders[orderIndex];
      const updatedOrder = { ...baseOrder } as MainTraderOrder & {
        manuallyEdited?: boolean;
      };
      let manuallyEdited = body?.manuallyEdited ?? false;
      if (body?.price !== undefined) {
        if (!Number.isFinite(body.price) || body.price <= 0) {
          log.error({ execLogId: logId }, 'invalid manual price');
          return reply.code(400).send(errorResponse('invalid price'));
        }
        updatedOrder.limitPrice = body.price;
        updatedOrder.basePrice = body.price;
        manuallyEdited = true;
      }
      if (body?.quantity !== undefined) {
        if (!Number.isFinite(body.quantity) || body.quantity <= 0) {
          log.error({ execLogId: logId }, 'invalid manual quantity');
          return reply.code(400).send(errorResponse('invalid quantity'));
        }
        updatedOrder.quantity = body.quantity;
        manuallyEdited = true;
      }
      if (manuallyEdited) updatedOrder.manuallyEdited = true;
      await createDecisionLimitOrders({
        userId,
        orders: [updatedOrder],
        reviewResultId: logId,
        log: log.child({ execLogId: logId }),
      });
      const orders = await getLimitOrdersByReviewResult(id, logId);
      if (!orders.length) {
        log.error({ execLogId: logId }, 'manual order not created');
        return reply
          .code(400)
          .send(errorResponse('failed to create limit order'));
      }
      const latest = orders[orders.length - 1];
      if (latest.status === 'canceled' && latest.cancellationReason) {
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

  const orderIdParams = z.object({ logId: z.string(), orderId: z.string() });

  app.post(
    '/portfolio-workflows/:id/exec-log/:logId/orders/:orderId/cancel',
    { config: { rateLimit: RATE_LIMITS.RELAXED } },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply);
      if (!ctx) return;
      const { id, userId, log } = ctx;
      const lp = parseParams(orderIdParams, req.params, reply);
      if (!lp) return;
      const { logId, orderId } = lp;
      const rows = await getLimitOrdersByReviewResult(id, logId);
      const row = rows.find((r) => r.orderId === orderId);
      if (!row) {
        log.error({ execLogId: logId, orderId }, 'order not found');
        return reply.code(404).send(errorResponse('order not found'));
      }
      if (row.status !== 'open') {
        log.error({ execLogId: logId, orderId }, 'order not open');
        return reply.code(400).send(errorResponse('order not open'));
      }
      const planned = JSON.parse(row.plannedJson);
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
        return reply.code(500).send(errorResponse(msg || 'failed to cancel order'));
      }
    },
  );

  app.get(
    '/portfolio-workflows/:id/exec-log/:logId/rebalance/preview',
    { config: { rateLimit: RATE_LIMITS.RELAXED } },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply);
      if (!ctx) return;
      const { id, userId, log, workflow } = ctx;
      if (!workflow.manual_rebalance) {
        log.error('workflow not in manual mode');
        return reply
          .code(400)
          .send(errorResponse('manual rebalance disabled'));
      }
      const lp = parseParams(logIdParams, req.params, reply);
      if (!lp) return;
      const { logId } = lp;
      const decisionResult = await loadManualDecision(log, id, logId);
      if ('code' in decisionResult)
        return reply.code(decisionResult.code).send(decisionResult.body);
      const { decision } = decisionResult;
      const { orderIndex: rawOrderIndex } = req.query as { orderIndex?: string };
      const orderIndex = rawOrderIndex ? Number.parseInt(rawOrderIndex, 10) : 0;
      if (!Number.isInteger(orderIndex) || orderIndex < 0 || orderIndex >= decision.orders.length) {
        log.error({ execLogId: logId, orderIndex }, 'invalid order index');
        return reply.code(400).send(errorResponse('invalid order index'));
      }
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
    { config: { rateLimit: RATE_LIMITS.RELAXED } },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply);
      if (!ctx) return;
      const { log, workflow: row } = ctx;
      log.info('fetched workflow');
      return toApi(row);
    }
  );

    app.put(
      '/portfolio-workflows/:id',
      { config: { rateLimit: RATE_LIMITS.TIGHT } },
      async (req, reply) => {
        const ctx = await getWorkflowForRequest(req, reply);
        if (!ctx) return;
        const { userId, id, log } = ctx;
        const body = req.body as AgentInput;
        const res = await prepareAgentForUpsert(log, userId, body, id);
        if ('code' in res) return reply.code(res.code).send(res.body);
        const { body: validated, startBalance } = res;
        const status = validated.status;
        await updateAgent({
          id,
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
        const row = (await getAgent(id))!;
        if (status === AgentStatus.Active)
          await reviewAgentPortfolio(req.log, id);
        log.info('updated workflow');
        return toApi(row);
      }
    );

  app.delete(
    '/portfolio-workflows/:id',
    { config: { rateLimit: RATE_LIMITS.TIGHT } },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply);
      if (!ctx) return;
      const { id, log } = ctx;
      await repoDeleteAgent(id);
      removeWorkflowFromSchedule(id);
      await cancelOrdersForWorkflow({
        workflowId: id,
        reason: CANCEL_ORDER_REASONS.WORKFLOW_DELETED,
        log,
      });
      log.info('deleted workflow');
      return { ok: true };
    }
  );

  app.post(
    '/portfolio-workflows/:id/start',
    { config: { rateLimit: RATE_LIMITS.VERY_TIGHT } },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply);
      if (!ctx) return;
      const { userId, id, log, workflow: existing } = ctx;
      if (!existing.model) {
        log.error('missing model');
        return reply.code(400).send(errorResponse('model required'));
      }
      const tokens = existing.tokens.map((t: { token: string }) => t.token);
      const conflict = await validateTokenConflicts(
        log,
        userId,
        tokens,
        id,
      );
      if (conflict) return reply.code(conflict.code).send(conflict.body);
      const keyErr = await ensureApiKeys(log, userId);
      if (keyErr) return reply.code(keyErr.code).send(keyErr.body);
      const bal = await getStartBalance(log, userId, tokens);
      if (typeof bal !== 'number') return reply.code(bal.code).send(bal.body);
      await repoStartAgent(id, bal);
      reviewAgentPortfolio(req.log, id).catch((err) =>
        log.error({ err }, 'initial review failed')
      );
      const row = (await getAgent(id))!;
      log.info('started workflow');
      return toApi(row);
    }
  );

  app.post(
    '/portfolio-workflows/:id/stop',
    { config: { rateLimit: RATE_LIMITS.VERY_TIGHT } },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply);
      if (!ctx) return;
      const { id, log } = ctx;
      await repoStopAgent(id);
      try {
        await cancelOrdersForWorkflow({
          workflowId: id,
          reason: CANCEL_ORDER_REASONS.WORKFLOW_STOPPED,
          log,
        });
      } catch (err) {
        log.error({ err }, 'failed to cancel open orders after stop');
      }
      const row = (await getAgent(id))!;
      log.info('stopped workflow');
      return toApi(row);
    }
  );

  app.post(
    '/portfolio-workflows/:id/review',
    { config: { rateLimit: RATE_LIMITS.VERY_TIGHT } },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply);
      if (!ctx) return;
      const { id, log, workflow } = ctx;
      if (workflow.status !== AgentStatus.Active) {
        log.error('workflow not active');
        return reply
          .code(400)
          .send(errorResponse('workflow not active'));
      }
      try {
        await reviewAgentPortfolio(req.log, id);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'manual review failed';
        log.error({ err: msg }, 'manual review failed');
        return reply.code(400).send(errorResponse(msg));
      }
      log.info('manual review triggered');
      return { ok: true };
    }
  );
}
