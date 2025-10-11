import { describe, it, expect, beforeEach, vi } from 'vitest';
import { executeFuturesDecision } from '../src/services/futures-execution.js';
import { mockLogger } from './helpers.js';
import { insertUser } from './repos/users.js';
import { insertPortfolioWorkflow } from './repos/portfolio-workflows.js';
import { insertReviewResult } from './repos/review-result.js';
import {
  clearFuturesOrders,
  getFuturesOrders,
  getFuturesOrdersByReviewResult,
} from './repos/futures-orders.js';
import { FuturesOrderStatus } from '../src/repos/futures-orders.types.js';

const getExchangeGatewayMock = vi.hoisted(() => vi.fn());

vi.mock('../src/services/exchange-gateway.js', () => ({
  getExchangeGateway: getExchangeGatewayMock,
}));


describe('executeFuturesDecision', () => {
  beforeEach(async () => {
    await clearFuturesOrders();
    getExchangeGatewayMock.mockReset();
  });

  it('executes futures actions through the exchange gateway', async () => {
    const log = mockLogger();
    const userId = await insertUser('50');
    const workflow = await insertPortfolioWorkflow({
      userId,
      model: 'm',
      status: 'active',
      startBalance: null,
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'USDT', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      manualRebalance: false,
      useEarn: true,
      mode: 'futures',
      futuresDefaultLeverage: 5,
      futuresMarginMode: 'cross',
    });
    const reviewResultId = await insertReviewResult({
      portfolioWorkflowId: workflow.id,
      log: '',
    });

    const futuresModule = {
      setLeverage: vi.fn().mockResolvedValue(undefined),
      openPosition: vi.fn().mockResolvedValue(undefined),
      setStopLoss: vi.fn().mockResolvedValue(undefined),
      setTakeProfit: vi.fn().mockResolvedValue(undefined),
    };

    getExchangeGatewayMock.mockReturnValue({
      metadata: { fetchMarket: vi.fn(), fetchTicker: vi.fn() },
      futures: futuresModule,
    } as any);

    const outcome = await executeFuturesDecision({
      userId,
      actions: [
        {
          symbol: 'BTCUSDT',
          positionSide: 'LONG',
          action: 'OPEN',
          type: 'LIMIT',
          quantity: 0.25,
          price: 100,
          leverage: 10,
          stopLoss: 90,
          takeProfit: 120,
        },
      ],
      reviewResultId,
      log,
      exchange: 'bybit',
      defaultLeverage: workflow.futuresDefaultLeverage,
      marginMode: workflow.futuresMarginMode,
    });

    expect(outcome).toEqual({ executed: 1, failed: 0, skipped: 0 });
    expect(futuresModule.setLeverage).toHaveBeenCalledWith(userId, {
      symbol: 'BTCUSDT',
      leverage: 10,
    });
    expect(futuresModule.openPosition).toHaveBeenCalledWith(userId, {
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      quantity: 0.25,
      type: 'LIMIT',
      price: 100,
      reduceOnly: false,
    });
    expect(futuresModule.setStopLoss).toHaveBeenCalledWith(userId, {
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      stopPrice: 90,
    });
    expect(futuresModule.setTakeProfit).toHaveBeenCalledWith(userId, {
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      stopPrice: 120,
    });

    const rows = await getFuturesOrders();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(FuturesOrderStatus.Executed);
    const planned = JSON.parse(rows[0].planned_json);
    expect(planned.exchange).toBe('bybit');
    expect(planned.leverage).toBe(10);
  });

  it('records failures when futures trading is unavailable', async () => {
    const log = mockLogger();
    const userId = await insertUser('51');
    const workflow = await insertPortfolioWorkflow({
      userId,
      model: 'm',
      status: 'active',
      startBalance: null,
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'USDT', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      manualRebalance: false,
      useEarn: true,
      mode: 'futures',
    });
    const reviewResultId = await insertReviewResult({
      portfolioWorkflowId: workflow.id,
      log: '',
    });

    getExchangeGatewayMock.mockReturnValue({
      metadata: { fetchMarket: vi.fn(), fetchTicker: vi.fn() },
      futures: undefined,
    } as any);

    const outcome = await executeFuturesDecision({
      userId,
      actions: [
        {
          symbol: 'ETHUSDT',
          positionSide: 'SHORT',
          action: 'OPEN',
          type: 'MARKET',
          quantity: 1,
        },
      ],
      reviewResultId,
      log,
      exchange: 'bybit',
    });

    expect(outcome).toEqual({ executed: 0, failed: 1, skipped: 0 });
    const rows = await getFuturesOrders();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(FuturesOrderStatus.Failed);
    expect(rows[0].failure_reason).toBe(
      'futures trading not supported for exchange',
    );
  });

  it('skips hold actions without calling the exchange', async () => {
    const log = mockLogger();
    const userId = await insertUser('52');
    const workflow = await insertPortfolioWorkflow({
      userId,
      model: 'm',
      status: 'active',
      startBalance: null,
      tokens: [
        { token: 'BTC', minAllocation: 10 },
        { token: 'USDT', minAllocation: 20 },
      ],
      risk: 'low',
      reviewInterval: '1h',
      agentInstructions: 'inst',
      manualRebalance: false,
      useEarn: true,
      mode: 'futures',
    });
    const reviewResultId = await insertReviewResult({
      portfolioWorkflowId: workflow.id,
      log: '',
    });

    const futuresModule = {
      setLeverage: vi.fn(),
      openPosition: vi.fn(),
      setStopLoss: vi.fn(),
      setTakeProfit: vi.fn(),
    };

    getExchangeGatewayMock.mockReturnValue({
      metadata: { fetchMarket: vi.fn(), fetchTicker: vi.fn() },
      futures: futuresModule,
    } as any);

    const outcome = await executeFuturesDecision({
      userId,
      actions: [
        {
          symbol: 'BTCUSDT',
          positionSide: 'LONG',
          action: 'HOLD',
          type: 'MARKET',
          quantity: 0.1,
        },
      ],
      reviewResultId,
      log,
      exchange: 'binance',
    });

    expect(outcome).toEqual({ executed: 0, failed: 0, skipped: 1 });
    expect(futuresModule.openPosition).not.toHaveBeenCalled();
    const rows = await getFuturesOrdersByReviewResult(reviewResultId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(FuturesOrderStatus.Skipped);
  });
});
