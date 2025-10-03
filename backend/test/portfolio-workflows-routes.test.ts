import { describe, it, expect, vi, beforeEach } from 'vitest';
import buildServer from '../src/server.js';
import { encrypt } from '../src/util/crypto.js';
import {
  getActivePortfolioWorkflowById,
  getPortfolioWorkflow,
} from '../src/repos/portfolio-workflows.js';
import { insertAdminUser, insertUser, insertUserWithKeys } from './repos/users.js';
import { setAiKey, shareAiKey } from '../src/repos/ai-api-key.js';
import {
  setWorkflowStatus,
  getPortfolioWorkflowStatus,
  insertPortfolioWorkflow,
} from './repos/portfolio-workflows.js';
import { insertReviewResult } from './repos/review-result.js';
import {
  insertLimitOrder,
  getLimitOrdersByReviewResult,
} from './repos/limit-orders.js';
import { LimitOrderStatus } from '../src/repos/limit-orders.types.js';
import { cancelOrder } from '../src/services/binance-client.js';
import { authCookies } from './helpers.js';
import * as orderOrchestrator from '../src/services/order-orchestrator.js';
import { CANCEL_ORDER_REASONS } from '../src/services/order-orchestrator.types.js';
import { developerInstructions } from '../src/agents/main-trader.js';

vi.mock('../src/workflows/portfolio-review.js', () => ({
  reviewWorkflowPortfolio: vi.fn(() => Promise.resolve()),
  removeWorkflowFromSchedule: vi.fn(),
}));

vi.mock('../src/services/binance-client.js', async () => {
  const actual = await vi.importActual<
    typeof import('../src/services/binance-client.js')
  >('../src/services/binance-client.js');
  return { ...actual, cancelOrder: vi.fn().mockResolvedValue(undefined) };
});

const cancelOrdersSpy = vi.spyOn(orderOrchestrator, 'cancelOrdersForWorkflow');

