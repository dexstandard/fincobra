import type { FastifyInstance } from 'fastify';
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
import { requireUserIdMatch } from '../util/auth.js';
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
import { parseParams } from '../util/validation.js';
import {
  CANCEL_ORDER_REASONS,
  cancelOrdersForWorkflow,
} from '../services/order-orchestrator.js';
import { userIdParams } from './_shared/validation.js';

export default async function exchangeApiKeyRoutes(app: FastifyInstance) {
  app.post(
    '/users/:id/binance-key',
    { config: { rateLimit: RATE_LIMITS.TIGHT } },
    async (req, reply) => {
      const params = parseParams(userIdParams, req.params, reply);
      if (!params) return;
      const { id } = params;
      if (!requireUserIdMatch(req, reply, id)) return;
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
    { config: { rateLimit: RATE_LIMITS.MODERATE } },
    async (req, reply) => {
      const params = parseParams(userIdParams, req.params, reply);
      if (!params) return;
      const { id } = params;
      if (!requireUserIdMatch(req, reply, id)) return;
      const row = await getBinanceKeyRow(id);
      const err = ensureKeyPresent(row, [
        'binanceApiKeyEnc',
        'binanceApiSecretEnc',
      ]);
      if (err) return reply.code(err.code).send(err.body);
      decryptKey(row!.binanceApiKeyEnc!);
      decryptKey(row!.binanceApiSecretEnc!);
      return { key: '<REDACTED>', secret: '<REDACTED>' };
    },
  );

  app.put(
    '/users/:id/binance-key',
    { config: { rateLimit: RATE_LIMITS.TIGHT } },
    async (req, reply) => {
      const params = parseParams(userIdParams, req.params, reply);
      if (!params) return;
      const { id } = params;
      if (!requireUserIdMatch(req, reply, id)) return;
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
    { config: { rateLimit: RATE_LIMITS.VERY_TIGHT } },
    async (req, reply) => {
      const params = parseParams(userIdParams, req.params, reply);
      if (!params) return;
      const { id } = params;
      if (!requireUserIdMatch(req, reply, id)) return;
      const row = await getBinanceKeyRow(id);
      const err = ensureKeyPresent(row, [
        'binanceApiKeyEnc',
        'binanceApiSecretEnc',
      ]);
      if (err) return reply.code(err.code).send(err.body);
      const agents = await getActivePortfolioWorkflowsByUser(id);
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
      await deactivateWorkflowsByUser(id);
      await clearBinanceKey(id);
      return { ok: true };
    },
  );
}
