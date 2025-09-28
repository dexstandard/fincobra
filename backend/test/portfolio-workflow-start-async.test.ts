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

describe('portfolio workflow start', () => {
  it('does not await initial review', async () => {
    const app = await buildServer();
    const userId = await insertUserWithKeys('1');
    const payload = {
      model: 'm',
      name: 'Inactive',
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
      } as any)
      .mockResolvedValue({
        ok: true,
        json: async () => ({ price: '1' }),
      } as any);
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;

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

    (globalThis as any).fetch = originalFetch;
    await app.close();
  });
});
