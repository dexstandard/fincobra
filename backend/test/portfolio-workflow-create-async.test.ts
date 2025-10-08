import { describe, it, expect, vi } from 'vitest';
import { insertUserWithKeys } from './repos/users.js';

const reviewWorkflowPortfolioMock = vi.fn<
  (log: unknown, workflowId: string) => Promise<unknown>
>(() => new Promise(() => {}));
vi.mock('../src/workflows/portfolio-review.js', () => ({
  reviewWorkflowPortfolio: reviewWorkflowPortfolioMock,
}));

vi.mock('../src/util/output-ip.js', () => ({
  fetchOutputIp: vi.fn().mockResolvedValue('127.0.0.1'),
}));

import buildServer from '../src/server.js';
import { authCookies } from './helpers.js';
import { db } from '../src/db/index.js';

function toUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (input && typeof input === 'object' && 'url' in input) {
    return String((input as { url: unknown }).url);
  }
  return String(input);
}

function mockExchangeInfo(symbol: string, base: string, quote: string) {
  return {
    ok: true,
    json: async () => ({
      symbols: [
        {
          symbol,
          baseAsset: base,
          quoteAsset: quote,
          filters: [
            { filterType: 'LOT_SIZE', stepSize: '0.0001' },
            { filterType: 'PRICE_FILTER', tickSize: '0.01' },
            { filterType: 'MIN_NOTIONAL', minNotional: '10' },
          ],
        },
      ],
    }),
  } as any;
}

function mockInvalidSymbolResponse() {
  return {
    ok: false,
    text: async () => JSON.stringify({ code: -1121, msg: 'Invalid symbol.' }),
  } as any;
}

function mockAccountResponse(
  balances: Array<{ asset: string; free: string; locked: string }>,
) {
  return {
    ok: true,
    json: async () => ({ balances }),
  } as any;
}

function mockPriceResponse(price: string) {
  return {
    ok: true,
    json: async () => ({ price }),
  } as any;
}

