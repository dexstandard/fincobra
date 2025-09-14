import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';

const callAiMock = vi.fn(() =>
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
);

vi.mock('../src/util/ai.js', () => ({
  callAi: callAiMock,
  developerInstructions: '',
  rebalanceResponseSchema: {},
}));

function createLogger(): FastifyBaseLogger {
  const log = { info: () => {}, error: () => {}, child: () => log } as unknown as FastifyBaseLogger;
  return log;
}

describe('main trader step', () => {
  beforeEach(() => {
    callAiMock.mockClear();
  });

  it('returns decision from AI response', async () => {
    const { run } = await import('../src/agents/main-trader.js');
    const prompt = {
      instructions: '',
      policy: { floor: {} },
      portfolio: { ts: new Date().toISOString(), positions: [] },
      marketData: { currentPrice: 0, minNotional: 10 },
      reports: [{ token: 'BTC', news: null, tech: null }],
    };
    const decision = await run(
      {
        log: createLogger(),
        model: 'gpt',
        apiKey: 'key',
        portfolioId: 'agent1',
      },
      prompt,
    );
    expect(decision?.orders).toEqual([
      { pair: 'BTCUSDT', token: 'BTC', side: 'SELL', quantity: 1 },
    ]);
    expect(callAiMock).toHaveBeenCalled();
  });
});

