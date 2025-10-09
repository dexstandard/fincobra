import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RATE_LIMITS } from '../rate-limit.js';
import {
  getBinanceKey,
  setBinanceKey,
  clearBinanceKey,
  getBybitKey,
  setBybitKey,
  clearBybitKey,
} from '../repos/exchange-api-keys.js';
import type { ExchangeApiKeyDetails, ExchangeApiKeyUpsert } from '../repos/exchange-api-keys.types.js';
import { verifyBinanceKey } from '../services/binance-client.js';
import type { ExchangeKeyVerificationResult } from '../services/binance-client.types.js';
import { verifyBybitKey } from '../services/bybit-client.js';
import { encryptKey } from '../util/crypto.js';
import { errorResponse, ERROR_MESSAGES } from '../util/error-messages.js';
import { REDACTED_KEY } from './_shared/constants.js';
import { getValidatedUserId, userPreHandlers } from './_shared/guards.js';
import { disableUserWorkflowsByExchangeKey } from '../workflows/disable.js';
import type { DisableWorkflowsSummary } from '../workflows/disable.types.js';
import { parseBody } from './_shared/validation.js';

interface ExchangeKeyBody {
  key: string;
  secret: string;
}

const binanceKeyBodySchema: z.ZodType<ExchangeKeyBody> = z
  .object({
    key: z.string().trim().length(64),
    secret: z.string().trim().min(64).max(128),
  })
  .strict();

const bybitKeyBodySchema: z.ZodType<ExchangeKeyBody> = z
  .object({
    key: z.string().trim().min(32).max(64),
    secret: z.string().trim().min(32).max(128),
  })
  .strict();

function formatVerificationError(result: ExchangeKeyVerificationResult): string {
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

interface ExchangeRouteConfig {
  exchange: 'binance' | 'bybit';
  verify: (
    key: string,
    secret: string,
  ) => Promise<ExchangeKeyVerificationResult>;
  get: (userId: string) => Promise<ExchangeApiKeyDetails | null>;
  set: (entry: ExchangeApiKeyUpsert) => Promise<void>;
  clear: (userId: string) => Promise<void>;
  bodySchema: z.ZodType<ExchangeKeyBody>;
  validationErrorMessage: string;
}

async function verifyAndSave(
  config: ExchangeRouteConfig,
  key: string,
  secret: string,
  reply: FastifyReply,
  userId: string,
) {
  const verRes = await config.verify(key, secret);
  if (!verRes.ok) {
    return reply.code(400).send(errorResponse(formatVerificationError(verRes)));
  }
  const encKey = encryptKey(key);
  const encSecret = encryptKey(secret);
  await config.set({
    userId,
    apiKeyEnc: encKey,
    apiSecretEnc: encSecret,
  });
  return { key: REDACTED_KEY, secret: REDACTED_KEY };
}

export default async function exchangeApiKeyRoutes(app: FastifyInstance) {
  const exchangeConfigs: ExchangeRouteConfig[] = [
    {
      exchange: 'binance',
      verify: verifyBinanceKey,
      get: getBinanceKey,
      set: setBinanceKey,
      clear: clearBinanceKey,
      bodySchema: binanceKeyBodySchema,
      validationErrorMessage:
        'invalid request body: key must be 64 characters long and secret must be 64 characters long',
    },
    {
      exchange: 'bybit',
      verify: verifyBybitKey,
      get: getBybitKey,
      set: setBybitKey,
      clear: clearBybitKey,
      bodySchema: bybitKeyBodySchema,
      validationErrorMessage:
        'invalid request body: key must be between 32 and 64 characters long and secret must be between 32 and 128 characters long',
    },
  ];

  for (const config of exchangeConfigs) {
    const basePath = `/users/:id/${config.exchange}-key` as const;

    app.post(
      basePath,
      {
        config: { rateLimit: RATE_LIMITS.TIGHT },
        preHandler: userPreHandlers,
      },
      async (req, reply) => {
        const userId = getValidatedUserId(req);
        const body = parseBody(config.bodySchema, req, reply, {
          errorMessage: config.validationErrorMessage,
        });
        if (!body) return;
        const { key, secret } = body;
        const existingKey = await config.get(userId);
        if (existingKey)
          return reply.code(409).send(errorResponse('key already exists'));
        return await verifyAndSave(config, key, secret, reply, userId);
      },
    );

    app.get(
      basePath,
      {
        config: { rateLimit: RATE_LIMITS.MODERATE },
        preHandler: userPreHandlers,
      },
      async (req, reply) => {
        const userId = getValidatedUserId(req);
        const exchangeKey = await config.get(userId);
        if (!exchangeKey)
          return reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
        return { key: REDACTED_KEY, secret: REDACTED_KEY };
      },
    );

    app.put(
      basePath,
      {
        config: { rateLimit: RATE_LIMITS.TIGHT },
        preHandler: userPreHandlers,
      },
      async (req, reply) => {
        const userId = getValidatedUserId(req);
        const body = parseBody(config.bodySchema, req, reply, {
          errorMessage: config.validationErrorMessage,
        });
        if (!body) return;
        const { key, secret } = body;
        const existingKey = await config.get(userId);
        if (!existingKey)
          return reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
        return await verifyAndSave(config, key, secret, reply, userId);
      },
    );

    app.delete(
      basePath,
      {
        config: { rateLimit: RATE_LIMITS.VERY_TIGHT },
        preHandler: userPreHandlers,
      },
      async (req, reply) => {
        const userId = getValidatedUserId(req);
        const existingKey = await config.get(userId);
        if (!existingKey)
          return reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));

        const disableSummary = await disableUserWorkflowsByExchangeKey(
          req.log,
          userId,
          existingKey.id,
        );
        logDisabledWorkflows(req, userId, disableSummary);
        await config.clear(userId);
        return { ok: true };
      },
    );
  }
}
