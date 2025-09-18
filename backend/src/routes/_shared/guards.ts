import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseParams } from '../../util/validation.js';
import { requireUserIdMatch, requireAdmin } from '../../util/auth.js';
import { errorResponse, ERROR_MESSAGES } from '../../util/errorMessages.js';
import { userIdParams } from './validation.js';

export type RequestWithUserId = FastifyRequest & { validatedUserId: string };

export function getValidatedUserId(req: FastifyRequest): string {
  return (req as RequestWithUserId).validatedUserId;
}

export async function parseUserIdParam(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const params = parseParams(userIdParams, req.params, reply);
  if (!params) return reply;
  (req as RequestWithUserId).validatedUserId = params.id;
}

export async function requireUserOwner(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const { validatedUserId } = req as RequestWithUserId;
  if (!requireUserIdMatch(req, reply, validatedUserId)) return reply;
}

export async function requireOwnerAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const adminId = await requireAdmin(req, reply);
  if (!adminId) return reply;
  const { validatedUserId } = req as RequestWithUserId;
  if (adminId !== validatedUserId) {
    reply.code(403).send(errorResponse(ERROR_MESSAGES.forbidden));
    return reply;
  }
}

export const userOwnerPreHandlers = [parseUserIdParam, requireUserOwner];
export const ownerAdminPreHandlers = [
  parseUserIdParam,
  requireOwnerAdmin,
];
