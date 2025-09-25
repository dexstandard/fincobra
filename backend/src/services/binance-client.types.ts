export interface BinanceKeyVerificationResult {
  ok: boolean;
  reason?: string;
}

export interface BinanceBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface BinanceAccount {
  balances: BinanceBalance[];
}

export interface PairInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  quantityPrecision: number;
  pricePrecision: number;
  minNotional: number;
}

export type Kline = [
  number,
  string,
  string,
  string,
  string,
  string,
  ...unknown[],
];

export interface OpenOrder {
  orderId: number;
}

export interface OrderStatusResponse {
  status?: string;
}
