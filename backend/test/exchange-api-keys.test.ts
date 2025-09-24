import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/binance-client.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/binance-client.js')>(
    '../src/services/binance-client.js',
  );
  return { ...actual, cancelOrder: vi.fn().mockResolvedValue(undefined) };
});

import buildServer from '../src/server.js';
import { insertUser } from './repos/users.js';
import { getBinanceKey, setBinanceKey } from '../src/repos/exchange-api-keys.js';
import { setAiKey } from '../src/repos/ai-api-key.js';
import { insertPortfolioWorkflow, getPortfolioWorkflow } from './repos/portfolio-workflows.js';
import { insertReviewResult } from './repos/review-result.js';
import { insertLimitOrder } from './repos/limit-orders.js';
import { LimitOrderStatus } from '../src/repos/limit-orders.types.js';
import { encrypt } from '../src/util/crypto.js';
import * as portfolioReview from '../src/workflows/portfolio-review.js';
import { cancelOrder } from '../src/services/binance-client.js';
import { authCookies } from './helpers.js';
import * as orderOrchestrator from '../src/services/order-orchestrator.js';
import { CANCEL_ORDER_REASONS } from '../src/services/order-orchestrator.types.js';

const cancelOrdersSpy = vi.spyOn(orderOrchestrator, 'cancelOrdersForWorkflow');
const removeWorkflowFromScheduleSpy = vi.spyOn(portfolioReview, 'removeWorkflowFromSchedule');

beforeEach(() => {
  removeWorkflowFromScheduleSpy.mockClear();
  (cancelOrder as any).mockClear();
  cancelOrdersSpy.mockClear();
});

describe('Exchange API key routes', () => {
  it('performs CRUD operations', async () => {
    const app = await buildServer();
    const userId = await insertUser('2');

    const fetchMock = vi.fn();
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;

    const k = (c: string) => c.repeat(64);
    const validBadKey = k('A');
    const validBadSecret = k('b');
    const key1 = k('C');
    const secret1 = k('d');
    const key2 = k('E');
    const secret2 = k('f');
    const dupKey = k('G');
    const dupSecret = k('h');

    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ msg: 'Invalid API-key' }),
    } as any);

    let res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/binance-key`,
      cookies: authCookies(userId),
      payload: { key: validBadKey, secret: validBadSecret },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'verification failed: Invalid API-key',
    });

    let binanceKey = await getBinanceKey(userId);
    expect(binanceKey).toBeNull();

    fetchMock.mockResolvedValueOnce({ ok: true } as any);
    fetchMock.mockResolvedValueOnce({ ok: true } as any);

    res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/binance-key`,
      cookies: authCookies(userId),
      payload: { key: key1, secret: secret1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      key: '<REDACTED>',
      secret: '<REDACTED>',
    });

    binanceKey = await getBinanceKey(userId);
    expect(binanceKey).not.toBeNull();
    if (!binanceKey) throw new Error('binance key missing');
    expect(binanceKey.apiKeyEnc).not.toBe(key1);
    expect(binanceKey.apiSecretEnc).not.toBe(secret1);

    res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/binance-key`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      key: '<REDACTED>',
      secret: '<REDACTED>',
    });

    res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/binance-key`,
      cookies: authCookies(userId),
      payload: { key: dupKey, secret: dupSecret },
    });
    expect(res.statusCode).toBe(409);

    fetchMock.mockResolvedValueOnce({ ok: false } as any);

    res = await app.inject({
      method: 'PUT',
      url: `/api/users/${userId}/binance-key`,
      cookies: authCookies(userId),
      payload: { key: validBadKey, secret: validBadSecret },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'verification failed' });

    res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/binance-key`,
      cookies: authCookies(userId),
    });
    expect(res.json()).toMatchObject({
      key: '<REDACTED>',
      secret: '<REDACTED>',
    });

    fetchMock.mockResolvedValueOnce({ ok: true } as any);
    fetchMock.mockResolvedValueOnce({ ok: true } as any);

    res = await app.inject({
      method: 'PUT',
      url: `/api/users/${userId}/binance-key`,
      cookies: authCookies(userId),
      payload: { key: key2, secret: secret2 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      key: '<REDACTED>',
      secret: '<REDACTED>',
    });

    res = await app.inject({
      method: 'DELETE',
      url: `/api/users/${userId}/binance-key`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);

    res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/binance-key`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(404);

    await app.close();
    (globalThis as any).fetch = originalFetch;
  });

  it("forbids accessing another user's binance key", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/999/binance-key',
      cookies: authCookies('1'),
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('Exchange API key effects on agents', () => {
  it('stops agents when binance key is deleted', async () => {
    const app = await buildServer();
    const userId = await insertUser('3');
    const ai = encrypt('aikey', process.env.KEY_PASSWORD!);
    const bk = encrypt('bkey', process.env.KEY_PASSWORD!);
    const bs = encrypt('skey', process.env.KEY_PASSWORD!);
    await setAiKey({ userId, apiKeyEnc: ai });
    await setBinanceKey({
      userId,
      apiKeyEnc: bk,
      apiSecretEnc: bs,
    });
    const agent = await insertPortfolioWorkflow({
      userId,
      model: 'gpt-5',
      status: 'active',
      startBalance: 100,
      name: 'A1',
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'ETH', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'prompt',
      manualRebalance: false,
      useEarn: true,
    });

    const rrId = await insertReviewResult({ portfolioWorkflowId: agent.id, log: '' });
    await insertLimitOrder({
      userId,
      planned: { symbol: 'BTCETH' },
      status: LimitOrderStatus.Open,
      reviewResultId: rrId,
      orderId: '1',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/users/${userId}/binance-key`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    const row = await getPortfolioWorkflow(agent.id);
    expect(row?.status).toBe('inactive');
    expect(removeWorkflowFromScheduleSpy).toHaveBeenCalledWith(agent.id);
    expect(cancelOrder).toHaveBeenCalledWith(userId, {
      symbol: 'BTCETH',
      orderId: 1,
    });
    expect(cancelOrdersSpy).toHaveBeenCalledTimes(1);
    expect(cancelOrdersSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: agent.id,
        reason: CANCEL_ORDER_REASONS.API_KEY_REMOVED,
      }),
    );
    await app.close();
  });
});
