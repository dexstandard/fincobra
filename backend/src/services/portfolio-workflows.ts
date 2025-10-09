import type { FastifyBaseLogger } from 'fastify';
import type {
  PortfolioWorkflowInput,
  PortfolioWorkflowTokenInput,
} from '../routes/portfolio-workflows.types.js';
import {
  getUserApiKeys,
  findIdenticalInactiveWorkflow,
  findActiveTokenConflicts,
} from '../repos/portfolio-workflows.js';
import { getAiKey, getSharedAiKey } from '../repos/ai-api-key.js';
import { errorResponse, lengthMessage } from '../util/error-messages.js';
import type { ErrorResponse } from '../util/error-messages.types.js';
import {
  fetchPairInfo,
  fetchTokensBalanceUsd,
  isInvalidSymbolError,
} from './binance-client.js';

function normalizeTokenSymbol(token: string): string {
  return token.trim().toUpperCase();
}

function validateAllocations(tokens: PortfolioWorkflowTokenInput[]) {
  let total = 0;
  for (const allocation of tokens) {
    if (allocation.minAllocation < 0 || allocation.minAllocation > 95)
      throw new Error('invalid minimum allocations');
    total += allocation.minAllocation;
  }
  if (total > 95) throw new Error('invalid minimum allocations');
  return tokens;
}

export async function validateTradingPairs(
  log: FastifyBaseLogger,
  cash: string,
  tokens: string[],
): Promise<ValidationErr | null> {
  for (const token of tokens) {
    try {
      await fetchPairInfo(token, cash);
    } catch (err) {
      if (isInvalidSymbolError(err)) {
        log.error({ token, cash }, 'unsupported trading pair');
        return {
          code: 400,
          body: errorResponse(`unsupported trading pair: ${token}/${cash}`),
        };
      }
      log.error({ err, token, cash }, 'failed to validate trading pair');
      return {
        code: 502,
        body: errorResponse('failed to validate trading pair'),
      };
    }
  }
  return null;
}

export enum PortfolioWorkflowStatus {
  Active = 'active',
  Inactive = 'inactive',
  Retired = 'retired',
}

export interface ValidationErr {
  code: number;
  body: ErrorResponse;
}

export async function validateTokenConflicts(
  log: FastifyBaseLogger,
  userId: string,
  tokens: string[],
  id?: string,
): Promise<ValidationErr | null> {
  const dupRows = await findActiveTokenConflicts(userId, tokens, id);
  if (!dupRows.length) return null;
  const conflicts = dupRows.map((r) => `${r.token} used by workflow ${r.id}`);
  const parts = conflicts;
  const msg = `token${parts.length > 1 ? 's' : ''} ${parts.join(', ')} already used`;
  log.error('token conflict');
  return { code: 400, body: errorResponse(msg) };
}

async function validateWorkflowInput(
  log: FastifyBaseLogger,
  userId: string,
  body: PortfolioWorkflowInput,
  id?: string,
): Promise<ValidationErr | null> {
  body.cash = (body.cash ?? '').toUpperCase();
  if (!['USDT', 'USDC'].includes(body.cash)) {
    log.error('invalid cash token');
    return { code: 400, body: errorResponse('invalid cash token') };
  }
  if (body.tokens.length < 1 || body.tokens.length > 4) {
    log.error('invalid tokens');
    return { code: 400, body: errorResponse('invalid tokens') };
  }
  if (body.tokens.some((t) => t.token === body.cash)) {
    log.error('cash token in positions');
    return { code: 400, body: errorResponse('cash token in positions') };
  }
  if (body.status === PortfolioWorkflowStatus.Retired) {
    log.error('invalid status');
    return { code: 400, body: errorResponse('invalid status') };
  }
  if (!body.model) {
    if (body.status === PortfolioWorkflowStatus.Active) {
      log.error('model required');
      return { code: 400, body: errorResponse('model required') };
    }
  } else if (body.model.length > 50) {
    log.error('model too long');
    return { code: 400, body: errorResponse(lengthMessage('model', 50)) };
  } else {
    const [ownKey, sharedKey] = await Promise.all([
      getAiKey(userId),
      getSharedAiKey(userId),
    ]);
    if (!ownKey && sharedKey?.model && body.model !== sharedKey.model) {
      log.error('model not allowed');
      return { code: 400, body: errorResponse('model not allowed') };
    }
  }
  if (body.status === PortfolioWorkflowStatus.Inactive) {
    const dupInactive = await findIdenticalInactiveWorkflow(
      {
        userId,
        model: body.model,
        cashToken: body.cash,
        tokens: body.tokens,
        risk: body.risk,
        reviewInterval: body.reviewInterval,
        agentInstructions: body.agentInstructions,
        manualRebalance: body.manualRebalance,
        useEarn: body.useEarn,
      },
      id,
    );
    if (dupInactive) {
      log.error({ workflowId: dupInactive.id }, 'identical inactive exists');
      return {
        code: 400,
        body: errorResponse(
          `identical inactive workflow already exists: workflow ${dupInactive.id}`,
        ),
      };
    }
  } else {
    const conflict = await validateTokenConflicts(
      log,
      userId,
      [body.cash, ...body.tokens.map((t) => t.token)],
      id,
    );
    if (conflict) return conflict;
  }
  return null;
}

