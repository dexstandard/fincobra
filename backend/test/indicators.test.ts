import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchTokenIndicators } from '../src/services/indicators.js';
import { fetchPairData } from '../src/services/binance.js';

vi.mock('../src/services/binance.js', () => ({
  fetchPairData: vi.fn(),
  fetchPairInfo: vi.fn().mockResolvedValue({ minNotional: 0 }),
}));

describe('fetchTokenIndicators', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns indicators object for token', async () => {
    function makeYear(mult = 1) {
      return Array.from({ length: 200 }, (_, i) => {
        const close = (i + 1) * mult;
        return [0, close - 0.5, close + 0.5, close - 0.5, close, 1000 + i + 1];
      });
    }
    (fetchPairData as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (token: string) => {
        if (token === 'BTC') {
          return { symbol: `${token}USDT`, currentPrice: 400, day: {}, year: makeYear(2) };
        }
        return { symbol: `${token}USDT`, currentPrice: 200, day: {}, year: makeYear(1) };
      },
    );

    const hourData = Array.from({ length: 200 }, (_, i) => [0, 0, 0, 0, i + 1, 1000 + i + 1]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => hourData })) as any);

    const data = await fetchTokenIndicators('SOL');
    expect(data.ret['1h']).toBeCloseTo(0.5, 1);
    expect(data.sma_dist['20']).toBeCloseTo(4.99, 2);
    expect(data.volume.z_1h).toBeCloseTo(1.8, 1);
    expect(data.corr.BTC_30d).toBeCloseTo(1, 5);
    expect(data.regime.BTC).toBe('trend');
    expect(data.osc.rsi_14).toBeCloseTo(100, 5);
    expect(data.osc.stoch_k).toBeCloseTo(96.43, 2);
    expect(data.osc.stoch_d).toBeCloseTo(96.43, 2);
  });
});

