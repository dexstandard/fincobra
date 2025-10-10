import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  mapBinanceAccountBalances,
  mapBinanceBalance,
  mapBinanceOpenOrder,
  mapBinanceOrderStatus,
  mapBinancePairInfo,
  mapBinanceTickerPrice,
  mapBybitWalletBalance,
} from '../../src/services/exchange-gateway.mappers.js';
import {
  type ExchangeGatewaySpecification,
  type ExchangeSpotOpenOrder,
} from '../../src/services/exchange-gateway.types.js';
import {
  cancelOrder as cancelBinanceOrder,
  createLimitOrder,
  fetchAccount,
  fetchOpenOrders,
  fetchOrder,
  fetchPairInfo,
  fetchSymbolPrice,
} from '../../src/services/binance-client.js';
import {
  openFuturesPosition as openBinanceFuturesPosition,
  setFuturesLeverage as setBinanceFuturesLeverage,
  setFuturesStopLoss as setBinanceFuturesStopLoss,
  setFuturesTakeProfit as setBinanceFuturesTakeProfit,
} from '../../src/services/binance-futures.js';
import {
  fetchFuturesWalletBalance,
  openBybitFuturesPosition,
  setBybitFuturesLeverage,
  setBybitFuturesStopLoss,
  setBybitFuturesTakeProfit,
} from '../../src/services/bybit-client.js';
import type { BinanceAccount } from '../../src/services/binance-client.types.js';
import type { BybitWalletBalance } from '../../src/services/bybit-client.types.js';

function buildSampleAccount(): BinanceAccount {
  return {
    balances: [
      { asset: 'BTC', free: '0.5', locked: '0.1' },
      { asset: 'ETH', free: '1.25', locked: '0' },
      { asset: 'BAD', free: 'abc', locked: '0.1' },
    ],
  };
}

function buildSampleBybitWallet(): BybitWalletBalance {
  return {
    accountType: 'UNIFIED',
    totalEquity: '1000',
    totalWalletBalance: '950',
    totalAvailableBalance: '900',
    totalMarginBalance: '920',
    coin: [
      {
        coin: 'USDT',
        equity: '500',
        walletBalance: '500',
        availableToWithdraw: '480',
        availableToTransfer: '480',
        availableToTrade: '500',
        unrealisedPnl: '5',
      },
      {
        coin: 'BTC',
        equity: '0.1',
        walletBalance: '0.09',
        availableToTrade: '0.08',
        unrealisedPnl: '-0.001',
      },
    ],
  };
}

describe('exchange gateway mappers', () => {
  it('maps Binance pair info into normalized market data', () => {
    const market = mapBinancePairInfo({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      quantityPrecision: 3,
      pricePrecision: 2,
      minNotional: 10,
    });
    expect(market).toEqual({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      quantityPrecision: 3,
      pricePrecision: 2,
      minNotional: 10,
    });
  });

  it('maps Binance ticker price with numeric coercion', () => {
    expect(mapBinanceTickerPrice({ symbol: 'ETHUSDT', currentPrice: 3520.12 })).toEqual({
      symbol: 'ETHUSDT',
      price: 3520.12,
    });
  });

  it('normalizes Binance balances and filters invalid entries', () => {
    const [btc, eth, invalid] = buildSampleAccount().balances;
    expect(mapBinanceBalance(btc)).toEqual({
      asset: 'BTC',
      free: 0.5,
      locked: 0.1,
      total: 0.6,
    });
    expect(mapBinanceBalance(eth)).toEqual({
      asset: 'ETH',
      free: 1.25,
      locked: 0,
      total: 1.25,
    });
    expect(mapBinanceBalance(invalid)).toBeNull();
  });

  it('extracts only valid balances from a Binance account snapshot', () => {
    const balances = mapBinanceAccountBalances(buildSampleAccount());
    expect(balances).toEqual([
      { asset: 'BTC', free: 0.5, locked: 0.1, total: 0.6 },
      { asset: 'ETH', free: 1.25, locked: 0, total: 1.25 },
    ]);
  });

  it('maps Binance open order payloads defensively', () => {
    const raw = {
      orderId: 12345,
      symbol: 'BTCUSDT',
      status: 'NEW',
      side: 'BUY',
      price: '25000',
      origQty: '0.01',
    };
    expect(mapBinanceOpenOrder(raw)).toEqual<ExchangeSpotOpenOrder>({
      orderId: 12345,
      symbol: 'BTCUSDT',
      status: 'NEW',
      side: 'BUY',
      limitPrice: 25000,
      quantity: 0.01,
    });
    expect(mapBinanceOpenOrder({ not: 'an order' })).toBeNull();
  });

  it('maps Binance order status payloads defensively', () => {
    expect(mapBinanceOrderStatus({ status: 'FILLED' })).toEqual({ status: 'FILLED' });
    expect(mapBinanceOrderStatus(null)).toBeNull();
  });

  it('maps Bybit wallet balances into normalized futures wallet data', () => {
    const wallet = mapBybitWalletBalance(buildSampleBybitWallet());
    expect(wallet).toEqual({
      accountType: 'UNIFIED',
      totalEquity: 1000,
      totalWalletBalance: 950,
      totalAvailableBalance: 900,
      totalMarginBalance: 920,
      coins: [
        {
          asset: 'USDT',
          equity: 500,
          walletBalance: 500,
          availableBalance: 500,
          availableToWithdraw: 480,
          availableToTransfer: 480,
          availableToTrade: 500,
          unrealizedPnl: 5,
        },
        {
          asset: 'BTC',
          equity: 0.1,
          walletBalance: 0.09,
          availableBalance: 0.08,
          availableToWithdraw: undefined,
          availableToTransfer: undefined,
          availableToTrade: 0.08,
          unrealizedPnl: -0.001,
        },
      ],
    });
    expect(mapBybitWalletBalance(null)).toBeNull();
  });
});

