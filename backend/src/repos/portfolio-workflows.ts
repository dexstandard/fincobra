import { db, withTransaction } from '../db/index.js';
import { PortfolioWorkflowStatus } from '../services/portfolio-workflows.js';
import { convertKeysToCamelCase } from '../util/object-case.js';
import type {
  ActivePortfolioWorkflow,
  PortfolioWorkflowDraftSearch,
  PortfolioWorkflowInsert,
  PortfolioWorkflow,
  PortfolioWorkflowUpdate,
  PortfolioWorkflowUserApiKeys,
} from './portfolio-workflows.types.js';

export type {
  PortfolioWorkflow,
  ActivePortfolioWorkflow,
  PortfolioWorkflowToken,
  PortfolioWorkflowInsert,
  PortfolioWorkflowUpdate,
  PortfolioWorkflowUserApiKeys,
} from './portfolio-workflows.types.js';

export function toApi(row: PortfolioWorkflow) {
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
  SELECT pw.id, pw.user_id, pw.model, pw.status, pw.created_at, pw.start_balance, pw.name, pw.cash_token,
         COALESCE(json_agg(json_build_object('token', t.token, 'min_allocation', t.min_allocation) ORDER BY t.position)
                  FILTER (WHERE t.token IS NOT NULL), '[]') AS tokens,
         pw.risk, pw.review_interval, pw.agent_instructions, pw.manual_rebalance, pw.use_earn,
         COALESCE(pw.ai_api_key_id, ak.id, oak.id) AS ai_api_key_id, COALESCE(pw.exchange_key_id, ek.id) AS exchange_api_key_id
    FROM portfolio_workflow pw
    LEFT JOIN portfolio_workflow_tokens t ON t.portfolio_workflow_id = pw.id
    LEFT JOIN ai_api_keys ak ON ak.user_id = pw.user_id AND ak.provider = 'openai'
    LEFT JOIN ai_api_key_shares s ON s.target_user_id = pw.user_id
    LEFT JOIN ai_api_keys oak ON oak.user_id = s.owner_user_id AND oak.provider = 'openai'
    LEFT JOIN exchange_keys ek ON ek.user_id = pw.user_id AND ek.provider = 'binance'
`;

export async function getPortfolioWorkflow(id: string): Promise<PortfolioWorkflow | undefined> {
  const { rows } = await db.query(
    `${baseSelect} WHERE pw.id = $1 AND pw.status != $2 GROUP BY pw.id, ak.id, oak.id, pw.exchange_key_id, ek.id`,
    [id, PortfolioWorkflowStatus.Retired],
  );
  if (!rows[0]) return undefined;
  return convertKeysToCamelCase(rows[0]) as PortfolioWorkflow;
}

export async function getPortfolioWorkflowsPaginated(
  userId: string,
  status: string | undefined,
  limit: number,
  offset: number,
) {
  if (status) {
    if (status === PortfolioWorkflowStatus.Retired) return { rows: [], total: 0 };
    const where = 'WHERE pw.user_id = $1 AND pw.status = $2';
    const totalRes = await db.query(
      `SELECT COUNT(*) as count FROM portfolio_workflow pw ${where}`,
      [userId, status],
    );
    const { rows } = await db.query(
      `${baseSelect} ${where} GROUP BY pw.id, ak.id, oak.id, pw.exchange_key_id, ek.id LIMIT $3 OFFSET $4`,
      [userId, status, limit, offset],
    );
    return {
      rows: convertKeysToCamelCase(rows) as PortfolioWorkflow[],
      total: Number(totalRes.rows[0].count),
    };
  }
  const where = 'WHERE pw.user_id = $1 AND pw.status != $2';
  const totalRes = await db.query(
    `SELECT COUNT(*) as count FROM portfolio_workflow pw ${where}`,
    [userId, PortfolioWorkflowStatus.Retired],
  );
  const { rows } = await db.query(
    `${baseSelect} ${where} GROUP BY pw.id, ak.id, oak.id, pw.exchange_key_id, ek.id LIMIT $3 OFFSET $4`,
    [userId, PortfolioWorkflowStatus.Retired, limit, offset],
  );
  return {
    rows: convertKeysToCamelCase(rows) as PortfolioWorkflow[],
    total: Number(totalRes.rows[0].count),
  };
}

export async function findIdenticalDraftWorkflow(
  data: PortfolioWorkflowDraftSearch,
  excludeId?: string,
) {
  const query = `SELECT pw.id, pw.name FROM portfolio_workflow pw
    LEFT JOIN (
      SELECT portfolio_workflow_id,
             json_agg(json_build_object('token', token, 'min_allocation', min_allocation) ORDER BY position) AS tokens
        FROM portfolio_workflow_tokens GROUP BY portfolio_workflow_id
    ) t ON t.portfolio_workflow_id = pw.id
    WHERE pw.user_id = $1 AND pw.status = 'draft' AND ($2::bigint IS NULL OR pw.id != $2)
      AND pw.model = $3 AND pw.name = $4 AND pw.cash_token = $5
      AND pw.risk = $6 AND pw.review_interval = $7 AND pw.agent_instructions = $8 AND pw.manual_rebalance = $9 AND pw.use_earn = $10
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
            SELECT pw.id, pw.name, pw.cash_token AS token
              FROM portfolio_workflow pw
             WHERE pw.user_id = $1
               AND pw.status = 'active'
               AND ($2::bigint IS NULL OR pw.id != $2)
               AND pw.cash_token = ANY($3::text[])
            UNION
            SELECT pw.id, pw.name, t.token
              FROM portfolio_workflow pw
              JOIN portfolio_workflow_tokens t ON t.portfolio_workflow_id = pw.id
             WHERE pw.user_id = $1
               AND pw.status = 'active'
               AND ($2::bigint IS NULL OR pw.id != $2)
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

export async function insertPortfolioWorkflow(
  data: PortfolioWorkflowInsert,
): Promise<PortfolioWorkflow> {
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
  return (await getPortfolioWorkflow(id))!;
}

export async function updatePortfolioWorkflow(
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

export async function deletePortfolioWorkflow(id: string): Promise<void> {
  await db.query(
    'UPDATE portfolio_workflow SET status = $1, start_balance = NULL WHERE id = $2',
    [PortfolioWorkflowStatus.Retired, id],
  );
}

export async function startPortfolioWorkflow(
  id: string,
  startBalance: number,
): Promise<void> {
  await db.query(
    'UPDATE portfolio_workflow SET status = $1, start_balance = $2 WHERE id = $3',
    [PortfolioWorkflowStatus.Active, startBalance, id],
  );
}

export async function stopPortfolioWorkflow(id: string): Promise<void> {
  await db.query(
    'UPDATE portfolio_workflow SET status = $1, start_balance = NULL WHERE id = $2',
    [PortfolioWorkflowStatus.Inactive, id],
  );
}

export async function getActivePortfolioWorkflowById(
  portfolioWorkflowId: string,
): Promise<ActivePortfolioWorkflow | undefined> {
  const sql = `SELECT pw.id, pw.user_id, pw.model,
                      pw.cash_token, COALESCE(t.tokens, '[]') AS tokens,
                      pw.risk, pw.review_interval, pw.agent_instructions,
                      COALESCE(pw.ai_api_key_id, ak.id, oak.id) AS ai_api_key_id,
                      CASE
                        WHEN pw.ai_api_key_id IS NOT NULL THEN wak.api_key_enc
                        WHEN ak.id IS NOT NULL THEN ak.api_key_enc
                        ELSE oak.api_key_enc
                      END AS ai_api_key_enc,
                      COALESCE(pw.exchange_key_id, ek.id) AS exchange_api_key_id,
                      pw.manual_rebalance,
                      pw.use_earn,
                      pw.start_balance,
                      pw.created_at,
                      pw.id AS portfolio_id
                 FROM portfolio_workflow pw
                 LEFT JOIN ai_api_keys ak ON ak.user_id = pw.user_id AND ak.provider = 'openai'
                 LEFT JOIN ai_api_key_shares s ON s.target_user_id = pw.user_id
                 LEFT JOIN ai_api_keys oak ON oak.user_id = s.owner_user_id AND oak.provider = 'openai'
                 LEFT JOIN ai_api_keys wak ON wak.id = pw.ai_api_key_id
                 LEFT JOIN exchange_keys ek ON ek.user_id = pw.user_id AND ek.provider = 'binance'
                 LEFT JOIN LATERAL (
                   SELECT json_agg(json_build_object('token', token, 'min_allocation', min_allocation) ORDER BY position) AS tokens
                     FROM portfolio_workflow_tokens
                    WHERE portfolio_workflow_id = pw.id
                 ) t ON true
                WHERE pw.status = 'active' AND pw.id = $1`;
  const { rows } = await db.query(sql, [portfolioWorkflowId]);
  if (!rows[0]) return undefined;
  return convertKeysToCamelCase(rows[0]) as ActivePortfolioWorkflow;
}

export async function getActivePortfolioWorkflowsByInterval(
  interval: string,
): Promise<ActivePortfolioWorkflow[]> {
  const sql = `SELECT pw.id, pw.user_id, pw.model,
                      pw.cash_token, COALESCE(t.tokens, '[]') AS tokens,
                      pw.risk, pw.review_interval, pw.agent_instructions,
                      COALESCE(pw.ai_api_key_id, ak.id, oak.id) AS ai_api_key_id,
                      CASE
                        WHEN pw.ai_api_key_id IS NOT NULL THEN wak.api_key_enc
                        WHEN ak.id IS NOT NULL THEN ak.api_key_enc
                        ELSE oak.api_key_enc
                      END AS ai_api_key_enc,
                      COALESCE(pw.exchange_key_id, ek.id) AS exchange_api_key_id,
                      pw.manual_rebalance,
                      pw.use_earn,
                      pw.start_balance,
                      pw.created_at,
                      pw.id AS portfolio_id
                 FROM portfolio_workflow pw
                 LEFT JOIN ai_api_keys ak ON ak.user_id = pw.user_id AND ak.provider = 'openai'
                 LEFT JOIN ai_api_key_shares s ON s.target_user_id = pw.user_id
                 LEFT JOIN ai_api_keys oak ON oak.user_id = s.owner_user_id AND oak.provider = 'openai'
                 LEFT JOIN ai_api_keys wak ON wak.id = pw.ai_api_key_id
                 LEFT JOIN exchange_keys ek ON ek.user_id = pw.user_id AND ek.provider = 'binance'
                 LEFT JOIN LATERAL (
                   SELECT json_agg(json_build_object('token', token, 'min_allocation', min_allocation) ORDER BY position) AS tokens
                     FROM portfolio_workflow_tokens
                    WHERE portfolio_workflow_id = pw.id
                 ) t ON true
                WHERE pw.status = 'active' AND pw.review_interval = $1`;
  const { rows } = await db.query(sql, [interval]);
  return convertKeysToCamelCase(rows) as ActivePortfolioWorkflow[];
}

const activePortfolioWorkflowSelect = `SELECT pw.id, pw.user_id, pw.model,
                      pw.cash_token, COALESCE(t.tokens, '[]') AS tokens,
                      pw.risk, pw.review_interval, pw.agent_instructions,
                      COALESCE(pw.ai_api_key_id, ak.id, oak.id) AS ai_api_key_id,
                      CASE
                        WHEN pw.ai_api_key_id IS NOT NULL THEN wak.api_key_enc
                        WHEN ak.id IS NOT NULL THEN ak.api_key_enc
                        ELSE oak.api_key_enc
                      END AS ai_api_key_enc,
                      COALESCE(pw.exchange_key_id, ek.id) AS exchange_api_key_id,
                      pw.manual_rebalance,
                      pw.use_earn,
                      pw.start_balance,
                      pw.created_at,
                      pw.id AS portfolio_id
                 FROM portfolio_workflow pw
                 LEFT JOIN ai_api_keys ak ON ak.user_id = pw.user_id AND ak.provider = 'openai'
                 LEFT JOIN ai_api_key_shares s ON s.target_user_id = pw.user_id
                 LEFT JOIN ai_api_keys oak ON oak.user_id = s.owner_user_id AND oak.provider = 'openai'
                 LEFT JOIN ai_api_keys wak ON wak.id = pw.ai_api_key_id
                 LEFT JOIN exchange_keys ek ON ek.user_id = pw.user_id AND ek.provider = 'binance'
                 LEFT JOIN LATERAL (
                   SELECT json_agg(json_build_object('token', token, 'min_allocation', min_allocation) ORDER BY position) AS tokens
                     FROM portfolio_workflow_tokens
                    WHERE portfolio_workflow_id = pw.id
                 ) t ON true`;

export async function getActivePortfolioWorkflowsByUser(
  userId: string,
): Promise<ActivePortfolioWorkflow[]> {
  const sql = `${activePortfolioWorkflowSelect}
                WHERE pw.status = 'active' AND pw.user_id = $1`;
  const { rows } = await db.query(sql, [userId]);
  return convertKeysToCamelCase(rows) as ActivePortfolioWorkflow[];
}

export async function getActivePortfolioWorkflowsByUserAndAiKey(
  userId: string,
  aiKeyId: string,
): Promise<ActivePortfolioWorkflow[]> {
  const sql = `${activePortfolioWorkflowSelect}
                WHERE pw.status = 'active'
                  AND pw.user_id = $1
                  AND COALESCE(
                        pw.ai_api_key_id,
                        (
                          SELECT ak.id
                            FROM ai_api_keys ak
                           WHERE ak.user_id = pw.user_id
                             AND ak.provider = 'openai'
                             AND ak.id = $2
                           LIMIT 1
                        ),
                        (
                          SELECT oak.id
                            FROM ai_api_key_shares s
                            JOIN ai_api_keys oak
                              ON oak.user_id = s.owner_user_id
                             AND oak.provider = 'openai'
                           WHERE s.target_user_id = pw.user_id
                             AND oak.id = $2
                           LIMIT 1
                        )
                      ) = $2`;
  const { rows } = await db.query(sql, [userId, aiKeyId]);
  return convertKeysToCamelCase(rows) as ActivePortfolioWorkflow[];
}

export async function getActivePortfolioWorkflowsByUserAndExchangeKey(
  userId: string,
  exchangeKeyId: string,
): Promise<ActivePortfolioWorkflow[]> {
  const sql = `${activePortfolioWorkflowSelect}
                WHERE pw.status = 'active'
                  AND pw.user_id = $1
                  AND COALESCE(pw.exchange_key_id, ek.id) = $2`;
  const { rows } = await db.query(sql, [userId, exchangeKeyId]);
  return convertKeysToCamelCase(rows) as ActivePortfolioWorkflow[];
}

export async function deactivateWorkflowsByUser(
  userId: string,
  aiKeyId?: string | null,
): Promise<void> {
  if (!aiKeyId) {
    await db.query(
      `UPDATE portfolio_workflow SET status = $1, start_balance = NULL WHERE user_id = $2 AND status = $3`,
      [PortfolioWorkflowStatus.Inactive, userId, PortfolioWorkflowStatus.Active],
    );
    return;
  }

  await db.query(
    `UPDATE portfolio_workflow AS pw
        SET status = $1,
            start_balance = NULL
      WHERE pw.user_id = $2
        AND pw.status = $3
        AND COALESCE(
              pw.ai_api_key_id,
              (
                SELECT ak.id
                  FROM ai_api_keys ak
                 WHERE ak.user_id = pw.user_id
                   AND ak.provider = 'openai'
                   AND ak.id = $4
                 LIMIT 1
              ),
              (
                SELECT oak.id
                  FROM ai_api_key_shares s
                  JOIN ai_api_keys oak
                    ON oak.user_id = s.owner_user_id
                   AND oak.provider = 'openai'
                 WHERE s.target_user_id = pw.user_id
                   AND oak.id = $4
                 LIMIT 1
              )
            ) = $4`,
    [PortfolioWorkflowStatus.Inactive, userId, PortfolioWorkflowStatus.Active, aiKeyId],
  );
}

export async function deactivateWorkflowsByIds(
  workflowIds: string[],
): Promise<void> {
  if (!workflowIds.length) return;
  const ids = workflowIds.map((id) => Number(id));
  await db.query(
    `UPDATE portfolio_workflow
        SET status = $1,
            start_balance = NULL
      WHERE id = ANY($2::bigint[])
        AND status = $3`,
    [PortfolioWorkflowStatus.Inactive, ids, PortfolioWorkflowStatus.Active],
  );
}
