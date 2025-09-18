import type { FastifyBaseLogger } from 'fastify';
import {
  getActivePortfolioWorkflowsByUser,
  deactivateWorkflowsByUser,
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
}

export interface DisableWorkflowsSummary {
  disabledWorkflowIds: string[];
  unscheduledWorkflowIds: string[];
}

export async function disableUserWorkflows({
  log,
  userId,
  aiKeyId,
}: DisableUserWorkflowsParams): Promise<DisableWorkflowsSummary> {
  const workflows = await getActivePortfolioWorkflowsByUser(userId);
  const relevant = aiKeyId
    ? workflows.filter((wf) => wf.aiApiKeyId === aiKeyId)
    : workflows;

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

  await deactivateWorkflowsByUser(userId, aiKeyId);

  const disabledWorkflowIds = relevant.map((workflow) => workflow.id);
  const unscheduledWorkflowIds: string[] = [];
  for (const workflowId of disabledWorkflowIds) {
    if (removeWorkflowFromSchedule(workflowId)) {
      unscheduledWorkflowIds.push(workflowId);
    }
  }

  return { disabledWorkflowIds, unscheduledWorkflowIds };
}
