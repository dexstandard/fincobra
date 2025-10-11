import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RATE_LIMITS } from '../rate-limit.js';
import { getGroqKey, setGroqKey, clearGroqKey } from '../repos/ai-api-key.js';
import { verifyGroqKey } from '../services/groq-client.js';
import { encryptKey } from '../util/crypto.js';
import { errorResponse, ERROR_MESSAGES } from '../util/error-messages.js';
import { userPreHandlers, getValidatedUserId } from './_shared/guards.js';
import { parseBody } from './_shared/validation.js';
import { REDACTED_KEY } from './_shared/constants.js';
import { disableUserWorkflowsByAiKey } from '../workflows/disable.js';

interface GroqKeyBody {
  key: string;
}

const groqKeyBodySchema: z.ZodType<GroqKeyBody> = z
  .object({ key: z.string().trim().min(1) })
  .strict();

function verificationError(reason?: string): string {
  return reason ? `verification failed: ${reason}` : 'verification failed';
}

export default async function groqApiKeyRoutes(app: FastifyInstance) {
  app.post(
    '/users/:id/groq-key',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const userId = getValidatedUserId(req);
      const body = parseBody(groqKeyBodySchema, req, reply);
      if (!body) return;
      const existingKey = await getGroqKey(userId);
      if (existingKey)
        return reply.code(409).send(errorResponse('key already exists'));
      const result = await verifyGroqKey(body.key);
      if (!result.ok)
        return reply
          .code(400)
          .send(errorResponse(verificationError(result.reason)));
      const enc = encryptKey(body.key);
      await setGroqKey({ userId, apiKeyEnc: enc });
      return { key: REDACTED_KEY };
    },
  );

  app.get(
    '/users/:id/groq-key',
    {
      config: { rateLimit: RATE_LIMITS.MODERATE },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const id = getValidatedUserId(req);
      const groqKey = await getGroqKey(id);
      if (!groqKey)
        return reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
      return { key: REDACTED_KEY };
    },
  );

  app.put(
    '/users/:id/groq-key',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const id = getValidatedUserId(req);
      const body = parseBody(groqKeyBodySchema, req, reply);
      if (!body) return;
      const groqKey = await getGroqKey(id);
      if (!groqKey)
        return reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
      const result = await verifyGroqKey(body.key);
      if (!result.ok)
        return reply
          .code(400)
          .send(errorResponse(verificationError(result.reason)));
      const enc = encryptKey(body.key);
      await setGroqKey({ userId: id, apiKeyEnc: enc });
      return { key: REDACTED_KEY };
    },
  );

  app.delete(
    '/users/:id/groq-key',
    {
      config: { rateLimit: RATE_LIMITS.VERY_TIGHT },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const id = getValidatedUserId(req);
      const groqKey = await getGroqKey(id);
      if (!groqKey)
        return reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
      const disableSummary = await disableUserWorkflowsByAiKey(
        req.log,
        id,
        groqKey.id,
      );
      if (
        disableSummary.disabledWorkflowIds.length ||
        disableSummary.unscheduledWorkflowIds.length
      ) {
        req.log.info(
          {
            userId: id,
            disabledWorkflowIds: disableSummary.disabledWorkflowIds,
            unscheduledWorkflowIds: disableSummary.unscheduledWorkflowIds,
            context: 'groq-ai-key-removed',
          },
          'disabled workflows after AI key update',
        );
      }
      await clearGroqKey(id);
      return { ok: true };
    },
  );
}
