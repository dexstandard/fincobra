import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { RATE_LIMITS } from '../rate-limit.js';
import { fetchAccount, fetchTotalBalanceUsd } from '../services/binance.js';
import { errorResponse, ERROR_MESSAGES } from '../util/errorMessages.js';
import { getValidatedUserId, userPreHandlers } from './_shared/guards.js';
import { parseRequestParams } from './_shared/validation.js';

interface TokenParams {
  token: string;
}

const tokenParamsSchema: z.ZodType<TokenParams> = z.object({
  token: z.string(),
});

type BinanceAccount = NonNullable<Awaited<ReturnType<typeof fetchAccount>>>;

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
  } catch {
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
    reply.code(500).send(errorResponse('failed to fetch account'));
    return undefined;
  }
}

function normalizeBalances(account: BinanceAccount) {
  return account.balances.map((balance) => ({
    asset: balance.asset,
    free: Number(balance.free),
    locked: Number(balance.locked),
  }));
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
      return { balances: normalizeBalances(account) };
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
      const params = parseRequestParams(tokenParamsSchema, req, reply);
      if (!params) return;
      const account = await loadAccount(userId, reply);
      if (!account) return;
      const symbol = params.token.toUpperCase();
      const balance = account.balances.find((entry) => entry.asset === symbol);
      if (!balance) return { asset: symbol, free: 0, locked: 0 };
      return {
        asset: symbol,
        free: Number(balance.free),
        locked: Number(balance.locked),
      };
    },
  );
}
