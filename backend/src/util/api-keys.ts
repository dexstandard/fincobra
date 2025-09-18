import { createHmac } from 'node:crypto';
import { encrypt, decrypt } from './crypto.js';
import { env } from './env.js';
import { errorResponse, type ErrorResponse } from './errorMessages.js';

export enum ApiKeyType {
  Ai = 'ai',
  Binance = 'binance',
}

export async function verifyApiKey(
  type: ApiKeyType,
  key: string,
  secret?: string,
): Promise<boolean | string> {
  if (type === ApiKeyType.Ai) {
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
  try {
    const ts1 = Date.now();
    const q1 = `timestamp=${ts1}`;
    const sig1 = createHmac('sha256', secret!).update(q1).digest('hex');
    const res1 = await fetch(
      `https://api.binance.com/api/v3/account?${q1}&signature=${sig1}`,
      { headers: { 'X-MBX-APIKEY': key } },
    );
    if (!res1.ok) {
      try {
        const body = await res1.json();
        return typeof body.msg === 'string' ? body.msg : false;
      } catch {
        return false;
      }
    }

    const ts2 = Date.now();
    const q2 =
      `symbol=BTCUSDT&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=1&timestamp=${ts2}`;
    const sig2 = createHmac('sha256', secret!).update(q2).digest('hex');
    const res2 = await fetch(
      `https://api.binance.com/api/v3/order/test?${q2}&signature=${sig2}`,
      {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': key },
      },
    );
    if (res2.ok) return true;
    try {
      const body = await res2.json();
      if (res2.status === 400 && typeof body.code === 'number') return true;
      return typeof body.msg === 'string' ? body.msg : false;
    } catch {
      return false;
    }
  } catch (err) {
    return err instanceof Error ? err.message : false;
  }
}

export function encryptKey(value: string) {
  return encrypt(value, env.KEY_PASSWORD);
}

export function decryptKey(value: string) {
  return decrypt(value, env.KEY_PASSWORD);
}

export interface ValidationErr {
  code: number;
  body: ErrorResponse;
}

export function ensureUser(row: unknown): ValidationErr | null {
  if (!row) return { code: 404, body: errorResponse('user not found') };
  return null;
}

export function ensureKeyAbsent(row: any, fields: string[]): ValidationErr | null {
  if (fields.some((f) => row?.[f]))
    return { code: 400, body: errorResponse('key exists') };
  return null;
}

export function ensureKeyPresent(row: any, fields: string[]): ValidationErr | null {
  if (fields.some((f) => !row?.[f]))
    return { code: 404, body: errorResponse('not found') };
  return null;
}