describe('exchange helper alignment', () => {
  it('Binance helpers can satisfy the exchange specification contract', () => {
    const spec = {
      metadata: {
        fetchMarket: async (base: string, quote: string) => {
          const info = await fetchPairInfo(base, quote);
          return mapBinancePairInfo(info);
        },
        fetchTicker: async (symbol: string) => {
          const ticker = await fetchSymbolPrice(symbol);
          return mapBinanceTickerPrice(ticker);
        },
      },
      spot: {
        fetchBalances: async (userId: string) => {
          const account = await fetchAccount(userId);
          return mapBinanceAccountBalances(account);
        },
        placeLimitOrder: (userId: string, order) =>
          createLimitOrder(userId, {
            symbol: order.symbol,
            side: order.side,
            qty: order.quantity,
            price: order.limitPrice,
          }),
        cancelOrder: (userId: string, reference) =>
          cancelBinanceOrder(userId, {
            symbol: reference.symbol,
            orderId:
              typeof reference.orderId === 'string'
                ? Number.parseInt(reference.orderId, 10)
                : reference.orderId,
          }),
        fetchOpenOrders: async (userId: string, filter) => {
          const raw = await fetchOpenOrders(userId, { symbol: filter.symbol });
          const list = Array.isArray(raw) ? raw : [];
          return list
            .map((entry) => mapBinanceOpenOrder(entry))
            .filter((entry): entry is ExchangeSpotOpenOrder => entry !== null);
        },
        fetchOrder: async (userId: string, reference) => {
          const orderId =
            typeof reference.orderId === 'string'
              ? Number.parseInt(reference.orderId, 10)
              : reference.orderId;
          const status = await fetchOrder(userId, {
            symbol: reference.symbol,
            orderId,
          });
          return mapBinanceOrderStatus(status);
        },
      },
      futures: {
        setLeverage: (userId: string, request) =>
          setBinanceFuturesLeverage(userId, request.symbol, request.leverage),
        openPosition: (userId: string, intent) =>
          openBinanceFuturesPosition(userId, {
            symbol: intent.symbol,
            positionSide: intent.positionSide,
            quantity: intent.quantity,
            type: intent.type,
            price: intent.price,
            reduceOnly: intent.reduceOnly,
          }),
        setStopLoss: (userId: string, intent) =>
          setBinanceFuturesStopLoss(userId, {
            symbol: intent.symbol,
            positionSide: intent.positionSide,
            stopPrice: intent.stopPrice,
          }),
        setTakeProfit: (userId: string, intent) =>
          setBinanceFuturesTakeProfit(userId, {
            symbol: intent.symbol,
            positionSide: intent.positionSide,
            stopPrice: intent.stopPrice,
          }),
      },
    } satisfies ExchangeGatewaySpecification;

    expectTypeOf(spec).toMatchTypeOf<ExchangeGatewaySpecification>();
  });

  it('Bybit futures helpers can satisfy the exchange specification contract', () => {
    const spec = {
      metadata: {
        fetchMarket: async () => {
          throw new Error('Bybit market metadata not yet implemented');
        },
        fetchTicker: async () => {
          throw new Error('Bybit ticker metadata not yet implemented');
        },
      },
      futures: {
        fetchWallet: async (userId: string) => {
          const wallet = await fetchFuturesWalletBalance(userId);
          return mapBybitWalletBalance(wallet);
        },
        setLeverage: (userId: string, request) =>
          setBybitFuturesLeverage(userId, request.symbol, request.leverage),
        openPosition: (userId: string, intent) =>
          openBybitFuturesPosition(userId, {
            symbol: intent.symbol,
            positionSide: intent.positionSide,
            quantity: intent.quantity,
            type: intent.type,
            price: intent.price,
            reduceOnly: intent.reduceOnly,
            hedgeMode: intent.hedgeMode,
            positionIdx: intent.positionIdx,
          }),
        setStopLoss: (userId: string, intent) =>
          setBybitFuturesStopLoss(userId, {
            symbol: intent.symbol,
            positionSide: intent.positionSide,
            stopPrice: intent.stopPrice,
            hedgeMode: intent.hedgeMode,
            positionIdx: intent.positionIdx,
          }),
        setTakeProfit: (userId: string, intent) =>
          setBybitFuturesTakeProfit(userId, {
            symbol: intent.symbol,
            positionSide: intent.positionSide,
            stopPrice: intent.stopPrice,
            hedgeMode: intent.hedgeMode,
            positionIdx: intent.positionIdx,
          }),
      },
    } satisfies ExchangeGatewaySpecification;

    expectTypeOf(spec).toMatchTypeOf<ExchangeGatewaySpecification>();
  });
});
