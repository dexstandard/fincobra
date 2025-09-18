import type { FastifyInstance } from 'fastify';
import { RATE_LIMITS } from '../rate-limit.js';
import {
  getAiKey,
  getSharedAiKey,
  setAiKey,
  clearAiKey,
  shareAiKey,
  revokeAiKeyShare,
  hasAiKeyShare,
  getAiKeyShareTargets,
} from '../repos/ai-api-key.js';
import {
  getActivePortfolioWorkflowsByUser,
  draftAgentsByUser,
} from '../repos/portfolio-workflow.js';
import { removeWorkflowFromSchedule } from '../workflows/portfolio-review.js';
import { requireUserIdMatch, requireAdmin } from '../util/auth.js';
import {
  ApiKeyType,
  verifyApiKey,
  encryptKey,
  ensureUser,
  ensureKeyAbsent,
  ensureKeyPresent,
} from '../util/api-keys.js';
import { errorResponse, ERROR_MESSAGES } from '../util/errorMessages.js';
import { findUserByEmail } from '../repos/users.js';
import { parseParams } from '../util/validation.js';
import { cancelOrdersForWorkflow, userIdParams } from '../services/order-orchestrator.js';

export default async function aiApiKeyRoutes(app: FastifyInstance) {
  app.post(
    '/users/:id/ai-key',
    { config: { rateLimit: RATE_LIMITS.TIGHT } },
    async (req, reply) => {
      const params = parseParams(userIdParams, req.params, reply);
      if (!params) return;
      const { id } = params;
      if (!requireUserIdMatch(req, reply, id)) return;
      const { key } = req.body as { key: string };
      const aiKey = await getAiKey(id);
      const userErr = ensureUser(aiKey === undefined ? undefined : {});
      if (userErr) return reply.code(userErr.code).send(userErr.body);
      const keyErr = ensureKeyAbsent(aiKey, ['aiApiKeyEnc']);
      if (keyErr) return reply.code(keyErr.code).send(keyErr.body);
      if (!(await verifyApiKey(ApiKeyType.Ai, key)))
        return reply.code(400).send(errorResponse('verification failed'));
      const enc = encryptKey(key);
      await setAiKey({ userId: id, apiKeyEnc: enc });
      return { key: '<REDACTED>' };
    },
  );

  app.get(
    '/users/:id/ai-key',
    { config: { rateLimit: RATE_LIMITS.MODERATE } },
    async (req, reply) => {
      const params = parseParams(userIdParams, req.params, reply);
      if (!params) return;
      const { id } = params;
      if (!requireUserIdMatch(req, reply, id)) return;
      const aiKey = await getAiKey(id);
      if (!aiKey?.id)
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
      const params = parseParams(userIdParams, req.params, reply);
      if (!params) return;
      const { id } = params;
      if (!requireUserIdMatch(req, reply, id)) return;
      const sharedKey = await getSharedAiKey(id);
      if (!sharedKey?.id)
        return reply
          .code(404)
          .send(errorResponse(ERROR_MESSAGES.notFound));
      return { key: '<REDACTED>', shared: true, model: sharedKey.model };
    },
  );

  app.put(
    '/users/:id/ai-key',
    { config: { rateLimit: RATE_LIMITS.TIGHT } },
    async (req, reply) => {
      const params = parseParams(userIdParams, req.params, reply);
      if (!params) return;
      const { id } = params;
      if (!requireUserIdMatch(req, reply, id)) return;
      const { key } = req.body as { key: string };
      const aiKey = await getAiKey(id);
      if (!aiKey?.aiApiKeyEnc)
        return reply
          .code(404)
          .send(errorResponse(ERROR_MESSAGES.notFound));
      if (!(await verifyApiKey(ApiKeyType.Ai, key)))
        return reply.code(400).send(errorResponse('verification failed'));
      const enc = encryptKey(key);
      await setAiKey({ userId: id, apiKeyEnc: enc });
      return { key: '<REDACTED>' };
    },
  );

  app.delete(
    '/users/:id/ai-key',
    { config: { rateLimit: RATE_LIMITS.VERY_TIGHT } },
    async (req, reply) => {
      const params = parseParams(userIdParams, req.params, reply);
      if (!params) return;
      const { id } = params;
      if (!requireUserIdMatch(req, reply, id)) return;
      const aiKey = await getAiKey(id);
      if (!aiKey?.aiApiKeyEnc)
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
        const [targetOwnKey, targetSharedKey] = await Promise.all([
          getAiKey(targetId),
          getSharedAiKey(targetId),
        ]);
        if (!targetOwnKey && targetSharedKey) {
          const targetAgents = await getActivePortfolioWorkflowsByUser(targetId);
          for (const agent of targetAgents) {
            removeWorkflowFromSchedule(agent.id);
            try {
              await cancelOrdersForWorkflow(agent.id, req.log);
            } catch (err) {
              req.log.error(
                { err, workflowId: agent.id },
                'failed to cancel orders',
              );
            }
          }
          await draftAgentsByUser(targetId);
        }
        await revokeAiKeyShare({ ownerUserId: id, targetUserId: targetId });
      }
      await clearAiKey(id);
      return { ok: true };
    },
  );

  app.post(
    '/users/:id/ai-key/share',
    { config: { rateLimit: RATE_LIMITS.MODERATE } },
    async (req, reply) => {
      const params = parseParams(userIdParams, req.params, reply);
      if (!params) return;
      const { id } = params;
      const adminId = await requireAdmin(req, reply);
      if (!adminId || adminId !== id) return;
      const { email, model } = req.body as { email: string; model: string };
      if (!model)
        return reply.code(400).send(errorResponse('model required'));
      const aiKey = await getAiKey(id);
      const keyErr = ensureKeyPresent(aiKey, ['aiApiKeyEnc']);
      if (keyErr) return reply.code(keyErr.code).send(keyErr.body);
      const target = await findUserByEmail(email);
      if (!target) return reply.code(404).send(errorResponse('user not found'));
      await shareAiKey({ ownerUserId: id, targetUserId: target.id, model });
      return { ok: true };
    },
  );

  app.delete(
    '/users/:id/ai-key/share',
    { config: { rateLimit: RATE_LIMITS.MODERATE } },
    async (req, reply) => {
      const params = parseParams(userIdParams, req.params, reply);
      if (!params) return;
      const { id } = params;
      const adminId = await requireAdmin(req, reply);
      if (!adminId || adminId !== id) return;
      const { email } = req.body as { email: string };
      const target = await findUserByEmail(email);
      if (!target) return reply.code(404).send(errorResponse('user not found'));
      if (!(await hasAiKeyShare({ ownerUserId: id, targetUserId: target.id })))
        return reply.code(404).send(errorResponse('share not found'));
      const [targetOwnKey, targetSharedKey] = await Promise.all([
        getAiKey(target.id),
        getSharedAiKey(target.id),
      ]);
      if (!targetOwnKey && targetSharedKey) {
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
      await revokeAiKeyShare({ ownerUserId: id, targetUserId: target.id });
      return { ok: true };
    },
  );
}
