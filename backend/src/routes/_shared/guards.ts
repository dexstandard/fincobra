import type { FastifyReply, FastifyRequest } from 'fastify';
import { requireAdmin, requireUserIdMatch } from '../../util/auth.js';
import { parseParams } from '../../util/validation.js';
import { errorResponse, ERROR_MESSAGES } from '../../util/errorMessages.js';
import { userIdParams } from './validation.js';

export type RequestWithUserId = FastifyRequest & { validatedUserId: string };

export async function parseUserIdParam(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void | FastifyReply> {
  const params = parseParams(userIdParams, req.params, reply);
  if (!params) return reply;
  (req as RequestWithUserId).validatedUserId = params.id;
}

export async function requireUserOwner(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void | FastifyReply> {
  const { validatedUserId } = req as RequestWithUserId;
  if (!requireUserIdMatch(req, reply, validatedUserId)) return reply;
}

export async function requireOwnerAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void | FastifyReply> {
  const adminId = await requireAdmin(req, reply);
  if (!adminId) return reply;
  const { validatedUserId } = req as RequestWithUserId;
  if (adminId !== validatedUserId) {
    reply.code(403).send(errorResponse(ERROR_MESSAGES.forbidden));
    return reply;
  }
}

export function getValidatedUserId(req: FastifyRequest): string {
  return (req as RequestWithUserId).validatedUserId;
}

export const userPreHandlers = [parseUserIdParam, requireUserOwner];
export const adminPreHandlers = [parseUserIdParam, requireOwnerAdmin];
