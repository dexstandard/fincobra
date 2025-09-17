import type { FastifyInstance, FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { RATE_LIMITS } from '../rate-limit.js';
import {
  getAiKeyRow,
  setAiKey,
  clearAiKey,
  getBinanceKeyRow,
  setBinanceKey,
  clearBinanceKey,
  shareAiKey,
  revokeAiKeyShare,
  hasAiKeyShare,
  getAiKeyShareTargets,

} from '../repos/api-keys.js';
import {
  getActivePortfolioWorkflowsByUser,
  deactivateAgentsByUser,
  draftAgentsByUser,
} from '../repos/portfolio-workflow.js';
import { removeWorkflowFromSchedule } from '../workflows/portfolio-review.js';
import { cancelLimitOrder } from '../services/limit-order.js';
import {
  getOpenLimitOrdersForWorkflow,
  updateLimitOrderStatus,
} from '../repos/limit-orders.js';
import { requireUserIdMatch, requireAdmin } from '../util/auth.js';
import {
  ApiKeyType,
  verifyApiKey,
  encryptKey,
  ensureUser,
  ensureKeyAbsent,
  ensureKeyPresent,
  decryptKey,
} from '../util/api-keys.js';
import { errorResponse, ERROR_MESSAGES } from '../util/errorMessages.js';
import { findUserByEmail } from '../repos/users.js';
import { parseParams } from '../util/validation.js';

const idParams = z.object({ id: z.string().regex(/^\d+$/) });

async function cancelOrdersForWorkflow(workflowId: string, log: FastifyBaseLogger) {
  const openOrders = await getOpenLimitOrdersForWorkflow(workflowId);
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
        'API key removed',
      );
      continue;
    }
    try {
      await cancelLimitOrder(o.user_id, {
        symbol,
        orderId: o.order_id,
        reason: 'API key removed',
      });
    } catch (err) {
      log.error({ err, orderId: o.order_id }, 'failed to cancel order');
    }
  }
}

