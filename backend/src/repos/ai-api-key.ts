import { db } from '../db/index.js';
import type {
  AiApiKeyRow,
  AiApiKeyUpsert,
  AiApiKeyShareUpsert,
  AiApiKeyShareQuery,
} from './ai-api-key.types.js';

interface AiApiKeyQueryRow {
  own_id?: string | null;
  own_enc?: string | null;
  shared_id?: string | null;
  shared_enc?: string | null;
  shared_model?: string | null;
}

function mapAiApiKeyRow(row: AiApiKeyQueryRow): AiApiKeyRow {
  return {
    own: row.own_id
      ? { id: row.own_id, ai_api_key_enc: row.own_enc ?? '' }
      : null,
    shared: row.shared_id
      ? {
          id: row.shared_id,
          ai_api_key_enc: row.shared_enc ?? '',
          model: row.shared_model ?? null,
        }
      : null,
  };
}

export async function getAiKeyRow(id: string): Promise<AiApiKeyRow | undefined> {
  const { rows } = await db.query(
    "SELECT ak.id AS own_id, ak.api_key_enc AS own_enc, oak.id AS shared_id, oak.api_key_enc AS shared_enc, s.model AS shared_model FROM users u LEFT JOIN ai_api_keys ak ON ak.user_id = u.id AND ak.provider = 'openai' LEFT JOIN ai_api_key_shares s ON s.target_user_id = u.id LEFT JOIN ai_api_keys oak ON oak.user_id = s.owner_user_id AND oak.provider = 'openai' WHERE u.id = $1",
    [id],
  );
  const row = rows[0] as AiApiKeyQueryRow | undefined;
  if (!row) return undefined;
  return mapAiApiKeyRow(row);
}

export async function setAiKey(entry: AiApiKeyUpsert): Promise<void> {
  await db.query(
    "INSERT INTO ai_api_keys (user_id, provider, api_key_enc) VALUES ($1, 'openai', $2) ON CONFLICT (user_id, provider) DO UPDATE SET api_key_enc = EXCLUDED.api_key_enc",
    [entry.userId, entry.apiKeyEnc],
  );
}

export async function clearAiKey(id: string): Promise<void> {
  await db.query(
    "DELETE FROM ai_api_keys WHERE user_id = $1 AND provider = 'openai'",
    [id],
  );
}

export async function shareAiKey(entry: AiApiKeyShareUpsert): Promise<void> {
  await db.query(
    "INSERT INTO ai_api_key_shares (owner_user_id, target_user_id, model) VALUES ($1, $2, $3) ON CONFLICT (target_user_id) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id, model = EXCLUDED.model",
    [entry.ownerUserId, entry.targetUserId, entry.model],
  );
}

export async function revokeAiKeyShare(entry: AiApiKeyShareQuery): Promise<void> {
  await db.query(
    'DELETE FROM ai_api_key_shares WHERE owner_user_id = $1 AND target_user_id = $2',
    [entry.ownerUserId, entry.targetUserId],
  );
}

export async function hasAiKeyShare(entry: AiApiKeyShareQuery): Promise<boolean> {
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
  return rows.map((r: { target_user_id: string }) => r.target_user_id);
}
