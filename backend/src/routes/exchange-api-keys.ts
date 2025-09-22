import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RATE_LIMITS } from '../rate-limit.js';
import {
  getBinanceKey,
  setBinanceKey,
  clearBinanceKey,
} from '../repos/exchange-api-keys.js';
import {
  verifyBinanceKey,
  type BinanceKeyVerificationResult,
} from '../services/binance.js';
import { encryptKey } from '../util/crypto.js';
import { errorResponse, ERROR_MESSAGES } from '../util/errorMessages.js';
import { REDACTED_KEY } from './_shared/constants.js';
import { getValidatedUserId, userPreHandlers } from './_shared/guards.js';
import {
  disableUserWorkflowsByExchangeKey,
  type DisableWorkflowsSummary,
} from '../workflows/disable.js';
import {parseBody} from "./_shared/validation.js";

interface ExchangeKeyBody {
  key: string;
  secret: string;
}

const exchangeKeyBodySchema: z.ZodType<ExchangeKeyBody> = z
  .object({
    key: z.string().trim().length(64),
    secret: z.string().trim().min(64).max(128),
  })
  .strict();

function formatVerificationError(result: BinanceKeyVerificationResult): string {
  return `verification failed${result.reason ? `: ${result.reason}` : ''}`;
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

async function verifyAndSave(
    key: string,
    secret: string,
    reply: FastifyReply,
    userId: string
) {
  const verRes = await verifyBinanceKey(key, secret);
  if (!verRes.ok) {
    return reply
      .code(400)
      .send(errorResponse(formatVerificationError(verRes)));
  }
  const encKey = encryptKey(key);
  const encSecret = encryptKey(secret);
  await setBinanceKey({
    userId,
    apiKeyEnc: encKey,
    apiSecretEnc: encSecret,
  });
  return {key: REDACTED_KEY, secret: REDACTED_KEY};
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
      if (existingKey) return reply.code(409).send(errorResponse('key already exists'));
      return await verifyAndSave(key, secret, reply, userId);
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
      if (!binanceKey) return reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
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
        return reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
      return await verifyAndSave(key, secret, reply, userId);
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
      if (!existingKey) return reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));

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
