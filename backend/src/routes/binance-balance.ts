import type { FastifyInstance, FastifyReply } from 'fastify';
import { RATE_LIMITS } from '../rate-limit.js';
import { BinanceAccount, fetchAccount, fetchTotalBalanceUsd } from '../services/binance-client.js';
import { errorResponse, ERROR_MESSAGES } from '../util/error-messages.js';
import { getValidatedUserId, userPreHandlers } from './_shared/guards.js';
import { parseRequestParams, userTokenParamsSchema } from './_shared/validation.js';

async function loadAccount(
  userId: string,
  reply: FastifyReply,
): Promise<BinanceAccount | undefined> {
  try {
    const account = await fetchAccount(userId);
    if (!account) {
      reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
      return undefined;
    }
    return account;
  } catch (err) {
    reply.log.error({ err, userId }, 'failed to fetch account');
    reply.code(500).send(errorResponse('failed to fetch account'));
    return undefined;
  }
}

async function loadTotalBalanceUsd(
  userId: string,
  reply: FastifyReply,
): Promise<number | undefined> {
  try {
    const total = await fetchTotalBalanceUsd(userId);
    if (total === null) {
      reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
      return undefined;
    }
    return total;
  } catch {
    reply.code(500).send(errorResponse('failed to fetch balance'));
    return undefined;
  }
}

export default async function binanceBalanceRoutes(app: FastifyInstance) {
  app.get(
    '/users/:id/binance-account',
    {
      config: { rateLimit: RATE_LIMITS.RELAXED },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const userId = getValidatedUserId(req);
      const account = await loadAccount(userId, reply);
      if (!account) return;
      return { balances: account.balances };
    },
  );

  app.get(
    '/users/:id/binance-balance',
    {
      config: { rateLimit: RATE_LIMITS.MODERATE },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const userId = getValidatedUserId(req);
      const total = await loadTotalBalanceUsd(userId, reply);
      if (total === undefined) return;
      return { totalUsd: total };
    },
  );

  app.get(
    '/users/:id/binance-balance/:token',
    {
      config: { rateLimit: RATE_LIMITS.RELAXED },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const userId = getValidatedUserId(req);
      const params = parseRequestParams(userTokenParamsSchema, req, reply);
      if (!params) return;
      const account = await loadAccount(userId, reply);
      if (!account) return;
      const symbol = params.token.toUpperCase();
      const balance = account.balances.find((entry) => entry.asset === symbol);
      if (!balance) return { asset: symbol, free: '0', locked: '0' };
      return {
        asset: symbol,
        free: balance.free,
        locked: balance.locked,
      };
    },
  );
}
