import { describe, it, expect, vi } from 'vitest';
import { insertUserWithKeys } from './repos/users.js';

const reviewWorkflowPortfolioMock = vi.fn<
  (log: unknown, workflowId: string) => Promise<unknown>
>(() => new Promise(() => {}));
vi.mock('../src/workflows/portfolio-review.js', () => ({
  reviewWorkflowPortfolio: reviewWorkflowPortfolioMock,
}));

import buildServer from '../src/server.js';
import { authCookies } from './helpers.js';
import { db } from '../src/db/index.js';

describe('portfolio workflow creation', () => {
  it('does not await initial review', async () => {
    const app = await buildServer();
    const userId = await insertUserWithKeys('1');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          balances: [
            { asset: 'BTC', free: '1', locked: '0' },
            { asset: 'ETH', free: '1', locked: '0' },
          ],
        }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ price: '60' }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ price: '40' }),
      } as any);
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
        { token: 'BTC', minAllocation: 30 },
        { token: 'ETH', minAllocation: 30 },
        { token: 'BNB', minAllocation: 35 },
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

    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          balances: [
            { asset: 'BTC', free: '1', locked: '0' },
            { asset: 'ETH', free: '1', locked: '0' },
          ],
        }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ price: '60' }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ price: '40' }),
      } as any);

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

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        balances: [
          { asset: 'USDC', free: '100', locked: '0' },
          { asset: 'USDT', free: '50', locked: '0' },
        ],
      }),
    } as any);

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
});
