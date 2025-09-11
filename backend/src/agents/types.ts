import type { FastifyBaseLogger } from 'fastify';

export interface Analysis {
  comment: string;
  score: number;
}

export const analysisSchema = {
  type: 'object',
  properties: {
    comment: { type: 'string' },
    score: { type: 'number' },
  },
  required: ['comment', 'score'],
  additionalProperties: false,
} as const;

export interface AnalysisLog {
  analysis: Analysis | null;
  prompt?: unknown;
  response?: string;
}

export interface RunParams {
  log: FastifyBaseLogger;
  model: string;
  apiKey: string;
  portfolioId: string;
}
