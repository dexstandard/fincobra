import { describe, it, expect, vi } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { authenticator } from 'otplib';
import buildServer from '../src/server.js';
import { encrypt, decrypt } from '../src/util/crypto.js';
import { env } from '../src/util/env.js';
import { insertUser, getUserEmailEnc, setUserEnabled } from './repos/users.js';
import { setUserTotpSecret } from '../src/repos/users.js';

describe('login route', () => {
  it('creates user on first login', async () => {
    const app = await buildServer();
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({ sub: '123', email: 'user@example.com' }),
    } as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: { 'sec-fetch-site': 'same-origin' },
      payload: { token: 'test-token-12345' }, // >=10 chars
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBeDefined();
    const body = res.json() as any;
    expect(body.role).toBe('user');
    const row = await getUserEmailEnc(body.id);
    expect(row).toBeTruthy();
    const email = decrypt(row!.email_enc!, env.KEY_PASSWORD);
    expect(email).toBe('user@example.com');
    await app.close();
  });

  it('requires otp when 2fa enabled', async () => {
    const app = await buildServer();
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({ sub: '2', email: 'user2@example.com' }),
    } as any);
    const secret = authenticator.generateSecret();
    const id = await insertUser(
      '2',
      encrypt('user2@example.com', env.KEY_PASSWORD),
    );
    await setUserTotpSecret(id, secret);

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: { 'sec-fetch-site': 'same-origin' },
      payload: { token: 'test-token-2aaaa' }, // >=10 chars
    });
    expect(res1.statusCode).toBe(401);

    const now = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
    const otp = authenticator.generate(secret); // 6 digits
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: { 'sec-fetch-site': 'same-origin' },
      payload: { token: 'test-token-2aaaa', otp },
    });
    nowSpy.mockRestore();
    expect(res2.statusCode).toBe(200);
    await app.close();
  });

  it('rejects disabled users', async () => {
    const app = await buildServer();
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({ sub: '3', email: 'u3@example.com' }),
    } as any);
    const id = await insertUser(
      '3',
      encrypt('u3@example.com', env.KEY_PASSWORD),
    );
    await setUserEnabled(id, false);

    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: { 'sec-fetch-site': 'same-origin' },
      payload: { token: 'test-token-3zzzz' }, // >=10 chars
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('requires csrf token for cross-site requests', async () => {
    const app = await buildServer();
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({ sub: 'csrf', email: 'csrf@example.com' }),
    } as any);

    // No CSRF -> should be rejected by CSRF guard
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: { 'sec-fetch-site': 'cross-site' },
      payload: { token: 'test-token-csrf1' }, // >=10 chars
    });
    expect(res1.statusCode).toBe(403);

    // Get CSRF token & cookie
    const tokenRes = await app.inject({
      method: 'GET',
      url: '/api/login/csrf',
    });
    const csrfToken = (tokenRes.json() as any).csrfToken;
    const cookieHeader = (tokenRes.headers['set-cookie'] as string).split(
      ';',
    )[0];

    // With CSRF -> should succeed
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: {
        'sec-fetch-site': 'cross-site',
        'x-csrf-token': csrfToken,
        cookie: cookieHeader,
      },
      payload: { token: 'test-token-csrf2' }, // >=10 chars
    });
    expect(res2.statusCode).toBe(200);
    await app.close();
  });

  it('returns session info for authenticated request', async () => {
    const app = await buildServer();
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({ sub: 'sess', email: 'sess@example.com' }),
    } as any);

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: { 'sec-fetch-site': 'same-origin' },
      payload: { token: 'test-token-session' }, // >=10 chars
    });
    const cookie = loginRes.headers['set-cookie'] as string;

    const res = await app.inject({
      method: 'GET',
      url: '/api/login/session',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.email).toBe('sess@example.com');
    await app.close();
  });

  it('rejects requests without session', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/login/session' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
