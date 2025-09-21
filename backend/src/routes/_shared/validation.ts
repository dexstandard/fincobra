import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { errorResponse } from '../../util/errorMessages.js';

export const userIdParams = z.object({ id: z.string().regex(/^\d+$/) });

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
