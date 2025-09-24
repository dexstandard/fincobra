import { db } from '../../src/db/index.js';
import {
  insertAgent as insertAgentProd,
  startAgent,
  stopAgent,
  deleteAgent,
} from '../../src/repos/portfolio-workflow.js';

export const insertAgent = (data: Parameters<typeof insertAgentProd>[0]) =>
  insertAgentProd({ cashToken: 'USDT', ...data });
export { startAgent, stopAgent, deleteAgent };

export async function setAgentStatus(id: string, status: string) {
  await db.query('UPDATE portfolio_workflow SET status = $1 WHERE id = $2', [status, id]);
}

export async function getPortfolioWorkflowStatus(id: string) {
  const { rows } = await db.query('SELECT status FROM portfolio_workflow WHERE id = $1', [
    id,
  ]);
  return rows[0]?.status as string | undefined;
}

export async function getPortfolioWorkflow(id: string) {
  const { rows } = await db.query(
    'SELECT status, model FROM portfolio_workflow WHERE id = $1',
    [id],
  );
  return rows[0] as { status: string; model: string } | undefined;
}
