import { describe, it, expect, vi } from 'vitest';
import { callAi } from '../src/util/ai.js';
import { developerInstructions, rebalanceResponseSchema } from '../src/agents/main-trader.js';
import { type RebalancePrompt } from '../src/agents/main-trader.types.js';
import { LimitOrderStatus } from '../src/repos/limit-orders.types.js';

describe('callAi structured output', () => {
  it('includes json schema in request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, text: async () => '' });
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;
    const prompt: RebalancePrompt = {
      instructions: 'inst',
      policy: { floor: { USDT: 20 } },
      portfolio: {
        ts: new Date().toISOString(),
        positions: [
          { sym: 'USDT', qty: 1, priceUsdt: 1, valueUsdt: 1 },
        ],
      },
      routes: [],
      marketData: {},
      reviewInterval: '1h',
      previousReports: [
        { datetime: '2025-01-01T00:00:00.000Z', shortReport: 'p1' },
        {
          datetime: '2025-01-02T00:00:00.000Z',
          orders: [
            {
              symbol: 'BTCUSDT',
              side: 'BUY',
              quantity: 1,
              status: LimitOrderStatus.Filled,
              datetime: '2025-01-02T00:00:00.000Z',
            },
          ],
          shortReport: 'p2',
        },
      ],
    };
    await callAi('gpt-test', developerInstructions, rebalanceResponseSchema, prompt, 'key');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(opts.body).toBe(JSON.stringify(body));
    expect(body.instructions).toMatch(/- Decide which limit orders to place/i);
    expect(body.instructions).toMatch(/On error, return \{error:"message"\}/i);
    expect(typeof body.input).toBe('string');
    const parsed = JSON.parse(body.input);
    expect(parsed.previousReports).toEqual([
      { datetime: '2025-01-01T00:00:00.000Z', shortReport: 'p1' },
      {
        datetime: '2025-01-02T00:00:00.000Z',
        orders: [
          {
            symbol: 'BTCUSDT',
            side: 'BUY',
            quantity: 1,
            status: LimitOrderStatus.Filled,
            datetime: '2025-01-02T00:00:00.000Z',
          },
        ],
        shortReport: 'p2',
      },
    ]);
    expect(body.tools).toBeUndefined();
    expect(body.text.format.type).toBe('json_schema');
    const anyOf = body.text.format.schema.properties.result.anyOf;
    expect(Array.isArray(anyOf)).toBe(true);
    expect(anyOf).toHaveLength(2);
    (globalThis as any).fetch = originalFetch;
  });

  it('adds web search tool when enabled', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, text: async () => '' });
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;
    await callAi(
      'gpt-test',
      developerInstructions,
      rebalanceResponseSchema,
      {},
      'key',
      true,
    );
    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.tools).toEqual([{ type: 'web_search_preview' }]);
    (globalThis as any).fetch = originalFetch;
  });
});
