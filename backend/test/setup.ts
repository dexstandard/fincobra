import { beforeAll, beforeEach, afterAll } from 'vitest';

process.env.DATABASE_URL ??=
  'postgres://postgres:postgres@localhost:5432/fincobra_test';

import { db, migrate } from '../src/db/index.js';

beforeAll(async () => {
  await migrate();
});

beforeEach(async () => {
  await db.query(
    'TRUNCATE TABLE news, review_raw_log, review_result, futures_order, limit_order, portfolio_workflow_tokens, portfolio_workflow, ai_api_key_shares, ai_api_keys, exchange_keys, user_identities, users RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await db.end();
});
