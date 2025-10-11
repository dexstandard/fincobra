import { db } from '../../src/db/index.js';
import {
  insertPortfolioWorkflow as insertWorkflowProd,
  startPortfolioWorkflow,
  stopPortfolioWorkflow,
  deletePortfolioWorkflow,
} from '../../src/repos/portfolio-workflows.js';

export const insertPortfolioWorkflow = (
  data: Parameters<typeof insertWorkflowProd>[0],
) =>
  insertWorkflowProd({
    aiProvider: 'openai',
    cashToken: 'USDT',
    mode: 'spot',
    ...data,
  });
export {
  startPortfolioWorkflow,
  stopPortfolioWorkflow,
  deletePortfolioWorkflow,
};

export async function setWorkflowStatus(id: string, status: string) {
  await db.query('UPDATE portfolio_workflow SET status = $1 WHERE id = $2', [
    status,
    id,
  ]);
}

export async function getPortfolioWorkflowStatus(id: string) {
  const { rows } = await db.query(
    'SELECT status FROM portfolio_workflow WHERE id = $1',
    [id],
  );
  return rows[0]?.status as string | undefined;
}

export async function getPortfolioWorkflow(id: string) {
  const { rows } = await db.query(
    'SELECT status, model FROM portfolio_workflow WHERE id = $1',
    [id],
  );
  return rows[0] as { status: string; model: string } | undefined;
}
