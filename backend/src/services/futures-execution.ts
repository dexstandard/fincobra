import { randomUUID } from 'crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { FuturesTraderAction } from '../agents/futures-trader.types.js';
import {
  insertFuturesOrder,
} from '../repos/futures-orders.js';
import { FuturesOrderStatus } from '../repos/futures-orders.types.js';
import type {
  PortfolioWorkflowFuturesMarginMode,
} from '../repos/portfolio-workflows.types.js';
import {
  getExchangeGateway,
  type SupportedExchange,
} from './exchange-gateway.js';

interface ExecuteFuturesDecisionOptions {
  userId: string;
  actions: FuturesTraderAction[];
  reviewResultId: string;
  log: FastifyBaseLogger;
  exchange?: SupportedExchange;
  defaultLeverage?: number | null;
  marginMode?: PortfolioWorkflowFuturesMarginMode | null;
}

export interface ExecuteFuturesDecisionResult {
  executed: number;
  failed: number;
  skipped: number;
}

const MAX_LEVERAGE = 125;
const MIN_LEVERAGE = 1;

function clampLeverage(value: number): number {
  return Math.max(MIN_LEVERAGE, Math.min(MAX_LEVERAGE, Math.round(value)));
}

function toPositiveNumber(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function normalizeSymbol(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

function resolveReduceOnly(action: FuturesTraderAction): boolean {
  if (typeof action.reduceOnly === 'boolean') {
    return action.reduceOnly;
  }
  if (action.action === 'CLOSE') {
    return true;
  }
  return false;
}

function resolveLeverage(
  action: FuturesTraderAction,
  fallback: number | null | undefined,
): number | null {
  if (typeof action.leverage === 'number') {
    return clampLeverage(action.leverage);
  }
  if (typeof fallback === 'number') {
    return clampLeverage(fallback);
  }
  return null;
}

function resolveStopPrice(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

export async function executeFuturesDecision({
  userId,
  actions,
  reviewResultId,
  log,
  exchange: requestedExchange,
  defaultLeverage,
  marginMode,
}: ExecuteFuturesDecisionOptions): Promise<ExecuteFuturesDecisionResult> {
  const exchange: SupportedExchange = requestedExchange ?? 'bybit';
  const gateway = getExchangeGateway(exchange);
  const futuresGateway = gateway.futures;
  const outcome: ExecuteFuturesDecisionResult = {
    executed: 0,
    failed: 0,
    skipped: 0,
  };

  if (!futuresGateway) {
    log.error({ exchange }, 'futures trading unavailable for exchange');
    await Promise.all(
      actions.map(async (action) => {
        const planned = {
          exchange,
          action,
        };
        await insertFuturesOrder({
          userId,
          reviewResultId,
          orderId: randomUUID(),
          planned,
          status: FuturesOrderStatus.Failed,
          failureReason: 'futures trading not supported for exchange',
        });
      }),
    );
    outcome.failed = actions.length;
    return outcome;
  }

  for (const action of actions) {
    const symbol = normalizeSymbol(action.symbol);
    const planned = {
      exchange,
      symbol,
      action: action.action,
      positionSide: action.positionSide,
      type: action.type,
      quantity: action.quantity,
      price: action.price,
      reduceOnly: resolveReduceOnly(action),
      leverage: action.leverage ?? defaultLeverage ?? null,
      stopLoss: action.stopLoss,
      takeProfit: action.takeProfit,
      notes: action.notes,
    };

    if (!symbol) {
      await insertFuturesOrder({
        userId,
        reviewResultId,
        orderId: randomUUID(),
        planned,
        status: FuturesOrderStatus.Failed,
        failureReason: 'missing symbol',
      });
      outcome.failed += 1;
      continue;
    }

    if (action.action === 'HOLD') {
      await insertFuturesOrder({
        userId,
        reviewResultId,
        orderId: randomUUID(),
        planned,
        status: FuturesOrderStatus.Skipped,
      });
      outcome.skipped += 1;
      continue;
    }

    const quantity = toPositiveNumber(action.quantity);
    if (quantity === null) {
      await insertFuturesOrder({
        userId,
        reviewResultId,
        orderId: randomUUID(),
        planned,
        status: FuturesOrderStatus.Failed,
        failureReason: `invalid quantity: ${String(action.quantity)}`,
      });
      outcome.failed += 1;
      continue;
    }
    planned.quantity = quantity;

    if (action.type === 'LIMIT' && action.price === undefined) {
      await insertFuturesOrder({
        userId,
        reviewResultId,
        orderId: randomUUID(),
        planned,
        status: FuturesOrderStatus.Failed,
        failureReason: 'price is required for LIMIT orders',
      });
      outcome.failed += 1;
      continue;
    }

    if (
      action.price !== undefined &&
      toPositiveNumber(action.price) === null
    ) {
      await insertFuturesOrder({
        userId,
        reviewResultId,
        orderId: randomUUID(),
        planned,
        status: FuturesOrderStatus.Failed,
        failureReason: `invalid price: ${String(action.price)}`,
      });
      outcome.failed += 1;
      continue;
    }

    const leverage = resolveLeverage(action, defaultLeverage ?? null);
    const stopLoss = resolveStopPrice(action.stopLoss);
    const takeProfit = resolveStopPrice(action.takeProfit);
    planned.leverage = leverage;
    planned.stopLoss = stopLoss;
    planned.takeProfit = takeProfit;

    try {
      if (leverage !== null) {
        await futuresGateway.setLeverage(userId, {
          symbol,
          leverage,
        });
      }

      await futuresGateway.openPosition(userId, {
        symbol,
        positionSide: action.positionSide,
        quantity,
        type: action.type,
        price: action.price,
        reduceOnly: resolveReduceOnly(action),
        ...(marginMode === 'isolated' ? { hedgeMode: false } : {}),
      });

      if (stopLoss !== null) {
        await futuresGateway.setStopLoss(userId, {
          symbol,
          positionSide: action.positionSide,
          stopPrice: stopLoss,
          ...(marginMode === 'isolated' ? { hedgeMode: false } : {}),
        });
      }

      if (takeProfit !== null) {
        await futuresGateway.setTakeProfit(userId, {
          symbol,
          positionSide: action.positionSide,
          stopPrice: takeProfit,
          ...(marginMode === 'isolated' ? { hedgeMode: false } : {}),
        });
      }

      await insertFuturesOrder({
        userId,
        reviewResultId,
        orderId: randomUUID(),
        planned,
        status: FuturesOrderStatus.Executed,
      });
      outcome.executed += 1;
      log.info(
        { step: 'executeFuturesDecision', exchange, symbol },
        'executed futures action',
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      await insertFuturesOrder({
        userId,
        reviewResultId,
        orderId: randomUUID(),
        planned,
        status: FuturesOrderStatus.Failed,
        failureReason: reason,
      });
      log.error(
        { err, step: 'executeFuturesDecision', exchange, symbol },
        'failed to execute futures action',
      );
      outcome.failed += 1;
    }
  }

  return outcome;
}
