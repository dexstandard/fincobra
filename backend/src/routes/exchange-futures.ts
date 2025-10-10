import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RATE_LIMITS } from '../rate-limit.js';
import {
  getExchangeGateway,
  type SupportedExchange,
} from '../services/exchange-gateway.js';
import { ensureApiKeys } from '../services/portfolio-workflows.js';
import { errorResponse } from '../util/error-messages.js';
import { getValidatedUserId, userOrAdminPreHandlers } from './_shared/guards.js';
import { parseBody } from './_shared/validation.js';

interface FuturesLeverageBody {
  symbol: string;
  leverage: number;
}

interface FuturesPositionBase {
  symbol: string;
  positionSide: 'LONG' | 'SHORT';
  quantity: number;
  type?: 'MARKET' | 'LIMIT';
  price?: number;
  hedgeMode?: boolean;
  positionIdx?: 0 | 1 | 2;
}

interface FuturesOpenPositionBody extends FuturesPositionBase {
  reduceOnly?: boolean;
}

type FuturesClosePositionBody = FuturesPositionBase;

interface FuturesStopBody {
  symbol: string;
  positionSide: 'LONG' | 'SHORT';
  stopPrice: number;
  hedgeMode?: boolean;
  positionIdx?: 0 | 1 | 2;
}

const leverageSchema: z.ZodType<FuturesLeverageBody> = z
  .object({
    symbol: z.string().trim().min(1).max(32),
    leverage: z.number().int().min(1).max(125),
  })
  .strict();

const basePositionShape = {
  symbol: z.string().trim().min(1).max(32),
  positionSide: z.enum(['LONG', 'SHORT']),
  quantity: z.number().positive(),
  type: z.enum(['MARKET', 'LIMIT']).optional(),
  price: z.number().positive().optional(),
  hedgeMode: z.boolean().optional(),
  positionIdx: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
} as const;

function requireLimitPrice(
  value: Pick<FuturesPositionBase, 'type' | 'price'>,
  ctx: z.RefinementCtx,
) {
  if (value.type === 'LIMIT' && value.price === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['price'],
      message: 'price is required when type is LIMIT',
    });
  }
}

const openPositionSchema: z.ZodType<FuturesOpenPositionBody> = z
  .object({ ...basePositionShape, reduceOnly: z.boolean().optional() })
  .strict()
  .superRefine(requireLimitPrice);

const closePositionSchema: z.ZodType<FuturesClosePositionBody> = z
  .object(basePositionShape)
  .strict()
  .superRefine(requireLimitPrice);

const stopSchema: z.ZodType<FuturesStopBody> = z
  .object({
    symbol: z.string().trim().min(1).max(32),
    positionSide: z.enum(['LONG', 'SHORT']),
    stopPrice: z.number().positive(),
    hedgeMode: z.boolean().optional(),
    positionIdx: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  })
  .strict();

type FuturesAction =
  | 'set futures leverage'
  | 'open futures position'
  | 'close futures position'
  | 'set futures stop loss'
  | 'set futures take profit';

async function handleFuturesAction(
  req: FastifyRequest,
  reply: FastifyReply,
  exchange: SupportedExchange,
  action: FuturesAction,
  executor: (
    userId: string,
    futures: NonNullable<ReturnType<typeof getExchangeGateway>['futures']>,
  ) => Promise<void>,
) {
  const userId = getValidatedUserId(req);
  const ensuredKeys = await ensureApiKeys(req.log, userId, {
    requireAi: false,
    preferredExchange: exchange,
  });

  if ('code' in ensuredKeys) {
    reply.code(ensuredKeys.code).send(ensuredKeys.body);
    return;
  }

  const gateway = getExchangeGateway(exchange);
  if (!gateway.futures) {
    req.log.error({ userId, exchange }, 'futures module missing');
    reply
      .code(400)
      .send(errorResponse('futures trading is not supported for this exchange'));
    return;
  }

  try {
    await executor(userId, gateway.futures);
    reply.send({ ok: true });
  } catch (err) {
    const message = `failed to ${action}`;
    req.log.error({ err, userId, exchange }, message);
    reply.code(500).send(errorResponse(message));
  }
}

