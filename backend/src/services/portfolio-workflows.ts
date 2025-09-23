import type { FastifyBaseLogger } from 'fastify';
import type { PortfolioWorkflowInput } from '../routes/portfolio-workflows.js';
import {
  getUserApiKeys,
  findIdenticalDraftWorkflow,
  findActiveTokenConflicts,
} from '../repos/portfolio-workflows.js';
import { getAiKey, getSharedAiKey } from '../repos/ai-api-key.js';
import { errorResponse, lengthMessage, type ErrorResponse } from '../util/errorMessages.js';
import { fetchTokensBalanceUsd } from './binance-client.js';

interface TokenAllocation {
  token: string;
  minAllocation: number;
}

function validateAllocations(tokens: TokenAllocation[]) {
  let total = 0;
  for (const allocation of tokens) {
    if (allocation.minAllocation < 0 || allocation.minAllocation > 95)
      throw new Error('invalid minimum allocations');
    total += allocation.minAllocation;
  }
  if (total > 95) throw new Error('invalid minimum allocations');
  return tokens;
}

export enum PortfolioWorkflowStatus {
  Active = 'active',
  Inactive = 'inactive',
  Draft = 'draft',
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
  const conflicts = dupRows.map((r) => `${r.token} used by ${r.name} (${r.id})`);
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
    if (body.status !== PortfolioWorkflowStatus.Draft) {
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
  if (body.status === PortfolioWorkflowStatus.Draft) {
    const dupDraft = await findIdenticalDraftWorkflow(
      {
        userId,
        model: body.model,
        name: body.name,
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
    if (dupDraft) {
      log.error({ workflowId: dupDraft.id }, 'identical draft exists');
      return {
        code: 400,
        body: errorResponse(
          `identical draft already exists: ${dupDraft.name} (${dupDraft.id})`,
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

export async function ensureApiKeys(
  log: FastifyBaseLogger,
  userId: string,
): Promise<ValidationErr | null> {
  const userRow = await getUserApiKeys(userId);
  if (
    !userRow?.aiApiKeyEnc ||
    !userRow.binanceApiKeyEnc ||
    !userRow.binanceApiSecretEnc
  ) {
    log.error('missing api keys');
    return { code: 400, body: errorResponse('missing api keys') };
  }
  return null;
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
): Promise<{ body: PortfolioWorkflowInput; startBalance: number | null } | ValidationErr> {
  try {
    body.manualRebalance = !!body.manualRebalance;
    body.useEarn = body.useEarn !== false;
    body.tokens = validateAllocations(body.tokens);
  } catch {
    log.error('invalid allocations');
    return { code: 400, body: errorResponse('invalid minimum allocations') };
  }
  const err = await validateWorkflowInput(log, userId, body, id);
  if (err) return err;
  let startBalance: number | null = null;
  if (body.status === PortfolioWorkflowStatus.Active) {
    const keyErr = await ensureApiKeys(log, userId);
    if (keyErr) return keyErr;
    const bal = await getStartBalance(
      log,
      userId,
      [body.cash, ...body.tokens.map((t) => t.token)],
    );
    if (typeof bal === 'number') startBalance = bal;
    else return bal;
  }
  return { body, startBalance };
}
