import { db } from '../db/index.js';
import { convertKeysToCamelCase } from '../util/object-case.js';
import type {
  ExchangeApiKeyDetails,
  ExchangeApiKeyUpsert,
} from './exchange-api-keys.types.js';

async function getExchangeKey(
  userId: string,
  provider: 'binance' | 'bybit',
): Promise<ExchangeApiKeyDetails | null> {
  const { rows } = await db.query(
    `SELECT id, api_key_enc, api_secret_enc
       FROM exchange_keys
      WHERE user_id = $1 AND provider = $2
      LIMIT 1`,
    [userId, provider],
  );
  const row = rows[0];
  if (!row) return null;
  return convertKeysToCamelCase(row) as ExchangeApiKeyDetails;
}

async function setExchangeKey(
  provider: 'binance' | 'bybit',
  entry: ExchangeApiKeyUpsert,
): Promise<void> {
  await db.query(
    "INSERT INTO exchange_keys (user_id, provider, api_key_enc, api_secret_enc) VALUES ($3, $4, $1, $2) ON CONFLICT (user_id, provider) DO UPDATE SET api_key_enc = EXCLUDED.api_key_enc, api_secret_enc = EXCLUDED.api_secret_enc",
    [entry.apiKeyEnc, entry.apiSecretEnc, entry.userId, provider],
  );
}

async function clearExchangeKey(
  userId: string,
  provider: 'binance' | 'bybit',
): Promise<void> {
  await db.query(
    'DELETE FROM exchange_keys WHERE user_id = $1 AND provider = $2',
    [userId, provider],
  );
}

export async function getBinanceKey(
  userId: string,
): Promise<ExchangeApiKeyDetails | null> {
  return getExchangeKey(userId, 'binance');
}

export async function setBinanceKey(entry: ExchangeApiKeyUpsert): Promise<void> {
  await setExchangeKey('binance', entry);
}

export async function clearBinanceKey(id: string): Promise<void> {
  await clearExchangeKey(id, 'binance');
}

export async function getBybitKey(
  userId: string,
): Promise<ExchangeApiKeyDetails | null> {
  return getExchangeKey(userId, 'bybit');
}

export async function setBybitKey(entry: ExchangeApiKeyUpsert): Promise<void> {
  await setExchangeKey('bybit', entry);
}

export async function clearBybitKey(id: string): Promise<void> {
  await clearExchangeKey(id, 'bybit');
}
