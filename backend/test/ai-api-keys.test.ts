import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/binance-client.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/binance-client.js')>(
    '../src/services/binance-client.js',
  );
  return { ...actual, cancelOrder: vi.fn().mockResolvedValue(undefined) };
});

import buildServer from '../src/server.js';
import { insertUser, insertAdminUser } from './repos/users.js';
import { getAiKey, setAiKey, shareAiKey, hasAiKeyShare } from '../src/repos/ai-api-key.js';
import { setBinanceKey } from '../src/repos/exchange-api-keys.js';
import { getUserApiKeys } from '../src/repos/portfolio-workflows.js';
import { insertPortfolioWorkflow, getPortfolioWorkflow } from './repos/portfolio-workflows.js';
import { insertReviewResult } from './repos/review-result.js';
import { insertLimitOrder } from './repos/limit-orders.js';
import { LimitOrderStatus } from '../src/repos/limit-orders.types.js';
import { encrypt } from '../src/util/crypto.js';
import * as portfolioReview from '../src/workflows/portfolio-review.js';
import { cancelOrder } from '../src/services/binance-client.js';
import { authCookies } from './helpers.js';
import * as orderOrchestrator from '../src/services/order-orchestrator.js';

const cancelOrdersSpy = vi.spyOn(orderOrchestrator, 'cancelOrdersForWorkflow');
const removeWorkflowFromScheduleSpy = vi.spyOn(portfolioReview, 'removeWorkflowFromSchedule');

beforeEach(() => {
  removeWorkflowFromScheduleSpy.mockClear();
  (cancelOrder as any).mockClear();
  cancelOrdersSpy.mockClear();
});

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

    const aiEnc = encrypt('aikey', process.env.KEY_PASSWORD!);
    const bk = encrypt('bkey', process.env.KEY_PASSWORD!);
    const bs = encrypt('skey', process.env.KEY_PASSWORD!);
    await setAiKey({ userId: adminId, apiKeyEnc: aiEnc });
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
    const agent = await insertPortfolioWorkflow({
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

    res = await app.inject({
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

describe('AI API key effects on agents', () => {
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
    const agent = await insertPortfolioWorkflow({
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
    const agent = await insertPortfolioWorkflow({
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
    const agent = await insertPortfolioWorkflow({
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
