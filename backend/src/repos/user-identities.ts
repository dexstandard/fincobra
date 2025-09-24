import { db } from '../db/index.js';
import { decrypt } from '../util/crypto.js';
import { env } from '../util/env.js';
import { convertKeysToCamelCase } from '../util/objectCase.js';
import type { UserIdentityDetails } from './user-identities.types.js';

export async function findUserByIdentity(
  provider: string,
  sub: string,
): Promise<UserIdentityDetails | undefined> {
  const { rows } = await db.query(
    'SELECT u.id, u.role, u.is_enabled, u.totp_secret_enc, u.is_totp_enabled FROM user_identities ui JOIN users u ON ui.user_id = u.id WHERE ui.provider = $1 AND ui.sub = $2',
    [provider, sub],
  );
  const row = rows[0];
  if (!row) return undefined;
  const entity = convertKeysToCamelCase(row) as {
    id: string;
    role: string;
    isEnabled: boolean;
    totpSecretEnc?: string;
    isTotpEnabled?: boolean;
  };
  const identity: UserIdentityDetails = {
    id: entity.id,
    role: entity.role,
    isEnabled: entity.isEnabled,
    totpSecret: entity.totpSecretEnc
      ? decrypt(entity.totpSecretEnc, env.KEY_PASSWORD)
      : undefined,
    isTotpEnabled: entity.isTotpEnabled,
  };
  return identity;
}

export async function insertUserIdentity(
  userId: string,
  provider: string,
  sub: string,
): Promise<void> {
  await db.query(
    'INSERT INTO user_identities (user_id, provider, sub) VALUES ($1, $2, $3)',
    [userId, provider, sub],
  );
}
