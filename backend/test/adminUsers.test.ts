import { describe, it, expect } from 'vitest';
import buildServer from '../src/server.js';
import { encrypt } from '../src/util/crypto.js';
import { env } from '../src/util/env.js';
import { insertAdminUser, insertUser } from './repos/users.js';
import { getUser } from '../src/repos/users.js';
import { authCookies } from './helpers.js';
import { setAiKey } from '../src/repos/ai-api-key.js';
import { setBinanceKey } from '../src/repos/exchange-api-keys.js';

describe('admin user routes', () => {
  it('lists users for admin only', async () => {
    const app = await buildServer();
    const adminId = await insertAdminUser(
      'admin1',
      encrypt('admin@example.com', env.KEY_PASSWORD),
    );
    const userId = await insertUser(
      '1',
      encrypt('user1@example.com', env.KEY_PASSWORD),
    );

    await setAiKey({
      userId,
      apiKeyEnc: encrypt('openai-key', env.KEY_PASSWORD),
    });
    await setBinanceKey({
      userId,
      apiKeyEnc: encrypt('binance-key', env.KEY_PASSWORD),
      apiSecretEnc: encrypt('binance-secret', env.KEY_PASSWORD),
    });

    const resForbidden = await app.inject({
      method: 'GET',
      url: '/api/users',
      cookies: authCookies(userId),
    });
    expect(resForbidden.statusCode).toBe(403);

    const res = await app.inject({
      method: 'GET',
      url: '/api/users',
      cookies: authCookies(adminId),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as any[];
    const user = body.find((u) => u.id === userId);
    expect(user.email).toBe('user1@example.com');
    expect(typeof user.createdAt).toBe('string');
    expect(user.hasAiKey).toBe(true);
    expect(user.hasBinanceKey).toBe(true);
    const admin = body.find((u) => u.id === adminId);
    expect(admin.hasAiKey).toBe(false);
    expect(admin.hasBinanceKey).toBe(false);
    await app.close();
  });

  it('enables and disables users', async () => {
    const app = await buildServer();
    const adminId = await insertAdminUser('admin2');
    const userId = await insertUser('2');

    const resDisable = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/disable`,
      cookies: authCookies(adminId),
    });
    expect(resDisable.statusCode).toBe(200);
    let row = await getUser(userId);
    expect(row?.isEnabled).toBe(false);

    const resEnable = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/enable`,
      cookies: authCookies(adminId),
    });
    expect(resEnable.statusCode).toBe(200);
    row = await getUser(userId);
    expect(row?.isEnabled).toBe(true);

    await app.close();
  });
});
