import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchMarketTimeseries } from '../src/services/binance.js';

describe('fetchMarketTimeseries', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches 1m, 1h and 1M klines', async () => {
    const minute = [[1, '1', '0', '0', '2', '4']];
    const hour = [[1, '1', '0', '0', '2', '4']];
    const month = [[1, '1', '0', '0', '2', '4']];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => minute })
      .mockResolvedValueOnce({ ok: true, json: async () => hour })
      .mockResolvedValueOnce({ ok: true, json: async () => month });
    vi.stubGlobal('fetch', fetchMock as any);
    const res = await fetchMarketTimeseries('BTCUSDT');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.minute_60[0]).toEqual([1, 1, 2, 4]);
    expect(res.hourly_24h[0]).toEqual([1, 1, 2, 4]);
    expect(res.monthly_24m[0]).toEqual([1, 1, 2]);
  });
});
