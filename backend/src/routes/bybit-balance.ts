import type { FastifyInstance } from 'fastify';
import { RATE_LIMITS } from '../rate-limit.js';
import { fetchFuturesWalletBalance } from '../services/bybit-client.js';
import { errorResponse, ERROR_MESSAGES } from '../util/error-messages.js';
import {
  getValidatedUserId,
  userOrAdminPreHandlers,
} from './_shared/guards.js';

export default async function bybitBalanceRoutes(app: FastifyInstance) {
  app.get(
    '/users/:id/bybit-wallet',
    {
      config: { rateLimit: RATE_LIMITS.RELAXED },
      preHandler: userOrAdminPreHandlers,
    },
    async (req, reply) => {
      const userId = getValidatedUserId(req);
      try {
        const wallet = await fetchFuturesWalletBalance(userId);
        if (!wallet) {
          reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
          return;
        }
        reply.send(wallet);
      } catch (err) {
        reply.log.error({ err, userId }, 'failed to fetch bybit wallet');
        reply
          .code(500)
          .send(errorResponse('failed to fetch Bybit wallet balance'));
      }
    },
  );
}
