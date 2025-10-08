import { describe, it, expect, vi, beforeEach } from 'vitest';
import { insertUserWithKeys } from './repos/users.js';

const reviewWorkflowPortfolioMock = vi.fn<
  (log: unknown, workflowId: string) => Promise<unknown>
>(() => new Promise(() => {}));
vi.mock('../src/workflows/portfolio-review.js', () => ({
  reviewWorkflowPortfolio: reviewWorkflowPortfolioMock,
}));

const fetchPairInfoMock = vi.hoisted(() =>
  vi.fn(
    async (token1: string, token2: string) => ({
      symbol: `${token1}${token2}`.toUpperCase(),
      baseAsset: token1.toUpperCase(),
      quoteAsset: token2.toUpperCase(),
      quantityPrecision: 8,
      pricePrecision: 2,
      minNotional: 10,
    }),
  ),
);
const fetchTokensBalanceUsdMock = vi.hoisted(() => vi.fn(async () => 100));

vi.mock('../src/services/binance-client.js', async () => {
  const actual = await vi.importActual<
    typeof import('../src/services/binance-client.js')
  >('../src/services/binance-client.js');
  return {
    ...actual,
    fetchPairInfo: fetchPairInfoMock,
    fetchTokensBalanceUsd: fetchTokensBalanceUsdMock,
  };
});

vi.mock('../src/util/output-ip.js', () => ({
  fetchOutputIp: vi.fn().mockResolvedValue('127.0.0.1'),
}));

import buildServer from '../src/server.js';
import { authCookies } from './helpers.js';

beforeEach(() => {
  reviewWorkflowPortfolioMock.mockClear();
  fetchPairInfoMock.mockClear();
  fetchTokensBalanceUsdMock.mockClear();
  fetchPairInfoMock.mockImplementation(
    async (token1: string, token2: string) => ({
      symbol: `${token1}${token2}`.toUpperCase(),
      baseAsset: token1.toUpperCase(),
      quoteAsset: token2.toUpperCase(),
      quantityPrecision: 8,
      pricePrecision: 2,
      minNotional: 10,
    }),
  );
  fetchTokensBalanceUsdMock.mockResolvedValue(100);
});

describe('portfolio workflow start', () => {
  it('does not await initial review', async () => {
    const app = await buildServer();
    const userId = await insertUserWithKeys('1');
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
      status: 'inactive',
    };
    const resCreate = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(userId),
      payload,
    });
    const id = resCreate.json().id as string;

    const startPromise = app.inject({
      method: 'POST',
      url: `/api/portfolio-workflows/${id}/start`,
      cookies: authCookies(userId),
    });
    const res = await Promise.race([
      startPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 1000),
      ),
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'active' });
    expect(reviewWorkflowPortfolioMock).toHaveBeenCalledTimes(1);
    expect(reviewWorkflowPortfolioMock.mock.calls[0][1]).toBe(id);
    expect(fetchPairInfoMock).toHaveBeenCalledTimes(payload.tokens.length);
    expect(fetchTokensBalanceUsdMock).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it('rejects start when Binance rejects the trading pair', async () => {
    const app = await buildServer();
    const userId = await insertUserWithKeys('invalid');
    const payload = {
      model: 'm',
      tokens: [{ token: 'DOGE', minAllocation: 10 }],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'prompt',
      cash: 'USDC',
      status: 'inactive',
    };
    const resCreate = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(userId),
      payload,
    });
    const id = resCreate.json().id as string;

    fetchPairInfoMock.mockImplementationOnce(async () => {
      throw new Error(
        'failed to fetch exchange info: 400 {"code":-1121,"msg":"Invalid symbol."}',
      );
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/portfolio-workflows/${id}/start`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'unsupported trading pair: DOGE/USDC' });
    expect(fetchTokensBalanceUsdMock).not.toHaveBeenCalled();
    expect(reviewWorkflowPortfolioMock).not.toHaveBeenCalled();

    await app.close();
  });
});
