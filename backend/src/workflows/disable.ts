import type { FastifyBaseLogger } from 'fastify';
import {
  getActivePortfolioWorkflowsByUser,
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

export async function disableUserWorkflows({
  log,
  userId,
  aiKeyId,
  exchangeKeyId,
}: DisableUserWorkflowsParams): Promise<DisableWorkflowsSummary> {
  const workflows = await getActivePortfolioWorkflowsByUser(userId);
  let relevant = workflows;

  if (aiKeyId) {
    relevant = relevant.filter((wf) => wf.aiApiKeyId === aiKeyId);
  }

  if (exchangeKeyId) {
    relevant = relevant.filter((wf) => wf.exchangeApiKeyId === exchangeKeyId);
  }

  if (!relevant.length) {
    return { disabledWorkflowIds: [], unscheduledWorkflowIds: [] };
  }

  for (const workflow of relevant) {
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

  const disabledWorkflowIds = relevant.map((workflow) => workflow.id);
  if (aiKeyId && !exchangeKeyId) {
    await deactivateWorkflowsByUser(userId, aiKeyId);
  } else if (!aiKeyId && !exchangeKeyId) {
    await deactivateWorkflowsByUser(userId);
  } else {
    await deactivateWorkflowsByIds(disabledWorkflowIds);
  }

  const unscheduledWorkflowIds: string[] = [];
  for (const workflowId of disabledWorkflowIds) {
    if (removeWorkflowFromSchedule(workflowId)) {
      unscheduledWorkflowIds.push(workflowId);
    }
  }

  return { disabledWorkflowIds, unscheduledWorkflowIds };
}