describe('portfolio workflow routes', () => {
  beforeEach(() => {
    cancelOrdersSpy.mockClear();
  });
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
    expect(res.json()).toMatchObject({
      id,
      cashToken: cash,
      ...rest,
      startBalanceUsd: 100,
    });
    expect(typeof res.json().aiApiKeyId).toBe('string');
    expect(typeof res.json().exchangeApiKeyId).toBe('string');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    res = await app.inject({
      method: 'GET',
      url: `/api/portfolio-workflows/${id}`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id,
      cashToken: cash,
      ...rest,
      startBalanceUsd: 100,
    });
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

    const update = { ...payload, model: 'o3', status: 'inactive' };
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
      url: '/api/portfolio-workflows/paginated?page=1&pageSize=10&status=inactive',
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(res.json().items).toHaveLength(1);

    const execId = await insertReviewResult({
      portfolioWorkflowId: id,
      log: '',
    });
    await insertLimitOrder({
      userId,
      planned: { symbol: 'BTCETH' },
      status: LimitOrderStatus.Open,
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
    expect(await getPortfolioWorkflow(id)).toBeUndefined();
    expect(await getActivePortfolioWorkflowById(id)).toBeUndefined();
    expect(cancelOrder).toHaveBeenCalledWith(userId, {
      symbol: 'BTCETH',
      orderId: 123,
    });
    const execOrders = await getLimitOrdersByReviewResult(execId);
    expect(execOrders[0].status).toBe(LimitOrderStatus.Canceled);

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
      status: 'inactive',
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
    const inactivePayload = {
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
      cookies: authCookies(starterId),
      payload: inactivePayload,
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
    expect(cancelOrdersSpy).toHaveBeenCalledTimes(1);
    expect(cancelOrdersSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: id,
        reason: CANCEL_ORDER_REASONS.WORKFLOW_STOPPED,
      }),
    );
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
    const row = await getPortfolioWorkflow(id);
    expect(row?.startBalance).toBeGreaterThanOrEqual(0);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await app.close();
    (globalThis as any).fetch = originalFetch;
  });

  it('handles inactive workflows and api key validation', async () => {
    const app = await buildServer();
    const u1Id = await insertUser('1');

    const basePayload = {
      model: 'm',
      name: 'Inactive1',
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
      payload: { ...basePayload, status: 'inactive' },
    });
    expect(res.statusCode).toBe(200);
    const inactiveId = res.json().id as string;

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

    const resInactive2 = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(u2Id),
      payload: { ...basePayload, name: 'Inactive2', status: 'inactive' },
    });
    const inactive2Id = resInactive2.json().id as string;

    expect(await getActivePortfolioWorkflowById(activeId)).toBeDefined();
    expect(await getActivePortfolioWorkflowById(inactiveId)).toBeUndefined();
    expect(await getActivePortfolioWorkflowById(inactive2Id)).toBeUndefined();

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

    await setWorkflowStatus(existingId, 'inactive');

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

  it('detects identical inactive workflows', async () => {
    const app = await buildServer();
    const inactiveUserId = await insertUser('inactiveUser');

    const inactivePayload = {
      model: 'm',
      name: 'Inactive',
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'ETH', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'p',
      cash: 'USDT',
      status: 'inactive',
    };

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(inactiveUserId),
      payload: inactivePayload,
    });
    const firstInactiveId = res1.json().id as string;

    const resDup = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(inactiveUserId),
      payload: inactivePayload,
    });
    expect(resDup.statusCode).toBe(400);
    expect(resDup.json().error).toContain(
      'identical inactive workflow already exists',
    );
    expect(resDup.json().error).toContain(firstInactiveId);

    const resOk = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(inactiveUserId),
      payload: { ...inactivePayload, name: 'Inactive2' },
    });
    expect(resOk.statusCode).toBe(200);

    await app.close();
  });

  it('rejects duplicate inactive updates', async () => {
    const app = await buildServer();
    const updId = await insertUser('updUser');

    const base = {
      model: 'm1',
      name: 'Inactive1',
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'ETH', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'p',
      cash: 'USDT',
      status: 'inactive',
    };

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(updId),
      payload: base,
    });
    const inactive1 = res1.json().id as string;

    const res2 = await app.inject({
      method: 'POST',
      url: '/api/portfolio-workflows',
      cookies: authCookies(updId),
      payload: {
        ...base,
        name: 'Inactive2',
        tokens: [
          { token: 'BTC', minAllocation: 10 },
          { token: 'SOL', minAllocation: 20 },
        ],
      },
    });
    const inactive2 = res2.json().id as string;

    const resUpd = await app.inject({
      method: 'PUT',
      url: `/api/portfolio-workflows/${inactive2}`,
      cookies: authCookies(updId),
      payload: { ...base },
    });
    expect(resUpd.statusCode).toBe(400);
    expect(resUpd.json().error).toContain('Inactive1');
    expect(resUpd.json().error).toContain(inactive1);

    await app.close();
  });

  it('fails to start agent without model', async () => {
    const app = await buildServer();
    const nomodelId = await insertUserWithKeys('nomodel');
    const payload = {
      model: '',
      name: 'Incomplete',
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
      status: 'inactive',
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

  it('requires admin role for admin workflows pagination', async () => {
    const app = await buildServer();
    const userId = await insertUser('regular');

    const res = await app.inject({
      method: 'GET',
      url: '/api/portfolio-workflows/admin/paginated?page=1&pageSize=5',
      cookies: authCookies(userId),
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('allows admins to list workflows for any user', async () => {
    const app = await buildServer();
    const adminId = await insertAdminUser('admin');
    const firstUser = await insertUser('first');
    const secondUser = await insertUser('second');

    await insertPortfolioWorkflow({
      userId: firstUser,
      model: 'm1',
      status: 'active',
      name: 'W1',
      tokens: [],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'p',
      manualRebalance: false,
      useEarn: false,
    });
    await insertPortfolioWorkflow({
      userId: secondUser,
      model: 'm2',
      status: 'inactive',
      name: 'W2',
      tokens: [],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'p',
      manualRebalance: false,
      useEarn: false,
    });

    const resAll = await app.inject({
      method: 'GET',
      url: '/api/portfolio-workflows/admin/paginated?page=1&pageSize=10',
      cookies: authCookies(adminId),
    });
    expect(resAll.statusCode).toBe(200);
    expect(resAll.json()).toMatchObject({ total: 2, page: 1, pageSize: 10 });
    const allItems = resAll.json().items as { userId: string; status: string }[];
    expect(allItems).toHaveLength(2);
    expect(allItems.map((item) => item.userId).sort()).toEqual(
      [firstUser, secondUser].sort(),
    );

    const resActive = await app.inject({
      method: 'GET',
      url: '/api/portfolio-workflows/admin/paginated?page=1&pageSize=10&status=active',
      cookies: authCookies(adminId),
    });
    expect(resActive.statusCode).toBe(200);
    expect(resActive.json()).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(resActive.json().items).toHaveLength(1);
    expect(resActive.json().items[0].userId).toBe(firstUser);

    const resFiltered = await app.inject({
      method: 'GET',
      url: `/api/portfolio-workflows/admin/paginated?page=1&pageSize=10&userId=${secondUser}`,
      cookies: authCookies(adminId),
    });
    expect(resFiltered.statusCode).toBe(200);
    expect(resFiltered.json()).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(resFiltered.json().items).toHaveLength(1);
    expect(resFiltered.json().items[0].userId).toBe(secondUser);

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
      status: 'inactive',
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

  it('exposes developer instructions', async () => {
    const app = await buildServer();
    const userId = await insertUser('dev');
    const res = await app.inject({
      method: 'GET',
      url: '/api/developer-instructions',
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ instructions: developerInstructions });
    await app.close();
  });
});
