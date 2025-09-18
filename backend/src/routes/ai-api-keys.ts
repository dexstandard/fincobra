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
import { userIdParams } from '../services/order-orchestrator.js';
import {
  disableUserWorkflows,
  removeWorkflowFromSchedule,
} from '../workflows/portfolio-review.js';

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

type RequestWithUserId = FastifyRequest & { validatedUserId: string };
type RequestWithOwnerAdmin = RequestWithUserId & { adminUserId: string };

const parseUserIdParam = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const params = parseParams(userIdParams, req.params, reply);
  if (!params) return reply;
  (req as RequestWithUserId).validatedUserId = params.id;
};

const requireUserOwner = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const { validatedUserId } = req as RequestWithUserId;
  if (!requireUserIdMatch(req, reply, validatedUserId)) return reply;
};

const requireOwnerAdmin = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const adminId = await requireAdmin(req, reply);
  if (!adminId) return reply;
  const { validatedUserId } = req as RequestWithUserId;
  if (adminId !== validatedUserId) {
    reply.code(403).send(errorResponse(ERROR_MESSAGES.forbidden));
    return reply;
  }
  (req as RequestWithOwnerAdmin).adminUserId = adminId;
};

function getUserId(req: FastifyRequest): string {
  return (req as RequestWithUserId).validatedUserId;
}

const userPreHandlers = [parseUserIdParam, requireUserOwner];
const adminPreHandlers = [parseUserIdParam, requireOwnerAdmin];

function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  req: FastifyRequest,
  reply: FastifyReply,
): z.infer<S> | undefined {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    reply.code(400).send(errorResponse('invalid request body'));
    return undefined;
  }
  return result.data;
}

export default async function aiApiKeyRoutes(app: FastifyInstance) {
  app.post(
    '/users/:id/ai-key',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const id = getUserId(req);
      const body = parseBody(aiKeyBodySchema, req, reply);
      if (!body) return;
      const { key } = body;
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
    {
      config: { rateLimit: RATE_LIMITS.MODERATE },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const id = getUserId(req);
      const aiKey = await getAiKey(id);
      if (!aiKey?.aiApiKeyEnc)
        return reply
          .code(404)
          .send(errorResponse(ERROR_MESSAGES.notFound));
      return { key: '<REDACTED>' };
    },
  );

  app.get(
    '/users/:id/ai-key/shared',
    {
      config: { rateLimit: RATE_LIMITS.MODERATE },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const id = getUserId(req);
      const sharedKey = await getSharedAiKey(id);
      if (!sharedKey?.aiApiKeyEnc)
        return reply
          .code(404)
          .send(errorResponse(ERROR_MESSAGES.notFound));
      return { key: '<REDACTED>', shared: true, model: sharedKey.model };
    },
  );

  app.put(
    '/users/:id/ai-key',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const id = getUserId(req);
      const body = parseBody(aiKeyBodySchema, req, reply);
      if (!body) return;
      const { key } = body;
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
    {
      config: { rateLimit: RATE_LIMITS.VERY_TIGHT },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const id = getUserId(req);
      const aiKey = await getAiKey(id);
      if (!aiKey?.aiApiKeyEnc)
        return reply
          .code(404)
          .send(errorResponse(ERROR_MESSAGES.notFound));

      const disabledIds = await disableUserWorkflows({
        log: req.log,
        userId: id,
        aiKeyId: aiKey.id,
      });
      for (const workflowId of disabledIds) removeWorkflowFromSchedule(workflowId);

      const targets = await getAiKeyShareTargets(id);
      for (const targetId of targets) {
        const [targetOwnKey, targetSharedKey] = await Promise.all([
          getAiKey(targetId),
          getSharedAiKey(targetId),
        ]);
        if (!targetOwnKey && targetSharedKey) {
          const affectedIds = await disableUserWorkflows({
            log: req.log,
            userId: targetId,
            aiKeyId: targetSharedKey.id,
          });
          for (const workflowId of affectedIds)
            removeWorkflowFromSchedule(workflowId);
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
      const id = getUserId(req);
      const body = parseBody(shareAiKeyBodySchema, req, reply);
      if (!body) return;
      const { email, model } = body;
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
    {
      config: { rateLimit: RATE_LIMITS.MODERATE },
      preHandler: adminPreHandlers,
    },
    async (req, reply) => {
      const id = getUserId(req);
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
        const affectedIds = await disableUserWorkflows({
          log: req.log,
          userId: target.id,
          aiKeyId: targetSharedKey.id,
        });
        for (const workflowId of affectedIds)
          removeWorkflowFromSchedule(workflowId);
      }
      await revokeAiKeyShare({ ownerUserId: id, targetUserId: target.id });
      return { ok: true };
    },
  );
}
