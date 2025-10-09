import { createHmac } from 'node:crypto';

import { getBybitKey } from '../repos/exchange-api-keys.js';
import { decryptKey } from '../util/crypto.js';
import type { ExchangeKeyVerificationResult } from './binance-client.types.js';
import type {
  BybitUserCreds,
  BybitWalletBalance,
} from './bybit-client.types.js';

const API_BASE_URL = 'https://api.bybit.com';
const RECV_WINDOW = '5000';

interface BybitApiResponse<T> {
  retCode?: number;
  retMsg?: string;
  result?: T;
}

interface SignedRequestOptions {
  method: 'GET' | 'POST';
  path: string;
  params?: URLSearchParams;
  body?: Record<string, unknown>;
}

interface FetchResponseLike {
  ok: boolean;
  status?: number;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
}

interface SignedRequestResult<T> {
  body: BybitApiResponse<T>;
  status: number;
  ok: boolean;
  rawBody: string;
}

interface RawWalletBalanceCoin {
  coin: string;
  equity?: string;
  walletBalance?: string;
  availableToWithdraw?: string;
  availableToTransfer?: string;
  availableToTrade?: string;
  unrealisedPnl?: string;
}

interface RawWalletBalanceEntry {
  accountType?: string;
  totalEquity?: string;
  totalWalletBalance?: string;
  totalAvailableBalance?: string;
  totalMarginBalance?: string;
  coin?: RawWalletBalanceCoin[];
}

interface WalletBalanceResult {
  list?: RawWalletBalanceEntry[];
}

interface FuturesPositionParams {
  symbol: string;
  positionSide: 'LONG' | 'SHORT';
  quantity: number;
  type?: 'MARKET' | 'LIMIT';
  price?: number;
  reduceOnly?: boolean;
  hedgeMode?: boolean;
  positionIdx?: 0 | 1 | 2;
}

interface FuturesStopParams {
  symbol: string;
  positionSide: 'LONG' | 'SHORT';
  stopPrice: number;
  hedgeMode?: boolean;
  positionIdx?: 0 | 1 | 2;
}

const FUTURES_CATEGORY = 'linear';

