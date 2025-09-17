import { describe, it, expect, vi, afterEach } from 'vitest';
import { encrypt } from '../src/util/crypto.js';
import { insertUser } from './repos/users.js';
import { setBinanceKey } from '../src/repos/exchange-api-keys.js';
import { createHmac } from 'node:crypto';
import {
  createLimitOrder,
  cancelOrder,
} from '../src/services/binance.js';

describe('binance order helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a signed limit order', async () => {
    const key = 'binKey123456';
    const secret = 'binSecret123456';
    const encKey = encrypt(key, process.env.KEY_PASSWORD!);
    const encSecret = encrypt(secret, process.env.KEY_PASSWORD!);
    const id1 = await insertUser('1');
    await setBinanceKey({
      userId: id1,
      apiKeyEnc: encKey,
      apiSecretEnc: encSecret,
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ orderId: 1 }) });
    vi.stubGlobal('fetch', fetchMock as any);

    await createLimitOrder(id1, {
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: 0.1,
      price: 20000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.binance.com/api/v3/order');
    expect(options.method).toBe('POST');
    expect(options.headers['X-MBX-APIKEY']).toBe(key);

    const params = new URLSearchParams(options.body as string);
    const query = (options.body as string).split('&signature=')[0];
    const expectedSig = createHmac('sha256', secret)
      .update(query)
      .digest('hex');
    expect(params.get('signature')).toBe(expectedSig);
  });

  it('cancels a signed order', async () => {
    const key = 'binKey654321';
    const secret = 'binSecret654321';
    const encKey = encrypt(key, process.env.KEY_PASSWORD!);
    const encSecret = encrypt(secret, process.env.KEY_PASSWORD!);
    const id2 = await insertUser('2');
    await setBinanceKey({
      userId: id2,
      apiKeyEnc: encKey,
      apiSecretEnc: encSecret,
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ status: 'canceled' }) });
    vi.stubGlobal('fetch', fetchMock as any);

    await cancelOrder(id2, { symbol: 'BTCUSDT', orderId: 42 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    const parsedUrl = new URL(url);
    expect(parsedUrl.origin + parsedUrl.pathname).toBe(
      'https://api.binance.com/api/v3/order'
    );
    expect(options.method).toBe('DELETE');
    expect(options.headers['X-MBX-APIKEY']).toBe(key);

    const query = parsedUrl.search.slice(1).split('&signature=')[0];
    const signature = parsedUrl.searchParams.get('signature');
    const expectedSig = createHmac('sha256', secret)
      .update(query)
      .digest('hex');
    expect(signature).toBe(expectedSig);
  });
});

