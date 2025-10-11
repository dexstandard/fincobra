import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callAi } from '../src/services/ai-service.js';
import {
  developerInstructions,
  rebalanceResponseSchema,
} from '../src/agents/main-trader.js';
import { type RebalancePrompt } from '../src/agents/main-trader.types.js';
import { LimitOrderStatus } from '../src/repos/limit-orders.types.js';

const createResponseMock = vi.fn();

vi.mock('openai', () => {
  class APIError extends Error {
    status?: number;
    error?: unknown;

    constructor(message?: string, options?: { status?: number; error?: unknown }) {
      super(message);
      this.status = options?.status;
      this.error = options?.error;
    }
  }

  return {
    default: vi.fn(() => ({
      responses: {
        create: createResponseMock,
      },
      models: {
        list: vi.fn(),
      },
    })),
    APIError,
  };
});

beforeEach(() => {
  createResponseMock.mockReset();
  createResponseMock.mockResolvedValue({ output: [] });
});

describe('callAi structured output', () => {
  it('includes json schema in request', async () => {
    const prompt: RebalancePrompt = {
      policy: { floor: { USDT: 20 } },
      cash: 'USDT',
      portfolio: {
        ts: new Date().toISOString(),
        positions: [{ sym: 'USDT', qty: 1, priceUsdt: 1, valueUsdt: 1 }],
      },
      routes: [],
      marketData: {},
      reviewInterval: '1h',
      previousReports: [
        { ts: '2025-01-01T00:00:00.000Z', shortReport: 'p1' },
        {
          ts: '2025-01-02T00:00:00.000Z',
          orders: [
            {
              symbol: 'BTCUSDT',
              side: 'BUY',
              qty: 1,
              price: 99.5,
              status: LimitOrderStatus.Filled,
            },
          ],
          shortReport: 'p2',
        },
      ],
    };
    await callAi(
      'openai',
      'gpt-test',
      developerInstructions,
      rebalanceResponseSchema,
      prompt,
      'key',
    );
    expect(createResponseMock).toHaveBeenCalledTimes(1);
    const [body] = createResponseMock.mock.calls[0];
    expect(body.instructions).toMatch(
      /You are a day-trading portfolio manager. Autonomously choose ANY trading strategy, set target allocations, and optionally place orders consistent with those targets/i,
    );
    expect(body.instructions).toMatch(/On error, return error message/i);
    expect(typeof body.input).toBe('string');
    const parsed = JSON.parse(body.input as string);
    expect(parsed.previousReports).toEqual([
      { ts: '2025-01-01T00:00:00.000Z', shortReport: 'p1' },
      {
        ts: '2025-01-02T00:00:00.000Z',
        orders: [
          {
            symbol: 'BTCUSDT',
            side: 'BUY',
            qty: 1,
            price: 99.5,
            status: LimitOrderStatus.Filled,
          },
        ],
        shortReport: 'p2',
      },
    ]);
    expect(body.tools).toBeUndefined();
    expect(body.text?.format?.type).toBe('json_schema');
    const anyOf =
      body.text?.format?.schema?.properties?.result?.anyOf ?? undefined;
    expect(Array.isArray(anyOf)).toBe(true);
    expect(anyOf).toHaveLength(2);
  });

  it('adds web search tool when enabled', async () => {
    const prompt: RebalancePrompt = {
      reviewInterval: '1h',
      policy: { floor: {} },
      cash: 'USDT',
      portfolio: {
        ts: new Date().toISOString(),
        positions: [{ sym: 'USDT', qty: 1, priceUsdt: 1, valueUsdt: 1 }],
      },
      routes: [],
      marketData: {},
    };
    await callAi(
      'openai',
      'gpt-test',
      developerInstructions,
      rebalanceResponseSchema,
      prompt,
      'key',
      true,
    );
    expect(createResponseMock).toHaveBeenCalledTimes(1);
    const [body] = createResponseMock.mock.calls[0];
    expect(body.tools).toEqual([{ type: 'web_search' }]);
  });
});
