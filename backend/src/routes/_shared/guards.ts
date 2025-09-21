import type { FastifyReply, FastifyRequest } from 'fastify';
import { requireAdmin, requireUserIdMatch } from '../../util/auth.js';
import { errorResponse, ERROR_MESSAGES } from '../../util/errorMessages.js';
import { parseRequestParams, userIdParams } from './validation.js';

export async function parseUserIdParam(
    req: FastifyRequest,
    reply: FastifyReply,
): Promise<void | FastifyReply> {
  const params = parseRequestParams(userIdParams, req, reply);
  if (!params) return reply;
  req.validatedUserId = params.id;
}

export async function requireUserOwner(
    req: FastifyRequest,
    reply: FastifyReply,
): Promise<void | FastifyReply> {
  if (!req.validatedUserId) {
    return reply.code(400).send(errorResponse('missing user id'));
  }
  if (!requireUserIdMatch(req, reply, req.validatedUserId)) return reply;
}

export async function requireAdminOwner(
    req: FastifyRequest,
    reply: FastifyReply,
): Promise<void | FastifyReply> {
  const adminId = await requireAdmin(req, reply);
  if (!adminId) return reply;
  if (!req.validatedUserId) {
    return reply.code(400).send(errorResponse('missing user id'));
  }
  if (adminId !== req.validatedUserId) {
    return reply.code(403).send(errorResponse(ERROR_MESSAGES.forbidden));
  }
  req.adminUserId = adminId;
}

export function getValidatedUserId(req: FastifyRequest): string {
  return req.validatedUserId!;
}

export const userPreHandlers = [parseUserIdParam, requireUserOwner];
export const adminPreHandlers = [parseUserIdParam, requireAdminOwner];
