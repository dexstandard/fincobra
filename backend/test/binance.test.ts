import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchPairData, fetchPairInfo } from '../src/services/binance.js';

describe('fetchPairData', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches yearly klines and omits week/month slices', async () => {
    const yearData = Array.from({ length: 365 }, (_, i) => [i]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ price: '1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ bids: [], asks: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => yearData });
    vi.stubGlobal('fetch', fetchMock as any);

    const data = await fetchPairData('BTC', 'USDT');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(data.year).toEqual(yearData);
    expect('week' in data).toBe(false);
    expect('month' in data).toBe(false);
  });

  it('retries with reversed pair on invalid symbol', async () => {
    const errRes = {
      ok: false,
      text: async () => JSON.stringify({ code: -1121, msg: 'Invalid symbol.' }),
    } as any;
    const yearData = Array.from({ length: 365 }, (_, i) => [i]);
    const fetchMock = vi
      .fn()
      // initial invalid pair (4 calls)
      .mockResolvedValueOnce(errRes)
      .mockResolvedValueOnce(errRes)
      .mockResolvedValueOnce(errRes)
      .mockResolvedValueOnce(errRes)
      // reversed pair succeeds
      .mockResolvedValueOnce({ ok: true, json: async () => ({ price: '1' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bids: [], asks: [] }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => yearData });
    vi.stubGlobal('fetch', fetchMock as any);

    const data = await fetchPairData('USDT', 'BTC');
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(data.year).toEqual(yearData);
  });
});

describe('fetchPairInfo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches and caches exchange info', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        symbols: [
          {
            symbol: 'SOLBTC',
            baseAsset: 'SOL',
            quoteAsset: 'BTC',
            quantityPrecision: 3,
            pricePrecision: 5,
            filters: [
              { filterType: 'LOT_SIZE', stepSize: '0.001' },
              { filterType: 'PRICE_FILTER', tickSize: '0.00001' },
              { filterType: 'NOTIONAL', minNotional: '10' },
            ],
          },
        ],
      }),
    } as any);
    vi.stubGlobal('fetch', fetchMock);
    const info1 = await fetchPairInfo('SOL', 'BTC');
    expect(info1.symbol).toBe('SOLBTC');
    expect(info1.minNotional).toBe(10);
    const info2 = await fetchPairInfo('SOL', 'BTC');
    expect(info1).toBe(info2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries with reversed pair on invalid symbol', async () => {
    const errRes = {
      ok: false,
      text: async () => JSON.stringify({ code: -1121, msg: 'Invalid symbol.' }),
    } as any;
    const okRes = {
      ok: true,
      json: async () => ({ symbols: [{ symbol: 'ETHBTC', baseAsset: 'ETH', quoteAsset: 'BTC', quantityPrecision: 3, pricePrecision: 5, filters: [] }] }),
    } as any;
    const fetchMock = vi.fn().mockResolvedValueOnce(errRes).mockResolvedValueOnce(okRes);
    vi.stubGlobal('fetch', fetchMock);
    const info = await fetchPairInfo('BTC', 'ETH');
    expect(info.symbol).toBe('ETHBTC');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
