import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RATE_LIMITS } from '../rate-limit.js';
import {
  getBinanceKey,
  setBinanceKey,
  clearBinanceKey,
} from '../repos/exchange-api-keys.js';
import {
  ApiKeyType,
  verifyApiKey,
  encryptKey,
  decryptKey,
} from '../util/api-keys.js';
import { errorResponse, ERROR_MESSAGES } from '../util/errorMessages.js';
import { REDACTED_KEY } from './_shared/constants.js';
import { getValidatedUserId, userPreHandlers } from './_shared/guards.js';
import {
  disableUserWorkflowsByExchangeKey,
  type DisableWorkflowsSummary,
} from '../workflows/disable.js';

interface ExchangeKeyBody {
  key: string;
  secret: string;
}

const exchangeKeyBodySchema: z.ZodType<ExchangeKeyBody> = z
  .object({
    key: z.string().trim().min(1),
    secret: z.string().trim().min(1),
  })
  .strict();

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

function formatVerificationError(result: boolean | string): string {
  return `verification failed${
    typeof result === 'string' ? `: ${result}` : ''
  }`;
}

function logDisabledWorkflows(
  req: FastifyRequest,
  userId: string,
  summary: DisableWorkflowsSummary,
) {
  const { disabledWorkflowIds, unscheduledWorkflowIds } = summary;
  if (!disabledWorkflowIds.length && !unscheduledWorkflowIds.length) return;
  req.log.info(
    { userId, disabledWorkflowIds, unscheduledWorkflowIds },
    'disabled workflows after exchange key update',
  );
}

export default async function exchangeApiKeyRoutes(app: FastifyInstance) {
  app.post(
    '/users/:id/binance-key',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const userId = getValidatedUserId(req);
      const body = parseBody(exchangeKeyBodySchema, req, reply);
      if (!body) return;
      const { key, secret } = body;
      const existingKey = await getBinanceKey(userId);
      if (existingKey)
        return reply.code(400).send(errorResponse('key exists'));
      const verRes = await verifyApiKey(ApiKeyType.Binance, key, secret);
      if (verRes !== true)
        return reply
          .code(400)
          .send(
            errorResponse(formatVerificationError(verRes)),
          );
      const encKey = encryptKey(key);
      const encSecret = encryptKey(secret);
      await setBinanceKey({
        userId,
        apiKeyEnc: encKey,
        apiSecretEnc: encSecret,
      });
      return { key: REDACTED_KEY, secret: REDACTED_KEY };
    },
  );

  app.get(
    '/users/:id/binance-key',
    {
      config: { rateLimit: RATE_LIMITS.MODERATE },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const userId = getValidatedUserId(req);
      const binanceKey = await getBinanceKey(userId);
      if (!binanceKey)
        return reply
          .code(404)
          .send(errorResponse(ERROR_MESSAGES.notFound));
      decryptKey(binanceKey.apiKeyEnc);
      decryptKey(binanceKey.apiSecretEnc);
      return { key: REDACTED_KEY, secret: REDACTED_KEY };
    },
  );

  app.put(
    '/users/:id/binance-key',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const userId = getValidatedUserId(req);
      const body = parseBody(exchangeKeyBodySchema, req, reply);
      if (!body) return;
      const { key, secret } = body;
      const existingKey = await getBinanceKey(userId);
      if (!existingKey)
        return reply
          .code(404)
          .send(errorResponse(ERROR_MESSAGES.notFound));
      const verRes = await verifyApiKey(ApiKeyType.Binance, key, secret);
      if (verRes !== true)
        return reply
          .code(400)
          .send(
            errorResponse(formatVerificationError(verRes)),
          );
      const encKey = encryptKey(key);
      const encSecret = encryptKey(secret);
      await setBinanceKey({
        userId,
        apiKeyEnc: encKey,
        apiSecretEnc: encSecret,
      });
      return { key: REDACTED_KEY, secret: REDACTED_KEY };
    },
  );

  app.delete(
    '/users/:id/binance-key',
    {
      config: { rateLimit: RATE_LIMITS.VERY_TIGHT },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const userId = getValidatedUserId(req);
      const existingKey = await getBinanceKey(userId);
      if (!existingKey)
        return reply
          .code(404)
          .send(errorResponse(ERROR_MESSAGES.notFound));
      const disableSummary = await disableUserWorkflowsByExchangeKey(
        req.log,
        userId,
        existingKey.id,
      );
      logDisabledWorkflows(req, userId, disableSummary);
      await clearBinanceKey(userId);
      return { ok: true };
    },
  );
}
