import type { FastifyInstance } from 'fastify';
import { RATE_LIMITS } from '../rate-limit.js';

export default async function healthRoute(app: FastifyInstance) {
  app.get(
    '/health',
    {
      config: { rateLimit: RATE_LIMITS.LAX },
    },
    async (_req, reply) => {
      if (!app.isStarted) {
        return reply.status(503).send({ ok: false });
      }
      return { ok: true, ts: Date.now() };
    }
  );
}
