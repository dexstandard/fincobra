import type { FastifyInstance } from 'fastify';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { z } from 'zod';
import { parseBody } from './_shared/validation.js';
import { RATE_LIMITS } from '../rate-limit.js';
import {
  clearUserTotp,
  getUserTotpSecret,
  getUserTotpStatus,
  setUserTotpSecret,
} from '../repos/users.js';
import { errorResponse } from '../util/error-messages.js';
import { getValidatedUserId, sessionPreHandlers } from './_shared/guards.js';

const OTP_ISSUER = 'FinCobra' as const;

const tokenSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/);
const base32 = /^[A-Z2-7]+=*$/i;

const enableTwofaBodySchema = z
  .object({
    token: tokenSchema,
    secret: z.string().trim().min(16).regex(base32),
  })
  .strict();

const disableTwofaBodySchema = z.object({ token: tokenSchema }).strict();

function invalidToken(reply: any): undefined {
  reply.code(400).send(errorResponse('invalid token'));
  return undefined;
}

export default async function twofaRoutes(app: FastifyInstance) {
  app.get(
    '/2fa/status',
    {
      config: { rateLimit: RATE_LIMITS.MODERATE },
      preHandler: sessionPreHandlers,
    },
    async (req) => {
      const userId = getValidatedUserId(req);
      const enabled = await getUserTotpStatus(userId);
      return { enabled };
    },
  );

  app.get(
    '/2fa/setup',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: sessionPreHandlers,
    },
    async (req) => {
      const userId = getValidatedUserId(req);
      const secret = authenticator.generateSecret();
      const label = String(userId); // replace with email if available
      const otpauthUrl = authenticator.keyuri(label, OTP_ISSUER, secret);
      const qr = await QRCode.toDataURL(otpauthUrl);
      return { secret, otpauthUrl, qr };
    },
  );

  app.post(
    '/2fa/enable',
    {
      config: { rateLimit: RATE_LIMITS.VERY_TIGHT },
      preHandler: sessionPreHandlers,
    },
    async (req, reply) => {
      const userId = getValidatedUserId(req);
      const body = parseBody(enableTwofaBodySchema, req, reply);
      if (!body) return;
      const { token, secret } = body;
      if (!authenticator.verify({ token, secret })) return invalidToken(reply);
      await setUserTotpSecret(userId, secret);
      return { enabled: true };
    },
  );

  app.post(
    '/2fa/disable',
    {
      config: { rateLimit: RATE_LIMITS.VERY_TIGHT },
      preHandler: sessionPreHandlers,
    },
    async (req, reply) => {
      const userId = getValidatedUserId(req);
      const body = parseBody(disableTwofaBodySchema, req, reply);
      if (!body) return;
      const secret = await getUserTotpSecret(userId);
      if (!secret) return reply.code(400).send(errorResponse('not enabled'));
      if (!authenticator.verify({ token: body.token, secret }))
        return invalidToken(reply);
      await clearUserTotp(userId);
      return { enabled: false };
    },
  );
}
