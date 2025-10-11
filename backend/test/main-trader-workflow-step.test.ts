import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockLogger } from './helpers.js';

const callAiMock = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve(
      JSON.stringify({
        output: [
          {
            id: 'msg_1',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  result: {
                    orders: [
                      {
                        pair: 'BTCUSDT',
                        token: 'BTC',
                        side: 'SELL',
                        qty: 1,
                        limitPrice: 25000,
                        basePrice: 25100,
                        maxPriceDriftPct: 0.01,
                      },
                    ],
                    shortReport: 'ok',
                  },
                }),
              },
            ],
          },
        ],
      }),
    ),
  ),
);

vi.mock('../src/services/ai-service.js', async () => {
  const actual = await vi.importActual<
    typeof import('../src/services/ai-service.js')
  >('../src/services/ai-service.js');
  return {
    ...actual,
    callAi: callAiMock,
  };
});

import { run, developerInstructions } from '../src/agents/main-trader.js';

describe('main trader step', () => {
  beforeEach(() => {
    callAiMock.mockClear();
  });

  it('returns decision from AI response', async () => {
    const prompt = {
      reviewInterval: '1h',
      policy: { floor: {} },
      cash: 'USDT',
      portfolio: { ts: new Date().toISOString(), positions: [] },
      routes: [],
      marketData: { currentPrice: 0, minNotional: 10 },
      reports: [{ token: 'BTC', news: null, tech: null }],
    };
    const decision = await run(
      {
        log: mockLogger(),
        model: 'gpt',
        apiKey: 'key',
        portfolioId: 'agent1',
        aiProvider: 'openai',
      },
      prompt,
    );
    expect(decision?.orders).toEqual([
      {
        pair: 'BTCUSDT',
        token: 'BTC',
        side: 'SELL',
        qty: 1,
        limitPrice: 25000,
        basePrice: 25100,
        maxPriceDriftPct: 0.01,
      },
    ]);
    expect(callAiMock).toHaveBeenCalled();
    const [, , instructionsArg] = callAiMock.mock.calls[0];
    expect(instructionsArg).toBe(developerInstructions);
  });

  it('prefers prompt instructions when provided', async () => {
    const prompt = {
      reviewInterval: '1h',
      policy: { floor: {} },
      cash: 'USDT',
      portfolio: { ts: new Date().toISOString(), positions: [] },
      routes: [],
      marketData: {},
    };
    await run(
      {
        log: mockLogger(),
        model: 'gpt',
        apiKey: 'key',
        portfolioId: 'agent1',
        aiProvider: 'openai',
      },
      prompt,
      'custom developer instructions',
    );
    const [, , instructionsArg] = callAiMock.mock.calls[0];
    expect(instructionsArg).toBe('custom developer instructions');
  });
});
