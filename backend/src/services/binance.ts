import { createHmac } from 'node:crypto';

import { getBinanceKeyRow } from '../repos/api-keys.js';
import { decrypt } from '../util/crypto.js';
import { env } from '../util/env.js';

type UserCreds = { key: string; secret: string };

interface LotSizeFilter {
  filterType: 'LOT_SIZE';
  stepSize: string;
}

interface PriceFilter {
  filterType: 'PRICE_FILTER';
  tickSize: string;
}

interface NotionalFilter {
  filterType: 'NOTIONAL' | 'MIN_NOTIONAL';
  minNotional: string;
}

type SymbolFilter =
  | LotSizeFilter
  | PriceFilter
  | NotionalFilter
  | { filterType: string };

interface SymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  quantityPrecision?: number;
  pricePrecision?: number;
  filters: SymbolFilter[];
}

interface ExchangeInfoResponse {
  symbols?: SymbolInfo[];
}

export type PairInfo = {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  quantityPrecision: number;
  pricePrecision: number;
  minNotional: number;
};

export type Kline = [
  number,
  string,
  string,
  string,
  string,
  string,
  ...unknown[],
];

export type OpenOrder = { orderId: number };

interface FearGreedResponse {
  data?: { value: string; value_classification: string }[];
  value?: string;
  value_classification?: string;
}

const pairInfoCache = new Map<string, PairInfo>();

function precisionFromStep(step: string): number {
  if (!step.includes('.')) return 0;
  return step.split('.')[1].replace(/0+$/, '').length;
}

export async function fetchPairInfo(
  token1: string,
  token2: string,
): Promise<PairInfo> {
  const key = [token1.toUpperCase(), token2.toUpperCase()].sort().join('-');
  const cached = pairInfoCache.get(key);
  if (cached) return cached;
  const symbols = [
    `${token1}${token2}`.toUpperCase(),
    `${token2}${token1}`.toUpperCase(),
  ];
  let lastErr: Error | undefined;
  for (const symbol of symbols) {
    const res = await fetch(
      `https://api.binance.com/api/v3/exchangeInfo?symbol=${symbol}`,
    );
    if (!res.ok) {
      const body = await res.text();
      lastErr = new Error(
        `failed to fetch exchange info: ${res.status} ${body}`,
      );
      if (/Invalid symbol/i.test(body)) continue;
      throw lastErr;
    }
    const json = (await res.json()) as ExchangeInfoResponse;
    const info = json.symbols?.[0];
    if (!info) continue;
    const lot = info.filters?.find(
      (f): f is LotSizeFilter => f.filterType === 'LOT_SIZE',
    );
    const priceF = info.filters?.find(
      (f): f is PriceFilter => f.filterType === 'PRICE_FILTER',
    );
    const notionalF = info.filters?.find(
      (f): f is NotionalFilter =>
        f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL',
    );
    const pair: PairInfo = {
      symbol: info.symbol,
      baseAsset: info.baseAsset,
      quoteAsset: info.quoteAsset,
      quantityPrecision:
        typeof info.quantityPrecision === 'number'
          ? info.quantityPrecision
          : lot
            ? precisionFromStep(lot.stepSize)
            : 8,
      pricePrecision:
        typeof info.pricePrecision === 'number'
          ? info.pricePrecision
          : priceF
            ? precisionFromStep(priceF.tickSize)
            : 8,
      minNotional: notionalF ? Number(notionalF.minNotional) : 0,
    };
    pairInfoCache.set(key, pair);
    return pair;
  }
  throw lastErr ?? new Error('failed to fetch exchange info');
}

async function getUserCreds(id: string): Promise<UserCreds | null> {
  const row = await getBinanceKeyRow(id);
  if (!row?.binance_api_key_enc || !row.binance_api_secret_enc) return null;
  const key = decrypt(row.binance_api_key_enc, env.KEY_PASSWORD);
  const secret = decrypt(row.binance_api_secret_enc, env.KEY_PASSWORD);
  return { key, secret };
}

