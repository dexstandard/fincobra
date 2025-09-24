export interface TokenTags {
  symbol: string;
  tags: string[];
}

export const TOKENS: TokenTags[] = [
  { symbol: 'BTC', tags: ['btc', 'bitcoin'] },
  { symbol: 'BNB', tags: ['bnb', 'binance', 'bcs'] },
  { symbol: 'DOGE', tags: ['doge', 'dogecoin'] },
  { symbol: 'ETH', tags: ['eth', 'ethereum'] },
  { symbol: 'HBAR', tags: ['hbar', 'hedera'] },
  { symbol: 'PEPE', tags: ['pepe'] },
  { symbol: 'SHIB', tags: ['shib', 'shiba inu', 'shiba'] },
  { symbol: 'SOL', tags: ['sol', 'solana'] },
  { symbol: 'TON', tags: ['ton', 'toncoin'] },
  { symbol: 'TRX', tags: ['trx', 'tron'] },
  { symbol: 'XRP', tags: ['xrp', 'ripple'] },
  { symbol: 'USDT', tags: ['usdt', 'tether'] },
  { symbol: 'USDC', tags: ['usdc', 'usd coin'] },
];

export const TOKEN_SYMBOLS = TOKENS.map((t) => t.symbol);

export const STABLECOINS = ['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDP'] as const;
export function isStablecoin(sym: string): boolean {
  return STABLECOINS.includes(sym.toUpperCase() as any);
}
