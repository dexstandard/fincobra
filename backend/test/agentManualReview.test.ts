import { describe, it, expect, vi } from 'vitest';
import buildServer from '../src/server.js';
import { insertUser } from './repos/users.js';
import { insertAgent } from './repos/portfolio-workflow.js';
import { authCookies } from './helpers.js';

const reviewAgentPortfolioMock = vi.fn<(
  log: unknown,
  agentId: string,
) => Promise<unknown>>(() => Promise.resolve());
vi.mock('../src/workflows/portfolio-review.js', () => ({
  reviewAgentPortfolio: reviewAgentPortfolioMock,
}));

describe('manual review endpoint', () => {
  it('triggers portfolio review', async () => {
    const app = await buildServer();
    const userId = await insertUser('1');
    const agent = await insertAgent({
      userId,
      model: 'gpt',
      status: 'active',
      startBalance: null,
      name: 'A',
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'ETH', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      manualRebalance: false,
      useEarn: true,
    });
    const agentId = agent.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/portfolio-workflows/${agentId}/review`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(reviewAgentPortfolioMock).toHaveBeenCalledTimes(1);
    expect(reviewAgentPortfolioMock.mock.calls[0][1]).toBe(agentId);
    await app.close();
  });

  it('returns error when agent is already reviewing', async () => {
    const app = await buildServer();
    const userId = await insertUser('2');
    const agent = await insertAgent({
      userId,
      model: 'gpt',
      status: 'active',
      startBalance: null,
      name: 'A2',
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'ETH', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      manualRebalance: false,
      useEarn: true,
    });
    const agentId = agent.id;
    reviewAgentPortfolioMock.mockRejectedValueOnce(
      new Error('Agent is already reviewing portfolio'),
    );
    const res = await app.inject({
      method: 'POST',
      url: `/api/portfolio-workflows/${agentId}/review`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Agent is already reviewing portfolio' });
    await app.close();
  });
});
