import { db, withTransaction } from '../db/index.js';
import { AgentStatus } from '../util/agents.js';
import { convertKeysToCamelCase } from '../util/objectCase.js';
import type {
  ActivePortfolioWorkflowRow,
  PortfolioWorkflowDraftSearch,
  PortfolioWorkflowInsert,
  PortfolioWorkflowRow,
  PortfolioWorkflowUpdate,
  PortfolioWorkflowUserApiKeys,
} from './portfolio-workflow.types.js';

export type {
  PortfolioWorkflowRow,
  ActivePortfolioWorkflowRow,
  PortfolioWorkflowToken,
  PortfolioWorkflowInsert,
  PortfolioWorkflowUpdate,
  PortfolioWorkflowUserApiKeys,
} from './portfolio-workflow.types.js';

export function toApi(row: PortfolioWorkflowRow) {
  return {
    id: row.id,
    userId: row.userId,
    model: row.model,
    status: row.status,
    createdAt: new Date(row.createdAt).getTime(),
    startBalanceUsd: row.startBalance ?? null,
    name: row.name,
    cashToken: row.cashToken,
    tokens: row.tokens.map((t) => ({
      token: t.token,
      minAllocation: t.minAllocation,
    })),
    risk: row.risk,
    reviewInterval: row.reviewInterval,
    agentInstructions: row.agentInstructions,
    manualRebalance: row.manualRebalance,
    useEarn: row.useEarn,
    aiApiKeyId: row.aiApiKeyId ?? null,
    exchangeApiKeyId: row.exchangeApiKeyId ?? null,
  };
}

const baseSelect = `
  SELECT a.id, a.user_id, a.model, a.status, a.created_at, a.start_balance, a.name, a.cash_token,
         COALESCE(json_agg(json_build_object('token', t.token, 'min_allocation', t.min_allocation) ORDER BY t.position)
                  FILTER (WHERE t.token IS NOT NULL), '[]') AS tokens,
         a.risk, a.review_interval, a.agent_instructions, a.manual_rebalance, a.use_earn,
         COALESCE(ak.id, oak.id) AS ai_api_key_id, ek.id AS exchange_api_key_id
    FROM portfolio_workflow a
    LEFT JOIN portfolio_workflow_tokens t ON t.portfolio_workflow_id = a.id
    LEFT JOIN ai_api_keys ak ON ak.user_id = a.user_id AND ak.provider = 'openai'
    LEFT JOIN ai_api_key_shares s ON s.target_user_id = a.user_id
    LEFT JOIN ai_api_keys oak ON oak.user_id = s.owner_user_id AND oak.provider = 'openai'
    LEFT JOIN exchange_keys ek ON ek.user_id = a.user_id AND ek.provider = 'binance'
`;

export async function getAgent(id: string): Promise<PortfolioWorkflowRow | undefined> {
  const { rows } = await db.query(
    `${baseSelect} WHERE a.id = $1 AND a.status != $2 GROUP BY a.id, ak.id, oak.id, ek.id`,
    [id, AgentStatus.Retired],
  );
  if (!rows[0]) return undefined;
  return convertKeysToCamelCase(rows[0]) as PortfolioWorkflowRow;
}

export async function getAgentsPaginated(
  userId: string,
  status: string | undefined,
  limit: number,
  offset: number,
) {
  if (status) {
    if (status === AgentStatus.Retired) return { rows: [], total: 0 };
    const where = 'WHERE a.user_id = $1 AND a.status = $2';
    const totalRes = await db.query(
      `SELECT COUNT(*) as count FROM portfolio_workflow a ${where}`,
      [userId, status],
    );
    const { rows } = await db.query(
      `${baseSelect} ${where} GROUP BY a.id, ak.id, oak.id, ek.id LIMIT $3 OFFSET $4`,
      [userId, status, limit, offset],
    );
    return {
      rows: convertKeysToCamelCase(rows) as PortfolioWorkflowRow[],
      total: Number(totalRes.rows[0].count),
    };
  }
  const where = 'WHERE a.user_id = $1 AND a.status != $2';
  const totalRes = await db.query(
    `SELECT COUNT(*) as count FROM portfolio_workflow a ${where}`,
    [userId, AgentStatus.Retired],
  );
  const { rows } = await db.query(
    `${baseSelect} ${where} GROUP BY a.id, ak.id, oak.id, ek.id LIMIT $3 OFFSET $4`,
    [userId, AgentStatus.Retired, limit, offset],
  );
  return {
    rows: convertKeysToCamelCase(rows) as PortfolioWorkflowRow[],
    total: Number(totalRes.rows[0].count),
  };
}

