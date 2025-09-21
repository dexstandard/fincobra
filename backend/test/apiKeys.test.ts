import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/binance.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/binance.js')>(
    '../src/services/binance.js',
  );
  return { ...actual, cancelOrder: vi.fn().mockResolvedValue(undefined) };
});

import buildServer from '../src/server.js';
import { insertUser, insertAdminUser } from './repos/users.js';
import { getAiKey, setAiKey, shareAiKey, hasAiKeyShare } from '../src/repos/ai-api-key.js';
import { getBinanceKey, setBinanceKey } from '../src/repos/exchange-api-keys.js';
import { insertAgent, getPortfolioWorkflow } from './repos/portfolio-workflow.js';
import { getUserApiKeys } from '../src/repos/portfolio-workflow.js';
import { insertReviewResult } from './repos/review-result.js';
import { insertLimitOrder } from './repos/limit-orders.js';
import { LimitOrderStatus } from '../src/repos/limit-orders.types.js';
import { encrypt } from '../src/util/crypto.js';
import * as portfolioReview from '../src/workflows/portfolio-review.js';
import { cancelOrder } from '../src/services/binance.js';
import { authCookies } from './helpers.js';
import * as orderOrchestrator from '../src/services/order-orchestrator.js';

const cancelOrdersSpy = vi.spyOn(
  orderOrchestrator,
  'cancelOrdersForWorkflow',
);

const removeWorkflowFromScheduleSpy = vi.spyOn(
  portfolioReview,
  'removeWorkflowFromSchedule',
);

