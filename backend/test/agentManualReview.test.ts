import { describe, it, expect, vi } from 'vitest';
import buildServer from '../src/server.js';
import { insertUser } from './repos/users.js';
import { insertPortfolioWorkflow } from './repos/portfolio-workflows.js';
import { authCookies } from './helpers.js';

const reviewWorkflowPortfolioMock = vi.fn<(
  log: unknown,
  workflowId: string,
) => Promise<unknown>>(() => Promise.resolve());
vi.mock('../src/workflows/portfolio-review.js', () => ({
  reviewWorkflowPortfolio: reviewWorkflowPortfolioMock,
}));

describe('manual review endpoint', () => {
  it('triggers portfolio review', async () => {
    const app = await buildServer();
    const userId = await insertUser('1');
    const agent = await insertPortfolioWorkflow({
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
    const workflowId = agent.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/portfolio-workflows/${workflowId}/review`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(reviewWorkflowPortfolioMock).toHaveBeenCalledTimes(1);
    expect(reviewWorkflowPortfolioMock.mock.calls[0][1]).toBe(workflowId);
    await app.close();
  });

  it('returns error when agent is already reviewing', async () => {
    const app = await buildServer();
    const userId = await insertUser('2');
    const agent = await insertPortfolioWorkflow({
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
    const workflowId = agent.id;
    reviewWorkflowPortfolioMock.mockRejectedValueOnce(
      new Error('Agent is already reviewing portfolio'),
    );
    const res = await app.inject({
      method: 'POST',
      url: `/api/portfolio-workflows/${workflowId}/review`,
      cookies: authCookies(userId),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Agent is already reviewing portfolio' });
    await app.close();
  });
});
