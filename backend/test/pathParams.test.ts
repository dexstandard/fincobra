import { describe, it, expect } from 'vitest';
import buildServer from '../src/server.js';
import { authCookies } from './helpers.js';

// Ensure that invalid path parameters are rejected

describe('path parameter validation', () => {
  it('returns 400 for invalid user id', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/abc/ai-key',
      cookies: authCookies('1'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid path parameter' });
  });
});
