import type { FastifyBaseLogger } from 'fastify';

import type { ActivePortfolioWorkflow } from '../../repos/portfolio-workflows.types.js';
import type { SpotRebalancePrompt } from '../../agents/spot-trader.types.js';
import { collectSpotPromptData } from '../../agents/spot-trader.js';

/**
 * Thin wrapper around the spot trader prompt collector so orchestration layers
 * can depend on a services module instead of importing from the agent
 * implementation directly.
 */
export async function buildSpotPrompt(
  row: ActivePortfolioWorkflow,
  log: FastifyBaseLogger,
): Promise<SpotRebalancePrompt | undefined> {
  return collectSpotPromptData(row, log);
}
