import { describe, it, expect, vi } from 'vitest';
import buildServer from '../src/server.js';
import { encrypt } from '../src/util/crypto.js';
import { insertUser } from './repos/users.js';
import { setAiKey, shareAiKey } from '../src/repos/ai-api-key.js';
import { authCookies } from './helpers.js';

describe('model routes', () => {
  it('returns filtered models', async () => {
    const app = await buildServer();
    const key = 'aikey1234567890';
    const enc = encrypt(key, process.env.KEY_PASSWORD!);
    const userId = await insertUser('1', null);
    await setAiKey({ userId, apiKeyEnc: enc });

    const fetchMock = vi.fn();
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'foo-search' },
          { id: 'gpt-3.5' },
          { id: 'o3-mini' },
          { id: 'gpt-5' },
        ],
      }),
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/models`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ models: ['foo-search', 'o3-mini', 'gpt-5'] });

    await app.close();
    (globalThis as any).fetch = originalFetch;
  });

  it('requires a key', async () => {
    const app = await buildServer();
    const userId2 = await insertUser('2');
    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId2}/models`,
      cookies: authCookies(userId2),
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('caches models by key', async () => {
    const app = await buildServer();
    const key = 'aikey9999999999';
    const enc = encrypt(key, process.env.KEY_PASSWORD!);
    const userId3 = await insertUser('3', null);
    await setAiKey({ userId: userId3, apiKeyEnc: enc });

    const fetchMock = vi.fn();
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-5' }] }),
    } as any);

    let res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId3}/models`,
      cookies: authCookies(userId3),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ models: ['gpt-5'] });

    // second request should hit cache
    res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId3}/models`,
      cookies: authCookies(userId3),
    });
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await app.close();
    (globalThis as any).fetch = originalFetch;
  });

  it("forbids accessing another user's models", async () => {
    const app = await buildServer();
    const userId = await insertUser('4');
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/999/models',
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('allows user to fetch models via shared key', async () => {
    const app = await buildServer();
    const adminId = await insertUser('5');
    const userId = await insertUser('6');
    const key = 'aikeyshared123456';
    await setAiKey({
      userId: adminId,
      apiKeyEnc: encrypt(key, process.env.KEY_PASSWORD!),
    });
    await shareAiKey({
      ownerUserId: adminId,
      targetUserId: userId,
      model: 'gpt-5',
    });

    const fetchMock = vi.fn();
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;

    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/models`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ models: ['gpt-5'] });
    expect(fetchMock).not.toHaveBeenCalled();

    (globalThis as any).fetch = originalFetch;
    await app.close();
  });
});
