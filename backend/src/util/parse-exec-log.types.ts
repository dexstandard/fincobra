export interface ExecOrder {
  pair: string;
  token: string;
  side: string;
  quantity: number;
  limitPrice?: number;
  basePrice?: number;
  maxPriceDivergencePct?: number;
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
