import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import { getAgent, type PortfolioWorkflow } from '../../repos/portfolio-workflow.js';
import { AgentStatus } from '../../util/agents.js';
import { requireUserId } from '../../util/auth.js';
import { errorResponse, ERROR_MESSAGES } from '../../util/errorMessages.js';
import { parseParams } from '../../util/validation.js';
import { workflowIdParams } from './validation.js';

export interface WorkflowRequestContext {
  userId: string;
  workflowId: string;
  workflow: PortfolioWorkflow;
  log: FastifyBaseLogger;
}

export async function loadWorkflowContext(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void | FastifyReply> {
  const userId = requireUserId(req, reply);
  if (!userId) return reply;
  const params = parseParams(workflowIdParams, req.params, reply);
  if (!params) return reply;
  const { id } = params;
  const log = req.log.child({ userId, workflowId: id });
  const workflow = await getAgent(id);
  if (!workflow || workflow.status === AgentStatus.Retired) {
    log.error('workflow not found');
    reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));
    return reply;
  }
  if (workflow.userId !== userId) {
    log.error('forbidden');
    reply.code(403).send(errorResponse(ERROR_MESSAGES.forbidden));
    return reply;
  }
  const context: WorkflowRequestContext = {
    userId,
    workflowId: id,
    workflow,
    log,
  };
  req.workflowContext = context;
}

export function getWorkflowContext(req: FastifyRequest): WorkflowRequestContext {
  if (!req.workflowContext) {
    throw new Error('workflow context not initialized');
  }
  return req.workflowContext;
}

export const workflowPreHandlers = [loadWorkflowContext];
