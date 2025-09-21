import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { errorResponse } from '../../util/errorMessages.js';

export const userIdParams = z.object({ id: z.string().regex(/^\d+$/) });

export const userTokenParamsSchema = z.object({
  id: z.string(),
  token: z.string().trim().min(1).regex(/^[A-Za-z0-9]{1,20}$/),
}).strict();

export function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown,
  reply: FastifyReply,
): z.infer<S> | undefined {
  const result = schema.safeParse(body);
  if (!result.success) {
    reply.code(400).send(errorResponse('invalid request body'));
    return undefined;
  }
  return result.data;
}

export function parseRequestParams<S extends z.ZodTypeAny>(
  schema: S,
  req: FastifyRequest,
  reply: FastifyReply,
): z.infer<S> | undefined {
  const result = schema.safeParse(req.params);
  if (!result.success) {
    reply.code(400).send(errorResponse('invalid path parameter'));
    return undefined;
  }
  return result.data;
}
