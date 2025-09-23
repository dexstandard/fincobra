import type { FastifyBaseLogger } from 'fastify';
import { callAi } from '../services/openai-client.js';
import { isStablecoin } from '../util/tokens.js';
import { fetchAccount, fetchPairData, fetchPairInfo } from '../services/binance-client.js';
import { getRecentReviewResults } from '../repos/review-result.js';
import { getLimitOrdersByReviewResult } from '../repos/limit-orders.js';
import type { ActivePortfolioWorkflow } from '../repos/portfolio-workflow.js';
import type {
  RunParams,
  RebalancePosition,
  PreviousReport,
  RebalancePrompt,
} from './main-trader.types.js';

export const developerInstructions = [
  '- You are a day-trading portfolio manager who sets target allocations autonomously, trimming highs and buying dips.',
  '- You lead a crypto analyst team (news, technical). Reports from each member are attached.',
  '- Know every team member, their role, and ensure decisions follow the overall trading strategy.',
  '- Decide which limit orders to place based on portfolio, market data, and analyst reports.',
  '- Make sure to size limit orders higher then minNotional values to avoid order cancellations.',
  '- Use precise quantities and prices that fit available balances; avoid rounding up and oversizing orders.',
  '- Trading pairs in the prompt may include asset-to-asset combos (e.g. BTCSOL); you are not limited to cash pairs.',
  '- The prompt lists all supported trading pairs with their current prices for easy reference.',
  '- Return {orders:[{pair:"TOKEN1TOKEN2",token:"TOKEN",side:"BUY"|"SELL",quantity:number,limitPrice:number,basePrice:number,maxPriceDivergencePct:number},...],shortReport}.',
  '- maxPriceDivergencePct is expressed as a percentage drift allowance (e.g. 0.01 = 1%) between basePrice and the live market price before cancelation;',
  '- maxPriceDivergencePct must be at least 0.0001 (0.01%) to avoid premature cancelations;',
  '- Keep limit targets realistic for the stated review interval so orders can fill within that window; avoid extreme prices unlikely to execute within interval.',
  '- Unfilled orders are canceled before the next review; the review interval is provided in the prompt.',
  '- shortReport ≤255 chars.',
  '- On error, return {error:"message"}.',
].join('\n');

