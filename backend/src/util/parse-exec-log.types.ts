export interface ExecOrder {
  pair: string;
  token: string;
  side: string;
  qty: number;
  limitPrice?: number;
  basePrice?: number;
  maxPriceDriftPct?: number;
}

export interface ExecFuturesPosition {
  symbol: string;
  positionSide: string;
  qty: number;
  leverage?: number;
  entryType?: string;
  entryPrice?: number;
  reduceOnly?: boolean;
  stopLoss?: number;
  takeProfit?: number;
}

export interface ParsedExecLogResponse {
  orders?: ExecOrder[];
  futures?: ExecFuturesPosition[];
  shortReport: string;
}

export interface ParsedExecLog {
  text: string;
  response?: ParsedExecLogResponse;
  error?: Record<string, unknown>;
}
