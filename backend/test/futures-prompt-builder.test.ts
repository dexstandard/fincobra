import { describe, it, expect, beforeEach, vi } from 'vitest';

import { buildFuturesPrompt, clearFuturesPromptCaches } from '../src/services/prompt-builders/futures.js';
import type { ActivePortfolioWorkflow } from '../src/repos/portfolio-workflows.types.js';
import { mockLogger } from './helpers.js';

const { fetchWalletMock, fetchTickerMock, getRecentReviewResultsMock } = vi.hoisted(() => ({
  fetchWalletMock: vi.fn(),
  fetchTickerMock: vi.fn(),
  getRecentReviewResultsMock: vi.fn(),
}));

vi.mock('../src/services/exchange-gateway.js', () => ({
  getExchangeGateway: vi.fn().mockReturnValue({
    metadata: { fetchTicker: fetchTickerMock },
    futures: { fetchWallet: fetchWalletMock },
  }),
}));

vi.mock('../src/repos/review-result.js', () => ({
  getRecentReviewResults: getRecentReviewResultsMock,
}));

describe('buildFuturesPrompt', () => {
  const workflow: ActivePortfolioWorkflow = {
    id: 'wf1',
    userId: 'user1',
    model: 'gpt',
    aiProvider: 'openai',
    cashToken: 'USDT',
    tokens: [{ token: 'BTC', minAllocation: 0 }],
    risk: 'moderate',
    reviewInterval: '60m',
    agentInstructions: '',
    aiApiKeyId: null,
    aiApiKeyEnc: null,
    exchangeApiKeyId: 'ex1',
    manualRebalance: false,
    useEarn: false,
    startBalance: 2500,
    createdAt: new Date().toISOString(),
    portfolioId: 'portfolio1',
    mode: 'futures',
    futuresDefaultLeverage: 5,
    futuresMarginMode: 'cross',
  };

  beforeEach(() => {
    clearFuturesPromptCaches();
    fetchWalletMock.mockReset();
    fetchTickerMock.mockReset();
    getRecentReviewResultsMock.mockReset();

    fetchWalletMock.mockResolvedValue({
      accountType: 'UNIFIED',
      totalEquity: 1234.56,
      coins: [
        {
          asset: 'USDT',
          walletBalance: 1200,
          availableBalance: 1000,
          unrealizedPnl: 34.56,
        },
      ],
    });
    fetchTickerMock.mockResolvedValue({ symbol: 'BTCUSDT', price: 35123.45 });
    getRecentReviewResultsMock.mockResolvedValue([
      {
        id: 'r1',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        rebalance: false,
        shortReport: 'prev',
        log: JSON.stringify({ strategyName: 'Carry' }),
      },
    ]);
  });

  it('builds a futures prompt with cached market data', async () => {
    const prompt = await buildFuturesPrompt(workflow, 'binance', mockLogger());
    expect(prompt).toBeDefined();
    expect(prompt?.reviewInterval).toBe('PT1H');
    expect(prompt?.portfolio.walletBalanceUsd).toBeCloseTo(1234.56);
    expect(prompt?.portfolio.balances[0]).toEqual(
      expect.objectContaining({ asset: 'USDT', balance: 1200, availableBalance: 1000 }),
    );
    expect(prompt?.marketData?.markPrices?.BTCUSDT).toBeCloseTo(35123.45);
    expect(prompt?.policy?.maxLeverage).toBe(5);
    expect(fetchWalletMock).toHaveBeenCalledTimes(1);
    expect(fetchTickerMock).toHaveBeenCalledTimes(1);

    const second = await buildFuturesPrompt(workflow, 'binance', mockLogger());
    expect(second?.marketData?.markPrices?.BTCUSDT).toBeCloseTo(35123.45);
    expect(fetchWalletMock).toHaveBeenCalledTimes(1);
    expect(fetchTickerMock).toHaveBeenCalledTimes(1);
  });
});
