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
} from '../repos/portfolio-workflow.js';
import { getAgentReviewResults } from '../repos/agent-review-result.js';
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
import * as binance from '../services/binance.js';
import {
  getLimitOrdersByReviewResult,
  getOpenLimitOrdersForAgent,
  updateLimitOrderStatus,
} from '../repos/limit-orders.js';
import {
  createRebalanceLimitOrder,
  MIN_LIMIT_ORDER_USD,
} from '../services/rebalance.js';
import { parseBinanceError } from '../services/binance.js';
import { getRebalanceInfo } from '../repos/agent-review-result.js';
import { getPromptForReviewResult } from '../repos/agent-review-raw-log.js';
import { parseParams } from '../util/validation.js';
import { cancelLimitOrder } from '../services/limit-order.js';

const idParams = z.object({ id: z.string().regex(/^\d+$/) });
const logIdParams = z.object({ logId: z.string().regex(/^\d+$/) });


async function getWorkflowForRequest(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<
  { userId: string; id: string; log: FastifyBaseLogger; agent: any } | undefined
> {
  const userId = requireUserId(req, reply);
  if (!userId) return;
  const params = parseParams(idParams, req.params, reply);
  if (!params) return;
  const { id } = params;
  const log = req.log.child({ userId, workflowId: id });
  const agent = await getAgent(id);
  if (!agent || agent.status === AgentStatus.Retired) {
    log.error('workflow not found');
    reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
    return;
  }
  if (agent.user_id !== userId) {
    log.error('forbidden');
    reply.code(403).send(errorResponse(ERROR_MESSAGES.forbidden));
    return;
  }
  return { userId, id, log, agent };
}

async function prepareManualRebalanceData(
  log: FastifyBaseLogger,
  agent: any,
  userId: string,
  workflowId: string,
  logId: string,
): Promise<
  | {
      token1: string;
      token2: string;
      positions: { sym: string; value_usdt: number }[];
      newAllocation: number;
      price1Data: { currentPrice: number };
      price2Data: { currentPrice: number };
      order: { diff: number; quantity: number; currentPrice: number };
    }
  | { code: number; body: { error: string } }
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
  if (!result || !result.rebalance || result.newAllocation === null) {
    log.error({ execLogId: logId }, 'no rebalance info');
    return { code: 400, body: errorResponse('no rebalance info') };
  }
  const token1 = agent.tokens[0].token;
  const token2 = agent.tokens[1].token;
  const account = await binance.fetchAccount(userId);
  if (!account) {
    log.error('missing api keys');
    return { code: 400, body: errorResponse('missing api keys') };
  }
  const bal1 = account.balances.find((b) => b.asset === token1);
  const bal2 = account.balances.find((b) => b.asset === token2);
  if (!bal1 || !bal2) {
    log.error('missing balances');
    return {
      code: 400,
      body: errorResponse('failed to fetch balances'),
    };
  }
  const [price1Data, price2Data, pairPrice] = await Promise.all([
    ['USDT', 'USDC'].includes(token1)
      ? Promise.resolve({ currentPrice: 1 })
      : binance.fetchPairData(token1, 'USDT'),
    ['USDT', 'USDC'].includes(token2)
      ? Promise.resolve({ currentPrice: 1 })
      : binance.fetchPairData(token2, 'USDT'),
    binance.fetchPairData(token1, token2),
  ]);
  const positions = [
    {
      sym: token1,
      value_usdt:
        (Number(bal1.free) + Number(bal1.locked)) * price1Data.currentPrice,
    },
    {
      sym: token2,
      value_usdt:
        (Number(bal2.free) + Number(bal2.locked)) * price2Data.currentPrice,
    },
  ];
  const total = positions[0].value_usdt + positions[1].value_usdt;
  const target1 = (result.newAllocation / 100) * total;
  const diff = target1 - positions[0].value_usdt;
  if (!diff || Math.abs(diff) < MIN_LIMIT_ORDER_USD) {
    log.error({ execLogId: logId }, 'order below minimum');
    return {
      code: 400,
      body: errorResponse('order value below minimum'),
    };
  }
  const quantity = Math.abs(diff) / pairPrice.currentPrice;
  return {
    token1,
    token2,
    positions,
    newAllocation: result.newAllocation,
    price1Data,
    price2Data,
    order: { diff, quantity, currentPrice: pairPrice.currentPrice },
  };
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
      const { rows, total } = await getAgentReviewResults(id, ps, offset, ro);
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
                  ...(r.new_allocation !== null
                    ? { newAllocation: r.new_allocation }
                    : {}),
                  shortReport: r.short_report ?? '',
                  ...(orders ? { orders } : {}),
                };
          return {
            id: r.id,
            log: r.log,
            ...(resp ? { response: resp } : {}),
            ...(r.error ? { error: JSON.parse(r.error) } : {}),
            createdAt: r.created_at,
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
          const planned = JSON.parse(r.planned_json);
          return {
            id: r.order_id,
            side: planned.side,
            quantity: planned.quantity,
            price: planned.price,
            symbol: planned.symbol,
            status: r.status,
            createdAt: r.created_at.getTime(),
            cancellationReason: r.cancellation_reason ?? undefined,
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
      const { id, userId, log, agent } = ctx;
      if (!agent.manual_rebalance) {
        log.error('workflow not in manual mode');
        return reply
          .code(400)
          .send(errorResponse('manual rebalance disabled'));
      }
      const lp = parseParams(logIdParams, req.params, reply);
      if (!lp) return;
      const { logId } = lp;
      const prep = await prepareManualRebalanceData(log, agent, userId, id, logId);
      if ('code' in prep) return reply.code(prep.code).send(prep.body);
      const {
        token1,
        token2,
        positions,
        newAllocation,
        price1Data,
        price2Data,
        order,
      } = prep;
      const body = req.body as
        | { price?: number; quantity?: number; manuallyEdited?: boolean }
        | undefined;
      const info = await binance.fetchPairInfo(token1, token2);
      const wantMoreToken1 = order.diff > 0;
      const side = info.baseAsset === token1
        ? (wantMoreToken1 ? 'BUY' : 'SELL')
        : (wantMoreToken1 ? 'SELL' : 'BUY');
      const defaultPrice = order.currentPrice * (side === 'BUY' ? 0.999 : 1.001);
      const finalPriceRaw = body?.price ?? defaultPrice;
      const finalQuantityRaw = body?.quantity ?? order.quantity;
      const finalPrice = Number(finalPriceRaw.toFixed(info.pricePrecision));
      const finalQuantity = Number(finalQuantityRaw.toFixed(info.quantityPrecision));
      const notional = finalPrice * finalQuantity;
      if (notional < info.minNotional) {
        log.error({ execLogId: logId }, 'order below minimum');
        return reply
          .code(400)
          .send(errorResponse('order value below minimum'));
      }
      const usdValue = (() => {
        if (info.baseAsset === token1) {
          return side === 'BUY'
            ? finalPrice * finalQuantity * price2Data.currentPrice
            : finalQuantity * price1Data.currentPrice;
        }
        return side === 'BUY'
          ? finalPrice * finalQuantity * price1Data.currentPrice
          : finalQuantity * price2Data.currentPrice;
      })();
      if (usdValue < MIN_LIMIT_ORDER_USD) {
        log.error({ execLogId: logId }, 'order below minimum');
        return reply
          .code(400)
          .send(errorResponse('order value below minimum'));
      }
      try {
        await createRebalanceLimitOrder({
          userId,
          tokens: [token1, token2],
          positions,
          newAllocation,
          reviewResultId: logId,
          log: log.child({ execLogId: logId }),
          price: finalPrice,
          quantity: finalQuantity,
          manuallyEdited: body?.manuallyEdited,
        });
      } catch (err) {
        const { msg } = parseBinanceError(err);
        return reply
          .code(400)
          .send(errorResponse(msg || 'failed to create limit order'));
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
      const row = rows.find((r) => r.order_id === orderId);
      if (!row) {
        log.error({ execLogId: logId, orderId }, 'order not found');
        return reply.code(404).send(errorResponse('order not found'));
      }
      if (row.status !== 'open') {
        log.error({ execLogId: logId, orderId }, 'order not open');
        return reply.code(400).send(errorResponse('order not open'));
      }
      const planned = JSON.parse(row.planned_json);
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
      const { id, userId, log, agent } = ctx;
      if (!agent.manual_rebalance) {
        log.error('workflow not in manual mode');
        return reply
          .code(400)
          .send(errorResponse('manual rebalance disabled'));
      }
      const lp = parseParams(logIdParams, req.params, reply);
      if (!lp) return;
      const { logId } = lp;
      const prep = await prepareManualRebalanceData(log, agent, userId, id, logId);
      if ('code' in prep) return reply.code(prep.code).send(prep.body);
      const { token1, token2, order } = prep;
      const info = await binance.fetchPairInfo(token1, token2);
      const wantMoreToken1 = order.diff > 0;
      const side = info.baseAsset === token1
        ? (wantMoreToken1 ? 'BUY' : 'SELL')
        : (wantMoreToken1 ? 'SELL' : 'BUY');
      const price = order.currentPrice * (side === 'BUY' ? 0.999 : 1.001);
      log.info({ execLogId: logId }, 'previewed manual order');
      return { order: { side, quantity: order.quantity, price } };
    },
  );

  app.get(
    '/portfolio-workflows/:id',
    { config: { rateLimit: RATE_LIMITS.RELAXED } },
    async (req, reply) => {
      const ctx = await getWorkflowForRequest(req, reply);
      if (!ctx) return;
      const { log, agent: row } = ctx;
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
      const { userId, id, log } = ctx;
      await repoDeleteAgent(id);
      removeWorkflowFromSchedule(id);
      const openOrders = await getOpenLimitOrdersForAgent(id);
      for (const o of openOrders) {
        let symbol: string | undefined;
        try {
          const planned = JSON.parse(o.planned_json);
          if (typeof planned.symbol === 'string') symbol = planned.symbol;
        } catch (err) {
          log.error({ err, orderId: o.order_id }, 'failed to parse planned order');
        }
        if (!symbol) {
          await updateLimitOrderStatus(
            o.user_id,
            o.order_id,
            'canceled',
            'Workflow deleted',
          );
          continue;
        }
        try {
          await cancelLimitOrder(o.user_id, {
            symbol,
            orderId: o.order_id,
            reason: 'Workflow deleted',
          });
        } catch (err) {
          log.error({ err, symbol, orderId: o.order_id }, 'failed to cancel order');
        }
      }
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
      const { userId, id, log, agent: existing } = ctx;
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
      const { id, log, agent } = ctx;
      if (agent.status !== AgentStatus.Active) {
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
