import type { FastifyBaseLogger } from 'fastify';
import type { ActivePortfolioWorkflow } from '../repos/portfolio-workflows.js';
import {
  getActivePortfolioWorkflowsByUser,
  getActivePortfolioWorkflowsByUserAndAiKey,
  getActivePortfolioWorkflowsByUserAndExchangeKey,
  deactivateWorkflowsByUser,
  deactivateWorkflowsByIds,
} from '../repos/portfolio-workflows.js';
import {
  CANCEL_ORDER_REASONS,
  cancelOrdersForWorkflow,
} from '../services/order-orchestrator.js';
import { removeWorkflowFromSchedule } from './portfolio-review.js';

export interface DisableWorkflowsSummary {
  disabledWorkflowIds: string[];
  unscheduledWorkflowIds: string[];
}

async function disableWorkflowSet(
  log: FastifyBaseLogger,
  workflows: ActivePortfolioWorkflow[],
  deactivate: () => Promise<void>,
): Promise<DisableWorkflowsSummary> {
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
  await deactivate();

  const unscheduledWorkflowIds: string[] = [];
  for (const workflowId of disabledWorkflowIds) {
    if (removeWorkflowFromSchedule(workflowId)) {
      unscheduledWorkflowIds.push(workflowId);
    }
  }

  return { disabledWorkflowIds, unscheduledWorkflowIds };
}

export async function disableUserWorkflows(
  log: FastifyBaseLogger,
  userId: string,
): Promise<DisableWorkflowsSummary> {
  const workflows = await getActivePortfolioWorkflowsByUser(userId);
  return disableWorkflowSet(log, workflows, () =>
    deactivateWorkflowsByUser(userId),
  );
}

export async function disableUserWorkflowsByAiKey(
  log: FastifyBaseLogger,
  userId: string,
  aiKeyId: string,
): Promise<DisableWorkflowsSummary> {
  const workflows = await getActivePortfolioWorkflowsByUserAndAiKey(
    userId,
    aiKeyId,
  );
  return disableWorkflowSet(log, workflows, () =>
    deactivateWorkflowsByUser(userId, aiKeyId),
  );
}

export async function disableUserWorkflowsByExchangeKey(
  log: FastifyBaseLogger,
  userId: string,
  exchangeKeyId: string,
): Promise<DisableWorkflowsSummary> {
  const workflows = await getActivePortfolioWorkflowsByUserAndExchangeKey(
    userId,
    exchangeKeyId,
  );
  return disableWorkflowSet(log, workflows, () =>
    deactivateWorkflowsByIds(workflows.map((workflow) => workflow.id)),
  );
}
