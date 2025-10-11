export type ExchangeOrderSide = 'BUY' | 'SELL';
export type ExchangePositionSide = 'LONG' | 'SHORT';
export type ExchangeFuturesOrderType = 'MARKET' | 'LIMIT';

export interface ExchangeSpotMarket {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  minNotional?: number;
}

export interface ExchangeTickerPrice {
  symbol: string;
  price: number;
}

export interface ExchangeSpotBalance {
  asset: string;
  free: number;
  locked: number;
  total: number;
}

export interface ExchangeSpotOrderIntent {
  symbol: string;
  side: ExchangeOrderSide;
  quantity: number;
  limitPrice: number;
}

export interface ExchangeSpotOrderReference {
  symbol: string;
  orderId: string | number;
}

export interface ExchangeSpotOpenOrder {
  orderId: string | number;
  symbol?: string;
  status?: string;
  side?: ExchangeOrderSide;
  limitPrice?: number;
  quantity?: number;
}

export interface ExchangeSpotOrderStatus {
  status?: string;
}

export interface ExchangeSpotOpenOrdersFilter {
  symbol: string;
}

export interface ExchangeFuturesLeverageRequest {
  symbol: string;
  leverage: number;
}

export interface ExchangeFuturesMarginModeRequest {
  symbol: string;
  marginMode: 'cross' | 'isolated';
  leverage?: number | null;
}

export interface ExchangeFuturesPositionIntent {
  symbol: string;
  positionSide: ExchangePositionSide;
  quantity: number;
  type?: ExchangeFuturesOrderType;
  price?: number;
  reduceOnly?: boolean;
  hedgeMode?: boolean;
  positionIdx?: 0 | 1 | 2;
}

export interface ExchangeFuturesStopIntent {
  symbol: string;
  positionSide: ExchangePositionSide;
  stopPrice: number;
  hedgeMode?: boolean;
  positionIdx?: 0 | 1 | 2;
}

export interface ExchangeFuturesWalletCoin {
  asset: string;
  equity?: number;
  walletBalance?: number;
  availableBalance?: number;
  availableToWithdraw?: number;
  availableToTransfer?: number;
  availableToTrade?: number;
  unrealizedPnl?: number;
}

export interface ExchangeFuturesWallet {
  accountType: string;
  totalEquity?: number;
  totalWalletBalance?: number;
  totalAvailableBalance?: number;
  totalMarginBalance?: number;
  coins: ExchangeFuturesWalletCoin[];
}

export interface ExchangeGatewayMetadataModule {
  fetchMarket(baseAsset: string, quoteAsset: string): Promise<ExchangeSpotMarket>;
  fetchTicker(symbol: string): Promise<ExchangeTickerPrice>;
}

export interface ExchangeGatewaySpotModule {
  fetchBalances(userId: string): Promise<ExchangeSpotBalance[]>;
  placeLimitOrder(
    userId: string,
    order: ExchangeSpotOrderIntent,
  ): Promise<unknown>;
  cancelOrder(
    userId: string,
    order: ExchangeSpotOrderReference,
  ): Promise<unknown>;
  fetchOpenOrders(
    userId: string,
    filter: ExchangeSpotOpenOrdersFilter,
  ): Promise<ExchangeSpotOpenOrder[]>;
  fetchOrder(
    userId: string,
    order: ExchangeSpotOrderReference,
  ): Promise<ExchangeSpotOrderStatus | null>;
}

export interface ExchangeGatewayFuturesModule {
  fetchWallet?(userId: string): Promise<ExchangeFuturesWallet | null>;
  setMarginMode?(
    userId: string,
    request: ExchangeFuturesMarginModeRequest,
  ): Promise<unknown>;
  setLeverage(
    userId: string,
    request: ExchangeFuturesLeverageRequest,
  ): Promise<unknown>;
  openPosition(
    userId: string,
    intent: ExchangeFuturesPositionIntent,
  ): Promise<unknown>;
  setStopLoss(
    userId: string,
    intent: ExchangeFuturesStopIntent,
  ): Promise<unknown>;
  setTakeProfit(
    userId: string,
    intent: ExchangeFuturesStopIntent,
  ): Promise<unknown>;
}

export interface ExchangeGatewaySpecification {
  metadata: ExchangeGatewayMetadataModule;
  spot?: ExchangeGatewaySpotModule;
  futures?: ExchangeGatewayFuturesModule;
}
