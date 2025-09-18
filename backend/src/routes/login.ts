import type { FastifyInstance, FastifyReply } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { authenticator } from 'otplib';
import { env } from '../util/env.js';
import { RATE_LIMITS } from '../rate-limit.js';
import { insertUser, setUserEmail, getUserAuthInfo } from '../repos/users.js';
import {
  findUserByIdentity,
  insertUserIdentity,
} from '../repos/user-identities.js';
import { encrypt } from '../util/crypto.js';
import { errorResponse, type ErrorResponse } from '../util/errorMessages.js';
import jwt from 'jsonwebtoken';
import { requireUserId } from '../util/auth.js';

interface ValidationErr {
  code: number;
  body: ErrorResponse;
}

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
  });
}

export default async function loginRoutes(app: FastifyInstance) {
  app.get('/login/csrf', async (_req, reply) => ({
    csrfToken: await reply.generateCsrf(),
  }));

  app.post(
    '/login',
    {
      config: { rateLimit: RATE_LIMITS.VERY_TIGHT },
      onRequest: async (req, reply) => {
        const site = req.headers['sec-fetch-site'] as string | undefined;
        if (site === 'same-origin' || site === 'same-site') return;
        const origin = req.headers.origin;
        if (origin) {
          try {
            const { host } = new URL(origin);
            if (host === req.headers.host) return;
          } catch {}
        }
        await new Promise<void>((resolve, reject) => {
          (app.csrfProtection as any)(req, reply, (err: any) =>
            err ? reject(err) : resolve(),
          );
        });
      },
    },
    async (req, reply) => {
      const body = z
        .object({ token: z.string(), otp: z.string().optional() })
        .parse(req.body);
      const payload = await verifyToken(body.token);
      if (!payload?.sub)
        return reply.code(400).send(errorResponse('invalid token'));
      const emailEnc = payload.email
        ? encrypt(payload.email, env.KEY_PASSWORD)
        : null;
      const row = await findUserByIdentity('google', payload.sub);
      let id: string;
      if (!row) {
        id = await insertUser(emailEnc);
        await insertUserIdentity(id, 'google', payload.sub);
        setSessionCookie(reply, id);
        return { id, email: payload.email, role: 'user' };
      }
      id = row.id;
      if (emailEnc) await setUserEmail(id, emailEnc);
      if (!row.isEnabled) {
        return reply.code(403).send(errorResponse('user disabled'));
      }
      const err = validateOtp(row, body.otp);
      if (err) return reply.code(err.code).send(err.body);
      setSessionCookie(reply, id);
      return { id, email: payload.email, role: row.role };
    }
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

function validateOtp(
  row: { totpSecret?: string; isTotpEnabled?: boolean },
  otp: string | undefined,
): ValidationErr | null {
  if (row.isTotpEnabled && row.totpSecret) {
    if (!otp) return { code: 401, body: errorResponse('otp required') };
    const valid = authenticator.verify({ token: otp, secret: row.totpSecret });
    if (!valid) return { code: 401, body: errorResponse('invalid otp') };
  }
  return null;
}
