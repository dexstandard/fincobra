export interface RateLimitConfig {
  max: number;
  timeWindow: string;
}

export const RATE_LIMITS = {
  VERY_TIGHT: { max: 3, timeWindow: '1 minute' },
  TIGHT: { max: 5, timeWindow: '1 minute' },
  MODERATE: { max: 10, timeWindow: '1 minute' },
  RELAXED: { max: 20, timeWindow: '1 minute' },
  LAX: { max: 60, timeWindow: '1 minute' },
} as const;

export type RateLimitLevel = keyof typeof RATE_LIMITS;
