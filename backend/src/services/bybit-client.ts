import { createHmac } from 'node:crypto';

import type { ExchangeKeyVerificationResult } from './binance-client.types.js';

const RECV_WINDOW = '5000';

function signPayload(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export async function verifyBybitKey(
  key: string,
  secret: string,
): Promise<ExchangeKeyVerificationResult> {
  try {
    const timestamp = Date.now().toString();
    const queryParams = new URLSearchParams({ accountType: 'UNIFIED' });
    const signaturePayload = `${timestamp}${key}${RECV_WINDOW}${queryParams.toString()}`;
    const signature = signPayload(secret, signaturePayload);
    const response = await fetch(
      `https://api.bybit.com/v5/account/wallet-balance?${queryParams.toString()}`,
      {
        headers: {
          'X-BAPI-API-KEY': key,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': RECV_WINDOW,
          'X-BAPI-SIGN': signature,
          'X-BAPI-SIGN-TYPE': '2',
        },
      },
    );
    const body = (await response.json().catch(() => undefined)) as
      | { retCode?: number; retMsg?: string }
      | undefined;
    if (!response.ok) {
      return {
        ok: false,
        reason: body && typeof body.retMsg === 'string' ? body.retMsg : undefined,
      };
    }
    if (!body || typeof body.retCode !== 'number') {
      return { ok: false };
    }
    if (body.retCode !== 0) {
      return {
        ok: false,
        reason: typeof body.retMsg === 'string' ? body.retMsg : undefined,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : undefined,
    };
  }
}