export function parseBinanceError(
  err: unknown,
): { code?: number; msg?: string } {
  if (err instanceof Error) {
    const match = err.message.match(/\{.+\}$/);
    if (match) {
      try {
        const body = JSON.parse(match[0]);
        const res: { code?: number; msg?: string } = {};
        if (typeof body.code === 'number') res.code = body.code;
        if (typeof body.msg === 'string') res.msg = body.msg;
        return res;
      } catch {}
    }
  }
  return {};
}

export async function fetchAccount(id: string) {
  const creds = await getUserCreds(id);
  if (!creds) return null;
  const timestamp = Date.now();
  const query = `timestamp=${timestamp}`;
  const signature = createHmac('sha256', creds.secret)
    .update(query)
    .digest('hex');
  const accountRes = await fetch(
    `https://api.binance.com/api/v3/account?${query}&signature=${signature}`,
    { headers: { 'X-MBX-APIKEY': creds.key } },
  );
  if (!accountRes.ok) throw new Error('failed to fetch account');
  return (await accountRes.json()) as {
    balances: { asset: string; free: string; locked: string }[];
  };
}

export async function fetchEarnFlexibleBalance(id: string, asset: string) {
  const creds = await getUserCreds(id);
  if (!creds) return null;
  const timestamp = Date.now();
  const params = new URLSearchParams({
    asset: asset.toUpperCase(),
    timestamp: String(timestamp),
  });
  const signature = createHmac('sha256', creds.secret)
    .update(params.toString())
    .digest('hex');
  const res = await fetch(
    `https://api.binance.com/sapi/v1/simple-earn/flexible/position?${params.toString()}&signature=${signature}`,
    { headers: { 'X-MBX-APIKEY': creds.key } },
  );
  if (!res.ok) throw new Error('failed to fetch earn balance');
  const json = (await res.json()) as {
    rows?: { totalAmount: string }[];
  };
  return json.rows?.reduce((sum, r) => sum + Number(r.totalAmount), 0) ?? 0;
}

