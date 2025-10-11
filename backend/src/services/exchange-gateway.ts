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
  setFuturesMarginMode as setBinanceFuturesMarginMode,
  setFuturesLeverage as setBinanceFuturesLeverage,
  setFuturesStopLoss as setBinanceFuturesStopLoss,
  setFuturesTakeProfit as setBinanceFuturesTakeProfit,
} from './binance-futures.js';
import {
  fetchFuturesWalletBalance,
  openBybitFuturesPosition,
  setBybitFuturesMarginMode,
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
  ExchangeFuturesPositionIntent,
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

function resolveBybitPositionContext(
  intent: Pick<ExchangeFuturesPositionIntent, 'hedgeMode' | 'positionIdx'>,
): Pick<ExchangeFuturesPositionIntent, 'hedgeMode' | 'positionIdx'> {
  const normalizedHedgeMode =
    intent.hedgeMode !== undefined
      ? intent.hedgeMode
      : intent.positionIdx === undefined
        ? false
        : undefined;

  return {
    ...(normalizedHedgeMode !== undefined
      ? { hedgeMode: normalizedHedgeMode }
      : {}),
    ...(intent.positionIdx !== undefined
      ? { positionIdx: intent.positionIdx }
      : {}),
  };
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
    setMarginMode(userId: string, request) {
      return setBinanceFuturesMarginMode(
        userId,
        request.symbol,
        request.marginMode,
      );
    },
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
    setMarginMode(userId: string, request) {
      return setBybitFuturesMarginMode(userId, {
        symbol: request.symbol,
        marginMode: request.marginMode,
        leverage: request.leverage ?? null,
      });
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
        ...resolveBybitPositionContext(intent),
      });
    },
    setStopLoss(userId: string, intent) {
      return setBybitFuturesStopLoss(userId, {
        symbol: intent.symbol,
        positionSide: intent.positionSide,
        stopPrice: intent.stopPrice,
        ...resolveBybitPositionContext(intent),
      });
    },
    setTakeProfit(userId: string, intent) {
      return setBybitFuturesTakeProfit(userId, {
        symbol: intent.symbol,
        positionSide: intent.positionSide,
        stopPrice: intent.stopPrice,
        ...resolveBybitPositionContext(intent),
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