export interface EnsuredExchangeKey {
  exchangeKeyId: string | null;
  exchangeProvider: 'binance' | 'bybit' | null;
}

interface EnsureApiKeysOptions {
  exchangeKeyId?: string | null;
  requireAi?: boolean;
  requireExchange?: boolean;
}

export async function ensureApiKeys(
  log: FastifyBaseLogger,
  userId: string,
  options: EnsureApiKeysOptions = {},
): Promise<ValidationErr | EnsuredExchangeKey> {
  const { exchangeKeyId, requireAi = true, requireExchange = true } = options;
  const userRow = await getUserApiKeys(userId);
  if (!userRow) {
    log.error('missing api keys');
    return { code: 400, body: errorResponse('missing api keys') };
  }

  const hasAiKey = !!userRow.aiApiKeyEnc;
  const hasBinanceKey =
    !!userRow.binanceApiKeyEnc && !!userRow.binanceApiSecretEnc;
  const hasBybitKey =
    !!userRow.bybitApiKeyEnc && !!userRow.bybitApiSecretEnc;

  let resolvedKeyId: string | null = null;
  let exchangeProvider: 'binance' | 'bybit' | null = null;

  if (exchangeKeyId) {
    if (hasBinanceKey && exchangeKeyId === userRow.binanceKeyId) {
      resolvedKeyId = userRow.binanceKeyId ?? null;
      exchangeProvider = 'binance';
    } else if (hasBybitKey && exchangeKeyId === userRow.bybitKeyId) {
      resolvedKeyId = userRow.bybitKeyId ?? null;
      exchangeProvider = 'bybit';
    } else {
      log.error({ exchangeKeyId }, 'missing api keys');
      return { code: 400, body: errorResponse('missing api keys') };
    }
  } else if (hasBinanceKey) {
    resolvedKeyId = userRow.binanceKeyId ?? null;
    exchangeProvider = 'binance';
  } else if (hasBybitKey) {
    resolvedKeyId = userRow.bybitKeyId ?? null;
    exchangeProvider = 'bybit';
  }

  if (requireAi && !hasAiKey) {
    log.error('missing api keys');
    return { code: 400, body: errorResponse('missing api keys') };
  }

  if (requireExchange && !exchangeProvider) {
    log.error('missing api keys');
    return { code: 400, body: errorResponse('missing api keys') };
  }

  return { exchangeKeyId: resolvedKeyId, exchangeProvider };
}

export async function getStartBalance(
  log: FastifyBaseLogger,
  userId: string,
  tokens: string[],
): Promise<number | ValidationErr> {
  try {
    const startBalance = await fetchTokensBalanceUsd(userId, tokens);
    if (startBalance === null) {
      log.error('failed to fetch balance');
      return { code: 500, body: errorResponse('failed to fetch balance') };
    }
    return startBalance;
  } catch {
    log.error('failed to fetch balance');
    return { code: 500, body: errorResponse('failed to fetch balance') };
  }
}

export async function preparePortfolioWorkflowForUpsert(
  log: FastifyBaseLogger,
  userId: string,
  body: PortfolioWorkflowInput,
  id?: string,
): Promise<
  { body: PortfolioWorkflowInput; startBalance: number | null } | ValidationErr
> {
  try {
    body.manualRebalance = !!body.manualRebalance;
    body.useEarn = body.useEarn === true;
    body.tokens = validateAllocations(
      body.tokens.map((t) => ({
        token: normalizeTokenSymbol(t.token),
        minAllocation: t.minAllocation,
      })),
    );
  } catch {
    log.error('invalid allocations');
    return { code: 400, body: errorResponse('invalid minimum allocations') };
  }
  const err = await validateWorkflowInput(log, userId, body, id);
  if (err) return err;

  const ensuredKeys = await ensureApiKeys(log, userId, {
    exchangeKeyId: body.exchangeKeyId,
    requireAi: body.status === PortfolioWorkflowStatus.Active,
    requireExchange: body.status === PortfolioWorkflowStatus.Active,
  });
  if ('code' in ensuredKeys) return ensuredKeys;
  body.exchangeKeyId = ensuredKeys.exchangeKeyId;

  let startBalance: number | null = null;
  if (body.status === PortfolioWorkflowStatus.Active) {
    const pairErr = await validateTradingPairs(
      log,
      body.cash,
      body.tokens.map((t) => t.token),
    );
    if (pairErr) return pairErr;
    if (ensuredKeys.exchangeProvider === 'binance') {
      const bal = await getStartBalance(log, userId, [
        body.cash,
        ...body.tokens.map((t) => t.token),
      ]);
      if (typeof bal === 'number') startBalance = bal;
      else return bal;
    }
  }
  return { body, startBalance };
}
