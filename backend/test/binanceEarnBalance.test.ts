import { describe, it, expect, vi } from 'vitest';
import buildServer from '../src/server.js';
import { encrypt } from '../src/util/crypto.js';
import { insertUser } from './repos/users.js';
import { setBinanceKey } from '../src/repos/exchange-api-keys.js';
import { authCookies } from './helpers.js';

describe('binance earn balance route', () => {
  it('returns flexible balance for a specific token', async () => {
    const app = await buildServer();
    const key = 'binKey123456';
    const secret = 'binSecret123456';
    const encKey = encrypt(key, process.env.KEY_PASSWORD!);
    const encSecret = encrypt(secret, process.env.KEY_PASSWORD!);
    const userId = await insertUser('3');
    await setBinanceKey({
      userId,
      apiKeyEnc: encKey,
      apiSecretEnc: encSecret,
    });

    const fetchMock = vi.fn();
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ rows: [{ totalAmount: '123.45' }] }),
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/binance-earn-balance/USDT`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ asset: 'USDT', total: 123.45 });

    await app.close();
    (globalThis as any).fetch = originalFetch;
  });

  it("forbids accessing another user's balance", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'GET',
      url: `/api/users/999/binance-earn-balance/USDT`,
      cookies: authCookies('1'),
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
