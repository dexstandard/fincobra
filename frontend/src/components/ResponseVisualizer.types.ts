export interface ResponseOrder {
  pair?: string;
  token?: string;
  side?: string;
  qty?: number;
  limitPrice?: number;
  basePrice?: number;
  maxPriceDriftPct?: number;
}

export interface ResponseData {
  rebalance: boolean;
  shortReport?: string;
  strategyName?: string;
  strategyRationale?: string;
  orders: ResponseOrder[];
  error?: string;
  errors?: string[];
}