export async function subscribeEarnFlexible(
  id: string,
  opts: { productId: string; amount: number },
) {
  const creds = await getUserCreds(id);
  if (!creds) return null;
  const timestamp = Date.now();
  const params = new URLSearchParams({
    productId: opts.productId,
    amount: String(opts.amount),
    timestamp: String(timestamp),
  });
  const signature = createHmac('sha256', creds.secret)
    .update(params.toString())
    .digest('hex');
  params.append('signature', signature);
  const res = await fetch(
    'https://api.binance.com/sapi/v1/simple-earn/flexible/subscribe',
    {
      method: 'POST',
      headers: {
        'X-MBX-APIKEY': creds.key,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`failed to subscribe earn: ${res.status} ${body}`);
  }
  return res.json();
}

export async function redeemEarnFlexible(
  id: string,
  opts: { productId: string; amount: number },
) {
  const creds = await getUserCreds(id);
  if (!creds) return null;
  const timestamp = Date.now();
  const params = new URLSearchParams({
    productId: opts.productId,
    amount: String(opts.amount),
    timestamp: String(timestamp),
  });
  const signature = createHmac('sha256', creds.secret)
    .update(params.toString())
    .digest('hex');
  params.append('signature', signature);
  const res = await fetch(
    'https://api.binance.com/sapi/v1/simple-earn/flexible/redeem',
    {
      method: 'POST',
      headers: {
        'X-MBX-APIKEY': creds.key,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`failed to redeem earn: ${res.status} ${body}`);
  }
  return res.json();
}

export async function fetchTotalBalanceUsd(id: string) {
  const account = await fetchAccount(id);
  if (!account) return null;
  let total = 0;
  for (const b of account.balances) {
    const amount = Number(b.free) + Number(b.locked);
    if (!amount) continue;
    if (b.asset === 'USDT' || b.asset === 'USDC') {
      total += amount;
      continue;
    }
    const priceRes = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${b.asset}USDT`,
    );
    if (!priceRes.ok) continue;
    const priceJson = (await priceRes.json()) as { price: string };
    total += amount * Number(priceJson.price);
  }
  return total;
}

export async function fetchTokensBalanceUsd(id: string, tokens: string[]) {
  const account = await fetchAccount(id);
  if (!account) return null;
  const wanted = new Set(tokens.map((t) => t.toUpperCase()));
  let total = 0;
  for (const b of account.balances) {
    if (!wanted.has(b.asset.toUpperCase())) continue;
    const amount = Number(b.free) + Number(b.locked);
    if (!amount) continue;
    if (b.asset === 'USDT' || b.asset === 'USDC') {
      total += amount;
      continue;
    }
    const priceRes = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${b.asset}USDT`,
    );
    if (!priceRes.ok) continue;
    const priceJson = (await priceRes.json()) as { price: string };
    total += amount * Number(priceJson.price);
  }
  return total;
}

export async function createLimitOrder(
  id: string,
  opts: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
  },
) {
  const creds = await getUserCreds(id);
  if (!creds) return null;
  const timestamp = Date.now();
  const params = new URLSearchParams({
    symbol: opts.symbol.toUpperCase(),
    side: opts.side,
    type: 'LIMIT',
    timeInForce: 'GTC',
    quantity: String(opts.quantity),
    price: String(opts.price),
    timestamp: String(timestamp),
  });
  const signature = createHmac('sha256', creds.secret)
    .update(params.toString())
    .digest('hex');
  params.append('signature', signature);
  const res = await fetch(`https://api.binance.com/api/v3/order`, {
    method: 'POST',
    headers: {
      'X-MBX-APIKEY': creds.key,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`failed to create order: ${res.status} ${body}`);
  }
  return res.json();
}

export async function cancelOrder(
  id: string,
  opts: { symbol: string; orderId: number },
) {
  const creds = await getUserCreds(id);
  if (!creds) return null;
  const timestamp = Date.now();
  const params = new URLSearchParams({
    symbol: opts.symbol.toUpperCase(),
    orderId: String(opts.orderId),
    timestamp: String(timestamp),
  });
  const signature = createHmac('sha256', creds.secret)
    .update(params.toString())
    .digest('hex');
  params.append('signature', signature);
  const res = await fetch(
    `https://api.binance.com/api/v3/order?${params.toString()}`,
    {
      method: 'DELETE',
      headers: { 'X-MBX-APIKEY': creds.key },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`failed to cancel order: ${res.status} ${body}`);
  }
  return res.json();
}

export async function fetchOrder(
  id: string,
  opts: { symbol: string; orderId: number },
) {
  const creds = await getUserCreds(id);
  if (!creds) return null;
  const timestamp = Date.now();
  const params = new URLSearchParams({
    symbol: opts.symbol.toUpperCase(),
    orderId: String(opts.orderId),
    timestamp: String(timestamp),
  });
  const signature = createHmac('sha256', creds.secret)
    .update(params.toString())
    .digest('hex');
  params.append('signature', signature);
  const res = await fetch(
    `https://api.binance.com/api/v3/order?${params.toString()}`,
    { headers: { 'X-MBX-APIKEY': creds.key } },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`failed to fetch order: ${res.status} ${body}`);
  }
  return res.json() as Promise<{ status?: string } | null>;
}

export async function cancelOpenOrders(id: string, opts: { symbol: string }) {
  const creds = await getUserCreds(id);
  if (!creds) return null;
  const timestamp = Date.now();
  const params = new URLSearchParams({
    symbol: opts.symbol.toUpperCase(),
    timestamp: String(timestamp),
  });
  const signature = createHmac('sha256', creds.secret)
    .update(params.toString())
    .digest('hex');
  params.append('signature', signature);
  const res = await fetch(
    `https://api.binance.com/api/v3/openOrders?${params.toString()}`,
    {
      method: 'DELETE',
      headers: { 'X-MBX-APIKEY': creds.key },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`failed to cancel open orders: ${res.status} ${body}`);
  }
  return res.json();
}

