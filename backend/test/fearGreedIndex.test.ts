import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchFearGreedIndex } from '../src/services/binance.js';

describe('fetchFearGreedIndex', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses value and classification', async () => {
    const mockJson = {
      data: [{ value: '55', value_classification: 'Greed' }],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => mockJson });
    vi.stubGlobal('fetch', fetchMock as any);
    const res = await fetchFearGreedIndex();
    expect(fetchMock).toHaveBeenCalledWith('https://api.alternative.me/fng/');
    expect(res).toEqual({ value: 55, classification: 'Greed' });
  });

  it('throws on non-ok response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, text: async () => 'err' });
    vi.stubGlobal('fetch', fetchMock as any);
    await expect(fetchFearGreedIndex()).rejects.toThrow(
      'failed to fetch fear & greed index: 500 err',
    );
  });
});
