export type SupportedOracleSymbol = 'USDT' | 'USDC';

export interface PriceOracleQuote {
  symbol: SupportedOracleSymbol;
  price: number;
  updatedAt: Date;
}
