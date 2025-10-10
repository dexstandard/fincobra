import { beforeEach, describe, expect, it, vi } from 'vitest';
import buildServer from '../src/server.js';
import { insertUser } from './repos/users.js';
import { authCookies } from './helpers.js';
import { encrypt } from '../src/util/crypto.js';
import {
  setBinanceKey,
  setBybitKey,
} from '../src/repos/exchange-api-keys.js';

const binanceFuturesMock = vi.hoisted(() => ({
  setLeverage: vi.fn().mockResolvedValue(undefined),
  openPosition: vi.fn().mockResolvedValue(undefined),
  setStopLoss: vi.fn().mockResolvedValue(undefined),
  setTakeProfit: vi.fn().mockResolvedValue(undefined),
}));

const bybitFuturesMock = vi.hoisted(() => ({
  setLeverage: vi.fn().mockResolvedValue(undefined),
  openPosition: vi.fn().mockResolvedValue(undefined),
  setStopLoss: vi.fn().mockResolvedValue(undefined),
  setTakeProfit: vi.fn().mockResolvedValue(undefined),
}));

const getExchangeGatewayMock = vi.hoisted(() =>
  vi.fn((exchange: 'binance' | 'bybit') => {
    if (exchange === 'binance') {
      return { futures: binanceFuturesMock } as const;
    }
    if (exchange === 'bybit') {
      return { futures: bybitFuturesMock } as const;
    }
    throw new Error(`unsupported exchange ${exchange}`);
  }),
);

vi.mock('../src/services/exchange-gateway.js', () => ({
  getExchangeGateway: getExchangeGatewayMock,
}));

describe('Exchange futures routes', () => {
  beforeEach(() => {
    getExchangeGatewayMock.mockClear();
    (
      Object.values(binanceFuturesMock) as Array<ReturnType<typeof vi.fn>>
    ).forEach((fn) => fn.mockClear());
    (
      Object.values(bybitFuturesMock) as Array<ReturnType<typeof vi.fn>>
    ).forEach((fn) => fn.mockClear());
  });

  it('sets binance futures leverage', async () => {
    const app = await buildServer();
    const userId = await insertUser('binance-futures-user');
    const key = encrypt('binance-key', process.env.KEY_PASSWORD!);
    const secret = encrypt('binance-secret', process.env.KEY_PASSWORD!);
    await setBinanceKey({ userId, apiKeyEnc: key, apiSecretEnc: secret });

    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/binance/futures/leverage`,
      cookies: authCookies(userId),
      payload: { symbol: 'BTCUSDT', leverage: 10 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(getExchangeGatewayMock).toHaveBeenCalledWith('binance');
    expect(binanceFuturesMock.setLeverage).toHaveBeenCalledWith(userId, {
      symbol: 'BTCUSDT',
      leverage: 10,
    });

    await app.close();
  });

  it('opens and closes futures positions', async () => {
    const app = await buildServer();
    const userId = await insertUser('binance-futures-open');
    const key = encrypt('binance-key2', process.env.KEY_PASSWORD!);
    const secret = encrypt('binance-secret2', process.env.KEY_PASSWORD!);
    await setBinanceKey({ userId, apiKeyEnc: key, apiSecretEnc: secret });

    let res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/binance/futures/positions/open`,
      cookies: authCookies(userId),
      payload: {
        symbol: 'ETHUSDT',
        positionSide: 'LONG',
        quantity: 1.5,
        type: 'LIMIT',
        price: 1800,
        reduceOnly: false,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(binanceFuturesMock.openPosition).toHaveBeenCalledWith(userId, {
      symbol: 'ETHUSDT',
      positionSide: 'LONG',
      quantity: 1.5,
      type: 'LIMIT',
      price: 1800,
      reduceOnly: false,
      hedgeMode: undefined,
      positionIdx: undefined,
    });

    res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/binance/futures/positions/close`,
      cookies: authCookies(userId),
      payload: {
        symbol: 'ETHUSDT',
        positionSide: 'LONG',
        quantity: 1.5,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(binanceFuturesMock.openPosition).toHaveBeenLastCalledWith(userId, {
      symbol: 'ETHUSDT',
      positionSide: 'LONG',
      quantity: 1.5,
      type: undefined,
      price: undefined,
      reduceOnly: true,
      hedgeMode: undefined,
      positionIdx: undefined,
    });

    await app.close();
  });

  it('updates bybit stops with hedge metadata', async () => {
    const app = await buildServer();
    const userId = await insertUser('bybit-futures-user');
    const key = encrypt('bybit-key', process.env.KEY_PASSWORD!);
    const secret = encrypt('bybit-secret', process.env.KEY_PASSWORD!);
    await setBybitKey({ userId, apiKeyEnc: key, apiSecretEnc: secret });

    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/bybit/futures/stop-loss`,
      cookies: authCookies(userId),
      payload: {
        symbol: 'BTCUSDT',
        positionSide: 'SHORT',
        stopPrice: 25000,
        hedgeMode: true,
        positionIdx: 2,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(bybitFuturesMock.setStopLoss).toHaveBeenCalledWith(userId, {
      symbol: 'BTCUSDT',
      positionSide: 'SHORT',
      stopPrice: 25000,
      hedgeMode: true,
      positionIdx: 2,
    });

    await app.close();
  });

  it('requires exchange credentials for targeted routes', async () => {
    const app = await buildServer();
    const userId = await insertUser('missing-futures-keys');

    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/bybit/futures/take-profit`,
      cookies: authCookies(userId),
      payload: {
        symbol: 'BTCUSDT',
        positionSide: 'LONG',
        stopPrice: 24000,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'missing api keys' });
    expect(bybitFuturesMock.setTakeProfit).not.toHaveBeenCalled();

    await app.close();
  });
});

