import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import { z } from 'zod';

import { RATE_LIMITS } from '../rate-limit.js';
import {
  findUserByIdentity,
  insertUserIdentity,
} from '../repos/user-identities.js';
import type { UserIdentityDetails } from '../repos/user-identities.types.js';
import { getUserAuthInfo, insertUser, setUserEmail } from '../repos/users.js';
import { requireUserId } from '../util/auth.js';
import { encrypt } from '../util/crypto.js';
import { env } from '../util/env.js';
import { errorResponse, type ErrorResponse } from '../util/error-messages.js';
import { parseBody } from './_shared/validation.js';

interface LoginBody {
  token: string;
  otp?: string;
}

interface ValidationErr {
  code: number;
  body: ErrorResponse;
}

const loginBodySchema: z.ZodType<LoginBody> = z
  .object({
    token: z.string().trim().min(10),
    otp: z.string().trim().min(6).max(10).optional(),
  })
  .strict();

const client = new OAuth2Client();

async function verifyToken(token: string) {
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: env.GOOGLE_CLIENT_ID,
  });
  return ticket.getPayload();
}

function setSessionCookie(reply: FastifyReply, id: string) {
  const token = jwt.sign({ id }, env.KEY_PASSWORD);
  reply.setCookie('session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7
  });
}

function validateOtp(
  identity: Pick<UserIdentityDetails, 'totpSecret' | 'isTotpEnabled'>,
  otp: string | undefined,
): ValidationErr | null {
  if (identity.isTotpEnabled && identity.totpSecret) {
    if (!otp) return { code: 401, body: errorResponse('otp required') };
    const valid = authenticator.verify({
      token: otp,
      secret: identity.totpSecret,
    });
    if (!valid) return { code: 401, body: errorResponse('invalid otp') };
  }
  return null;
}

function isSameSiteRequest(req: FastifyRequest): boolean {
  const site = req.headers['sec-fetch-site'];
  if (site === 'same-origin' || site === 'same-site') return true;

  const origin = req.headers.origin;
  if (!origin) return false;

  try {
    const { host } = new URL(origin);
    return host === req.headers.host;
  } catch {
    return false;
  }
}

async function runCsrfProtection(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    (app.csrfProtection as any)(req, reply, (err: any) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function createCsrfProtectionHandler(app: FastifyInstance) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (isSameSiteRequest(req)) return;
    try {
      await runCsrfProtection(app, req, reply);
    } catch (err) {
      req.log.warn({ err }, 'csrf check failed');
      throw err;
    }
  };
}

export default async function loginRoutes(app: FastifyInstance) {
  const csrfProtection = createCsrfProtectionHandler(app);

  app.get('/login/csrf', async (_req, reply) => ({
    csrfToken: await reply.generateCsrf(),
  }));

  app.post(
    '/login',
    {
      config: { rateLimit: RATE_LIMITS.VERY_TIGHT },
      onRequest: csrfProtection,
    },
    async (req, reply) => {
      const body = parseBody(loginBodySchema, req, reply);
      if (!body) return;

      let payload;
      try {
        payload = await verifyToken(body.token);
      } catch (err) {
        req.log.info({ err }, 'invalid google id token');
        return reply.code(400).send(errorResponse('invalid token'));
      }
      if (!payload?.sub) return reply.code(400).send(errorResponse('invalid token'));

      const emailEnc = payload.email
        ? encrypt(payload.email, env.KEY_PASSWORD)
        : null;

      const identity = await findUserByIdentity('google', payload.sub);
      if (!identity) {
        const id = await insertUser(emailEnc);
        await insertUserIdentity(id, 'google', payload.sub);
        setSessionCookie(reply, id);
        return { id, email: payload.email, role: 'user' };
      }

      const id = identity.id;
      if (emailEnc) await setUserEmail(id, emailEnc);
      if (!identity.isEnabled)
        return reply.code(403).send(errorResponse('user disabled'));

      const err = validateOtp(identity, body.otp);
      if (err) return reply.code(err.code).send(err.body);

      setSessionCookie(reply, id);
      return { id, email: payload.email, role: identity.role };
    },
  );

  app.get(
    '/login/session',
    { config: { rateLimit: RATE_LIMITS.LAX } },
    async (req, reply) => {
      const id = requireUserId(req, reply);
      if (!id) return;

      const info = await getUserAuthInfo(id);
      if (!info)
        return reply.code(404).send(errorResponse('user not found'));
      if (!info.isEnabled)
        return reply.code(403).send(errorResponse('user disabled'));

      return { id, email: info.email, role: info.role };
    },
  );
}
