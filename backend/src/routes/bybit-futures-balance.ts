import type { FastifyInstance } from 'fastify';
import { RATE_LIMITS } from '../rate-limit.js';
import { fetchFuturesWalletBalance } from '../services/bybit-client.js';
import { errorResponse, ERROR_MESSAGES } from '../util/error-messages.js';
import {
  getValidatedUserId,
  userOrAdminPreHandlers,
} from './_shared/guards.js';

export default async function bybitFuturesBalanceRoutes(app: FastifyInstance) {
  app.get(
    '/users/:id/bybit-futures-balance',
    {
      config: { rateLimit: RATE_LIMITS.MODERATE },
      preHandler: userOrAdminPreHandlers,
    },
    async (req, reply) => {
      const userId = getValidatedUserId(req);
      try {
        const balance = await fetchFuturesWalletBalance(userId);
        if (!balance) {
          reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
          return;
        }
        return { balance };
      } catch (err) {
        req.log.error({ err, userId }, 'failed to fetch Bybit futures balance');
        reply.code(500).send(errorResponse('failed to fetch balance'));
      }
    },
  );
}
