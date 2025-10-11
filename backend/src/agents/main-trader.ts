import type { FastifyBaseLogger } from 'fastify';
import type { ActivePortfolioWorkflow, PortfolioWorkflowMode } from '../repos/portfolio-workflows.types.js';
import {
  spotDeveloperInstructions,
  spotRebalanceResponseSchema,
  collectSpotPromptData,
  clearSpotTraderCaches,
  runSpotTrader,
  __resetSpotTraderCachesForTest,
} from './spot-trader.js';
import {
  futuresTraderDeveloperInstructions,
  futuresTraderResponseSchema,
  collectFuturesPromptData,
  clearFuturesTraderCaches,
  runFuturesTrader,
} from './futures-trader.js';
import type {
  RunParams,
  TraderPromptResult,
  TraderRunResult,
  SpotRebalancePrompt,
  FuturesTraderPrompt,
} from './main-trader.types.js';

export const developerInstructions = spotDeveloperInstructions;
export const rebalanceResponseSchema = spotRebalanceResponseSchema;

export function getDeveloperInstructionsForMode(
  mode: PortfolioWorkflowMode,
): string {
  return mode === 'futures'
    ? futuresTraderDeveloperInstructions
    : spotDeveloperInstructions;
}

export function getResponseSchemaForMode(mode: PortfolioWorkflowMode) {
  return mode === 'futures'
    ? futuresTraderResponseSchema
    : spotRebalanceResponseSchema;
}

export async function collectPromptData(
  row: ActivePortfolioWorkflow,
  log: FastifyBaseLogger,
): Promise<TraderPromptResult | undefined> {
  if (row.mode === 'futures') {
    const prompt = await collectFuturesPromptData(row, log);
    return prompt ? { mode: 'futures', prompt } : undefined;
  }
  const prompt = await collectSpotPromptData(row, log);
  return prompt ? { mode: 'spot', prompt } : undefined;
}

export async function run(
  params: RunParams,
  prompt: TraderPromptResult,
  instructionsOverride?: string,
): Promise<TraderRunResult> {
  if (prompt.mode === 'futures') {
    const decision = await runFuturesTrader(
      params,
      prompt.prompt as FuturesTraderPrompt,
      instructionsOverride,
    );
    return { mode: 'futures', decision };
  }
  const decision = await runSpotTrader(
    params,
    prompt.prompt as SpotRebalancePrompt,
    instructionsOverride,
  );
  return { mode: 'spot', decision };
}

export function clearMainTraderCaches(): void {
  clearSpotTraderCaches();
  clearFuturesTraderCaches();
}

export {
  __resetSpotTraderCachesForTest,
  __resetSpotTraderCachesForTest as __resetNewsContextCacheForTest,
};
