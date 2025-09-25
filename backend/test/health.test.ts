import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import buildServer from '../src/server.js';

describe('health route', () => {
  it('returns 503 before server start', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false });
    await app.close();
  });

  it('returns ok with security headers when started', async () => {
    const app = await buildServer();
    app.isStarted = true;
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain('https://accounts.google.com');
    expect(res.headers['content-security-policy']).toContain('https://api.binance.com');
    await app.close();
  });

  it('fails to boot when a route does not export a plugin', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'routes-'));
    try {
      writeFileSync(
        join(dir, 'broken.js'),
        'export const foo = 42;\nexport const bar = () => {};\n',
        'utf8',
      );

      await expect(buildServer(dir)).rejects.toThrowError(
        /Route broken\.js does not export a Fastify plugin\./,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails to boot when a route throws during registration', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'routes-'));
    try {
      writeFileSync(
        join(dir, 'broken.js'),
        "export default async function () { throw new Error('startup boom'); }\n",
        'utf8',
      );

      await expect(buildServer(dir)).rejects.toThrowError(/startup boom/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

});
