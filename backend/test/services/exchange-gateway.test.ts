import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/binance-client.js', () => ({
  fetchPairInfo: vi.fn(),
  fetchSymbolPrice: vi.fn(),
  fetchAccount: vi.fn(),
  createLimitOrder: vi.fn(),
  cancelOrder: vi.fn(),
  fetchOpenOrders: vi.fn(),
  fetchOrder: vi.fn(),
}));

vi.mock('../../src/services/binance-futures.js', () => ({
  setFuturesLeverage: vi.fn(),
  openFuturesPosition: vi.fn(),
  setFuturesStopLoss: vi.fn(),
  setFuturesTakeProfit: vi.fn(),
}));

vi.mock('../../src/services/bybit-client.js', () => ({
  fetchFuturesWalletBalance: vi.fn(),
  setBybitFuturesLeverage: vi.fn(),
  openBybitFuturesPosition: vi.fn(),
  setBybitFuturesStopLoss: vi.fn(),
  setBybitFuturesTakeProfit: vi.fn(),
}));

import {
  type SupportedExchange,
  exchangeGateways,
  getExchangeGateway,
} from '../../src/services/exchange-gateway.js';
import * as binanceClientModule from '../../src/services/binance-client.js';
import * as binanceFuturesModule from '../../src/services/binance-futures.js';
import * as bybitClientModule from '../../src/services/bybit-client.js';

const binanceClient = vi.mocked(binanceClientModule);
const binanceFutures = vi.mocked(binanceFuturesModule);
const bybitClient = vi.mocked(bybitClientModule);

describe('exchange gateway factory', () => {
  it('returns the gateway for supported exchanges', () => {
    (['binance', 'bybit'] satisfies SupportedExchange[]).forEach((name) => {
      expect(getExchangeGateway(name)).toBe(exchangeGateways[name]);
    });
  });

  it('throws on unsupported exchanges', () => {
    expect(() => getExchangeGateway('kraken' as SupportedExchange)).toThrow(
      'unsupported exchange gateway: kraken',
    );
  });
});

