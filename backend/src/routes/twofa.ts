import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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
import { requireUserId } from '../util/auth.js';
import { errorResponse } from '../util/errorMessages.js';

const OTP_ISSUER = 'FinCobra' as const;

interface EnableTwofaBody {
  token: string;
  secret: string;
}

interface DisableTwofaBody {
  token: string;
}

const tokenSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/);

const enableTwofaBodySchema: z.ZodType<EnableTwofaBody> = z
  .object({
    token: tokenSchema,
    secret: z.string().trim().min(1),
  })
  .strict();

const disableTwofaBodySchema: z.ZodType<DisableTwofaBody> = z
  .object({ token: tokenSchema })
  .strict();

function getAuthenticatedUserId(
  req: FastifyRequest,
  reply: FastifyReply,
): string | undefined {
  const userId = requireUserId(req, reply);
  if (!userId) return undefined;
  return userId;
}

function invalidTokenResponse(reply: FastifyReply) {
  return reply.code(400).send(errorResponse('invalid token'));
}

export default async function twofaRoutes(app: FastifyInstance) {
  app.get(
    '/2fa/status',
    { config: { rateLimit: RATE_LIMITS.MODERATE } },
    async (req, reply) => {
      const userId = getAuthenticatedUserId(req, reply);
      if (!userId) return;
      const enabled = await getUserTotpStatus(userId);
      return { enabled };
    },
  );

  app.get(
    '/2fa/setup',
    { config: { rateLimit: RATE_LIMITS.TIGHT } },
    async (req, reply) => {
      const userId = getAuthenticatedUserId(req, reply);
      if (!userId) return;
      const secret = authenticator.generateSecret();
      const otpauthUrl = authenticator.keyuri(String(userId), OTP_ISSUER, secret);
      const qr = await QRCode.toDataURL(otpauthUrl);
      return { secret, otpauthUrl, qr };
    },
  );

  app.post(
    '/2fa/enable',
    { config: { rateLimit: RATE_LIMITS.VERY_TIGHT } },
    async (req, reply) => {
      const userId = getAuthenticatedUserId(req, reply);
      if (!userId) return;
      const body = parseBody(enableTwofaBodySchema, req, reply);
      if (!body) return;
      const { token, secret } = body;
      if (!authenticator.verify({ token, secret })) {
        return invalidTokenResponse(reply);
      }
      await setUserTotpSecret(userId, secret);
      return { enabled: true };
    },
  );

  app.post(
    '/2fa/disable',
    { config: { rateLimit: RATE_LIMITS.VERY_TIGHT } },
    async (req, reply) => {
      const userId = getAuthenticatedUserId(req, reply);
      if (!userId) return;
      const body = parseBody(disableTwofaBodySchema, req, reply);
      if (!body) return;
      const secret = await getUserTotpSecret(userId);
      if (!secret) {
        return reply.code(400).send(errorResponse('not enabled'));
      }
      if (!authenticator.verify({ token: body.token, secret })) {
        return invalidTokenResponse(reply);
      }
      await clearUserTotp(userId);
      return { enabled: false };
    },
  );
}