export async function findIdenticalDraftAgent(
  data: PortfolioWorkflowDraftSearch,
  excludeId?: string,
) {
  const query = `SELECT a.id, a.name FROM portfolio_workflow a
    LEFT JOIN (
      SELECT portfolio_workflow_id,
             json_agg(json_build_object('token', token, 'min_allocation', min_allocation) ORDER BY position) AS tokens
        FROM portfolio_workflow_tokens GROUP BY portfolio_workflow_id
    ) t ON t.portfolio_workflow_id = a.id
    WHERE a.user_id = $1 AND a.status = 'draft' AND ($2::bigint IS NULL OR a.id != $2)
      AND a.model = $3 AND a.name = $4 AND a.cash_token = $5
      AND a.risk = $6 AND a.review_interval = $7 AND a.agent_instructions = $8 AND a.manual_rebalance = $9 AND a.use_earn = $10
      AND COALESCE(t.tokens::jsonb, '[]'::jsonb) = $11::jsonb`;
  const params: unknown[] = [
    data.userId,
    excludeId ?? null,
    data.model,
    data.name,
    data.cashToken,
    data.risk,
    data.reviewInterval,
    data.agentInstructions,
    data.manualRebalance,
    data.useEarn,
    JSON.stringify(
      data.tokens.map((t) => ({
        token: t.token,
        min_allocation: t.minAllocation,
      })),
    ),
  ];
  const { rows } = await db.query(query, params as any[]);
  return rows[0] as { id: string; name: string } | undefined;
}

export async function findActiveTokenConflicts(
  userId: string,
  tokens: string[],
  excludeId?: string,
) {
  const query = `SELECT id, name, token
      FROM (
            SELECT a.id, a.name, a.cash_token AS token
              FROM portfolio_workflow a
             WHERE a.user_id = $1
               AND a.status = 'active'
               AND ($2::bigint IS NULL OR a.id != $2)
               AND a.cash_token = ANY($3::text[])
            UNION
            SELECT a.id, a.name, t.token
              FROM portfolio_workflow a
              JOIN portfolio_workflow_tokens t ON t.portfolio_workflow_id = a.id
             WHERE a.user_id = $1
               AND a.status = 'active'
               AND ($2::bigint IS NULL OR a.id != $2)
               AND t.token = ANY($3::text[])
           ) conflicts`;
  const params: unknown[] = [userId, excludeId ?? null, tokens];
  const { rows } = await db.query(query, params as any[]);
  return rows as { id: string; name: string; token: string }[];
}

export async function getUserApiKeys(userId: string) {
  const { rows } = await db.query(
    "SELECT COALESCE(ak.api_key_enc, oak.api_key_enc) AS ai_api_key_enc, ek.api_key_enc AS binance_api_key_enc, ek.api_secret_enc AS binance_api_secret_enc FROM users u LEFT JOIN ai_api_keys ak ON ak.user_id = u.id AND ak.provider = 'openai' LEFT JOIN ai_api_key_shares s ON s.target_user_id = u.id LEFT JOIN ai_api_keys oak ON oak.user_id = s.owner_user_id AND oak.provider = 'openai' LEFT JOIN exchange_keys ek ON ek.user_id = u.id AND ek.provider = 'binance' WHERE u.id = $1",
    [userId],
  );
  if (!rows[0]) return undefined;
  return convertKeysToCamelCase(rows[0]) as PortfolioWorkflowUserApiKeys;
}

