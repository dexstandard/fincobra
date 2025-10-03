export interface ExecOrder {
  pair: string;
  token: string;
  side: string;
  qty: number;
  limitPrice?: number;
  basePrice?: number;
  maxPriceDriftPct?: number;
}

export interface ParsedExecLogResponse {
  orders: ExecOrder[];
  shortReport: string;
}

export interface ParsedExecLog {
  text: string;
  response?: ParsedExecLogResponse;
  error?: Record<string, unknown>;
}
