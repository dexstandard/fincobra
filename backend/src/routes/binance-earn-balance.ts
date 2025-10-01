import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { RATE_LIMITS } from '../rate-limit.js';
import { fetchEarnFlexibleBalance } from '../services/binance-client.js';
import { errorResponse, ERROR_MESSAGES } from '../util/error-messages.js';
import { getValidatedUserId, userPreHandlers } from './_shared/guards.js';
import {
  parseRequestParams,
  userTokenParamsSchema,
} from './_shared/validation.js';

async function loadEarnFlexibleBalance(
  userId: string,
  token: string,
  reply: FastifyReply,
): Promise<number | undefined> {
  try {
    const amount = await fetchEarnFlexibleBalance(userId, token);
    if (amount === null) {
      reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
      return undefined;
    }
    return amount;
  } catch {
    reply.code(500).send(errorResponse('failed to fetch earn balance'));
    return undefined;
  }
}

export default async function binanceEarnBalanceRoutes(app: FastifyInstance) {
  app.get(
    '/users/:id/binance-earn-balance/:token',
    {
      config: { rateLimit: RATE_LIMITS.RELAXED },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const userId = getValidatedUserId(req);
      const params = parseRequestParams(userTokenParamsSchema, req, reply);
      if (!params) return;
      const amount = await loadEarnFlexibleBalance(userId, params.token, reply);
      if (amount === undefined) return;
      return { asset: params.token.toUpperCase(), total: amount };
    },
  );
}
