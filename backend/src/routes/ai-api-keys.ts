import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
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
  ApiKeyType,
  verifyApiKey,
  encryptKey,
} from '../util/api-keys.js';
import { errorResponse, ERROR_MESSAGES } from '../util/errorMessages.js';
import { findUserByEmail } from '../repos/users.js';
import {
  disableUserWorkflowsByAiKey,
  type DisableWorkflowsSummary,
} from '../workflows/disable.js';
import {
  adminPreHandlers,
  getValidatedUserId,
  userPreHandlers,
} from './_shared/guards.js';
import { REDACTED_KEY } from './_shared/constants.js';
import {parseBody} from "./_shared/validation.js";

interface AiKeyBody {
  key: string;
}

interface ShareAiKeyBody {
  email: string;
  model: string;
}

interface RevokeShareBody {
  email: string;
}

const aiKeyBodySchema: z.ZodType<AiKeyBody> = z
  .object({ key: z.string().trim().min(1) })
  .strict();

const shareAiKeyBodySchema: z.ZodType<ShareAiKeyBody> = z
  .object({
    email: z.string().trim().email(),
    model: z.string().trim().min(1),
  })
  .strict();

const revokeShareBodySchema: z.ZodType<RevokeShareBody> = z
  .object({
    email: z.string().trim().email(),
  })
  .strict();

function logDisabledWorkflows(
  req: FastifyRequest,
  userId: string,
  summary: DisableWorkflowsSummary,
  context: string,
) {
  const { disabledWorkflowIds, unscheduledWorkflowIds } = summary;
  if (!disabledWorkflowIds.length && !unscheduledWorkflowIds.length) return;
  req.log.info(
    { userId, disabledWorkflowIds, unscheduledWorkflowIds, context },
    'disabled workflows after AI key update',
  );
}

export default async function aiApiKeyRoutes(app: FastifyInstance) {
  app.post(
    '/users/:id/ai-key',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const userId = getValidatedUserId(req);
      const body = parseBody(aiKeyBodySchema, req, reply);
      if (!body) return;
      const { key } = body;
      const aiKey = await getAiKey(userId);
      if (aiKey) return reply.code(409).send(errorResponse('key already exists'));
      if (!(await verifyApiKey(ApiKeyType.Ai, key)))
        return reply.code(400).send(errorResponse('verification failed'));
      const enc = encryptKey(key);
      await setAiKey({ userId: userId, apiKeyEnc: enc });
      return { key: REDACTED_KEY };
    },
  );

  app.get(
    '/users/:id/ai-key',
    {
      config: { rateLimit: RATE_LIMITS.MODERATE },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const id = getValidatedUserId(req);
      const aiKey = await getAiKey(id);
      if (!aiKey)
        return reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
      return { key: REDACTED_KEY };
    },
  );

  app.get(
    '/users/:id/ai-key/shared',
    {
      config: { rateLimit: RATE_LIMITS.MODERATE },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const id = getValidatedUserId(req);
      const sharedKey = await getSharedAiKey(id);
      if (!sharedKey) return reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
      return { key: REDACTED_KEY, shared: true, model: sharedKey.model };
    },
  );

  app.put(
    '/users/:id/ai-key',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const id = getValidatedUserId(req);
      const body = parseBody(aiKeyBodySchema, req, reply);
      if (!body) return;
      const { key } = body;
      const aiKey = await getAiKey(id);
      if (!aiKey) return reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
      if (!(await verifyApiKey(ApiKeyType.Ai, key)))
        return reply.code(400).send(errorResponse('verification failed'));
      const enc = encryptKey(key);
      await setAiKey({ userId: id, apiKeyEnc: enc });
      return { key: REDACTED_KEY };
    },
  );

  app.delete(
    '/users/:id/ai-key',
    {
      config: { rateLimit: RATE_LIMITS.VERY_TIGHT },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const id = getValidatedUserId(req);
      const aiKey = await getAiKey(id);
      if (!aiKey) return reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));

      const disableSummary = await disableUserWorkflowsByAiKey(
        req.log,
        id,
        aiKey.id,
      );
      logDisabledWorkflows(req, id, disableSummary, 'owner-ai-key-removed');

      const targets = await getAiKeyShareTargets(id);
      for (const targetId of targets) {
        const [targetOwnKey, targetSharedKey] = await Promise.all([
          getAiKey(targetId),
          getSharedAiKey(targetId),
        ]);
        if (!targetOwnKey && targetSharedKey) {
          const targetSummary = await disableUserWorkflowsByAiKey(
            req.log,
            targetId,
            targetSharedKey.id,
          );
          logDisabledWorkflows(
            req,
            targetId,
            targetSummary,
            'shared-ai-key-removed',
          );
        }
        await revokeAiKeyShare({ ownerUserId: id, targetUserId: targetId });
      }
      await clearAiKey(id);
      return { ok: true };
    },
  );

  app.post(
    '/users/:id/ai-key/share',
    {
      config: { rateLimit: RATE_LIMITS.MODERATE },
      preHandler: adminPreHandlers,
    },
    async (req, reply) => {
      const userId = getValidatedUserId(req);
      const body = parseBody(shareAiKeyBodySchema, req, reply);
      if (!body) return;
      const { email, model } = body;
      const aiKey = await getAiKey(userId);
      if (!aiKey) return reply.code(404).send(errorResponse('no key to share'));
      const target = await findUserByEmail(email);
      if (!target) return reply.code(404).send(errorResponse('user not found'));
      await shareAiKey({ ownerUserId: userId, targetUserId: target.id, model });
      return { ok: true };
    },
  );

  app.delete(
    '/users/:id/ai-key/share',
    {
      config: { rateLimit: RATE_LIMITS.MODERATE },
      preHandler: adminPreHandlers,
    },
    async (req, reply) => {
      const id = getValidatedUserId(req);
      const body = parseBody(revokeShareBodySchema, req, reply);
      if (!body) return;
      const { email } = body;
      const target = await findUserByEmail(email);
      if (!target) return reply.code(404).send(errorResponse('user not found'));
      if (!(await hasAiKeyShare({ ownerUserId: id, targetUserId: target.id })))
        return reply.code(404).send(errorResponse('share not found'));
      const [targetOwnKey, targetSharedKey] = await Promise.all([
        getAiKey(target.id),
        getSharedAiKey(target.id),
      ]);
      if (!targetOwnKey && targetSharedKey) {
        const disableSummary = await disableUserWorkflowsByAiKey(
          req.log,
          target.id,
          targetSharedKey.id,
        );
        logDisabledWorkflows(
          req,
          target.id,
          disableSummary,
          'shared-ai-key-revoked',
        );
      }
      await revokeAiKeyShare({ ownerUserId: id, targetUserId: target.id });
      return { ok: true };
    },
  );
}