function signPayload(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function buildSignaturePayload(
  key: string,
  timestamp: string,
  data: string,
): string {
  return `${timestamp}${key}${RECV_WINDOW}${data}`;
}

function buildSignedHeaders(
  creds: BybitUserCreds,
  payload: string,
  timestamp: string,
  hasJsonBody: boolean,
) {
  const headers: Record<string, string> = {
    'X-BAPI-API-KEY': creds.key,
    'X-BAPI-TIMESTAMP': timestamp,
    'X-BAPI-RECV-WINDOW': RECV_WINDOW,
    'X-BAPI-SIGN': signPayload(creds.secret, payload),
    'X-BAPI-SIGN-TYPE': '2',
  };
  if (hasJsonBody) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

async function parseResponseBody<T>(
  res: FetchResponseLike,
): Promise<{ body: BybitApiResponse<T>; raw: string }> {
  let raw = '';
  if (typeof res.text === 'function') {
    try {
      raw = await res.text();
      if (raw) {
        const parsed = JSON.parse(raw) as BybitApiResponse<T>;
        return { body: parsed, raw };
      }
    } catch {
      // ignore and fallback to json()
    }
  }
  if (typeof res.json === 'function') {
    try {
      const parsed = (await res.json()) as BybitApiResponse<T>;
      return { body: parsed, raw: raw || JSON.stringify(parsed) };
    } catch {
      // ignore and fallback to empty body
    }
  }
  return { body: {} as BybitApiResponse<T>, raw };
}

async function sendSignedRequest<T>(
  creds: BybitUserCreds,
  options: SignedRequestOptions,
): Promise<SignedRequestResult<T>> {
  const timestamp = Date.now().toString();
  const queryString = options.params?.toString() ?? '';
  const bodyString = options.body ? JSON.stringify(options.body) : '';
  const signaturePayload = buildSignaturePayload(
    creds.key,
    timestamp,
    options.method === 'GET' ? queryString : bodyString,
  );
  const headers = buildSignedHeaders(
    creds,
    signaturePayload,
    timestamp,
    !!options.body,
  );
  const url =
    options.method === 'GET' && queryString
      ? `${API_BASE_URL}${options.path}?${queryString}`
      : `${API_BASE_URL}${options.path}`;
  const res = await fetch(url, {
    method: options.method,
    headers,
    body: options.body ? bodyString : undefined,
  });
  const { body, raw } = await parseResponseBody<T>(res as FetchResponseLike);
  return {
    body,
    status: typeof res.status === 'number' ? res.status : 0,
    ok: res.ok,
    rawBody: raw,
  };
}

async function requestOrThrow<T>(
  creds: BybitUserCreds,
  options: SignedRequestOptions,
  errorMessage: string,
): Promise<T> {
  const response = await sendSignedRequest<T>(creds, options);
  if (!response.ok) {
    const status = response.status || 0;
    const reason =
      typeof response.body.retMsg === 'string' && response.body.retMsg.length > 0
        ? response.body.retMsg
        : response.rawBody || 'unknown error';
    throw new Error(`${errorMessage}: [${status}] ${reason}`);
  }
  if (typeof response.body.retCode !== 'number') {
    throw new Error(`${errorMessage}: malformed response`);
  }
  if (response.body.retCode !== 0) {
    const reason =
      typeof response.body.retMsg === 'string' && response.body.retMsg.length > 0
        ? response.body.retMsg
        : 'unknown error';
    throw new Error(`${errorMessage}: [${response.body.retCode}] ${reason}`);
  }
  return (response.body.result ?? {}) as T;
}

async function getUserCreds(id: string): Promise<BybitUserCreds | null> {
  const entry = await getBybitKey(id);
  if (!entry) return null;
  return {
    key: decryptKey(entry.apiKeyEnc),
    secret: decryptKey(entry.apiSecretEnc),
  };
}

export async function withBybitUserCreds<T>(
  id: string,
  fn: (creds: BybitUserCreds) => Promise<T>,
): Promise<T | null> {
  const creds = await getUserCreds(id);
  if (!creds) return null;
  return fn(creds);
}

export async function verifyBybitKey(
  key: string,
  secret: string,
): Promise<ExchangeKeyVerificationResult> {
  try {
    const creds: BybitUserCreds = { key, secret };
    const response = await sendSignedRequest<WalletBalanceResult>(creds, {
      method: 'GET',
      path: '/v5/account/wallet-balance',
      params: new URLSearchParams({ accountType: 'UNIFIED' }),
    });
    if (!response.ok) {
      return {
        ok: false,
        reason:
          typeof response.body.retMsg === 'string'
            ? response.body.retMsg
            : undefined,
      };
    }
    if (typeof response.body.retCode !== 'number') {
      return { ok: false };
    }
    if (response.body.retCode !== 0) {
      return {
        ok: false,
        reason:
          typeof response.body.retMsg === 'string'
            ? response.body.retMsg
            : undefined,
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

function mapWalletEntry(entry: RawWalletBalanceEntry): BybitWalletBalance {
  const coins = entry.coin ?? [];
  return {
    accountType: entry.accountType ?? 'UNIFIED',
    totalEquity: entry.totalEquity,
    totalWalletBalance: entry.totalWalletBalance,
    totalAvailableBalance: entry.totalAvailableBalance,
    totalMarginBalance: entry.totalMarginBalance,
    coin: coins.map((c) => ({
      coin: c.coin,
      equity: c.equity,
      walletBalance: c.walletBalance,
      availableToWithdraw: c.availableToWithdraw,
      availableToTransfer: c.availableToTransfer,
      availableToTrade: c.availableToTrade,
      unrealisedPnl: c.unrealisedPnl,
    })),
  };
}

function mapOpenSide(positionSide: 'LONG' | 'SHORT'): 'Buy' | 'Sell' {
  return positionSide === 'LONG' ? 'Buy' : 'Sell';
}

function mapCloseSide(positionSide: 'LONG' | 'SHORT'): 'Buy' | 'Sell' {
  return positionSide === 'LONG' ? 'Sell' : 'Buy';
}

function mapPositionIndex(positionSide: 'LONG' | 'SHORT'): 1 | 2 {
  return positionSide === 'LONG' ? 1 : 2;
}

export async function fetchFuturesWalletBalance(
  userId: string,
): Promise<BybitWalletBalance | null> {
  return withBybitUserCreds(userId, async (creds) => {
    const result = await requestOrThrow<WalletBalanceResult>(
      creds,
      {
        method: 'GET',
        path: '/v5/account/wallet-balance',
        params: new URLSearchParams({ accountType: 'UNIFIED' }),
      },
      'failed to fetch Bybit futures wallet balance',
    );
    const entry = result.list?.[0];
    if (!entry) {
      return {
        accountType: 'UNIFIED',
        coin: [],
      };
    }
    return mapWalletEntry(entry);
  });
}

export async function setBybitFuturesLeverage(
  userId: string,
  symbol: string,
  leverage: number,
) {
  return withBybitUserCreds(userId, async (creds) =>
    requestOrThrow<Record<string, unknown>>(
      creds,
      {
        method: 'POST',
        path: '/v5/position/set-leverage',
        body: {
          category: FUTURES_CATEGORY,
          symbol: symbol.toUpperCase(),
          buyLeverage: String(leverage),
          sellLeverage: String(leverage),
        },
      },
      'failed to set Bybit futures leverage',
    ),
  );
}

export async function openBybitFuturesPosition(
  userId: string,
  params: FuturesPositionParams,
) {
  return withBybitUserCreds(userId, async (creds) => {
    const isReduceOnly = params.reduceOnly === true;
    const orderType = params.type ?? 'MARKET';
    const body: Record<string, unknown> = {
      category: FUTURES_CATEGORY,
      symbol: params.symbol.toUpperCase(),
      side: isReduceOnly
        ? mapCloseSide(params.positionSide)
        : mapOpenSide(params.positionSide),
      orderType: orderType === 'LIMIT' ? 'Limit' : 'Market',
      qty: String(params.quantity),
    };

    const shouldOmitPositionIdx =
      params.hedgeMode === false && params.positionIdx === undefined;
    const positionIdx = shouldOmitPositionIdx
      ? undefined
      : params.positionIdx !== undefined
        ? params.positionIdx
        : mapPositionIndex(params.positionSide);

    if (positionIdx !== undefined) {
      body.positionIdx = positionIdx;
    }

    if (orderType === 'LIMIT') {
      if (params.price === undefined) {
        throw new Error('price is required for LIMIT futures orders');
      }
      body.price = String(params.price);
      body.timeInForce = 'GTC';
    }

    if (isReduceOnly) {
      body.reduceOnly = true;
    }

    return requestOrThrow<Record<string, unknown>>(
      creds,
      {
        method: 'POST',
        path: '/v5/order/create',
        body,
      },
      'failed to open Bybit futures position',
    );
  });
}

async function updateTradingStop(
  userId: string,
  params: FuturesStopParams,
  field: 'stopLoss' | 'takeProfit',
  triggerField: 'slTriggerBy' | 'tpTriggerBy',
  errorMessage: string,
) {
  return withBybitUserCreds(userId, async (creds) =>
    requestOrThrow<Record<string, unknown>>(
      creds,
      {
        method: 'POST',
        path: '/v5/position/trading-stop',
        body: {
          category: FUTURES_CATEGORY,
          symbol: params.symbol.toUpperCase(),
          [field]: String(params.stopPrice),
          [triggerField]: 'LastPrice',
          ...(params.hedgeMode === false && params.positionIdx === undefined
            ? {}
            : {
                positionIdx:
                  params.positionIdx !== undefined
                    ? params.positionIdx
                    : mapPositionIndex(params.positionSide),
              }),
        },
      },
      errorMessage,
    ),
  );
}

export async function setBybitFuturesStopLoss(
  userId: string,
  params: FuturesStopParams,
) {
  return updateTradingStop(
    userId,
    params,
    'stopLoss',
    'slTriggerBy',
    'failed to set Bybit futures stop loss',
  );
}

export async function setBybitFuturesTakeProfit(
  userId: string,
  params: FuturesStopParams,
) {
  return updateTradingStop(
    userId,
    params,
    'takeProfit',
    'tpTriggerBy',
    'failed to set Bybit futures take profit',
  );
}