export default async function apiKeyRoutes(app: FastifyInstance) {
  app.post(
    '/users/:id/ai-key',
    { config: { rateLimit: RATE_LIMITS.TIGHT } },
    async (req, reply) => {
      const params = parseParams(idParams, req.params, reply);
      if (!params) return;
  const { id } = params;
  if (!requireUserIdMatch(req, reply, id)) return;
  const { key } = req.body as { key: string };
  const row = await getAiKeyRow(id);
      let err = ensureUser(row);
      if (err) return reply.code(err.code).send(err.body);
      err = ensureKeyAbsent(row?.own, ['ai_api_key_enc']);
      if (err) return reply.code(err.code).send(err.body);
      if (!(await verifyApiKey(ApiKeyType.Ai, key)))
        return reply.code(400).send(errorResponse('verification failed'));
      const enc = encryptKey(key);
      await setAiKey(id, enc);
      return { key: '<REDACTED>' };
    },
  );

  app.get(
    '/users/:id/ai-key',
    { config: { rateLimit: RATE_LIMITS.MODERATE } },
    async (req, reply) => {
      const params = parseParams(idParams, req.params, reply);
      if (!params) return;
  const { id } = params;
  if (!requireUserIdMatch(req, reply, id)) return;
      const row = await getAiKeyRow(id);
      if (!row?.own?.id)
        return reply
          .code(404)
          .send(errorResponse(ERROR_MESSAGES.notFound));
      return { key: '<REDACTED>' };
    },
  );

  app.get(
    '/users/:id/ai-key/shared',
    { config: { rateLimit: RATE_LIMITS.MODERATE } },
    async (req, reply) => {
      const params = parseParams(idParams, req.params, reply);
      if (!params) return;
      const { id } = params;
      if (!requireUserIdMatch(req, reply, id)) return;
      const row = await getAiKeyRow(id);
      if (!row?.shared?.id)
        return reply
          .code(404)
          .send(errorResponse(ERROR_MESSAGES.notFound));
      return { key: '<REDACTED>', shared: true, model: row.shared.model };
    },
  );

  app.put(
    '/users/:id/ai-key',
    { config: { rateLimit: RATE_LIMITS.TIGHT } },
    async (req, reply) => {
      const params = parseParams(idParams, req.params, reply);
      if (!params) return;
      const { id } = params;
      if (!requireUserIdMatch(req, reply, id)) return;
      const { key } = req.body as { key: string };
      const row = await getAiKeyRow(id);
      if (!row?.own?.ai_api_key_enc)
        return reply
          .code(404)
          .send(errorResponse(ERROR_MESSAGES.notFound));
      if (!(await verifyApiKey(ApiKeyType.Ai, key)))
        return reply.code(400).send(errorResponse('verification failed'));
      const enc = encryptKey(key);
      await setAiKey(id, enc);
      return { key: '<REDACTED>' };
    },
  );

  app.delete(
    '/users/:id/ai-key',
    { config: { rateLimit: RATE_LIMITS.VERY_TIGHT } },
    async (req, reply) => {
      const params = parseParams(idParams, req.params, reply);
      if (!params) return;
      const { id } = params;
      if (!requireUserIdMatch(req, reply, id)) return;
      const row = await getAiKeyRow(id);
      if (!row?.own?.ai_api_key_enc)
        return reply
          .code(404)
          .send(errorResponse(ERROR_MESSAGES.notFound));
      const agents = await getActivePortfolioWorkflowsByUser(id);
      for (const agent of agents) {
        removeWorkflowFromSchedule(agent.id);
        try {
          await cancelOrdersForWorkflow(agent.id, req.log);
        } catch (err) {
          req.log.error({ err, workflowId: agent.id }, 'failed to cancel orders');
        }
      }
      await draftAgentsByUser(id);

      const targets = await getAiKeyShareTargets(id);
      for (const targetId of targets) {
        const keyRow = await getAiKeyRow(targetId);
        if (!keyRow?.own && keyRow?.shared) {
          const tAgents = await getActivePortfolioWorkflowsByUser(targetId);
          for (const agent of tAgents) {
            removeWorkflowFromSchedule(agent.id);
            try {
              await cancelOrdersForWorkflow(agent.id, req.log);
            } catch (err) {
              req.log.error({ err, workflowId: agent.id }, 'failed to cancel orders');
            }
          }
          await draftAgentsByUser(targetId);
        }
        await revokeAiKeyShare(id, targetId);
      }
      await clearAiKey(id);
      return { ok: true };
    },
  );

  app.post(
    '/users/:id/ai-key/share',
    { config: { rateLimit: RATE_LIMITS.MODERATE } },
    async (req, reply) => {
      const params = parseParams(idParams, req.params, reply);
      if (!params) return;
      const { id } = params;
      const adminId = await requireAdmin(req, reply);
      if (!adminId || adminId !== id) return;
      const { email, model } = req.body as { email: string; model: string };
      if (!model)
        return reply.code(400).send(errorResponse('model required'));
      const row = await getAiKeyRow(id);
      const err = ensureKeyPresent(row?.own, ['ai_api_key_enc']);
      if (err) return reply.code(err.code).send(err.body);
      const target = await findUserByEmail(email);
      if (!target) return reply.code(404).send(errorResponse('user not found'));
      await shareAiKey(id, target.id, model);
      return { ok: true };
    },
  );

  app.delete(
    '/users/:id/ai-key/share',
    { config: { rateLimit: RATE_LIMITS.MODERATE } },
    async (req, reply) => {
      const params = parseParams(idParams, req.params, reply);
      if (!params) return;
      const { id } = params;
      const adminId = await requireAdmin(req, reply);
      if (!adminId || adminId !== id) return;
      const { email } = req.body as { email: string };
      const target = await findUserByEmail(email);
      if (!target) return reply.code(404).send(errorResponse('user not found'));
      if (!(await hasAiKeyShare(id, target.id)))
        return reply.code(404).send(errorResponse('share not found'));
      const keyRow = await getAiKeyRow(target.id);
      if (!keyRow?.own && keyRow?.shared) {
        const agents = await getActivePortfolioWorkflowsByUser(target.id);
        for (const agent of agents) {
          removeWorkflowFromSchedule(agent.id);
          try {
            await cancelOrdersForWorkflow(agent.id, req.log);
          } catch (err) {
            req.log.error({ err, workflowId: agent.id }, 'failed to cancel orders');
          }
        }
        await draftAgentsByUser(target.id);
      }
      await revokeAiKeyShare(id, target.id);
      return { ok: true };
    },
  );

  app.post(
    '/users/:id/binance-key',
    { config: { rateLimit: RATE_LIMITS.TIGHT } },
    async (req, reply) => {
      const params = parseParams(idParams, req.params, reply);
      if (!params) return;
      const { id } = params;
      if (!requireUserIdMatch(req, reply, id)) return;
      const { key, secret } = req.body as { key: string; secret: string };
      const row = await getBinanceKeyRow(id);
      let err = ensureUser(row);
      if (err) return reply.code(err.code).send(err.body);
      err = ensureKeyAbsent(row, ['binance_api_key_enc', 'binance_api_secret_enc']);
      if (err) return reply.code(err.code).send(err.body);
      const verRes = await verifyApiKey(ApiKeyType.Binance, key, secret);
      if (verRes !== true)
        return reply
          .code(400)
          .send(
            errorResponse(
              `verification failed${
                typeof verRes === 'string' ? `: ${verRes}` : ''
              }`,
            ),
          );
      const encKey = encryptKey(key);
      const encSecret = encryptKey(secret);
      await setBinanceKey(id, encKey, encSecret);
      return { key: '<REDACTED>', secret: '<REDACTED>' };
    },
  );

  app.get(
    '/users/:id/binance-key',
    { config: { rateLimit: RATE_LIMITS.MODERATE } },
    async (req, reply) => {
      const params = parseParams(idParams, req.params, reply);
      if (!params) return;
      const { id } = params;
      if (!requireUserIdMatch(req, reply, id)) return;
      const row = await getBinanceKeyRow(id);
      const err = ensureKeyPresent(row, [
        'binance_api_key_enc',
        'binance_api_secret_enc',
      ]);
      if (err) return reply.code(err.code).send(err.body);
      const key = decryptKey(row!.binance_api_key_enc!);
      const secret = decryptKey(row!.binance_api_secret_enc!);
      return { key: '<REDACTED>', secret: '<REDACTED>' };
    },
  );

  app.put(
    '/users/:id/binance-key',
    { config: { rateLimit: RATE_LIMITS.TIGHT } },
    async (req, reply) => {
      const params = parseParams(idParams, req.params, reply);
      if (!params) return;
      const { id } = params;
      if (!requireUserIdMatch(req, reply, id)) return;
      const { key, secret } = req.body as { key: string; secret: string };
      const row = await getBinanceKeyRow(id);
      const err = ensureKeyPresent(row, [
        'binance_api_key_enc',
        'binance_api_secret_enc',
      ]);
      if (err) return reply.code(err.code).send(err.body);
      const verRes = await verifyApiKey(ApiKeyType.Binance, key, secret);
      if (verRes !== true)
        return reply
          .code(400)
          .send(
            errorResponse(
              `verification failed${
                typeof verRes === 'string' ? `: ${verRes}` : ''
              }`,
            ),
          );
      const encKey = encryptKey(key);
      const encSecret = encryptKey(secret);
      await setBinanceKey(id, encKey, encSecret);
      return { key: '<REDACTED>', secret: '<REDACTED>' };
    },
  );

  app.delete(
    '/users/:id/binance-key',
    { config: { rateLimit: RATE_LIMITS.VERY_TIGHT } },
    async (req, reply) => {
      const params = parseParams(idParams, req.params, reply);
      if (!params) return;
      const { id } = params;
      if (!requireUserIdMatch(req, reply, id)) return;
      const row = await getBinanceKeyRow(id);
      const err = ensureKeyPresent(row, [
        'binance_api_key_enc',
        'binance_api_secret_enc',
      ]);
      if (err) return reply.code(err.code).send(err.body);
      const agents = await getActivePortfolioWorkflowsByUser(id);
      for (const agent of agents) {
        removeWorkflowFromSchedule(agent.id);
        try {
          await cancelOrdersForWorkflow(agent.id, req.log);
        } catch (err) {
          req.log.error({ err, workflowId: agent.id }, 'failed to cancel orders');
        }
      }
      await deactivateAgentsByUser(id);
      await clearBinanceKey(id);
      return { ok: true };
    },
  );
}
