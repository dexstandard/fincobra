import type { FastifyInstance } from 'fastify';
import { RATE_LIMITS } from '../rate-limit.js';
import {
  getBinanceKeyRow,
  setBinanceKey,
  clearBinanceKey,
} from '../repos/exchange-api-keys.js';
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
import { disableUserWorkflows } from '../workflows/portfolio-review.js';
import {
  getValidatedUserId as getUserId,
  userOwnerPreHandlers,
} from './_shared/guards.js';

export default async function exchangeApiKeyRoutes(app: FastifyInstance) {
  app.post(
    '/users/:id/binance-key',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: userOwnerPreHandlers,
    },
    async (req, reply) => {
      const id = getUserId(req);
      const { key, secret } = req.body as { key: string; secret: string };
      const row = await getBinanceKeyRow(id);
      let err = ensureUser(row);
      if (err) return reply.code(err.code).send(err.body);
      err = ensureKeyAbsent(row, ['binanceApiKeyEnc', 'binanceApiSecretEnc']);
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
      await setBinanceKey({
        userId: id,
        apiKeyEnc: encKey,
        apiSecretEnc: encSecret,
      });
      return { key: '<REDACTED>', secret: '<REDACTED>' };
    },
  );

  app.get(
    '/users/:id/binance-key',
    {
      config: { rateLimit: RATE_LIMITS.MODERATE },
      preHandler: userOwnerPreHandlers,
    },
    async (req, reply) => {
      const id = getUserId(req);
      const row = await getBinanceKeyRow(id);
      const err = ensureKeyPresent(row, [
        'binanceApiKeyEnc',
        'binanceApiSecretEnc',
      ]);
      if (err) return reply.code(err.code).send(err.body);
      const key = decryptKey(row!.binanceApiKeyEnc!);
      const secret = decryptKey(row!.binanceApiSecretEnc!);
      return { key: '<REDACTED>', secret: '<REDACTED>' };
    },
  );

  app.put(
    '/users/:id/binance-key',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: userOwnerPreHandlers,
    },
    async (req, reply) => {
      const id = getUserId(req);
      const { key, secret } = req.body as { key: string; secret: string };
      const row = await getBinanceKeyRow(id);
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
            errorResponse(
              `verification failed${
                typeof verRes === 'string' ? `: ${verRes}` : ''
              }`,
            ),
          );
      const encKey = encryptKey(key);
      const encSecret = encryptKey(secret);
      await setBinanceKey({
        userId: id,
        apiKeyEnc: encKey,
        apiSecretEnc: encSecret,
      });
      return { key: '<REDACTED>', secret: '<REDACTED>' };
    },
  );

  app.delete(
    '/users/:id/binance-key',
    {
      config: { rateLimit: RATE_LIMITS.VERY_TIGHT },
      preHandler: userOwnerPreHandlers,
    },
    async (req, reply) => {
      const id = getUserId(req);
      const row = await getBinanceKeyRow(id);
      const err = ensureKeyPresent(row, [
        'binanceApiKeyEnc',
        'binanceApiSecretEnc',
      ]);
      if (err) return reply.code(err.code).send(err.body);
      const { disabledWorkflowIds } = await disableUserWorkflows({
        log: req.log,
        userId: id,
      });
      if (disabledWorkflowIds.length) {
        req.log.info(
          { userId: id, disabledWorkflowIds },
          'disabled workflows after Binance key removal',
        );
      }
      await clearBinanceKey(id);
      return { ok: true };
    },
  );
}
