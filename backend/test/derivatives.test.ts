import { describe, it, expect, vi } from 'vitest';
import { fetchOrderBook } from '../src/services/binance-client.js';

describe('fetchOrderBook', () => {
  it('uses spot order book endpoint', async () => {
    const mock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        bids: [['1', '1']],
        asks: [['2', '1']],
      }),
    } as any);

    await fetchOrderBook('BTCUSDT');

    expect(mock).toHaveBeenCalledWith(
      'https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=5',
    );

    mock.mockRestore();
  });
});