describe('portfolio workflow creation', () => {
  it('does not await initial review', async () => {
    const app = await buildServer();
    const userId = await insertUserWithKeys('1');
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrl(input);
      if (url.includes('/exchangeInfo?symbol=BTCUSDT')) {
        return mockExchangeInfo('BTCUSDT', 'BTC', 'USDT');
      }
      if (url.includes('/exchangeInfo?symbol=ETHUSDT')) {
        return mockExchangeInfo('ETHUSDT', 'ETH', 'USDT');
      }
      if (url.includes('/api/v3/account')) {
        return mockAccountResponse([
          { asset: 'BTC', free: '1', locked: '0' },
          { asset: 'ETH', free: '1', locked: '0' },
        ]);
      }
      if (url.includes('/ticker/price?symbol=BTCUSDT')) {
        return mockPriceResponse('60');
      }
      if (url.includes('/ticker/price?symbol=ETHUSDT')) {
        return mockPriceResponse('40');
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;

    const payload = {
      model: 'm',
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'ETH', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'prompt',
      cash: 'USDT',
      status: 'active',
    };

    const createPromise = app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(userId),
      payload,
    });
    const res = await Promise.race([
      createPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 1000),
      ),
    ]);
    expect(res.statusCode).toBe(200);
    const id = res.json().id as string;
    const { cash, ...rest } = payload;
    expect(res.json()).toMatchObject({ id, cashToken: cash, ...rest });
    expect(reviewWorkflowPortfolioMock).toHaveBeenCalledTimes(1);
    expect(reviewWorkflowPortfolioMock.mock.calls[0][1]).toBe(id);

    (globalThis as any).fetch = originalFetch;
    await app.close();
  });

  it('saves multiple tokens', async () => {
    const app = await buildServer();
    const userId = await insertUserWithKeys('2');

    const payload = {
      model: 'm',
      tokens: [
        { token: 'btc', minAllocation: 30 },
        { token: 'eth', minAllocation: 30 },
        { token: 'bnb', minAllocation: 35 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'prompt',
      cash: 'USDT',
      status: 'inactive',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(userId),
      payload,
    });
    expect(res.statusCode).toBe(200);
    const id = res.json().id as string;
    const { rows } = await db.query(
      'SELECT token, min_allocation FROM portfolio_workflow_tokens WHERE portfolio_workflow_id = $1 ORDER BY position',
      [id],
    );
    expect(rows).toEqual([
      { token: 'BTC', min_allocation: 30 },
      { token: 'ETH', min_allocation: 30 },
      { token: 'BNB', min_allocation: 35 },
    ]);
    await app.close();
  });

  it('rejects duplicate cash tokens for active workflows', async () => {
    const app = await buildServer();
    const userId = await insertUserWithKeys('3');

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrl(input);
      if (url.includes('/exchangeInfo?symbol=BTCUSDT')) {
        return mockExchangeInfo('BTCUSDT', 'BTC', 'USDT');
      }
      if (url.includes('/exchangeInfo?symbol=ETHUSDT')) {
        return mockExchangeInfo('ETHUSDT', 'ETH', 'USDT');
      }
      if (url.includes('/api/v3/account')) {
        return mockAccountResponse([
          { asset: 'BTC', free: '1', locked: '0' },
          { asset: 'ETH', free: '1', locked: '0' },
        ]);
      }
      if (url.includes('/ticker/price?symbol=BTCUSDT')) {
        return mockPriceResponse('60');
      }
      if (url.includes('/ticker/price?symbol=ETHUSDT')) {
        return mockPriceResponse('40');
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;

    const firstPayload = {
      model: 'm',
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'ETH', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'prompt',
      cash: 'USDT',
      status: 'active',
    };

    try {
      const firstRes = await app.inject({
        method: 'POST',
        url: '/api/portfolio-workflows',
        cookies: authCookies(userId),
        payload: firstPayload,
      });
      expect(firstRes.statusCode).toBe(200);
      const firstId = firstRes.json().id as string;

      fetchMock.mockClear();

      const secondRes = await app.inject({
        method: 'POST',
        url: '/api/portfolio-workflows',
        cookies: authCookies(userId),
        payload: {
          ...firstPayload,
          tokens: [{ token: 'BNB', minAllocation: 30 }],
        },
      });
      expect(secondRes.statusCode).toBe(400);
      expect(secondRes.json()).toEqual({
        error: `token USDT used by workflow ${firstId} already used`,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      (globalThis as any).fetch = originalFetch;
      await app.close();
    }
  });

  it('rejects cash token conflicts against other workflow positions', async () => {
    const app = await buildServer();
    const userId = await insertUserWithKeys('4');

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrl(input);
      if (url.includes('/exchangeInfo?symbol=USDTUSDC')) {
        return mockInvalidSymbolResponse();
      }
      if (url.includes('/exchangeInfo?symbol=USDCUSDT')) {
        return mockExchangeInfo('USDCUSDT', 'USDC', 'USDT');
      }
      if (url.includes('/api/v3/account')) {
        return mockAccountResponse([
          { asset: 'USDC', free: '100', locked: '0' },
          { asset: 'USDT', free: '50', locked: '0' },
        ]);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;

    const firstPayload = {
      model: 'm',
      tokens: [{ token: 'USDT', minAllocation: 10 }],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'prompt',
      cash: 'USDC',
      status: 'active',
    };

    try {
      const firstRes = await app.inject({
        method: 'POST',
        url: '/api/portfolio-workflows',
        cookies: authCookies(userId),
        payload: firstPayload,
      });
      expect(firstRes.statusCode).toBe(200);
      const firstId = firstRes.json().id as string;

      fetchMock.mockClear();

      const secondRes = await app.inject({
        method: 'POST',
        url: '/api/portfolio-workflows',
        cookies: authCookies(userId),
        payload: {
          ...firstPayload,
          cash: 'USDT',
          tokens: [{ token: 'BTC', minAllocation: 20 }],
        },
      });
      expect(secondRes.statusCode).toBe(400);
      expect(secondRes.json()).toEqual({
        error: `token USDT used by workflow ${firstId} already used`,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      (globalThis as any).fetch = originalFetch;
      await app.close();
    }
  });

  it('rejects tokens without matching cash trading pair', async () => {
    const app = await buildServer();
    const userId = await insertUserWithKeys('5');

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = toUrl(input);
      if (
        url.includes('/exchangeInfo?symbol=DOGEUSDC') ||
        url.includes('/exchangeInfo?symbol=USDCDOGE')
      ) {
        return mockInvalidSymbolResponse();
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/portfolio-workflows',
        cookies: authCookies(userId),
        payload: {
          model: 'm',
          tokens: [{ token: 'DOGE', minAllocation: 10 }],
          risk: 'low',
          reviewInterval: '1h',
          agentInstructions: 'prompt',
          cash: 'USDC',
          status: 'active',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error: 'unsupported trading pair: DOGE/USDC',
      });
    } finally {
      (globalThis as any).fetch = originalFetch;
      await app.close();
    }
  });
});
