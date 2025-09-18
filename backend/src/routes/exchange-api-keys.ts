import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RATE_LIMITS } from '../rate-limit.js';
import {
  getBinanceKeyRow,
  setBinanceKey,
  clearBinanceKey,
} from '../repos/exchange-api-keys.js';
import {
  getActivePortfolioWorkflowsByUser,
  deactivateWorkflowsByUser,
} from '../repos/portfolio-workflow.js';
import { removeWorkflowFromSchedule } from '../workflows/portfolio-review.js';
import {
  ApiKeyType,
  verifyApiKey,
  encryptKey,
  ensureUser,
  ensureKeyAbsent,
  ensureKeyPresent,
  decryptKey,
} from '../util/api-keys.js';
import { errorResponse } from '../util/errorMessages.js';
import {
  CANCEL_ORDER_REASONS,
  cancelOrdersForWorkflow,
} from '../services/order-orchestrator.js';
import { REDACTED_KEY } from './_shared/constants.js';
import { getValidatedUserId, userPreHandlers } from './_shared/guards.js';

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
      const row = await getBinanceKeyRow(userId);
      let err = ensureUser(row);
      if (err) return reply.code(err.code).send(err.body);
      err = ensureKeyAbsent(row, ['binanceApiKeyEnc', 'binanceApiSecretEnc']);
      if (err) return reply.code(err.code).send(err.body);
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
      const row = await getBinanceKeyRow(userId);
      const err = ensureKeyPresent(row, [
        'binanceApiKeyEnc',
        'binanceApiSecretEnc',
      ]);
      if (err) return reply.code(err.code).send(err.body);
      decryptKey(row!.binanceApiKeyEnc!);
      decryptKey(row!.binanceApiSecretEnc!);
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
      const row = await getBinanceKeyRow(userId);
      const err = ensureKeyPresent(row, [
        'binanceApiKeyEnc',
        'binanceApiSecretEnc',
      ]);
      if (err) return reply.code(err.code).send(err.body);
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
      const row = await getBinanceKeyRow(userId);
      const err = ensureKeyPresent(row, [
        'binanceApiKeyEnc',
        'binanceApiSecretEnc',
      ]);
      if (err) return reply.code(err.code).send(err.body);
      const agents = await getActivePortfolioWorkflowsByUser(userId);
      for (const agent of agents) {
        removeWorkflowFromSchedule(agent.id);
        try {
          await cancelOrdersForWorkflow({
            workflowId: agent.id,
            reason: CANCEL_ORDER_REASONS.API_KEY_REMOVED,
            log: req.log,
          });
        } catch (err) {
          req.log.error({ err, workflowId: agent.id }, 'failed to cancel orders');
        }
      }
      await deactivateWorkflowsByUser(userId);
      await clearBinanceKey(userId);
      return { ok: true };
    },
  );
}