export async function fetchOpenOrders(id: string, opts: { symbol?: string }) {
  const creds = await getUserCreds(id);
  if (!creds) return null;
  const timestamp = Date.now();
  const params = new URLSearchParams({ timestamp: String(timestamp) });
  if (opts.symbol) params.append('symbol', opts.symbol.toUpperCase());
  const signature = createHmac('sha256', creds.secret)
    .update(params.toString())
    .digest('hex');
  params.append('signature', signature);
  const res = await fetch(
    `https://api.binance.com/api/v3/openOrders?${params.toString()}`,
    { headers: { 'X-MBX-APIKEY': creds.key } },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`failed to fetch open orders: ${res.status} ${body}`);
  }
  return res.json() as Promise<OpenOrder[]>;
}

async function fetchSymbolData(symbol: string) {
  const [priceRes, depthRes, dayRes, yearRes] = await Promise.all([
    fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`),
    fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=5`),
    fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`),
    fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=365`,
    ),
  ]);
  const responses = {
    price: priceRes,
    depth: depthRes,
    day: dayRes,
    year: yearRes,
  } as const;
  for (const [name, res] of Object.entries(responses)) {
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`failed to fetch ${name} data: ${res.status} ${body}`);
    }
  }
  const priceJson = (await priceRes.json()) as { price: string };
  const depthJson = (await depthRes.json()) as {
    bids: [string, string][];
    asks: [string, string][];
  };
  const yearJson = (await yearRes.json()) as Kline[];
  return {
    symbol,
    currentPrice: Number(priceJson.price),
    orderBook: {
      bids: depthJson.bids.map(([p, q]) => [Number(p), Number(q)]),
      asks: depthJson.asks.map(([p, q]) => [Number(p), Number(q)]),
    },
    day: await dayRes.json(),
    year: yearJson,
  };
}

export async function fetchPairData(token1: string, token2: string) {
  const symbols = [
    `${token1}${token2}`.toUpperCase(),
    `${token2}${token1}`.toUpperCase(),
  ];
  let lastErr: unknown;
  for (const symbol of symbols) {
    try {
      return await fetchSymbolData(symbol);
    } catch (err) {
      lastErr = err;
      if (err instanceof Error && /Invalid symbol/i.test(err.message)) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchMarketTimeseries(symbol: string) {
  const [minRes, hourRes, monthRes] = await Promise.all([
    fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=60`,
    ),
    fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=24`,
    ),
    fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1M&limit=24`,
    ),
  ]);

  const responses = {
    minute_60: minRes,
    hourly_24h: hourRes,
    monthly_24m: monthRes,
  } as const;
  for (const [name, res] of Object.entries(responses)) {
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`failed to fetch ${name} data: ${res.status} ${body}`);
    }
  }

  const [minJson, hourJson, monthJson] = (await Promise.all([
    minRes.json(),
    hourRes.json(),
    monthRes.json(),
  ])) as [Kline[], Kline[], Kline[]];

  return {
    minute_60: minJson.map(
      (k) =>
        [Number(k[0]), Number(k[1]), Number(k[4]), Number(k[5])] as [
          number,
          number,
          number,
          number,
        ],
    ),
    hourly_24h: hourJson.map(
      (k) =>
        [Number(k[0]), Number(k[1]), Number(k[4]), Number(k[5])] as [
          number,
          number,
          number,
          number,
        ],
    ),
    monthly_24m: monthJson.map(
      (k) =>
        [Number(k[0]), Number(k[1]), Number(k[4])] as [number, number, number],
    ),
  };
}

export type FearGreedIndex = { value: number; classification: string };

export async function fetchFearGreedIndex(): Promise<FearGreedIndex> {
  const res = await fetch('https://api.alternative.me/fng/');
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `failed to fetch fear & greed index: ${res.status} ${body}`,
    );
  }
  const json = (await res.json()) as FearGreedResponse;
  const value = Number(json?.data?.[0]?.value ?? json?.value);
  const classification =
    json?.data?.[0]?.value_classification ?? json?.value_classification ?? '';
  return { value, classification };
}
