import { describe, it, expect, vi } from 'vitest';
import { mockLogger } from './helpers.js';

vi.mock('../src/util/tokens.js', () => ({
  isStablecoin: (sym: string) => sym === 'USDC',
}));

const insertReviewRawLogMock = vi.hoisted(() => vi.fn());
vi.mock('../src/repos/agent-review-raw-log.js', () => ({
  insertReviewRawLog: insertReviewRawLogMock,
}));

vi.mock('../src/repos/news.js', () => ({
  getNewsByToken: vi.fn().mockResolvedValue([{ title: 't', link: 'l' }]),
}));

vi.mock('../src/util/ai.js', () => ({
  callAi: vi.fn().mockResolvedValue('res'),
  extractJson: () => ({ comment: 'summary for BTC', score: 1 }),
}));

import { runNewsAnalyst } from '../src/agents/news-analyst.js';

describe('news analyst step', () => {
  it('fetches news summaries', async () => {
    const prompt: any = {
      reports: [
        { token: 'BTC', news: null, tech: null },
        { token: 'USDC', news: null, tech: null },
      ],
    };
    await runNewsAnalyst(
      { log: mockLogger(), model: 'gpt', apiKey: 'key', portfolioId: 'agent1' },
      prompt,
    );
    const report = prompt.reports?.find((r: any) => r.token === 'BTC');
    expect(report?.news).toEqual({ comment: 'summary for BTC', score: 1 });
    const stable = prompt.reports?.find((r: any) => r.token === 'USDC');
    expect(stable?.news).toBeNull();
    expect(insertReviewRawLogMock).toHaveBeenCalled();
  });
});
