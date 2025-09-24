import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { errorResponse } from './errorMessages.js';

export function parseParams<S extends z.ZodTypeAny>(
  schema: S,
  params: unknown,
  reply: FastifyReply,
): z.infer<S> | undefined {
  const result = schema.safeParse(params);
  if (!result.success) {
    reply.code(400).send(errorResponse('invalid path parameter'));
    return;
  }
  return result.data;
}
