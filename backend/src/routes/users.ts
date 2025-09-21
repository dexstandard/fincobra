import type { FastifyInstance, FastifyReply } from 'fastify';
import { RATE_LIMITS } from '../rate-limit.js';
import { errorResponse } from '../util/errorMessages.js';
import { decrypt } from '../util/crypto.js';
import { env } from '../util/env.js';
import { getUser, listUsers, setUserEnabled } from '../repos/users.js';
import type { UserListEntry } from '../repos/users.types.js';
import {
  adminManagedUserPreHandlers,
  adminOnlyPreHandlers,
  getValidatedUserId,
} from './_shared/guards.js';

interface AdminUserResponse {
  id: string;
  role: string;
  isEnabled: boolean;
  email: string | null;
  createdAt: string;
  hasAiKey: boolean;
  hasBinanceKey: boolean;
}

interface ToggleUserResponse {
  ok: true;
}

function mapUserListEntry(entry: UserListEntry): AdminUserResponse {
  return {
    id: entry.id,
    role: entry.role,
    isEnabled: entry.isEnabled,
    email: entry.emailEnc ? decrypt(entry.emailEnc, env.KEY_PASSWORD) : null,
    createdAt: entry.createdAt,
    hasAiKey: entry.hasAiKey,
    hasBinanceKey: entry.hasBinanceKey,
  };
}

async function setUserEnabledStatus(
    reply: FastifyReply,
    userId: string,
    enabled: boolean,
): Promise<ToggleUserResponse | FastifyReply> {
  const user = await getUser(userId);
  if (!user) return reply.code(404).send(errorResponse('user not found'));
  await setUserEnabled(userId, enabled);
  return { ok: true };
}

export default async function usersRoutes(app: FastifyInstance) {
  app.get(
    '/users',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: adminOnlyPreHandlers,
    },
    async () => {
      const rows = await listUsers();
      return rows.map(mapUserListEntry);
    },
  );

  app.post(
    '/users/:id/enable',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: adminManagedUserPreHandlers,
    },
    async (req, reply) => {
      const userId = getValidatedUserId(req);
      return setUserEnabledStatus(reply, userId, true);
    },
  );

  app.post(
    '/users/:id/disable',
    {
      config: { rateLimit: RATE_LIMITS.TIGHT },
      preHandler: adminManagedUserPreHandlers,
    },
    async (req, reply) => {
      const userId = getValidatedUserId(req);
      return setUserEnabledStatus(reply, userId, false);
    },
  );
}
