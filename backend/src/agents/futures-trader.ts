import type { FastifyBaseLogger } from 'fastify';
import { callAi, extractJson as extractAiJson } from '../services/ai-service.js';
import type { ActivePortfolioWorkflow } from '../repos/portfolio-workflows.types.js';
import { ensureApiKeys } from '../services/portfolio-workflows.js';
import {
  buildFuturesPrompt,
  clearFuturesPromptCaches,
} from '../services/prompt-builders/futures.js';
import type {
  FuturesTraderDecision,
  FuturesTraderPrompt,
  FuturesTraderRunParams,
} from './futures-trader.types.js';

export const futuresTraderDeveloperInstructions = [
  'Primary Goal: Grow total USD account value by managing perpetual futures exposure while protecting account margin and PnL.',
  'Strategy & Decision Rules',
  '- Evaluate wallet balances, maintenance margin, and active positions before proposing trades.',
  '- Explicitly consider funding rates, mark-price momentum, and leverage constraints to avoid liquidation risk.',
  '- Prefer scaling or hedging existing positions instead of over-trading when confidence is low.',
  '- Document key risk drivers (volatility, funding flips, liquidation distances) in your rationale.',
  'Execution Rules',
  '- Proposed actions must stay within the provided leverage and exposure policy.',
  '- Always specify stop loss and take profit targets for new or scaled positions when market conditions permit.',
  '- Use reduce-only CLOSE actions when trimming exposure or exiting legs.',
  '- Never assume access to spot balances; operate solely on the futures account.',
  'Response Specification',
  '- Return a short report (≤255 chars), strategy name, optional rationale, and a list of actions.',
  '- Each action must include symbol, side, action kind, order type, quantity, and optional price/TP/SL/leverage notes.',
  '- If no trade is recommended, return an empty actions array.',
  '- On irrecoverable error, return an error message instead.',
].join('\n');

export const futuresTraderResponseSchema = {
  type: 'object',
  properties: {
    result: {
      anyOf: [
        {
          type: 'object',
          properties: {
            actions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  symbol: { type: 'string' },
                  positionSide: { type: 'string', enum: ['LONG', 'SHORT'] },
                  action: {
                    type: 'string',
                    enum: ['OPEN', 'CLOSE', 'SCALE', 'HOLD'],
                  },
                  type: { type: 'string', enum: ['MARKET', 'LIMIT'] },
                  quantity: { type: 'number' },
                  price: { type: 'number' },
                  reduceOnly: { type: 'boolean' },
                  leverage: { type: 'number' },
                  stopLoss: { type: 'number' },
                  takeProfit: { type: 'number' },
                  notes: { type: 'string' },
                },
                required: ['symbol', 'positionSide', 'action', 'type', 'quantity'],
                additionalProperties: false,
              },
            },
            shortReport: { type: 'string' },
            strategyName: { type: 'string' },
            strategyRationale: { type: 'string' },
          },
          required: ['actions', 'shortReport'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
          required: ['error'],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ['result'],
  additionalProperties: false,
} as const;

export async function collectFuturesPromptData(
  row: ActivePortfolioWorkflow,
  log: FastifyBaseLogger,
): Promise<FuturesTraderPrompt | undefined> {
  const ensuredExchange = await ensureApiKeys(log, row.userId, {
    exchangeKeyId: row.exchangeApiKeyId,
    requireAi: false,
    preferredExchange: 'bybit',
  });
  if ('code' in ensuredExchange || !ensuredExchange.exchangeProvider) {
    log.error({ workflowId: row.id }, 'missing exchange key for futures');
    return undefined;
  }
  return buildFuturesPrompt(row, ensuredExchange.exchangeProvider, log);
}

function extractFuturesResult(
  provider: FuturesTraderRunParams['aiProvider'],
  res: string,
): FuturesTraderDecision | null {
  const parsed = extractAiJson<{ result?: FuturesTraderDecision }>(provider, res);
  if (!parsed) return null;
  return parsed.result ?? null;
}

export async function runFuturesTrader(
  { log, model, apiKey, aiProvider }: FuturesTraderRunParams,
  prompt: FuturesTraderPrompt,
  instructionsOverride?: string,
): Promise<FuturesTraderDecision | null> {
  const instructions = instructionsOverride?.trim()
    ? instructionsOverride
    : futuresTraderDeveloperInstructions;
  const res = await callAi(
    aiProvider,
    model,
    instructions,
    futuresTraderResponseSchema,
    prompt,
    apiKey,
    true,
  );
  const decision = extractFuturesResult(aiProvider, res);
  if (!decision) {
    log.error('futures trader returned invalid response');
    return null;
  }
  return decision;
}

export function clearFuturesTraderCaches(): void {
  clearFuturesPromptCaches();
}
