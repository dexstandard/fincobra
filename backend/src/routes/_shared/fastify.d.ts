import type { FastifyBaseLogger } from 'fastify';
import type { PortfolioWorkflow } from '../../repos/portfolio-workflow.js';
import 'fastify';

declare module 'fastify' {
    interface FastifyRequest {
        validatedUserId?: string;
        adminUserId?: string;
        workflowContext?: {
            userId: string;
            workflowId: string;
            workflow: PortfolioWorkflow;
            log: FastifyBaseLogger;
        };
    }
}