export default async function exchangeFuturesRoutes(app: FastifyInstance) {
  const exchanges: SupportedExchange[] = ['binance', 'bybit'];

  for (const exchange of exchanges) {
    const basePath = `/users/:id/${exchange}/futures` as const;

    app.post(
      `${basePath}/leverage`,
      {
        config: { rateLimit: RATE_LIMITS.TIGHT },
        preHandler: userOrAdminPreHandlers,
      },
      async (req, reply) => {
        const body = parseBody(leverageSchema, req, reply);
        if (!body) return;

        await handleFuturesAction(
          req,
          reply,
          exchange,
          'set futures leverage',
          async (userId, futures) => {
            await futures.setLeverage(userId, {
              symbol: body.symbol,
              leverage: body.leverage,
            });
          },
        );
      },
    );

    app.post(
      `${basePath}/positions/open`,
      {
        config: { rateLimit: RATE_LIMITS.TIGHT },
        preHandler: userOrAdminPreHandlers,
      },
      async (req, reply) => {
        const body = parseBody(openPositionSchema, req, reply);
        if (!body) return;

        await handleFuturesAction(
          req,
          reply,
          exchange,
          'open futures position',
          async (userId, futures) => {
            await futures.openPosition(userId, {
              symbol: body.symbol,
              positionSide: body.positionSide,
              quantity: body.quantity,
              type: body.type,
              price: body.price,
              reduceOnly: body.reduceOnly,
              hedgeMode: body.hedgeMode,
              positionIdx: body.positionIdx,
            });
          },
        );
      },
    );

    app.post(
      `${basePath}/positions/close`,
      {
        config: { rateLimit: RATE_LIMITS.TIGHT },
        preHandler: userOrAdminPreHandlers,
      },
      async (req, reply) => {
        const body = parseBody(closePositionSchema, req, reply);
        if (!body) return;

        await handleFuturesAction(
          req,
          reply,
          exchange,
          'close futures position',
          async (userId, futures) => {
            await futures.openPosition(userId, {
              symbol: body.symbol,
              positionSide: body.positionSide,
              quantity: body.quantity,
              type: body.type,
              price: body.price,
              reduceOnly: true,
              hedgeMode: body.hedgeMode,
              positionIdx: body.positionIdx,
            });
          },
        );
      },
    );

    app.post(
      `${basePath}/stop-loss`,
      {
        config: { rateLimit: RATE_LIMITS.TIGHT },
        preHandler: userOrAdminPreHandlers,
      },
      async (req, reply) => {
        const body = parseBody(stopSchema, req, reply);
        if (!body) return;

        await handleFuturesAction(
          req,
          reply,
          exchange,
          'set futures stop loss',
          async (userId, futures) => {
            await futures.setStopLoss(userId, {
              symbol: body.symbol,
              positionSide: body.positionSide,
              stopPrice: body.stopPrice,
              hedgeMode: body.hedgeMode,
              positionIdx: body.positionIdx,
            });
          },
        );
      },
    );

    app.post(
      `${basePath}/take-profit`,
      {
        config: { rateLimit: RATE_LIMITS.TIGHT },
        preHandler: userOrAdminPreHandlers,
      },
      async (req, reply) => {
        const body = parseBody(stopSchema, req, reply);
        if (!body) return;

        await handleFuturesAction(
          req,
          reply,
          exchange,
          'set futures take profit',
          async (userId, futures) => {
            await futures.setTakeProfit(userId, {
              symbol: body.symbol,
              positionSide: body.positionSide,
              stopPrice: body.stopPrice,
              hedgeMode: body.hedgeMode,
              positionIdx: body.positionIdx,
            });
          },
        );
      },
    );
  }
}

