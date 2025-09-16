import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import pino from 'pino';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import csrf from '@fastify/csrf-protection';
import helmet from '@fastify/helmet';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RATE_LIMITS } from './rate-limit.js';
import { errorResponse } from './util/errorMessages.js';
import { fetchOutputIp } from './util/output-ip.js';
import { migrate } from './db/index.js';
import { tryGetUserId } from './util/auth.js';

type RequestLogContext = {
  userId: string | null;
  workflowId: unknown;
  route?: string;
};

const FORBIDDEN_LOG_KEYS = new Set(['password', 'token', 'key', 'secret']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getWorkflowId(source: unknown): unknown {
  return isRecord(source) ? source.workflowId : undefined;
}

function isFastifyError(error: unknown): error is FastifyError {
  return error instanceof Error && 'statusCode' in error;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Indicates whether the HTTP server finished booting */
    isStarted: boolean;
  }
  interface FastifyRequest {
    /** Context used to enrich request logs */
    logContext?: RequestLogContext;
  }
}

function sanitize(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map((value) => sanitize(value));
  }
  if (!isRecord(obj)) return obj;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (FORBIDDEN_LOG_KEYS.has(key.toLowerCase())) continue;
    result[key] = sanitize(value);
  }
  return result;
}

export default async function buildServer(
  routesDir: string = path.join(new URL('.', import.meta.url).pathname, 'routes'),
): Promise<FastifyInstance> {
  await migrate();
  const app = Fastify({
    logger: {
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label.toUpperCase() }),
      },
    },
    disableRequestLogging: true,
  });

  app.decorate('isStarted', false);


  await app.register(cookie);
  await app.register(csrf, {
    getToken: (req) => req.headers['x-csrf-token'] as string,
    cookieOpts: { sameSite: 'strict', path: '/', secure: true },
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://accounts.google.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com'],
        imgSrc: ["'self'", 'data:', 'https://accounts.google.com'],
        connectSrc: ["'self'", 'https://api.binance.com', 'https://accounts.google.com'],
        fontSrc: ["'self'", 'data:'],
        frameSrc: ['https://accounts.google.com'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
  });

  await app.register(rateLimit, {
    global: false,
    ...RATE_LIMITS.LAX,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      ...errorResponse(`Too many requests, please try again in ${context.after}.`),
    }),
  });

  await fetchOutputIp();

  for (const file of fs.readdirSync(routesDir)) {
    if (file.endsWith('.js') || (file.endsWith('.ts') && !file.endsWith('.d.ts'))) {
      const route = await import(pathToFileURL(path.join(routesDir, file)).href);
      app.register(route.default, { prefix: '/api' });
    }
  }

  app.addHook('preHandler', (req, _reply, done) => {
    const userId = tryGetUserId(req);
    const workflowId =
      getWorkflowId(req.params) ??
      getWorkflowId(req.body) ??
      getWorkflowId(req.query);
    const route = req.routerPath ? `/api${req.routerPath}` : req.raw.url;
    req.logContext = { userId, workflowId, route };
    const params = sanitize({ params: req.params, query: req.query, body: req.body });
    req.log.info({ userId, workflowId, route, params }, 'request start');
    done();
  });

  app.addHook('onResponse', (req, reply, done) => {
    const ctx = req.logContext ?? {};
    if (reply.statusCode < 400) {
      req.log.info({ ...ctx, statusCode: reply.statusCode }, 'request success');
    }
    done();
  });

  app.setErrorHandler((err, req, reply) => {
    const ctx = req.logContext ?? {};
    req.log.error({ err, ...ctx }, 'request error');
    const statusCode = isFastifyError(err) && typeof err.statusCode === 'number' ? err.statusCode : 500;
    reply.code(statusCode).send(err);
  });

  app.log.info('Server initialized');
  return app;
}
