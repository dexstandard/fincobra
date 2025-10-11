import type { FastifyInstance } from 'fastify';
import { RATE_LIMITS } from '../rate-limit.js';
import { fetchFuturesBalances } from '../services/binance-client.js';
import { errorResponse, ERROR_MESSAGES } from '../util/error-messages.js';
import {
  getValidatedUserId,
  userOrAdminPreHandlers,
} from './_shared/guards.js';

export default async function binanceFuturesBalanceRoutes(app: FastifyInstance) {
  app.get(
    '/users/:id/binance/futures/balance',
    {
      config: { rateLimit: RATE_LIMITS.MODERATE },
      preHandler: userOrAdminPreHandlers,
    },
    async (req, reply) => {
      const userId = getValidatedUserId(req);
      try {
        const balance = await fetchFuturesBalances(userId);
        if (!balance) {
          reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
          return;
        }

        const balances = balance
          .map((entry) => {
            const asset = entry.asset?.toUpperCase();
            if (!asset) return null;
            const total = Number(entry.balance ?? entry.availableBalance ?? 0);
            const available = Number(entry.availableBalance ?? entry.balance ?? 0);
            const locked = Math.max(total - available, 0);
            return {
              asset,
              free: String(available),
              locked: String(locked),
            };
          })
          .filter((entry): entry is { asset: string; free: string; locked: string } => entry !== null);

        return { balances };
      } catch (err) {
        req.log.error({ err, userId }, 'failed to fetch Binance futures balance');
        reply.code(500).send(errorResponse('failed to fetch balance'));
      }
    },
  );
}
