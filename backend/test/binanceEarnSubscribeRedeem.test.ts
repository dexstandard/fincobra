import { describe, it, expect, vi, afterEach } from 'vitest';
import { encrypt } from '../src/util/crypto.js';
import { insertUser } from './repos/users.js';
import { setBinanceKey } from '../src/repos/exchange-api-keys.js';
import { createHmac } from 'node:crypto';
import {
  subscribeEarnFlexible,
  redeemEarnFlexible,
} from '../src/services/binance.js';

describe('binance earn subscribe/redeem helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('subscribes to flexible earn', async () => {
    const key = 'binKeySub123';
    const secret = 'binSecretSub123';
    const encKey = encrypt(key, process.env.KEY_PASSWORD!);
    const encSecret = encrypt(secret, process.env.KEY_PASSWORD!);
    const id = await insertUser('11');
    await setBinanceKey({
      userId: id,
      apiKeyEnc: encKey,
      apiSecretEnc: encSecret,
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) });
    vi.stubGlobal('fetch', fetchMock as any);

    await subscribeEarnFlexible(id, { productId: 'PRD1', amount: 1.5 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://api.binance.com/sapi/v1/simple-earn/flexible/subscribe',
    );
    expect(options.method).toBe('POST');
    expect(options.headers['X-MBX-APIKEY']).toBe(key);
    const params = new URLSearchParams(options.body as string);
    const query = (options.body as string).split('&signature=')[0];
    const expectedSig = createHmac('sha256', secret)
      .update(query)
      .digest('hex');
    expect(params.get('signature')).toBe(expectedSig);
    expect(params.get('productId')).toBe('PRD1');
    expect(params.get('amount')).toBe('1.5');
  });

  it('redeems from flexible earn', async () => {
    const key = 'binKeyRed123';
    const secret = 'binSecretRed123';
    const encKey = encrypt(key, process.env.KEY_PASSWORD!);
    const encSecret = encrypt(secret, process.env.KEY_PASSWORD!);
    const id = await insertUser('12');
    await setBinanceKey({
      userId: id,
      apiKeyEnc: encKey,
      apiSecretEnc: encSecret,
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) });
    vi.stubGlobal('fetch', fetchMock as any);

    await redeemEarnFlexible(id, { productId: 'PRD2', amount: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://api.binance.com/sapi/v1/simple-earn/flexible/redeem',
    );
    expect(options.method).toBe('POST');
    expect(options.headers['X-MBX-APIKEY']).toBe(key);
    const params = new URLSearchParams(options.body as string);
    const query = (options.body as string).split('&signature=')[0];
    const expectedSig = createHmac('sha256', secret)
      .update(query)
      .digest('hex');
    expect(params.get('signature')).toBe(expectedSig);
    expect(params.get('productId')).toBe('PRD2');
    expect(params.get('amount')).toBe('2');
  });
});

