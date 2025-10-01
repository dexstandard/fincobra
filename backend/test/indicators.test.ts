import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchMarketOverview } from '../src/services/indicators.js';
import { fetchPairData } from '../src/services/binance-client.js';

vi.mock('../src/services/binance-client.js', () => ({
  fetchPairData: vi.fn(),
  fetchPairInfo: vi.fn().mockResolvedValue({ minNotional: 0 }),
  fetchOrder: vi.fn().mockResolvedValue(undefined),
}));

function makeYear(mult = 1) {
  return Array.from({ length: 400 }, (_, i) => {
    const close = (i + 1) * mult;
    return [0, close - 0.5, close + 0.5, close - 0.5, close, 1000 + i + 1];
  });
}

describe('fetchMarketOverview', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns market overview payload with tokens', async () => {
    (fetchPairData as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (token: string) => {
        if (token === 'BTC') {
          return {
            symbol: `${token}USDT`,
            currentPrice: 400,
            orderBook: { bids: [[399, 150]], asks: [[401, 200]] },
            day: {},
            year: makeYear(2),
          };
        }
        return {
          symbol: `${token}USDT`,
          currentPrice: 200,
          orderBook: { bids: [[199, 100]], asks: [[201, 120]] },
          day: {},
          year: makeYear(1),
        };
      },
    );

    const fetchStub = vi.fn(async (url: string) => {
      const u = new URL(url, 'https://api.binance.com');
      const limit = Number(u.searchParams.get('limit') ?? '10');
      const interval = u.searchParams.get('interval');
      const base = interval === '1w' ? 50 : interval === '1d' ? 100 : 200;
      const data = Array.from({ length: limit }, (_, i) => [
        0,
        base + i,
        base + i + 1,
        base + i - 1,
        base + i,
        1_000 + i,
      ]);
      return { ok: true, json: async () => data } as any;
    });
    vi.stubGlobal('fetch', fetchStub);

    const payload = await fetchMarketOverview(['SOL']);
    expect(payload.schema_version).toBe('market_overview.v2');
    expect(payload.market_overview.SOL).toBeDefined();
    expect(payload.market_overview.BTC).toBeDefined();
    const sol = payload.market_overview.SOL;
    expect(sol.trend_basis.sma_periods).toEqual([50, 200]);
    expect(typeof sol.ret1h).toBe('number');
    expect(sol.risk_flags).toEqual(
      expect.objectContaining({
        overbought: expect.any(Boolean),
        oversold: expect.any(Boolean),
        vol_spike: expect.any(Boolean),
        thin_book: expect.any(Boolean),
      }),
    );
    expect(fetchStub).toHaveBeenCalled();
  });
});
