import type {
  BinanceAccount,
  BinanceBalance,
  OrderStatusResponse,
  PairInfo,
} from './binance-client.types.js';
import type {
  BybitWalletBalance,
  BybitWalletCoinBalance,
} from './bybit-client.types.js';
import type {
  ExchangeFuturesWallet,
  ExchangeFuturesWalletCoin,
  ExchangeSpotBalance,
  ExchangeSpotMarket,
  ExchangeSpotOpenOrder,
  ExchangeSpotOrderStatus,
  ExchangeTickerPrice,
} from './exchange-gateway.types.js';

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function mapBinancePairInfo(info: PairInfo): ExchangeSpotMarket {
  return {
    symbol: info.symbol,
    baseAsset: info.baseAsset,
    quoteAsset: info.quoteAsset,
    pricePrecision: info.pricePrecision,
    quantityPrecision: info.quantityPrecision,
    minNotional: info.minNotional,
  };
}

export function mapBinanceTickerPrice(
  ticker: { symbol: string; currentPrice: number },
): ExchangeTickerPrice {
  const price = toFiniteNumber(ticker.currentPrice) ?? 0;
  return {
    symbol: ticker.symbol,
    price,
  };
}

export function mapBinanceBalance(
  balance: BinanceBalance,
): ExchangeSpotBalance | null {
  const free = toFiniteNumber(balance.free);
  const locked = toFiniteNumber(balance.locked);
  if (free === undefined || locked === undefined) {
    return null;
  }
  const total = free + locked;
  if (!Number.isFinite(total)) {
    return null;
  }
  return {
    asset: balance.asset,
    free,
    locked,
    total,
  };
}

export function mapBinanceAccountBalances(
  account: BinanceAccount | null,
): ExchangeSpotBalance[] {
  if (!account) return [];
  return account.balances
    .map((balance) => mapBinanceBalance(balance))
    .filter((balance): balance is ExchangeSpotBalance => balance !== null);
}

export function mapBinanceOpenOrder(raw: unknown): ExchangeSpotOpenOrder | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const orderId = candidate.orderId;
  if (typeof orderId !== 'number' && typeof orderId !== 'string') {
    return null;
  }
  const side = candidate.side;
  const quantitySource =
    candidate.origQty ?? candidate.quantity ?? candidate.qty;
  const limitPrice = toFiniteNumber(candidate.price);
  const quantity = toFiniteNumber(quantitySource);
  return {
    orderId,
    symbol: typeof candidate.symbol === 'string' ? candidate.symbol : undefined,
    status: typeof candidate.status === 'string' ? candidate.status : undefined,
    side: side === 'BUY' || side === 'SELL' ? side : undefined,
    limitPrice: limitPrice,
    quantity: quantity,
  };
}

export function mapBinanceOrderStatus(
  status: OrderStatusResponse | null,
): ExchangeSpotOrderStatus | null {
  if (!status) return null;
  return {
    status: typeof status.status === 'string' ? status.status : undefined,
  };
}

function mapBybitWalletCoin(
  coin: BybitWalletCoinBalance,
): ExchangeFuturesWalletCoin {
  return {
    asset: coin.coin,
    equity: toFiniteNumber(coin.equity),
    walletBalance: toFiniteNumber(coin.walletBalance),
    availableBalance: toFiniteNumber(coin.availableToTrade),
    availableToWithdraw: toFiniteNumber(coin.availableToWithdraw),
    availableToTransfer: toFiniteNumber(coin.availableToTransfer),
    availableToTrade: toFiniteNumber(coin.availableToTrade),
    unrealizedPnl: toFiniteNumber(coin.unrealisedPnl),
  };
}

export function mapBybitWalletBalance(
  balance: BybitWalletBalance | null,
): ExchangeFuturesWallet | null {
  if (!balance) return null;
  return {
    accountType: balance.accountType,
    totalEquity: toFiniteNumber(balance.totalEquity),
    totalWalletBalance: toFiniteNumber(balance.totalWalletBalance),
    totalAvailableBalance: toFiniteNumber(balance.totalAvailableBalance),
    totalMarginBalance: toFiniteNumber(balance.totalMarginBalance),
    coins: (balance.coin ?? []).map((coin) => mapBybitWalletCoin(coin)),
  };
}
