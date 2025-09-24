import Fastify, { type FastifyInstance } from 'fastify';
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

declare module 'fastify' {
  interface FastifyInstance {
    /** Indicates whether the HTTP server finished booting */
    isStarted: boolean;
  }
}

function sanitize(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  const forbidden = ['password', 'token', 'key', 'secret'];
  const result: any = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj as any)) {
    if (forbidden.includes(k.toLowerCase())) continue;
    result[k] = sanitize(v);
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
      (req.params as any)?.workflowId ??
      (req.body as any)?.workflowId ??
      (req.query as any)?.workflowId;
    const route = req.routerPath ? `/api${req.routerPath}` : req.raw.url;
    (req as any).logContext = { userId, workflowId, route };
    const params = sanitize({ params: req.params, query: req.query, body: req.body });
    req.log.info({ userId, workflowId, route, params }, 'request start');
    done();
  });

  app.addHook('onResponse', (req, reply, done) => {
    const ctx = (req as any).logContext ?? {};
    if (reply.statusCode < 400) {
      req.log.info({ ...ctx, statusCode: reply.statusCode }, 'request success');
    }
    done();
  });

  app.setErrorHandler((err, req, reply) => {
    const ctx = (req as any).logContext ?? {};
    req.log.error({ err, ...ctx }, 'request error');
    reply.code((err as any).statusCode || 500).send(err);
  });

  app.log.info('Server initialized');
  return app;
}