export async function insertAgent(
  data: PortfolioWorkflowInsert,
): Promise<PortfolioWorkflowRow> {
  let id = '';
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO portfolio_workflow (user_id, model, status, start_balance, name, cash_token, risk, review_interval, agent_instructions, manual_rebalance, use_earn)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        data.userId,
        data.model,
        data.status,
        data.startBalance,
        data.name,
        data.cashToken,
        data.risk,
        data.reviewInterval,
        data.agentInstructions,
        data.manualRebalance,
        data.useEarn,
      ],
    );
    id = rows[0].id as string;
    const params: any[] = [id];
    const values: string[] = [];
    data.tokens.forEach((t, i) => {
      values.push(`($1, $${i * 2 + 2}, $${i * 2 + 3}, ${i + 1})`);
      params.push(t.token, t.minAllocation);
    });
    if (values.length)
      await client.query(
        `INSERT INTO portfolio_workflow_tokens (portfolio_workflow_id, token, min_allocation, position) VALUES ${values.join(', ')}`,
        params,
      );
  });
  return (await getAgent(id))!;
}

export async function updateAgent(
  data: PortfolioWorkflowUpdate,
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE portfolio_workflow SET model = $1, status = $2, name = $3, cash_token = $4, risk = $5, review_interval = $6, agent_instructions = $7, start_balance = $8, manual_rebalance = $9, use_earn = $10 WHERE id = $11`,
      [
        data.model,
        data.status,
        data.name,
        data.cashToken,
        data.risk,
        data.reviewInterval,
        data.agentInstructions,
        data.startBalance,
        data.manualRebalance,
        data.useEarn,
        data.id,
      ],
    );
    await client.query('DELETE FROM portfolio_workflow_tokens WHERE portfolio_workflow_id = $1', [data.id]);
    const params: any[] = [data.id];
    const values: string[] = [];
    data.tokens.forEach((t, i) => {
      values.push(`($1, $${i * 2 + 2}, $${i * 2 + 3}, ${i + 1})`);
      params.push(t.token, t.minAllocation);
    });
    if (values.length)
      await client.query(
        `INSERT INTO portfolio_workflow_tokens (portfolio_workflow_id, token, min_allocation, position) VALUES ${values.join(', ')}`,
        params,
      );
  });
}

export async function deleteAgent(id: string): Promise<void> {
  await db.query(
    'UPDATE portfolio_workflow SET status = $1, start_balance = NULL WHERE id = $2',
    [AgentStatus.Retired, id],
  );
}

export async function startAgent(
  id: string,
  startBalance: number,
): Promise<void> {
  await db.query(
    'UPDATE portfolio_workflow SET status = $1, start_balance = $2 WHERE id = $3',
    [AgentStatus.Active, startBalance, id],
  );
}

export async function stopAgent(id: string): Promise<void> {
  await db.query(
    'UPDATE portfolio_workflow SET status = $1, start_balance = NULL WHERE id = $2',
    [AgentStatus.Inactive, id],
  );
}

export async function getActivePortfolioWorkflowById(
  portfolioWorkflowId: string,
): Promise<ActivePortfolioWorkflowRow | undefined> {
  const sql = `SELECT a.id, a.user_id, a.model,
                      a.cash_token, COALESCE(t.tokens, '[]') AS tokens,
                      a.risk, a.review_interval, a.agent_instructions,
                      COALESCE(
                        (SELECT api_key_enc FROM ai_api_keys WHERE user_id = a.user_id AND provider = 'openai'),
                        (
                          SELECT oak.api_key_enc
                            FROM ai_api_key_shares s
                            JOIN ai_api_keys oak ON oak.user_id = s.owner_user_id AND oak.provider = 'openai'
                           WHERE s.target_user_id = a.user_id
                           LIMIT 1
                        )
                      ) AS ai_api_key_enc,
                      a.manual_rebalance,
                      a.use_earn,
                      a.start_balance,
                      a.created_at,
                      a.id AS portfolio_id
                 FROM portfolio_workflow a
                 LEFT JOIN LATERAL (
                   SELECT json_agg(json_build_object('token', token, 'min_allocation', min_allocation) ORDER BY position) AS tokens
                     FROM portfolio_workflow_tokens
                    WHERE portfolio_workflow_id = a.id
                 ) t ON true
                WHERE a.status = 'active' AND a.id = $1`;
  const { rows } = await db.query(sql, [portfolioWorkflowId]);
  if (!rows[0]) return undefined;
  return convertKeysToCamelCase(rows[0]) as ActivePortfolioWorkflowRow;
}

export async function getActivePortfolioWorkflowsByInterval(
  interval: string,
): Promise<ActivePortfolioWorkflowRow[]> {
  const sql = `SELECT a.id, a.user_id, a.model,
                      a.cash_token, COALESCE(t.tokens, '[]') AS tokens,
                      a.risk, a.review_interval, a.agent_instructions,
                      COALESCE(
                        (SELECT api_key_enc FROM ai_api_keys WHERE user_id = a.user_id AND provider = 'openai'),
                        (
                          SELECT oak.api_key_enc
                            FROM ai_api_key_shares s
                            JOIN ai_api_keys oak ON oak.user_id = s.owner_user_id AND oak.provider = 'openai'
                           WHERE s.target_user_id = a.user_id
                           LIMIT 1
                        )
                      ) AS ai_api_key_enc,
                      a.manual_rebalance,
                      a.use_earn,
                      a.start_balance,
                      a.created_at,
                      a.id AS portfolio_id
                 FROM portfolio_workflow a
                 LEFT JOIN LATERAL (
                   SELECT json_agg(json_build_object('token', token, 'min_allocation', min_allocation) ORDER BY position) AS tokens
                     FROM portfolio_workflow_tokens
                    WHERE portfolio_workflow_id = a.id
                 ) t ON true
                WHERE a.status = 'active' AND a.review_interval = $1`;
  const { rows } = await db.query(sql, [interval]);
  return convertKeysToCamelCase(rows) as ActivePortfolioWorkflowRow[];
}

export async function getActivePortfolioWorkflowsByUser(
  userId: string,
): Promise<ActivePortfolioWorkflowRow[]> {
  const sql = `SELECT a.id, a.user_id, a.model,
                      a.cash_token, COALESCE(t.tokens, '[]') AS tokens,
                      a.risk, a.review_interval, a.agent_instructions,
                      COALESCE(
                        (SELECT api_key_enc FROM ai_api_keys WHERE user_id = a.user_id AND provider = 'openai'),
                        (
                          SELECT oak.api_key_enc
                            FROM ai_api_key_shares s
                            JOIN ai_api_keys oak ON oak.user_id = s.owner_user_id AND oak.provider = 'openai'
                           WHERE s.target_user_id = a.user_id
                           LIMIT 1
                        )
                      ) AS ai_api_key_enc,
                      a.manual_rebalance,
                      a.use_earn,
                      a.start_balance,
                      a.created_at,
                      a.id AS portfolio_id
                 FROM portfolio_workflow a
                 LEFT JOIN LATERAL (
                   SELECT json_agg(json_build_object('token', token, 'min_allocation', min_allocation) ORDER BY position) AS tokens
                     FROM portfolio_workflow_tokens
                    WHERE portfolio_workflow_id = a.id
                 ) t ON true
                WHERE a.status = 'active' AND a.user_id = $1`;
  const { rows } = await db.query(sql, [userId]);
  return convertKeysToCamelCase(rows) as ActivePortfolioWorkflowRow[];
}

export async function deactivateAgentsByUser(
  userId: string,
): Promise<void> {
  await db.query(
    `UPDATE portfolio_workflow SET status = $1, start_balance = NULL WHERE user_id = $2 AND status = $3`,
    [AgentStatus.Inactive, userId, AgentStatus.Active],
  );
}

export async function draftAgentsByUser(userId: string): Promise<void> {
  await db.query(
    `UPDATE portfolio_workflow SET status = $1, model = NULL, start_balance = NULL WHERE user_id = $2 AND status = $3`,
    [AgentStatus.Draft, userId, AgentStatus.Active],
  );
}
