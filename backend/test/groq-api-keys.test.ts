import { describe, it, expect, vi } from 'vitest';
import buildServer from '../src/server.js';
import { insertUser } from './repos/users.js';
import { authCookies } from './helpers.js';
import { getGroqKey } from '../src/repos/ai-api-key.js';

describe('Groq API key routes', () => {
  it('performs CRUD operations', async () => {
    const app = await buildServer();
    const userId = await insertUser('groq-user');

    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn();
    (globalThis as any).fetch = fetchMock;

    const key1 = 'groqkey-1234567890';
    const key2 = 'groqkey-abcdefghij';

    fetchMock.mockResolvedValueOnce({
      ok: false,
      text: () =>
        Promise.resolve(
          JSON.stringify({ error: { message: 'invalid authentication' } }),
        ),
    } as any);
    let res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/groq-key`,
      cookies: authCookies(userId),
      payload: { key: 'bad-key' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'verification failed: invalid authentication',
    });
    let stored = await getGroqKey(userId);
    expect(stored).toBeNull();

    fetchMock.mockResolvedValueOnce({ ok: true } as any);
    res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/groq-key`,
      cookies: authCookies(userId),
      payload: { key: key1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ key: '<REDACTED>' });
    stored = await getGroqKey(userId);
    expect(stored?.aiApiKeyEnc).toBeDefined();
    expect(stored?.aiApiKeyEnc).not.toBe(key1);

    res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/groq-key`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ key: '<REDACTED>' });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve('bad update'),
    } as any);
    res = await app.inject({
      method: 'PUT',
      url: `/api/users/${userId}/groq-key`,
      cookies: authCookies(userId),
      payload: { key: 'bad-update' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'verification failed: bad update' });

    fetchMock.mockResolvedValueOnce({ ok: true } as any);
    res = await app.inject({
      method: 'PUT',
      url: `/api/users/${userId}/groq-key`,
      cookies: authCookies(userId),
      payload: { key: key2 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ key: '<REDACTED>' });

    res = await app.inject({
      method: 'DELETE',
      url: `/api/users/${userId}/groq-key`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });

    res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/groq-key`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(404);

    (globalThis as any).fetch = originalFetch;
    await app.close();
  });
});
