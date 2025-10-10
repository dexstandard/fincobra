import { db } from '../db/index.js';
import { convertKeysToCamelCase } from '../util/object-case.js';
import type {
  AiApiKeyDetails,
  AiApiKeyUpsert,
  AiApiKeyShareUpsert,
  AiApiKeyShareDelete,
  AiApiKeyShareLookup,
  SharedAiApiKeyDetails,
  AiApiProvider,
} from './ai-api-key.types.js';

interface AiApiKeyRow {
  aiApiKeyId: string | null;
  aiApiKeyEnc: string | null;
}

function mapAiKeyRow(
  row: AiApiKeyRow | undefined | null,
): AiApiKeyDetails | null | undefined {
  if (!row) return undefined;
  if (!row.aiApiKeyId) return null;
  return { id: row.aiApiKeyId, aiApiKeyEnc: row.aiApiKeyEnc ?? '' };
}

function normalizeProvider(
  provider: AiApiProvider | undefined,
): AiApiProvider {
  return provider ?? 'openai';
}

async function getProviderAiKey(
  userId: string,
  provider: AiApiProvider,
): Promise<AiApiKeyDetails | null | undefined> {
  const { rows } = await db.query(
    `SELECT ak.id AS ai_api_key_id,
            ak.api_key_enc AS ai_api_key_enc
       FROM users u
       LEFT JOIN ai_api_keys ak ON ak.user_id = u.id AND ak.provider = $2
      WHERE u.id = $1`,
    [userId, provider],
  );
  const row = rows[0];
  if (!row) return undefined;
  const entity = convertKeysToCamelCase(row) as AiApiKeyRow;
  return mapAiKeyRow(entity);
}

async function upsertAiKey(entry: AiApiKeyUpsert): Promise<void> {
  const provider = normalizeProvider(entry.provider);
  await db.query(
    'INSERT INTO ai_api_keys (user_id, provider, api_key_enc) VALUES ($1, $2, $3) ON CONFLICT (user_id, provider) DO UPDATE SET api_key_enc = EXCLUDED.api_key_enc',
    [entry.userId, provider, entry.apiKeyEnc],
  );
}

async function deleteAiKey(
  userId: string,
  provider: AiApiProvider,
): Promise<void> {
  await db.query(
    'DELETE FROM ai_api_keys WHERE user_id = $1 AND provider = $2',
    [userId, provider],
  );
}

export async function getAiKey(
  userId: string,
  provider: AiApiProvider = 'openai',
): Promise<AiApiKeyDetails | null | undefined> {
  return getProviderAiKey(userId, provider);
}

export async function getGroqKey(
  userId: string,
): Promise<AiApiKeyDetails | null | undefined> {
  return getProviderAiKey(userId, 'groq');
}

export async function getSharedAiKey(
  id: string,
  provider: AiApiProvider = 'openai',
): Promise<SharedAiApiKeyDetails | null | undefined> {
  const { rows } = await db.query(
    `SELECT oak.id AS shared_ai_api_key_id,
            oak.api_key_enc AS shared_ai_api_key_enc,
            s.model AS shared_model
       FROM users u
       LEFT JOIN ai_api_key_shares s ON s.target_user_id = u.id
       LEFT JOIN ai_api_keys oak ON oak.user_id = s.owner_user_id AND oak.provider = $2
      WHERE u.id = $1`,
    [id, provider],
  );
  const row = rows[0];
  if (!row) return undefined;
  const entity = convertKeysToCamelCase(row) as {
    sharedAiApiKeyId: string | null;
    sharedAiApiKeyEnc: string | null;
    sharedModel: string | null;
  };
  if (!entity.sharedAiApiKeyId) return null;
  return {
    id: entity.sharedAiApiKeyId,
    aiApiKeyEnc: entity.sharedAiApiKeyEnc ?? '',
    model: entity.sharedModel ?? null,
  };
}

export async function setAiKey(entry: AiApiKeyUpsert): Promise<void> {
  await upsertAiKey(entry);
}

export async function clearAiKey(
  id: string,
  provider: AiApiProvider = 'openai',
): Promise<void> {
  await deleteAiKey(id, provider);
}

export async function setGroqKey(entry: AiApiKeyUpsert): Promise<void> {
  await upsertAiKey({ ...entry, provider: 'groq' });
}

export async function clearGroqKey(id: string): Promise<void> {
  await deleteAiKey(id, 'groq');
}

export async function shareAiKey(entry: AiApiKeyShareUpsert): Promise<void> {
  await db.query(
    'INSERT INTO ai_api_key_shares (owner_user_id, target_user_id, model) VALUES ($1, $2, $3) ON CONFLICT (target_user_id) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id, model = EXCLUDED.model',
    [entry.ownerUserId, entry.targetUserId, entry.model],
  );
}

export async function revokeAiKeyShare(
  entry: AiApiKeyShareDelete,
): Promise<void> {
  await db.query(
    'DELETE FROM ai_api_key_shares WHERE owner_user_id = $1 AND target_user_id = $2',
    [entry.ownerUserId, entry.targetUserId],
  );
}

export async function hasAiKeyShare(
  entry: AiApiKeyShareLookup,
): Promise<boolean> {
  const { rowCount } = await db.query(
    'SELECT 1 FROM ai_api_key_shares WHERE owner_user_id = $1 AND target_user_id = $2',
    [entry.ownerUserId, entry.targetUserId],
  );
  return rowCount > 0;
}

export async function getAiKeyShareTargets(ownerId: string): Promise<string[]> {
  const { rows } = await db.query(
    'SELECT target_user_id FROM ai_api_key_shares WHERE owner_user_id = $1',
    [ownerId],
  );
  return (convertKeysToCamelCase(rows) as { targetUserId: string }[]).map(
    (row) => row.targetUserId,
  );
}
