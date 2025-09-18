import { db } from '../db/index.js';
import { convertKeysToCamelCase } from '../util/objectCase.js';
import type {
  BinanceApiKey,
  BinanceApiKeyUpsert,
} from './exchange-api-keys.types.js';

export async function getBinanceKeyRow(
  id: string,
): Promise<BinanceApiKey | undefined> {
  const { rows } = await db.query(
    `SELECT ek.id,
            ek.api_key_enc AS binance_api_key_enc,
            ek.api_secret_enc AS binance_api_secret_enc
       FROM users u
       LEFT JOIN exchange_keys ek ON ek.user_id = u.id AND ek.provider = 'binance'
      WHERE u.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return undefined;
  const entity = convertKeysToCamelCase(row) as {
    id: string | null;
    binanceApiKeyEnc: string | null;
    binanceApiSecretEnc: string | null;
  };
  return {
    id: entity.id ?? null,
    binanceApiKeyEnc: entity.binanceApiKeyEnc ?? null,
    binanceApiSecretEnc: entity.binanceApiSecretEnc ?? null,
  };
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
