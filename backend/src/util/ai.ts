import type { Analysis } from '../agents/types.js';

export const developerInstructions = [
  '- You are a day-trading portfolio manager who sets target allocations autonomously, trimming highs and buying dips.',
  '- You lead a crypto analyst team (news, technical). Reports from each member are attached.',
  '- Know every team member, their role, and ensure decisions follow the overall trading strategy.',
  '- Decide which limit orders to place based on portfolio, market data, and analyst reports.',
  '- Verify limit orders meet minNotional to avoid cancellations, especially for small amounts.',
  '- Use precise quantities and prices that fit available balances; avoid rounding up and oversizing orders.',
  '- Trading pairs in the prompt may include asset-to-asset combos (e.g. BTCSOL); you are not limited to cash pairs.',
  '- The prompt lists all supported trading pairs with their current prices for easy reference.',
  '- Return {orders:[{pair:"TOKEN1TOKEN2",token:"TOKEN",side:"BUY"|"SELL",quantity:number,delta:number|null,limitPrice:number|null,basePrice:number|null,maxPriceDivergence:number|null},...],shortReport}.',
  '- Unfilled orders are canceled before the next review; the review interval is provided in the prompt.',
  '- shortReport ≤255 chars.',
  '- On error, return {error:"message"}.',
].join('\n');

export interface TokenMetrics {
  ret_1h: number;
  ret_4h: number;
  ret_24h: number;
  ret_7d: number;
  ret_30d: number;
  sma_dist_20: number;
  sma_dist_50: number;
  sma_dist_200: number;
  macd_hist: number;
  vol_rv_7d: number;
  vol_rv_30d: number;
  vol_atr_pct: number;
  range_bb_bw: number;
  range_donchian20: number;
  volume_z_1h: number;
  volume_z_24h: number;
  corr_BTC_30d: number;
  regime_BTC: string;
}

export interface MarketTimeseries {
  ret_60m: number;
  ret_24h: number;
  ret_24m: number;
}

export interface RebalancePosition {
  sym: string;
  qty: number;
  price_usdt: number;
  value_usdt: number;
}

export interface PreviousReport {
  datetime: string;
  orders?: {
    symbol: string;
    side: string;
    quantity: number;
    status: string;
    datetime: string;
    cancellationReason?: string;
  }[];
  shortReport?: string;
  error?: unknown;
}

export interface RoutePrice {
  pair: string;
  price: number;
}

export interface RebalancePrompt {
  instructions: string;
  reviewInterval: string;
  policy: { floor: Record<string, number> };
  cash: string;
  portfolio: {
    ts: string;
    positions: RebalancePosition[];
    start_balance_usd?: number;
    start_balance_ts?: string;
    pnl_usd?: number;
  };
  routes: RoutePrice[];
  marketData: {
    indicators?: Record<string, TokenMetrics>;
    market_timeseries?: Record<string, MarketTimeseries>;
    fearGreedIndex?: { value: number; classification: string };
  };
  previous_reports?: PreviousReport[];
  reports?: {
    token: string;
    news: Analysis | null;
    tech: Analysis | null;
  }[];
}

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
                    delta: { type: ['number', 'null'] },
                    limitPrice: { type: ['number', 'null'] },
                    basePrice: { type: ['number', 'null'] },
                    maxPriceDivergence: { type: ['number', 'null'] },
                  },
                  required: [
                    'pair',
                    'token',
                    'side',
                    'quantity',
                    'delta',
                    'limitPrice',
                    'basePrice',
                    'maxPriceDivergence',
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

export async function callAi(
  model: string,
  developerInstructions: string,
  schema: unknown,
  input: unknown,
  apiKey: string,
  webSearch = false,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    input: compactJson(input),
    instructions: developerInstructions,
    text: {
      format: {
        type: 'json_schema',
        name: 'rebalance_response',
        strict: true,
        schema,
      },
    },
  };
  if (webSearch) body.tools = [{ type: 'web_search_preview' }];
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: compactJson(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`AI request failed: ${res.status} ${text}`);
  return text;
}

export function compactJson(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return value.trim();
    }
  }
  return JSON.stringify(value);
}

export function extractJson<T>(res: string): T | null {
  try {
    const json = JSON.parse(res);
    const outputs = Array.isArray((json as any).output) ? (json as any).output : [];
    const msg = outputs.find((o: any) => o.type === 'message' || o.id?.startsWith('msg_'));
    const text = msg?.content?.[0]?.text;
    if (typeof text !== 'string') return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
