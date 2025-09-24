import type { FastifyReply, FastifyRequest } from 'fastify';
import { errorResponse, ERROR_MESSAGES } from './error-messages.js';
import { getUser } from '../repos/users.js';
import jwt from 'jsonwebtoken';
import { env } from './env.js';

export function requireUserId(
  req: FastifyRequest,
  reply: FastifyReply,
): string | null {
  const token = req.cookies?.session as string | undefined;
  if (!token) {
    reply.code(403).send(errorResponse(ERROR_MESSAGES.forbidden));
    return null;
  }
  try {
    const payload = jwt.verify(token, env.KEY_PASSWORD) as { id: string };
    return payload.id;
  } catch {
    reply.code(403).send(errorResponse(ERROR_MESSAGES.forbidden));
    return null;
  }
}

export function tryGetUserId(req: FastifyRequest): string | null {
  const token = req.cookies?.session as string | undefined;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.KEY_PASSWORD) as { id: string };
    return payload.id;
  } catch {
    return null;
  }
}

export async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  const userId = requireUserId(req, reply);
  if (!userId) return null;
  const row = await getUser(userId);
  if (!row || row.role !== 'admin' || !row.isEnabled) {
    reply.code(403).send(errorResponse(ERROR_MESSAGES.forbidden));
    return null;
  }
  return userId;
}