export const rebalanceResponseSchema = {
  type: 'object',
  properties: {
    result: {
      anyOf: [
        {
          type: 'object',
          properties: {
            orders: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  pair: { type: 'string' },
                  token: { type: 'string' },
                  side: { type: 'string', enum: ['BUY', 'SELL'] },
                  quantity: { type: 'number' },
                  limitPrice: { type: 'number' },
                  basePrice: { type: 'number' },
                  maxPriceDivergencePct: { type: 'number' },
                },
                required: [
                  'pair',
                  'token',
                  'side',
                  'quantity',
                  'limitPrice',
                  'basePrice',
                  'maxPriceDivergencePct',
                ],
                additionalProperties: false,
              },
            },
            shortReport: { type: 'string' },
          },
          required: ['orders', 'shortReport'],
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
};

export async function collectPromptData(
  row: ActivePortfolioWorkflow,
  log: FastifyBaseLogger,
): Promise<RebalancePrompt | undefined> {
  const cash = row.cashToken;
  const tokens = row.tokens.map((t) => t.token);
  const allTokens = [cash, ...tokens];

  const account = await fetchAccount(row.userId).catch((err) => {
    log.error({ err }, 'failed to fetch balance');
    return null;
  });
  if (!account) return undefined;

  const floor: Record<string, number> = { [cash]: 0 };
  const positions: RebalancePosition[] = [];
  const routes: RebalancePrompt['routes'] = [];

  const balCash = account.balances.find((b) => b.asset === cash);
  const cashQty = balCash ? Number(balCash.free) : 0;
  positions.push({ sym: cash, qty: cashQty, priceUsdt: 1, valueUsdt: cashQty });

  for (const t of row.tokens) {
    const bal = account.balances.find((b) => b.asset === t.token);
    const qty = bal ? Number(bal.free) : undefined;
    if (qty === undefined) {
      log.error('failed to fetch token balances');
      return undefined;
    }
    const { currentPrice } = await fetchPairData(t.token, cash);
    positions.push({
      sym: t.token,
      qty,
      priceUsdt: currentPrice,
      valueUsdt: currentPrice * qty,
    });
    floor[t.token] = t.minAllocation;
  }

  for (let i = 0; i < allTokens.length; i++) {
    for (let j = i + 1; j < allTokens.length; j++) {
      try {
        const [info, data] = await Promise.all([
          fetchPairInfo(allTokens[i], allTokens[j]),
          fetchPairData(allTokens[i], allTokens[j]),
        ]);
        const baseMin = data.currentPrice
          ? info.minNotional / data.currentPrice
          : 0;
        routes.push({
          pair: data.symbol,
          price: data.currentPrice,
          [info.quoteAsset]: { minNotional: info.minNotional },
          [info.baseAsset]: { minNotional: baseMin },
        });
      } catch (err) {
        log.error({ err }, 'failed to fetch pair data');
      }
    }
  }

  const portfolio: RebalancePrompt['portfolio'] = {
    ts: new Date().toISOString(),
    positions,
  };

  const totalValue = positions.reduce((sum, p) => sum + p.valueUsdt, 0);
  if (row.startBalance !== null) {
    portfolio.startBalanceUsd = row.startBalance;
    portfolio.startBalanceTs = row.createdAt;
    portfolio.pnlUsd = totalValue - row.startBalance;
  }

  const prevRows = await getRecentReviewResults(row.id, 5);
  const previousReports: PreviousReport[] = [];
  for (const r of prevRows) {
    const ordersRows = await getLimitOrdersByReviewResult(row.id, r.id);
    const orders = ordersRows.map((o) => {
      const planned = JSON.parse(o.plannedJson);
      return {
        symbol: planned.symbol,
        side: planned.side,
        quantity: planned.quantity,
        status: o.status,
        datetime: o.createdAt.toISOString(),
        ...(o.cancellationReason
          ? { cancellationReason: o.cancellationReason }
          : {}),
      } as const;
    });
    const report: PreviousReport = {
      datetime: r.createdAt.toISOString(),
      ...(r.shortReport !== undefined ? { shortReport: r.shortReport } : {}),
      ...(r.error !== undefined ? { error: r.error } : {}),
      ...(orders.length ? { orders } : {}),
    };
    previousReports.push(report);
  }

  const prompt: RebalancePrompt = {
    instructions: row.agentInstructions,
    reviewInterval: row.reviewInterval,
    policy: { floor },
    cash,
    portfolio,
    routes,
    marketData: {},
    reports: tokens
      .filter((t) => !isStablecoin(t))
      .map((token) => ({ token, news: null, tech: null })),
  };
  if (previousReports.length) {
    prompt.previousReports = previousReports;
  }
  return prompt;
}

export interface MainTraderOrder {
  pair: string;
  token: string;
  side: string;
  quantity: number;
  limitPrice: number;
  basePrice: number;
  maxPriceDivergencePct: number;
}

export interface MainTraderDecision {
  orders: MainTraderOrder[];
  shortReport: string;
}

function extractResult(res: string): MainTraderDecision | null {
  try {
    const json = JSON.parse(res);
    const outputs = Array.isArray((json as any).output) ? (json as any).output : [];
    const msg = outputs.find((o: any) => o.type === 'message' || o.id?.startsWith('msg_'));
    const text = msg?.content?.[0]?.text;
    if (typeof text !== 'string') return null;
    const parsed = JSON.parse(text);
    return parsed.result ?? null;
  } catch {
    return null;
  }
}

export async function run(
  { log, model, apiKey }: RunParams,
  prompt: RebalancePrompt,
): Promise<MainTraderDecision | null> {
  const res = await callAi(
    model,
    developerInstructions,
    rebalanceResponseSchema,
    prompt,
    apiKey,
    true,
  );
  const decision = extractResult(res);
  if (!decision) {
    log.error('main trader returned invalid response');
    return null;
  }
  return decision;
}

