import type { FastifyBaseLogger } from 'fastify';
import {
  callAi,
  developerInstructions,
  rebalanceResponseSchema,
  type RebalancePosition,
  type PreviousResponse,
  type RebalancePrompt,
  extractJson,
} from '../util/ai.js';
import { isStablecoin } from '../util/tokens.js';
import { fetchAccount, fetchPairData } from '../services/binance.js';
import { getRecentReviewResults } from '../repos/agent-review-result.js';
import { getRecentLimitOrders } from '../repos/limit-orders.js';
import type { ActivePortfolioWorkflowRow } from '../repos/portfolio-workflow.js';
import type { RunParams } from './types.js';

function extractPreviousResponse(r: any): PreviousResponse | undefined {
  const res: PreviousResponse = {};
  if (Array.isArray(r.orders)) res.orders = r.orders;
  if (typeof r.shortReport === 'string') res.shortReport = r.shortReport;
  if (r.error !== undefined && r.error !== null) res.error = r.error;
  return Object.keys(res).length ? res : undefined;
}

export async function collectPromptData(
  row: ActivePortfolioWorkflowRow,
  log: FastifyBaseLogger,
): Promise<RebalancePrompt | undefined> {
  const cash = row.cash_token;
  const tokens = row.tokens.map((t) => t.token);

  const account = await fetchAccount(row.user_id).catch((err) => {
    log.error({ err }, 'failed to fetch balance');
    return null;
  });
  if (!account) return undefined;

  const floor: Record<string, number> = {};
  const positions: RebalancePosition[] = [];

  const balCash = account.balances.find((b) => b.asset === cash);
  const cashQty = balCash ? Number(balCash.free) + Number(balCash.locked) : 0;
  positions.push({ sym: cash, qty: cashQty, price_usdt: 1, value_usdt: cashQty });

  for (const t of row.tokens) {
    const bal = account.balances.find((b) => b.asset === t.token);
    const qty = bal ? Number(bal.free) + Number(bal.locked) : undefined;
    if (qty === undefined) {
      log.error('failed to fetch token balances');
      return undefined;
    }
    const { currentPrice } = await fetchPairData(t.token, cash);
    positions.push({
      sym: t.token,
      qty,
      price_usdt: currentPrice,
      value_usdt: currentPrice * qty,
    });
    floor[t.token] = t.min_allocation;
  }

  const portfolio: RebalancePrompt['portfolio'] = {
    ts: new Date().toISOString(),
    positions,
  };

  const totalValue = positions.reduce((sum, p) => sum + p.value_usdt, 0);
  if (row.start_balance !== null) {
    portfolio.start_balance_usd = row.start_balance;
    portfolio.start_balance_ts = row.created_at;
    portfolio.pnl_usd = totalValue - row.start_balance;
  }

  const [prevRows, prevOrdersRows] = await Promise.all([
    getRecentReviewResults(row.id, 5),
    getRecentLimitOrders(row.id, 5),
  ]);
  const previousResponses = prevRows
    .map(extractPreviousResponse)
    .filter(Boolean) as PreviousResponse[];
  const prevOrders = prevOrdersRows.map((o) => {
    const planned = JSON.parse(o.planned_json);
    return {
      symbol: planned.symbol,
      side: planned.side,
      quantity: planned.quantity,
      datetime: o.created_at.toISOString(),
      status: o.status,
    } as const;
  });

  const prompt: RebalancePrompt = {
    instructions: row.agent_instructions,
    policy: { floor },
    cash,
    portfolio,
    marketData: {},
    reports: tokens
      .filter((t) => !isStablecoin(t))
      .map((token) => ({ token, news: null, tech: null })),
  };
  if (previousResponses.length) {
    prompt.previous_responses = previousResponses;
  }
  if (prevOrders.length) {
    prompt.prev_orders = prevOrders;
  }
  return prompt;
}

export interface MainTraderOrder {
  pair: string;
  token: string;
  side: string;
  quantity: number;
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

