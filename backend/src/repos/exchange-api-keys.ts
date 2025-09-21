import { db } from '../db/index.js';
import { convertKeysToCamelCase } from '../util/objectCase.js';
import type {
  BinanceApiKeyDetails,
  BinanceApiKeyUpsert,
} from './exchange-api-keys.types.js';

export async function getBinanceKey(
  userId: string,
): Promise<BinanceApiKeyDetails | null> {
  const { rows } = await db.query(
    `SELECT id, api_key_enc, api_secret_enc
       FROM exchange_keys
      WHERE user_id = $1 AND provider = 'binance'
      LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return convertKeysToCamelCase(row) as BinanceApiKeyDetails;
}

export async function setBinanceKey(entry: BinanceApiKeyUpsert): Promise<void> {
  await db.query(
    "INSERT INTO exchange_keys (user_id, provider, api_key_enc, api_secret_enc) VALUES ($3, 'binance', $1, $2) ON CONFLICT (user_id, provider) DO UPDATE SET api_key_enc = EXCLUDED.api_key_enc, api_secret_enc = EXCLUDED.api_secret_enc",
    [entry.apiKeyEnc, entry.apiSecretEnc, entry.userId],
  );
}

export async function clearBinanceKey(id: string): Promise<void> {
  await db.query(
    "DELETE FROM exchange_keys WHERE user_id = $1 AND provider = 'binance'",
    [id],
  );
}
