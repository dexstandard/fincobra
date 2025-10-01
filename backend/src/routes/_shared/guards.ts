import type { FastifyReply, FastifyRequest } from 'fastify';
import { requireAdmin, requireUserId } from '../../util/auth.js';
import { errorResponse, ERROR_MESSAGES } from '../../util/error-messages.js';
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
  const sessionUserId = requireUserId(req, reply);
  if (!sessionUserId) return reply;
  if (sessionUserId !== req.validatedUserId) {
    return reply.code(403).send(errorResponse(ERROR_MESSAGES.forbidden));
  }
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

export async function requireAdminAccess(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void | FastifyReply> {
  const adminId = await requireAdmin(req, reply);
  if (!adminId) return reply;
  req.adminUserId = adminId;
}

export async function requireSession(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void | FastifyReply> {
  const id = requireUserId(req, reply);
  if (!id) return reply;
  req.validatedUserId = id;
}

export function getValidatedUserId(req: FastifyRequest): string {
  return req.validatedUserId!;
}

export const userPreHandlers = [parseUserIdParam, requireUserOwner];
export const adminPreHandlers = [parseUserIdParam, requireAdminOwner];
export const adminOnlyPreHandlers = [requireAdminAccess];
export const adminManagedUserPreHandlers = [
  parseUserIdParam,
  requireAdminAccess,
];
export const sessionPreHandlers = [requireSession];
