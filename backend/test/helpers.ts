import jwt from 'jsonwebtoken';
import type { FastifyBaseLogger } from 'fastify';
import { env } from '../src/util/env.js';

export function authCookies(id: string) {
  return { session: jwt.sign({ id }, env.KEY_PASSWORD) };
}

export function mockLogger(): FastifyBaseLogger {
  const log = {
    info: () => {},
    error: () => {},
    child: () => log,
  } as unknown as FastifyBaseLogger;
  return log;
}