describe('AI API key routes', () => {
  it('performs CRUD operations', async () => {
    const app = await buildServer();
    const userId = await insertUser('1');

    const fetchMock = vi.fn();
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;

    const key1 = 'aikey1234567890';
    const key2 = 'aikeyabcdefghij';

    fetchMock.mockResolvedValueOnce({ ok: false } as any);
    let res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/ai-key`,
      cookies: authCookies(userId),
      payload: { key: 'bad' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'verification failed' });
    let row = await getAiKey(userId);
    expect(row?.aiApiKeyEnc).toBeUndefined();

    fetchMock.mockResolvedValueOnce({ ok: true } as any);
    res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/ai-key`,
      cookies: authCookies(userId),
      payload: { key: key1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ key: '<REDACTED>' });
    row = await getAiKey(userId);
    expect(row?.aiApiKeyEnc).not.toBe(key1);

    res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/ai-key`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ key: '<REDACTED>' });

    res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/ai-key`,
      cookies: authCookies(userId),
      payload: { key: 'dup' },
    });
    expect(res.statusCode).toBe(409);

    fetchMock.mockResolvedValueOnce({ ok: false } as any);
    res = await app.inject({
      method: 'PUT',
      url: `/api/users/${userId}/ai-key`,
      cookies: authCookies(userId),
      payload: { key: 'bad2' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'verification failed' });
    res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/ai-key`,
      cookies: authCookies(userId),
    });
    expect(res.json()).toMatchObject({ key: '<REDACTED>' });

    fetchMock.mockResolvedValueOnce({ ok: true } as any);
    res = await app.inject({
      method: 'PUT',
      url: `/api/users/${userId}/ai-key`,
      cookies: authCookies(userId),
      payload: { key: key2 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ key: '<REDACTED>' });

    res = await app.inject({
      method: 'DELETE',
      url: `/api/users/${userId}/ai-key`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);

    res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/ai-key`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(404);

    await app.close();
    (globalThis as any).fetch = originalFetch;
  });

  it('allows admin to share and revoke ai key', async () => {
    const app = await buildServer();
    const fetchMock = vi.fn();
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;
    fetchMock.mockResolvedValue({ ok: true } as any);
    const adminId = await insertAdminUser('admin1', encrypt('admin@example.com', process.env.KEY_PASSWORD!));
    const userId = await insertUser('u1', encrypt('user@example.com', process.env.KEY_PASSWORD!));
    const ai = encrypt('aikey1234567890', process.env.KEY_PASSWORD!);
    await setAiKey({ userId: adminId, apiKeyEnc: ai });

    let res = await app.inject({
      method: 'POST',
      url: `/api/users/${adminId}/ai-key/share`,
      cookies: authCookies(adminId),
      payload: { email: 'user@example.com', model: 'gpt-5' },
    });
    expect(res.statusCode).toBe(200);

    res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/ai-key/shared`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ key: '<REDACTED>', shared: true });

    let keyRow = await getUserApiKeys(userId);
    expect(keyRow?.aiApiKeyEnc).toBeDefined();

    res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/ai-key`,
      cookies: authCookies(userId),
      payload: { key: 'newkey1234567890' },
    });
    expect(res.statusCode).toBe(200);

    res = await app.inject({
      method: 'PUT',
      url: `/api/users/${userId}/ai-key`,
      cookies: authCookies(userId),
      payload: { key: 'newkeyabcdefghij' },
    });
    expect(res.statusCode).toBe(200);

    res = await app.inject({
      method: 'DELETE',
      url: `/api/users/${userId}/ai-key`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);

    res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/ai-key`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(404);

    res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/ai-key/shared`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);

    res = await app.inject({
      method: 'DELETE',
      url: `/api/users/${adminId}/ai-key/share`,
      cookies: authCookies(adminId),
      payload: { email: 'user@example.com' },
    });
    expect(res.statusCode).toBe(200);

    keyRow = await getUserApiKeys(userId);
    expect(keyRow?.aiApiKeyEnc).toBeNull();

    res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/ai-key/shared`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(404);

    await app.close();
    (globalThis as any).fetch = originalFetch;
  });

  it("forbids accessing another user's ai key", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/999/ai-key',
      cookies: authCookies('1'),
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('Binance API key routes', () => {
  it('performs CRUD operations', async () => {
    const app = await buildServer();
    const userId = await insertUser('2');

    const fetchMock = vi.fn();
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;

    // Helpers: valid-length (64) placeholders
    const k = (c: string) => c.repeat(64);
    const validBadKey = k('A');          // passes Zod, will fail verification
    const validBadSecret = k('b');       // passes Zod, will fail verification
    const key1 = k('C');
    const secret1 = k('d');
    const key2 = k('E');
    const secret2 = k('f');
    const dupKey = k('G');
    const dupSecret = k('h');

    // ---- Create: verification fails (body passes schema) ----
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

    // ---- Create: success ----
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

    // ---- Read ----
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

    // ---- Create duplicate: should be 409 ----
    res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/binance-key`,
      cookies: authCookies(userId),
      payload: { key: dupKey, secret: dupSecret },
    });
    expect(res.statusCode).toBe(409);

    // ---- Update: verification fails (generic message) ----
    fetchMock.mockResolvedValueOnce({ ok: false } as any);

    res = await app.inject({
      method: 'PUT',
      url: `/api/users/${userId}/binance-key`,
      cookies: authCookies(userId),
      payload: { key: validBadKey, secret: validBadSecret },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'verification failed' });

    // Ensure GET still returns masked values
    res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/binance-key`,
      cookies: authCookies(userId),
    });
    expect(res.json()).toMatchObject({
      key: '<REDACTED>',
      secret: '<REDACTED>',
    });

    // ---- Update: success ----
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

    // ---- Delete ----
    res = await app.inject({
      method: 'DELETE',
      url: `/api/users/${userId}/binance-key`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);

    // ---- Read after delete ----
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

describe('key deletion effects on agents', () => {
  beforeEach(() => {
    removeWorkflowFromScheduleSpy.mockClear();
    (cancelOrder as any).mockClear();
    cancelOrdersSpy.mockClear();
  });
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
    const agent = await insertAgent({
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
        reason: orderOrchestrator.CANCEL_ORDER_REASONS.API_KEY_REMOVED,
      }),
    );
    await app.close();
  });

  it('deactivates agents when ai key is deleted', async () => {
    const app = await buildServer();
    const userId = await insertUser('4');
    const ai = encrypt('aikey', process.env.KEY_PASSWORD!);
    const bk = encrypt('bkey', process.env.KEY_PASSWORD!);
    const bs = encrypt('skey', process.env.KEY_PASSWORD!);
    await setAiKey({ userId, apiKeyEnc: ai });
    await setBinanceKey({
      userId,
      apiKeyEnc: bk,
      apiSecretEnc: bs,
    });
    const agent = await insertAgent({
      userId,
      model: 'gpt-5',
      status: 'active',
      startBalance: 100,
      name: 'A2',
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
      orderId: '2',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/users/${userId}/ai-key`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    const row = await getPortfolioWorkflow(agent.id);
    expect(row).toMatchObject({ status: 'inactive' });
    expect(removeWorkflowFromScheduleSpy).toHaveBeenCalledWith(agent.id);
    expect(cancelOrder).toHaveBeenCalledWith(userId, {
      symbol: 'BTCETH',
      orderId: 2,
    });
    expect(cancelOrdersSpy).toHaveBeenCalledTimes(1);
    expect(cancelOrdersSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: agent.id,
        reason: orderOrchestrator.CANCEL_ORDER_REASONS.API_KEY_REMOVED,
      }),
    );
    await app.close();
  });

  it('deactivates agents when shared ai key is revoked', async () => {
    const app = await buildServer();
    const adminId = await insertAdminUser(
      'a5',
      encrypt('admin@example.com', process.env.KEY_PASSWORD!),
    );
    const userId = await insertUser(
      'u5',
      encrypt('user@example.com', process.env.KEY_PASSWORD!),
    );
    const ai = encrypt('aikey', process.env.KEY_PASSWORD!);
    const bk = encrypt('bkey', process.env.KEY_PASSWORD!);
    const bs = encrypt('skey', process.env.KEY_PASSWORD!);
    await setAiKey({ userId: adminId, apiKeyEnc: ai });
    await setBinanceKey({
      userId,
      apiKeyEnc: bk,
      apiSecretEnc: bs,
    });
    await shareAiKey({
      ownerUserId: adminId,
      targetUserId: userId,
      model: 'gpt-5',
    });
    const agent = await insertAgent({
      userId,
      model: 'gpt-5',
      status: 'active',
      startBalance: 100,
      name: 'A3',
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
      orderId: '3',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/users/${adminId}/ai-key/share`,
      cookies: authCookies(adminId),
      payload: { email: 'user@example.com' },
    });
    expect(res.statusCode).toBe(200);
    const row = await getPortfolioWorkflow(agent.id);
    expect(row).toMatchObject({ status: 'inactive' });
    expect(removeWorkflowFromScheduleSpy).toHaveBeenCalledWith(agent.id);
    expect(cancelOrder).toHaveBeenCalledWith(userId, {
      symbol: 'BTCETH',
      orderId: 3,
    });
    expect(cancelOrdersSpy).toHaveBeenCalledTimes(1);
    expect(cancelOrdersSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: agent.id,
        reason: orderOrchestrator.CANCEL_ORDER_REASONS.API_KEY_REMOVED,
      }),
    );
    await app.close();
  });

  it('revokes shares and deactivates agents when admin deletes ai key', async () => {
    const app = await buildServer();
    const adminId = await insertAdminUser(
      'a8',
      encrypt('admin@example.com', process.env.KEY_PASSWORD!),
    );
    const userId = await insertUser(
      'u8',
      encrypt('user@example.com', process.env.KEY_PASSWORD!),
    );
    const ai = encrypt('aikey', process.env.KEY_PASSWORD!);
    const bk = encrypt('bkey', process.env.KEY_PASSWORD!);
    const bs = encrypt('skey', process.env.KEY_PASSWORD!);
    await setAiKey({ userId: adminId, apiKeyEnc: ai });
    await setBinanceKey({
      userId,
      apiKeyEnc: bk,
      apiSecretEnc: bs,
    });
    await shareAiKey({
      ownerUserId: adminId,
      targetUserId: userId,
      model: 'gpt-5',
    });
    const agent = await insertAgent({
      userId,
      model: 'gpt-5',
      status: 'active',
      startBalance: 100,
      name: 'A8',
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
      orderId: '4',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/users/${adminId}/ai-key`,
      cookies: authCookies(adminId),
    });
    expect(res.statusCode).toBe(200);
    const row = await getPortfolioWorkflow(agent.id);
    expect(row).toMatchObject({ status: 'inactive' });
    expect(removeWorkflowFromScheduleSpy).toHaveBeenCalledWith(agent.id);
    expect(cancelOrder).toHaveBeenCalledWith(userId, {
      symbol: 'BTCETH',
      orderId: 4,
    });
    expect(cancelOrdersSpy).toHaveBeenCalledTimes(1);
    expect(cancelOrdersSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: agent.id,
        reason: orderOrchestrator.CANCEL_ORDER_REASONS.API_KEY_REMOVED,
      }),
    );
    const keyRow = await getUserApiKeys(userId);
    expect(keyRow?.aiApiKeyEnc).toBeNull();
    const shareExists = await hasAiKeyShare({
      ownerUserId: adminId,
      targetUserId: userId,
    });
    expect(shareExists).toBe(false);
    await app.close();
  });

  it('ignores agent cleanup when user has their own ai key', async () => {
    const app = await buildServer();
    const adminId = await insertAdminUser(
      'a7',
      encrypt('admin@example.com', process.env.KEY_PASSWORD!),
    );
    const userId = await insertUser(
      'u7',
      encrypt('user@example.com', process.env.KEY_PASSWORD!),
    );
    const aiAdmin = encrypt('aikey', process.env.KEY_PASSWORD!);
    const aiUser = encrypt('userkey', process.env.KEY_PASSWORD!);
    const bk = encrypt('bkey', process.env.KEY_PASSWORD!);
    const bs = encrypt('skey', process.env.KEY_PASSWORD!);
    await setAiKey({ userId: adminId, apiKeyEnc: aiAdmin });
    await setAiKey({ userId, apiKeyEnc: aiUser });
    await setBinanceKey({
      userId,
      apiKeyEnc: bk,
      apiSecretEnc: bs,
    });
    await shareAiKey({
      ownerUserId: adminId,
      targetUserId: userId,
      model: 'gpt-5',
    });
    const agent = await insertAgent({
      userId,
      model: 'gpt-5',
      status: 'active',
      startBalance: 100,
      name: 'A5',
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

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/users/${adminId}/ai-key/share`,
      cookies: authCookies(adminId),
      payload: { email: 'user@example.com' },
    });
    expect(res.statusCode).toBe(200);
    const row = await getPortfolioWorkflow(agent.id);
    expect(row).toMatchObject({ status: 'active', model: 'gpt-5' });
    expect(removeWorkflowFromScheduleSpy).not.toHaveBeenCalled();
    expect(cancelOrder).not.toHaveBeenCalled();
    expect(cancelOrdersSpy).not.toHaveBeenCalled();
    const keyRow = await getUserApiKeys(userId);
    expect(keyRow?.aiApiKeyEnc).toBeDefined();
    await app.close();
  });

  it('does not affect agents if no shared ai key exists', async () => {
    const app = await buildServer();
    const adminId = await insertAdminUser(
      'a6',
      encrypt('admin@example.com', process.env.KEY_PASSWORD!),
    );
    const userId = await insertUser(
      'u6',
      encrypt('user@example.com', process.env.KEY_PASSWORD!),
    );
    const aiAdmin = encrypt('aikey', process.env.KEY_PASSWORD!);
    const aiUser = encrypt('userkey', process.env.KEY_PASSWORD!);
    const bk = encrypt('bkey', process.env.KEY_PASSWORD!);
    const bs = encrypt('skey', process.env.KEY_PASSWORD!);
    await setAiKey({ userId: adminId, apiKeyEnc: aiAdmin });
    await setAiKey({ userId, apiKeyEnc: aiUser });
    await setBinanceKey({
      userId,
      apiKeyEnc: bk,
      apiSecretEnc: bs,
    });
    const agent = await insertAgent({
      userId,
      model: 'gpt-5',
      status: 'active',
      startBalance: 100,
      name: 'A4',
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

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/users/${adminId}/ai-key/share`,
      cookies: authCookies(adminId),
      payload: { email: 'user@example.com' },
    });
    expect(res.statusCode).toBe(404);
    const row = await getPortfolioWorkflow(agent.id);
    expect(row).toMatchObject({ status: 'active', model: 'gpt-5' });
    expect(removeWorkflowFromScheduleSpy).not.toHaveBeenCalled();
    expect(cancelOrder).not.toHaveBeenCalled();
    expect(cancelOrdersSpy).not.toHaveBeenCalled();
    await app.close();
  });
});
