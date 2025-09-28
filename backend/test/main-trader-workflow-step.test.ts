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
                text: JSON.stringify({
                  result: {
                    orders: [
                      {
                        pair: 'BTCUSDT',
                        token: 'BTC',
                        side: 'SELL',
                        quantity: 1,
                        limitPrice: 25000,
                        basePrice: 25100,
                        maxPriceDivergencePct: 0.01,
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

vi.mock('../src/services/openai-client.js', () => ({
  callAi: callAiMock,
}));

import { run } from '../src/agents/main-trader.js';

describe('main trader step', () => {
  beforeEach(() => {
    callAiMock.mockClear();
  });

  it('returns decision from AI response', async () => {
    const prompt = {
      instructions: '',
      policy: { floor: {} },
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
      },
      prompt,
    );
    expect(decision?.orders).toEqual([
      {
        pair: 'BTCUSDT',
        token: 'BTC',
        side: 'SELL',
        quantity: 1,
        limitPrice: 25000,
        basePrice: 25100,
        maxPriceDivergencePct: 0.01,
      },
    ]);
    expect(callAiMock).toHaveBeenCalled();
  });
});
