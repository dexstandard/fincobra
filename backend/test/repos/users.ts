import { db } from '../../src/db/index.js';
import {
  insertUser as insertUserProd,
  setUserEmail,
  setUserEnabled,
} from '../../src/repos/users.js';
import { insertUserIdentity } from '../../src/repos/user-identities.js';
import { setAiKey, setBinanceKey } from '../../src/repos/api-keys.js';
import { encrypt } from '../../src/util/crypto.js';

export async function insertUser(sub?: string, emailEnc?: string | null) {
  const id = await insertUserProd(emailEnc ?? null);
  if (sub) await insertUserIdentity(id, 'google', sub);
  return id;
}
export { setUserEmail, setUserEnabled };

export async function insertAdminUser(sub?: string, emailEnc?: string | null) {
  const { rows } = await db.query(
    "INSERT INTO users (role, is_enabled, email_enc) VALUES ('admin', true, $1) RETURNING id",
    [emailEnc ?? null],
  );
  const id = rows[0].id as string;
  if (sub) await insertUserIdentity(id, 'google', sub);
  return id;
}

export async function getUserEmailEnc(id: string) {
  const { rows } = await db.query('SELECT email_enc FROM users WHERE id = $1', [id]);
  return rows[0] as { email_enc?: string } | undefined;
}

export async function insertUserWithKeys(sub?: string, emailEnc?: string | null) {
  const userId = await insertUser(sub, emailEnc ?? null);
  const ai = encrypt('aikey', process.env.KEY_PASSWORD!);
  const bk = encrypt('bkey', process.env.KEY_PASSWORD!);
  const bs = encrypt('skey', process.env.KEY_PASSWORD!);
  await setAiKey(userId, ai);
  await setBinanceKey(userId, bk, bs);
  return userId;
}