describe('binance exchange gateway', () => {
  const gateway = exchangeGateways.binance;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches market metadata through Binance helpers', async () => {
    binanceClient.fetchPairInfo.mockResolvedValue({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      quantityPrecision: 3,
      pricePrecision: 2,
      minNotional: 10,
    });

    const market = await gateway.metadata.fetchMarket('BTC', 'USDT');

    expect(binanceClient.fetchPairInfo).toHaveBeenCalledWith('BTC', 'USDT');
    expect(market).toEqual({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      quantityPrecision: 3,
      pricePrecision: 2,
      minNotional: 10,
    });
  });

  it('fetches ticker metadata through Binance helpers', async () => {
    binanceClient.fetchSymbolPrice.mockResolvedValue({
      symbol: 'ETHUSDT',
      currentPrice: 3520.12,
    });

    const ticker = await gateway.metadata.fetchTicker('ETHUSDT');

    expect(binanceClient.fetchSymbolPrice).toHaveBeenCalledWith('ETHUSDT');
    expect(ticker).toEqual({ symbol: 'ETHUSDT', price: 3520.12 });
  });

  it('normalizes balances from the Binance account snapshot', async () => {
    binanceClient.fetchAccount.mockResolvedValue({
      balances: [
        { asset: 'BTC', free: '0.5', locked: '0.1' },
        { asset: 'ETH', free: '1.25', locked: '0' },
        { asset: 'BAD', free: 'nope', locked: '0.1' },
      ],
    });

    const balances = await gateway.spot!.fetchBalances('user-123');

    expect(binanceClient.fetchAccount).toHaveBeenCalledWith('user-123');
    expect(balances).toEqual([
      { asset: 'BTC', free: 0.5, locked: 0.1, total: 0.6 },
      { asset: 'ETH', free: 1.25, locked: 0, total: 1.25 },
    ]);
  });

  it('delegates spot order placement and cancellation to Binance helpers', async () => {
    binanceClient.createLimitOrder.mockResolvedValue({ id: 42 });
    binanceClient.cancelOrder.mockResolvedValue({ status: 'CANCELED' });

    const placeResult = await gateway.spot!.placeLimitOrder('user-1', {
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: 0.01,
      limitPrice: 25000,
    });

    expect(binanceClient.createLimitOrder).toHaveBeenCalledWith('user-1', {
      symbol: 'BTCUSDT',
      side: 'BUY',
      qty: 0.01,
      price: 25000,
    });
    expect(placeResult).toEqual({ id: 42 });

    const cancelResult = await gateway.spot!.cancelOrder('user-1', {
      symbol: 'BTCUSDT',
      orderId: '42',
    });

    expect(binanceClient.cancelOrder).toHaveBeenCalledWith('user-1', {
      symbol: 'BTCUSDT',
      orderId: 42,
    });
    expect(cancelResult).toEqual({ status: 'CANCELED' });
  });

  it('maps open orders and filters invalid payloads', async () => {
    binanceClient.fetchOpenOrders.mockResolvedValue([
      {
        orderId: 1001,
        symbol: 'BTCUSDT',
        status: 'NEW',
        side: 'BUY',
        price: '25000',
        origQty: '0.01',
      },
      { nonsense: true },
    ]);

    const orders = await gateway.spot!.fetchOpenOrders('user-1', {
      symbol: 'BTCUSDT',
    });

    expect(binanceClient.fetchOpenOrders).toHaveBeenCalledWith('user-1', {
      symbol: 'BTCUSDT',
    });
    expect(orders).toEqual([
      {
        orderId: 1001,
        symbol: 'BTCUSDT',
        status: 'NEW',
        side: 'BUY',
        limitPrice: 25000,
        quantity: 0.01,
      },
    ]);
  });

  it('maps order status payloads via the Binance helper', async () => {
    binanceClient.fetchOrder.mockResolvedValue({ status: 'FILLED' });

    const status = await gateway.spot!.fetchOrder('user-1', {
      symbol: 'BTCUSDT',
      orderId: 123,
    });

    expect(binanceClient.fetchOrder).toHaveBeenCalledWith('user-1', {
      symbol: 'BTCUSDT',
      orderId: 123,
    });
    expect(status).toEqual({ status: 'FILLED' });
  });

  it('delegates futures controls to Binance futures helpers', async () => {
    binanceFutures.setFuturesLeverage.mockResolvedValue({ ok: true });
    binanceFutures.openFuturesPosition.mockResolvedValue({ id: 10 });
    binanceFutures.setFuturesStopLoss.mockResolvedValue({});
    binanceFutures.setFuturesTakeProfit.mockResolvedValue({});

    await gateway.futures!.setLeverage('user-1', {
      symbol: 'BTCUSDT',
      leverage: 10,
    });
    await gateway.futures!.openPosition('user-1', {
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      quantity: 0.01,
      type: 'LIMIT',
      price: 20000,
      reduceOnly: true,
    });
    await gateway.futures!.setStopLoss('user-1', {
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      stopPrice: 19000,
    });
    await gateway.futures!.setTakeProfit('user-1', {
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      stopPrice: 26000,
    });

    expect(binanceFutures.setFuturesLeverage).toHaveBeenCalledWith(
      'user-1',
      'BTCUSDT',
      10,
    );
    expect(binanceFutures.openFuturesPosition).toHaveBeenCalledWith('user-1', {
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      quantity: 0.01,
      type: 'LIMIT',
      price: 20000,
      reduceOnly: true,
    });
    expect(binanceFutures.setFuturesStopLoss).toHaveBeenCalledWith('user-1', {
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      stopPrice: 19000,
    });
    expect(binanceFutures.setFuturesTakeProfit).toHaveBeenCalledWith('user-1', {
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      stopPrice: 26000,
    });
  });
});

