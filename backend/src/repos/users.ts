import { db } from '../db/index.js';
import { encrypt, decrypt } from '../util/crypto.js';
import { env } from '../util/env.js';
import { convertKeysToCamelCase } from '../util/objectCase.js';
import type {
  UserAuthInfo,
  UserDetails,
  UserDetailsWithId,
  UserListEntry,
} from './users.types.js';

export async function getUser(id: string): Promise<UserDetails | undefined> {
  const { rows } = await db.query(
    'SELECT totp_secret_enc, is_totp_enabled, role, is_enabled FROM users WHERE id = $1',
    [id],
  );
  const row = rows[0];
  if (!row) return undefined;
  const entity = convertKeysToCamelCase(row) as {
    totpSecretEnc?: string;
    isTotpEnabled?: boolean;
    role: string;
    isEnabled: boolean;
  };
  const result: UserDetails = {
    totpSecret: entity.totpSecretEnc
      ? decrypt(entity.totpSecretEnc, env.KEY_PASSWORD)
      : undefined,
    isTotpEnabled: entity.isTotpEnabled,
    role: entity.role,
    isEnabled: entity.isEnabled,
  };
  return result;
}

export async function getUserAuthInfo(id: string): Promise<UserAuthInfo | undefined> {
  const { rows } = await db.query(
    'SELECT email_enc, role, is_enabled FROM users WHERE id = $1',
    [id],
  );
  const row = rows[0];
  if (!row) return undefined;
  const entity = convertKeysToCamelCase(row) as {
    emailEnc?: string;
    role: string;
    isEnabled: boolean;
  };
  const result: UserAuthInfo = {
    email: entity.emailEnc ? decrypt(entity.emailEnc, env.KEY_PASSWORD) : undefined,
    role: entity.role,
    isEnabled: entity.isEnabled,
  };
  return result;
}

export async function insertUser(emailEnc: string | null): Promise<string> {
  const { rows } = await db.query(
    "INSERT INTO users (role, is_enabled, email_enc) VALUES ('user', true, $1) RETURNING id",
    [emailEnc],
  );
  return rows[0].id as string;
}

export async function setUserEmail(id: string, emailEnc: string): Promise<void> {
  await db.query('UPDATE users SET email_enc = $1 WHERE id = $2', [emailEnc, id]);
}

export async function listUsers(): Promise<UserListEntry[]> {
  const { rows } = await db.query(
    "SELECT u.id, u.role, u.is_enabled, u.email_enc, u.created_at, " +
      "(ak.id IS NOT NULL OR oak.id IS NOT NULL) AS has_ai_key, " +
      "(ek.id IS NOT NULL) AS has_binance_key " +
      "FROM users u " +
      "LEFT JOIN ai_api_keys ak ON ak.user_id = u.id AND ak.provider = 'openai' " +
      "LEFT JOIN ai_api_key_shares s ON s.target_user_id = u.id " +
      "LEFT JOIN ai_api_keys oak ON oak.user_id = s.owner_user_id AND oak.provider = 'openai' " +
      "LEFT JOIN exchange_keys ek ON ek.user_id = u.id AND ek.provider = 'binance'",
  );
  return rows.map((row) =>
    convertKeysToCamelCase(row) as UserListEntry,
  );
}

export async function setUserEnabled(id: string, enabled: boolean): Promise<void> {
  await db.query('UPDATE users SET is_enabled = $1 WHERE id = $2', [enabled, id]);
}

export async function getUserTotpStatus(id: string) {
  const { rows } = await db.query(
    'SELECT is_totp_enabled FROM users WHERE id = $1',
    [id],
  );
  const row = rows[0];
  if (!row) return false;
  const entity = convertKeysToCamelCase(row) as { isTotpEnabled?: boolean };
  return !!entity.isTotpEnabled;
}

export async function setUserTotpSecret(id: string, secret: string): Promise<void> {
  const enc = encrypt(secret, env.KEY_PASSWORD);
  await db.query(
    'UPDATE users SET totp_secret_enc = $1, is_totp_enabled = true WHERE id = $2',
    [enc, id],
  );
}

export async function getUserTotpSecret(id: string) {
  const { rows } = await db.query(
    'SELECT totp_secret_enc FROM users WHERE id = $1',
    [id],
  );
  const row = rows[0];
  if (!row) return undefined;
  const entity = convertKeysToCamelCase(row) as { totpSecretEnc?: string };
  if (!entity.totpSecretEnc) return undefined;
  return decrypt(entity.totpSecretEnc, env.KEY_PASSWORD);
}

export async function clearUserTotp(id: string): Promise<void> {
  await db.query(
    'UPDATE users SET totp_secret_enc = NULL, is_totp_enabled = false WHERE id = $1',
    [id],
  );
}

export async function findUserByEmail(email: string): Promise<UserDetailsWithId | undefined> {
  const { rows } = await db.query(
    'SELECT id, role, is_enabled, totp_secret_enc, is_totp_enabled, email_enc FROM users',
  );
  for (const rawRow of rows) {
    const row = convertKeysToCamelCase(rawRow) as {
      id: string;
      role: string;
      isEnabled: boolean;
      totpSecretEnc?: string;
      isTotpEnabled?: boolean;
      emailEnc?: string;
    };
    if (row.emailEnc && decrypt(row.emailEnc, env.KEY_PASSWORD) === email) {
      const result: UserDetailsWithId = {
        id: row.id,
        role: row.role,
        isEnabled: row.isEnabled,
        totpSecret: row.totpSecretEnc
          ? decrypt(row.totpSecretEnc, env.KEY_PASSWORD)
          : undefined,
        isTotpEnabled: row.isTotpEnabled,
      };
      return result;
    }
  }
  return undefined;
}
