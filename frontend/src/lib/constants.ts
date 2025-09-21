import { createElement } from 'react';
import { z } from 'zod';
import RiskDisplay from '../components/RiskDisplay';

export const tokens = [
    {value: 'BTC', label: 'BTC'},
    {value: 'BNB', label: 'BNB'},
    {value: 'DOGE', label: 'DOGE'},
    {value: 'ETH', label: 'ETH'},
    {value: 'HBAR', label: 'HBAR'},
    {value: 'PEPE', label: 'PEPE'},
    {value: 'SHIB', label: 'SHIB'},
    {value: 'SOL', label: 'SOL'},
    {value: 'TON', label: 'TON'},
    {value: 'TRX', label: 'TRX'},
    {value: 'XRP', label: 'XRP'},
    {value: 'USDT', label: 'USDT'},
    {value: 'USDC', label: 'USDC'},
];

export const stableCoins = ['USDT', 'USDC'];

export const riskOptions = [
    {value: 'low', label: createElement(RiskDisplay, {risk: 'low'})},
    {value: 'medium', label: createElement(RiskDisplay, {risk: 'medium'})},
    {value: 'high', label: createElement(RiskDisplay, {risk: 'high'})},
];

export const reviewIntervalOptions = (t: (key: string) => string) => [
    {value: '10m', label: t('review_interval_10m')},
    {value: '15m', label: t('review_interval_15m')},
    {value: '30m', label: t('review_interval_30m')},
    {value: '1h', label: t('review_interval_1h')},
    {value: '3h', label: t('review_interval_3h')},
    {value: '5h', label: t('review_interval_5h')},
    {value: '12h', label: t('review_interval_12h')},
    {value: '24h', label: t('review_interval_24h')},
    {value: '3d', label: t('review_interval_3d')},
    {value: '1w', label: t('review_interval_1w')},
];

export const DEFAULT_AGENT_INSTRUCTIONS =
    'Day trade this pair and determine the target allocation yourself. Monitor real-time market data and news, trimming positions after rallies and adding to them after dips to stay within policy floors while exploiting intraday swings.';

export const portfolioReviewSchema = z
  .object({
    tokens: z
      .array(
        z.object({
          token: z.string().min(1, 'Token is required'),
          minAllocation: z
            .number()
            .min(0, 'Must be at least 0')
            .max(95, 'Must be 95 or less'),
        }),
      )
      .min(2)
      .max(4),
    risk: z.enum(['low', 'medium', 'high']),
    reviewInterval: z.enum([
      '10m',
      '15m',
      '30m',
      '1h',
      '3h',
      '5h',
      '12h',
      '24h',
      '3d',
      '1w',
    ]),
  })
  .refine((data) => {
    const tokens = data.tokens.map((t) => t.token.toUpperCase());
    return new Set(tokens).size === tokens.length;
  }, {
    message: 'Tokens must be different',
    path: ['tokens'],
  })
  .refine(
    (data) => {
      const total = data.tokens.reduce((sum, t) => sum + t.minAllocation, 0);
      return total <= 95;
    },
    {
      message: 'Min allocations must not exceed 95% total',
      path: ['tokens'],
    },
  );

export type PortfolioReviewFormValues = z.infer<typeof portfolioReviewSchema>;

export const portfolioReviewDefaults: PortfolioReviewFormValues = {
  tokens: [{ token: 'USDT', minAllocation: 0 }],
  risk: 'low',
  reviewInterval: '30m',
};

