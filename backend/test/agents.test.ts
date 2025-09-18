import { describe, it, expect, vi } from 'vitest';
import buildServer from '../src/server.js';
import { encrypt } from '../src/util/crypto.js';
import { getActivePortfolioWorkflowById, getAgent } from '../src/repos/portfolio-workflow.js';
import { insertUser, insertUserWithKeys } from './repos/users.js';
import { setAiKey, shareAiKey } from '../src/repos/ai-api-key.js';
import {
  setAgentStatus,
  getPortfolioWorkflowStatus,
} from './repos/portfolio-workflow.js';
import { insertReviewResult } from './repos/review-result.js';
import {
  insertLimitOrder,
  getLimitOrdersByReviewResult,
} from './repos/limit-orders.js';
import { cancelOrder } from '../src/services/binance.js';
import { authCookies } from './helpers.js';

vi.mock('../src/workflows/portfolio-review.js', () => ({
  reviewAgentPortfolio: vi.fn(() => Promise.resolve()),
  removeWorkflowFromSchedule: vi.fn(),
}));

vi.mock('../src/services/binance.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/binance.js')>(
    '../src/services/binance.js',
  );
  return { ...actual, cancelOrder: vi.fn().mockResolvedValue(undefined) };
});


describe('agent routes', () => {
  it('performs CRUD operations', async () => {
    const app = await buildServer();
    const userId = await insertUserWithKeys('1');

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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ price: '60' }) } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ price: '40' }) } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ balances: [] }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          balances: [
            { asset: 'BTC', free: '1', locked: '0' },
            { asset: 'ETH', free: '1', locked: '0' },
          ],
        }),
      } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ price: '60' }) } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ price: '40' }) } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ balances: [] }),
      } as any);
    fetchMock.mockResolvedValue({ ok: true, text: async () => 'ok' } as any);
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;

    const payload = {
      model: 'gpt-5',
      name: 'A1',
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

    let res = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(userId),
      payload,
    });
    expect(res.statusCode).toBe(200);
    const id = res.json().id as string;
    const { cash, ...rest } = payload;
    expect(res.json()).toMatchObject({ id, cashToken: cash, ...rest, startBalanceUsd: 100 });
    expect(typeof res.json().aiApiKeyId).toBe('string');
    expect(typeof res.json().exchangeApiKeyId).toBe('string');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    res = await app.inject({
      method: 'GET',
      url: `/api/portfolio-workflows/${id}`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id, cashToken: cash, ...rest, startBalanceUsd: 100 });
    expect(typeof res.json().aiApiKeyId).toBe('string');
    expect(typeof res.json().exchangeApiKeyId).toBe('string');

    res = await app.inject({
      method: 'GET',
      url: '/api/portfolio-workflows/paginated?page=1&pageSize=10',
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(res.json().items).toHaveLength(1);

    res = await app.inject({
      method: 'GET',
      url: '/api/portfolio-workflows/paginated?page=1&pageSize=10&status=active',
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(res.json().items).toHaveLength(1);

    const update = { ...payload, model: 'o3', status: 'draft' };
    res = await app.inject({
      method: 'PUT',
      url: `/api/portfolio-workflows/${id}`,
      cookies: authCookies(userId),
      payload: update,
    });
    expect(res.statusCode).toBe(200);
    const { cash: cashUpd, ...restUpd } = update;
    expect(res.json()).toMatchObject({ id, cashToken: cashUpd, ...restUpd });

    res = await app.inject({
      method: 'GET',
      url: '/api/portfolio-workflows/paginated?page=1&pageSize=10&status=active',
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 0, page: 1, pageSize: 10 });
    expect(res.json().items).toHaveLength(0);

    res = await app.inject({
      method: 'GET',
      url: '/api/portfolio-workflows/paginated?page=1&pageSize=10&status=draft',
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(res.json().items).toHaveLength(1);

    const execId = await insertReviewResult({ portfolioWorkflowId: id, log: '' });
    await insertLimitOrder({
      userId,
      planned: { symbol: 'BTCETH' },
      status: 'open',
      reviewResultId: execId,
      orderId: '123',
    });

    res = await app.inject({
      method: 'DELETE',
      url: `/api/portfolio-workflows/${id}`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    const deletedStatus = await getPortfolioWorkflowStatus(id);
    expect(deletedStatus).toBe('retired');
    expect(await getAgent(id)).toBeUndefined();
    expect(await getActivePortfolioWorkflowById(id)).toBeUndefined();
    expect(cancelOrder).toHaveBeenCalledWith(userId, {
      symbol: 'BTCETH',
      orderId: 123,
    });
    const execOrders = await getLimitOrdersByReviewResult(execId);
    expect(execOrders[0].status).toBe('canceled');

    res = await app.inject({
      method: 'GET',
      url: '/api/portfolio-workflows/paginated?page=1&pageSize=10',
      cookies: authCookies(userId),
    });
    expect(res.json().items).toHaveLength(0);

    res = await app.inject({
      method: 'GET',
      url: '/api/portfolio-workflows/paginated?page=1&pageSize=10&status=retired',
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(0);

    res = await app.inject({
      method: 'GET',
      url: `/api/portfolio-workflows/${id}`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(404);

    await app.close();
    (globalThis as any).fetch = originalFetch;
  });

  it('returns null api key ids when keys missing', async () => {
    const app = await buildServer();
    const userId = await insertUser('nokeys');
    const payload = {
      model: 'm',
      name: 'NoKeys',
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'ETH', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'prompt',
      cash: 'USDT',
      status: 'draft',
    };
    const resCreate = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(userId),
      payload,
    });
    expect(resCreate.statusCode).toBe(200);
    const id = resCreate.json().id as string;
    const resGet = await app.inject({
      method: 'GET',
      url: `/api/portfolio-workflows/${id}`,
      cookies: authCookies(userId),
    });
    expect(resGet.statusCode).toBe(200);
    expect(resGet.json().aiApiKeyId).toBeNull();
    expect(resGet.json().exchangeApiKeyId).toBeNull();
    await app.close();
  });

  it('starts and stops agent', async () => {
    const app = await buildServer();
    const starterId = await insertUserWithKeys('starter');
    const draftPayload = {
      model: 'm',
      name: 'Draft',
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'ETH', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'prompt',
      cash: 'USDT',
      status: 'draft',
    };
    const resCreate = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(starterId),
      payload: draftPayload,
    });
    const id = resCreate.json().id as string;

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
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ balances: [] }),
      } as any);
    fetchMock.mockResolvedValue({ ok: true, text: async () => 'ok' } as any);
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;

    let res = await app.inject({
      method: 'POST',
      url: `/api/portfolio-workflows/${id}/start`,
      cookies: authCookies(starterId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'active' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await getActivePortfolioWorkflowById(id)).toBeDefined();

    res = await app.inject({
      method: 'POST',
      url: `/api/portfolio-workflows/${id}/stop`,
      cookies: authCookies(starterId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'inactive' });
    expect(await getActivePortfolioWorkflowById(id)).toBeUndefined();

    await app.close();
    (globalThis as any).fetch = originalFetch;
  });

  it('updates running agent and refreshes start balance', async () => {
    const app = await buildServer();
    const updateUserId = await insertUserWithKeys('update-user');
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
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ balances: [] }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          balances: [
            { asset: 'BTC', free: '2', locked: '0' },
            { asset: 'ETH', free: '2', locked: '0' },
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
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ balances: [] }),
      } as any);
    fetchMock.mockResolvedValue({ ok: true, text: async () => 'ok' } as any);
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;

    const createPayload = {
      model: 'm',
      name: 'A',
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

    const resCreate = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(updateUserId),
      payload: createPayload,
    });
    expect(resCreate.statusCode).toBe(200);
    const id = resCreate.json().id as string;

    const updatePayload = {
      ...createPayload,
      tokens: [
        { token: 'BTC', minAllocation: 15 },
        { token: 'ETH', minAllocation: 20 },
      ],
    };
    const resUpdate = await app.inject({
      method: 'PUT',
      url: `/api/portfolio-workflows/${id}`,
      cookies: authCookies(updateUserId),
      payload: updatePayload,
    });
    expect(resUpdate.statusCode).toBe(200);
    const row = await getAgent(id);
    expect(row?.startBalance).toBeGreaterThanOrEqual(0);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await app.close();
    (globalThis as any).fetch = originalFetch;
  });

  it('handles drafts and api key validation', async () => {
    const app = await buildServer();
    const u1Id = await insertUser('1');

    const basePayload = {
      model: 'm',
      name: 'Draft1',
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'ETH', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'prompt',
      cash: 'USDT',
    };

    let res = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(u1Id),
      payload: { ...basePayload, status: 'active' },
    });
    expect(res.statusCode).toBe(400);

    res = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(u1Id),
      payload: { ...basePayload, status: 'draft' },
    });
    expect(res.statusCode).toBe(200);
    const draftId = res.json().id as string;

    const u2Id = await insertUserWithKeys('2');
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
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ balances: [] }),
      } as any);
    fetchMock.mockResolvedValue({ ok: true, text: async () => 'ok' } as any);
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;

    res = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(u2Id),
      payload: { ...basePayload, name: 'Active', status: 'active' },
    });
    expect(res.statusCode).toBe(200);
    const activeId = res.json().id as string;

    const resDraft2 = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(u2Id),
      payload: { ...basePayload, name: 'Draft2', status: 'draft' },
    });
    const draft2Id = resDraft2.json().id as string;

    expect(await getActivePortfolioWorkflowById(activeId)).toBeDefined();
    expect(await getActivePortfolioWorkflowById(draftId)).toBeUndefined();
    expect(await getActivePortfolioWorkflowById(draft2Id)).toBeUndefined();

    await app.close();
    (globalThis as any).fetch = originalFetch;
  });

  it('checks duplicates based on status and tokens', async () => {
    const app = await buildServer();
    const dupId = await insertUserWithKeys('dupUser');
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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ price: '60' }) } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ price: '40' }) } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          balances: [
            { asset: 'BTC', free: '1', locked: '0' },
            { asset: 'ETH', free: '1', locked: '0' },
          ],
        }),
      } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ price: '60' }) } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ price: '40' }) } as any);
    fetchMock.mockResolvedValue({ ok: true, text: async () => 'ok' } as any);
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;

    const base = {
      model: 'm',
      name: 'A1',
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'ETH', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'p',
      cash: 'USDT',
      status: 'active',
    };

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(dupId),
      payload: base,
    });
    const existingId = res1.json().id as string;

    const resDup = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(dupId),
      payload: {
        ...base,
        name: 'B1',
        tokens: [
          { token: 'BTC', minAllocation: 10 },
          { token: 'SOL', minAllocation: 20 },
        ],
      },
    });
    expect(resDup.statusCode).toBe(400);
    expect(resDup.json().error).toContain('BTC');
    expect(resDup.json().error).toContain('A1');
    expect(resDup.json().error).toContain(existingId);

    await setAgentStatus(existingId, 'inactive');

    const resOk = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(dupId),
      payload: {
        ...base,
        name: 'B2',
        tokens: [
          { token: 'BTC', minAllocation: 10 },
          { token: 'SOL', minAllocation: 20 },
        ],
      },
    });
    expect(resOk.statusCode).toBe(200);

    await app.close();
    (globalThis as any).fetch = origFetch;
  });

  it('detects identical drafts', async () => {
    const app = await buildServer();
    const draftUserId = await insertUser('draftUser');

    const draftPayload = {
      model: 'm',
      name: 'Draft',
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'ETH', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'p',
      cash: 'USDT',
      status: 'draft',
    };

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(draftUserId),
      payload: draftPayload,
    });
    const draftId = res1.json().id as string;

    const resDup = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(draftUserId),
      payload: draftPayload,
    });
    expect(resDup.statusCode).toBe(400);
    expect(resDup.json().error).toContain('Draft');
    expect(resDup.json().error).toContain(draftId);

    const resOk = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(draftUserId),
      payload: { ...draftPayload, name: 'Draft2' },
    });
    expect(resOk.statusCode).toBe(200);

    await app.close();
  });

  it('rejects duplicate draft updates', async () => {
    const app = await buildServer();
    const updId = await insertUser('updUser');

    const base = {
      model: 'm1',
      name: 'Draft1',
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'ETH', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'p',
      cash: 'USDT',
      status: 'draft',
    };

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(updId),
      payload: base,
    });
    const draft1 = res1.json().id as string;

    const res2 = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(updId),
      payload: {
        ...base,
        name: 'Draft2',
        tokens: [
          { token: 'BTC', minAllocation: 10 },
          { token: 'SOL', minAllocation: 20 },
        ],
      },
    });
    const draft2 = res2.json().id as string;

    const resUpd = await app.inject({
      method: 'PUT',
      url: `/api/portfolio-workflows/${draft2}`,
      cookies: authCookies(updId),
      payload: { ...base },
    });
    expect(resUpd.statusCode).toBe(400);
    expect(resUpd.json().error).toContain('Draft1');
    expect(resUpd.json().error).toContain(draft1);

    await app.close();
  });

  it('fails to start agent without model', async () => {
    const app = await buildServer();
    const nomodelId = await insertUserWithKeys('nomodel');
    const payload = {
      model: '',
      name: 'Draft',
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'ETH', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'prompt',
      cash: 'USDT',
      status: 'draft',
    };
    const resCreate = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(nomodelId),
      payload,
    });
    const id = resCreate.json().id as string;
    const resStart = await app.inject({
      method: 'POST',
      url: `/api/portfolio-workflows/${id}/start`,
      cookies: authCookies(nomodelId),
    });
    expect(resStart.statusCode).toBe(400);
    expect(resStart.json().error).toContain('model');
    await app.close();
  });

  it('rejects allocations exceeding 95%', async () => {
    const app = await buildServer();
    const allocId = await insertUser('allocUser');
    const payload = {
      model: 'm',
      name: 'Bad',
      tokens: [
        { token: 'BTC', minAllocation: 60 },
        { token: 'ETH', minAllocation: 40 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'p',
      status: 'draft',
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(allocId),
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('minimum allocations');
    await app.close();
  });

  it('rejects unauthorized model for shared key', async () => {
    const app = await buildServer();
    const adminId = await insertUser('adm');
    const userId = await insertUser('usr');
    const ai = encrypt('aikey', process.env.KEY_PASSWORD!);
    await setAiKey({ userId: adminId, apiKeyEnc: ai });
    await shareAiKey({
      ownerUserId: adminId,
      targetUserId: userId,
      model: 'gpt-5',
    });
    const payload = {
      userId,
      model: 'gpt-4',
      name: 'A',
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'ETH', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'prompt',
      manualRebalance: false,
      useEarn: true,
      cash: 'USDT',
      status: 'draft',
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(userId),
      payload,
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
