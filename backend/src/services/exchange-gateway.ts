import {
  cancelOrder as cancelBinanceOrder,
  createLimitOrder,
  fetchAccount,
  fetchOpenOrders,
  fetchOrder,
  fetchPairInfo,
  fetchSymbolPrice,
} from './binance-client.js';
import {
  openFuturesPosition as openBinanceFuturesPosition,
  setFuturesLeverage as setBinanceFuturesLeverage,
  setFuturesStopLoss as setBinanceFuturesStopLoss,
  setFuturesTakeProfit as setBinanceFuturesTakeProfit,
} from './binance-futures.js';
import {
  fetchFuturesWalletBalance,
  openBybitFuturesPosition,
  setBybitFuturesLeverage,
  setBybitFuturesStopLoss,
  setBybitFuturesTakeProfit,
} from './bybit-client.js';
import {
  mapBinanceAccountBalances,
  mapBinanceOpenOrder,
  mapBinanceOrderStatus,
  mapBinancePairInfo,
  mapBinanceTickerPrice,
  mapBybitWalletBalance,
} from './exchange-gateway.mappers.js';
import type {
  ExchangeGatewaySpecification,
  ExchangeSpotOpenOrder,
  ExchangeSpotOrderReference,
} from './exchange-gateway.types.js';

export type SupportedExchange = 'binance' | 'bybit';

function normalizeOrderId(reference: ExchangeSpotOrderReference): number {
  if (typeof reference.orderId === 'number') {
    return reference.orderId;
  }
  const parsed = Number.parseInt(reference.orderId, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`invalid order id: ${reference.orderId}`);
  }
  return parsed;
}

const binanceGateway: ExchangeGatewaySpecification = {
  metadata: {
    async fetchMarket(baseAsset: string, quoteAsset: string) {
      const info = await fetchPairInfo(baseAsset, quoteAsset);
      return mapBinancePairInfo(info);
    },
    async fetchTicker(symbol: string) {
      const ticker = await fetchSymbolPrice(symbol);
      return mapBinanceTickerPrice(ticker);
    },
  },
  spot: {
    async fetchBalances(userId: string) {
      const account = await fetchAccount(userId);
      return mapBinanceAccountBalances(account);
    },
    placeLimitOrder(userId: string, order) {
      return createLimitOrder(userId, {
        symbol: order.symbol,
        side: order.side,
        qty: order.quantity,
        price: order.limitPrice,
      });
    },
    cancelOrder(userId: string, reference) {
      const orderId = normalizeOrderId(reference);
      return cancelBinanceOrder(userId, {
        symbol: reference.symbol,
        orderId,
      });
    },
    async fetchOpenOrders(userId: string, filter) {
      const raw = await fetchOpenOrders(userId, { symbol: filter.symbol });
      const entries = Array.isArray(raw) ? raw : [];
      return entries
        .map((entry) => mapBinanceOpenOrder(entry))
        .filter((entry): entry is ExchangeSpotOpenOrder => entry !== null);
    },
    async fetchOrder(userId: string, reference) {
      const orderId = normalizeOrderId(reference);
      const status = await fetchOrder(userId, {
        symbol: reference.symbol,
        orderId,
      });
      return mapBinanceOrderStatus(status);
    },
  },
  futures: {
    setLeverage(userId: string, request) {
      return setBinanceFuturesLeverage(userId, request.symbol, request.leverage);
    },
    openPosition(userId: string, intent) {
      return openBinanceFuturesPosition(userId, {
        symbol: intent.symbol,
        positionSide: intent.positionSide,
        quantity: intent.quantity,
        type: intent.type,
        price: intent.price,
        reduceOnly: intent.reduceOnly,
      });
    },
    setStopLoss(userId: string, intent) {
      return setBinanceFuturesStopLoss(userId, {
        symbol: intent.symbol,
        positionSide: intent.positionSide,
        stopPrice: intent.stopPrice,
      });
    },
    setTakeProfit(userId: string, intent) {
      return setBinanceFuturesTakeProfit(userId, {
        symbol: intent.symbol,
        positionSide: intent.positionSide,
        stopPrice: intent.stopPrice,
      });
    },
  },
};

const bybitGateway: ExchangeGatewaySpecification = {
  metadata: {
    async fetchMarket() {
      throw new Error('Bybit market metadata is not implemented yet');
    },
    async fetchTicker() {
      throw new Error('Bybit ticker metadata is not implemented yet');
    },
  },
  futures: {
    async fetchWallet(userId: string) {
      const wallet = await fetchFuturesWalletBalance(userId);
      return mapBybitWalletBalance(wallet);
    },
    setLeverage(userId: string, request) {
      return setBybitFuturesLeverage(userId, request.symbol, request.leverage);
    },
    openPosition(userId: string, intent) {
      return openBybitFuturesPosition(userId, {
        symbol: intent.symbol,
        positionSide: intent.positionSide,
        quantity: intent.quantity,
        type: intent.type,
        price: intent.price,
        reduceOnly: intent.reduceOnly,
        hedgeMode: intent.hedgeMode,
        positionIdx: intent.positionIdx,
      });
    },
    setStopLoss(userId: string, intent) {
      return setBybitFuturesStopLoss(userId, {
        symbol: intent.symbol,
        positionSide: intent.positionSide,
        stopPrice: intent.stopPrice,
        hedgeMode: intent.hedgeMode,
        positionIdx: intent.positionIdx,
      });
    },
    setTakeProfit(userId: string, intent) {
      return setBybitFuturesTakeProfit(userId, {
        symbol: intent.symbol,
        positionSide: intent.positionSide,
        stopPrice: intent.stopPrice,
        hedgeMode: intent.hedgeMode,
        positionIdx: intent.positionIdx,
      });
    },
  },
};

export function getExchangeGateway(
  exchange: SupportedExchange,
): ExchangeGatewaySpecification {
  switch (exchange) {
    case 'binance':
      return binanceGateway;
    case 'bybit':
      return bybitGateway;
    default:
      throw new Error(`unsupported exchange gateway: ${exchange}`);
  }
}

export const exchangeGateways: Record<SupportedExchange, ExchangeGatewaySpecification> = {
  binance: binanceGateway,
  bybit: bybitGateway,
};

