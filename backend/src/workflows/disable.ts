import type { FastifyBaseLogger } from 'fastify';
import type { ActivePortfolioWorkflow } from '../repos/portfolio-workflow.js';
import {
  getActivePortfolioWorkflowsByUser,
  getActivePortfolioWorkflowsByUserAndAiKey,
  getActivePortfolioWorkflowsByUserAndExchangeKey,
  deactivateWorkflowsByUser,
  deactivateWorkflowsByIds,
} from '../repos/portfolio-workflow.js';
import {
  CANCEL_ORDER_REASONS,
  cancelOrdersForWorkflow,
} from '../services/order-orchestrator.js';
import { removeWorkflowFromSchedule } from './portfolio-review.js';

interface DisableUserWorkflowsParams {
  log: FastifyBaseLogger;
  userId: string;
  aiKeyId?: string | null;
  exchangeKeyId?: string | null;
}

export interface DisableWorkflowsSummary {
  disabledWorkflowIds: string[];
  unscheduledWorkflowIds: string[];
}

async function findWorkflowsForDisable({
  userId,
  aiKeyId,
  exchangeKeyId,
}: {
  userId: string;
  aiKeyId?: string | null;
  exchangeKeyId?: string | null;
}): Promise<ActivePortfolioWorkflow[]> {
  if (aiKeyId && exchangeKeyId) {
    const [byAiKey, byExchangeKey] = await Promise.all([
      getActivePortfolioWorkflowsByUserAndAiKey(userId, aiKeyId),
      getActivePortfolioWorkflowsByUserAndExchangeKey(userId, exchangeKeyId),
    ]);
    const exchangeIds = new Set(byExchangeKey.map((workflow) => workflow.id));
    return byAiKey.filter((workflow) => exchangeIds.has(workflow.id));
  }

  if (aiKeyId) {
    return getActivePortfolioWorkflowsByUserAndAiKey(userId, aiKeyId);
  }

  if (exchangeKeyId) {
    return getActivePortfolioWorkflowsByUserAndExchangeKey(userId, exchangeKeyId);
  }

  return getActivePortfolioWorkflowsByUser(userId);
}

export async function disableUserWorkflows({
  log,
  userId,
  aiKeyId,
  exchangeKeyId,
}: DisableUserWorkflowsParams): Promise<DisableWorkflowsSummary> {
  const workflows = await findWorkflowsForDisable({
    userId,
    aiKeyId,
    exchangeKeyId,
  });

  if (!workflows.length) {
    return { disabledWorkflowIds: [], unscheduledWorkflowIds: [] };
  }

  for (const workflow of workflows) {
    try {
      await cancelOrdersForWorkflow({
        workflowId: workflow.id,
        reason: CANCEL_ORDER_REASONS.API_KEY_REMOVED,
        log,
      });
    } catch (err) {
      log.error({ err, workflowId: workflow.id }, 'failed to cancel orders');
    }
  }

  const disabledWorkflowIds = workflows.map((workflow) => workflow.id);
  if (exchangeKeyId) {
    await deactivateWorkflowsByIds(disabledWorkflowIds);
  } else if (aiKeyId) {
    await deactivateWorkflowsByUser(userId, aiKeyId);
  } else {
    await deactivateWorkflowsByUser(userId);
  }

  const unscheduledWorkflowIds: string[] = [];
  for (const workflowId of disabledWorkflowIds) {
    if (removeWorkflowFromSchedule(workflowId)) {
      unscheduledWorkflowIds.push(workflowId);
    }
  }

  return { disabledWorkflowIds, unscheduledWorkflowIds };
}
