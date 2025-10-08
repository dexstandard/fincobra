import {
  appendSignature,
  createTimestampedParams,
  withUserCreds,
} from './binance-client.js';
import type { BinanceUserCreds } from './binance-client.types.js';

const FUTURES_API_BASE_URL = 'https://fapi.binance.com';

interface FuturesPostOptions {
  path: string;
  params: Record<string, string>;
  errorMessage: string;
}

interface FuturesPositionParams {
  symbol: string;
  positionSide: 'LONG' | 'SHORT';
  quantity: number;
  type?: 'MARKET' | 'LIMIT';
  price?: number;
  reduceOnly?: boolean;
}

interface FuturesStopParams {
  symbol: string;
  positionSide: 'LONG' | 'SHORT';
  stopPrice: number;
}

async function postSignedFuturesRequest(
  creds: BinanceUserCreds,
  options: FuturesPostOptions,
): Promise<Record<string, unknown>> {
  const params = createTimestampedParams(options.params);
  appendSignature(creds.secret, params);
  const res = await fetch(`${FUTURES_API_BASE_URL}${options.path}`, {
    method: 'POST',
    headers: {
      'X-MBX-APIKEY': creds.key,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${options.errorMessage}: ${res.status} ${body}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

function mapOpenSide(positionSide: 'LONG' | 'SHORT'): 'BUY' | 'SELL' {
  return positionSide === 'LONG' ? 'BUY' : 'SELL';
}

function mapCloseSide(positionSide: 'LONG' | 'SHORT'): 'BUY' | 'SELL' {
  return positionSide === 'LONG' ? 'SELL' : 'BUY';
}

export async function setFuturesLeverage(
  userId: string,
  symbol: string,
  leverage: number,
) {
  return withUserCreds(userId, async (creds) =>
    postSignedFuturesRequest(creds, {
      path: '/fapi/v1/leverage',
      errorMessage: 'failed to set futures leverage',
      params: {
        symbol: symbol.toUpperCase(),
        leverage: String(leverage),
      },
    }),
  );
}

export async function openFuturesPosition(
  userId: string,
  params: FuturesPositionParams,
) {
  return withUserCreds(userId, async (creds) => {
    const requestParams: Record<string, string> = {
      symbol: params.symbol.toUpperCase(),
      side: mapOpenSide(params.positionSide),
      positionSide: params.positionSide,
      type: params.type ?? 'MARKET',
      quantity: String(params.quantity),
    };

    if (requestParams.type === 'LIMIT') {
      if (params.price === undefined) {
        throw new Error('price is required for LIMIT futures orders');
      }
      requestParams.price = String(params.price);
      requestParams.timeInForce = 'GTC';
    }

    if (params.reduceOnly) {
      requestParams.reduceOnly = 'true';
    }

    return postSignedFuturesRequest(creds, {
      path: '/fapi/v1/order',
      errorMessage: 'failed to open futures position',
      params: requestParams,
    });
  });
}

export async function setFuturesStopLoss(
  userId: string,
  params: FuturesStopParams,
) {
  return withUserCreds(userId, async (creds) =>
    postSignedFuturesRequest(creds, {
      path: '/fapi/v1/order',
      errorMessage: 'failed to set futures stop loss',
      params: {
        symbol: params.symbol.toUpperCase(),
        side: mapCloseSide(params.positionSide),
        positionSide: params.positionSide,
        type: 'STOP_MARKET',
        stopPrice: String(params.stopPrice),
        closePosition: 'true',
      },
    }),
  );
}

export async function setFuturesTakeProfit(
  userId: string,
  params: FuturesStopParams,
) {
  return withUserCreds(userId, async (creds) =>
    postSignedFuturesRequest(creds, {
      path: '/fapi/v1/order',
      errorMessage: 'failed to set futures take profit',
      params: {
        symbol: params.symbol.toUpperCase(),
        side: mapCloseSide(params.positionSide),
        positionSide: params.positionSide,
        type: 'TAKE_PROFIT_MARKET',
        stopPrice: String(params.stopPrice),
        closePosition: 'true',
      },
    }),
  );
}