describe('bybit exchange gateway', () => {
  const gateway = exchangeGateways.bybit;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws for unimplemented metadata calls', async () => {
    await expect(gateway.metadata.fetchMarket('BTC', 'USDT')).rejects.toThrow(
      'Bybit market metadata is not implemented yet',
    );
    await expect(gateway.metadata.fetchTicker('BTCUSDT')).rejects.toThrow(
      'Bybit ticker metadata is not implemented yet',
    );
  });

  it('normalizes Bybit futures wallet balances', async () => {
    bybitClient.fetchFuturesWalletBalance.mockResolvedValue({
      accountType: 'UNIFIED',
      totalEquity: '1000',
      coin: [
        { coin: 'USDT', walletBalance: '900', availableToTrade: '850' },
      ],
    } as never);

    const wallet = await gateway.futures!.fetchWallet!('user-1');

    expect(bybitClient.fetchFuturesWalletBalance).toHaveBeenCalledWith(
      'user-1',
    );
    expect(wallet).toEqual({
      accountType: 'UNIFIED',
      totalEquity: 1000,
      coins: [
        {
          asset: 'USDT',
          walletBalance: 900,
          availableBalance: 850,
          availableToTrade: 850,
          availableToWithdraw: undefined,
          availableToTransfer: undefined,
          equity: undefined,
          unrealizedPnl: undefined,
        },
      ],
      totalAvailableBalance: undefined,
      totalMarginBalance: undefined,
      totalWalletBalance: undefined,
    });
  });

  it('delegates futures controls to Bybit helpers', async () => {
    bybitClient.setBybitFuturesLeverage.mockResolvedValue({ ok: true });
    bybitClient.openBybitFuturesPosition.mockResolvedValue({ id: 'abc' });
    bybitClient.setBybitFuturesStopLoss.mockResolvedValue({});
    bybitClient.setBybitFuturesTakeProfit.mockResolvedValue({});

    await gateway.futures!.setLeverage('user-1', {
      symbol: 'BTCUSDT',
      leverage: 3,
    });
    await gateway.futures!.openPosition('user-1', {
      symbol: 'BTCUSDT',
      positionSide: 'SHORT',
      quantity: 0.02,
      type: 'MARKET',
      reduceOnly: false,
      hedgeMode: true,
      positionIdx: 2,
    });
    await gateway.futures!.setStopLoss('user-1', {
      symbol: 'BTCUSDT',
      positionSide: 'SHORT',
      stopPrice: 30000,
      hedgeMode: true,
      positionIdx: 2,
    });
    await gateway.futures!.setTakeProfit('user-1', {
      symbol: 'BTCUSDT',
      positionSide: 'SHORT',
      stopPrice: 18000,
      hedgeMode: true,
      positionIdx: 2,
    });

    expect(bybitClient.setBybitFuturesLeverage).toHaveBeenCalledWith(
      'user-1',
      'BTCUSDT',
      3,
    );
    expect(bybitClient.openBybitFuturesPosition).toHaveBeenCalledWith(
      'user-1',
      {
        symbol: 'BTCUSDT',
        positionSide: 'SHORT',
        quantity: 0.02,
        type: 'MARKET',
        price: undefined,
        reduceOnly: false,
        hedgeMode: true,
        positionIdx: 2,
      },
    );
    expect(bybitClient.setBybitFuturesStopLoss).toHaveBeenCalledWith('user-1', {
      symbol: 'BTCUSDT',
      positionSide: 'SHORT',
      stopPrice: 30000,
      hedgeMode: true,
      positionIdx: 2,
    });
    expect(bybitClient.setBybitFuturesTakeProfit).toHaveBeenCalledWith(
      'user-1',
      {
        symbol: 'BTCUSDT',
        positionSide: 'SHORT',
        stopPrice: 18000,
        hedgeMode: true,
        positionIdx: 2,
      },
    );
  });

  it('defaults to one-way mode when Bybit hedge context is omitted', async () => {
    bybitClient.openBybitFuturesPosition.mockResolvedValue({});
    bybitClient.setBybitFuturesStopLoss.mockResolvedValue({});
    bybitClient.setBybitFuturesTakeProfit.mockResolvedValue({});

    await gateway.futures!.openPosition('user-2', {
      symbol: 'ETHUSDT',
      positionSide: 'LONG',
      quantity: 0.5,
    });

    await gateway.futures!.setStopLoss('user-2', {
      symbol: 'ETHUSDT',
      positionSide: 'LONG',
      stopPrice: 2000,
    });

    await gateway.futures!.setTakeProfit('user-2', {
      symbol: 'ETHUSDT',
      positionSide: 'LONG',
      stopPrice: 2500,
    });

    expect(bybitClient.openBybitFuturesPosition).toHaveBeenCalledWith(
      'user-2',
      expect.objectContaining({
        symbol: 'ETHUSDT',
        positionSide: 'LONG',
        quantity: 0.5,
        hedgeMode: false,
      }),
    );
    const [, openIntent] = bybitClient.openBybitFuturesPosition.mock.calls[0];
    expect(openIntent.positionIdx).toBeUndefined();

    expect(bybitClient.setBybitFuturesStopLoss).toHaveBeenCalledWith(
      'user-2',
      expect.objectContaining({
        symbol: 'ETHUSDT',
        positionSide: 'LONG',
        stopPrice: 2000,
        hedgeMode: false,
      }),
    );
    const [, stopIntent] = bybitClient.setBybitFuturesStopLoss.mock.calls[0];
    expect(stopIntent.positionIdx).toBeUndefined();

    expect(bybitClient.setBybitFuturesTakeProfit).toHaveBeenCalledWith(
      'user-2',
      expect.objectContaining({
        symbol: 'ETHUSDT',
        positionSide: 'LONG',
        stopPrice: 2500,
        hedgeMode: false,
      }),
    );
    const [, takeProfitIntent] = bybitClient.setBybitFuturesTakeProfit.mock.calls[0];
    expect(takeProfitIntent.positionIdx).toBeUndefined();
  });
});

