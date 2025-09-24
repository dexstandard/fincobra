CREATE TABLE IF NOT EXISTS migrations(
  id TEXT PRIMARY KEY,
  run_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS users(
  id BIGSERIAL PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'user',
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  totp_secret_enc TEXT,
  is_totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  email_enc TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS user_identities(
  user_id BIGINT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  sub TEXT NOT NULL,
  UNIQUE(provider, sub)
);

CREATE TABLE IF NOT EXISTS ai_api_keys(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  api_key_enc TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS ai_api_key_shares(
  owner_user_id BIGINT NOT NULL REFERENCES users(id),
  target_user_id BIGINT PRIMARY KEY REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS exchange_keys(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  api_key_enc TEXT NOT NULL,
  api_secret_enc TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS agents(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  exchange_key_id BIGINT REFERENCES exchange_keys(id),
  ai_api_key_id BIGINT REFERENCES ai_api_keys(id),
  model TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  start_balance REAL,
  name VARCHAR(100),
  risk VARCHAR(20) NOT NULL,
  review_interval VARCHAR(20) NOT NULL,
  agent_instructions VARCHAR(1000) NOT NULL,
  manual_rebalance BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS agent_tokens(
  agent_id BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  token VARCHAR(20) NOT NULL,
  min_allocation INTEGER NOT NULL DEFAULT 0,
  position SMALLINT NOT NULL,
  PRIMARY KEY(agent_id, position),
  UNIQUE(agent_id, token)
);

CREATE TABLE IF NOT EXISTS agent_review_result(
  id BIGSERIAL PRIMARY KEY,
  agent_id BIGINT NOT NULL REFERENCES agents(id),
  log TEXT NOT NULL,
  rebalance BOOLEAN NOT NULL DEFAULT FALSE,
  new_allocation REAL,
  short_report TEXT,
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE TABLE IF NOT EXISTS limit_order(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  planned_json TEXT NOT NULL,
  status TEXT NOT NULL,
  review_result_id BIGINT NOT NULL REFERENCES agent_review_result(id),
  order_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS agent_review_raw_log(
  id BIGSERIAL PRIMARY KEY,
  agent_id BIGINT NOT NULL REFERENCES agents(id),
  prompt TEXT NOT NULL,
  response TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS idx_agent_review_result_agent_id_created_at
  ON agent_review_result(agent_id, created_at);

-- Indexes to optimize agent lookups
CREATE INDEX IF NOT EXISTS idx_agent_tokens_agent_id ON agent_tokens(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_tokens_token ON agent_tokens(token);

-- Additional indexes for query efficiency
CREATE INDEX IF NOT EXISTS idx_users_email_enc ON users(email_enc);
CREATE INDEX IF NOT EXISTS idx_agents_user_id_status ON agents(user_id, status);
CREATE INDEX IF NOT EXISTS idx_agents_status_review_interval ON agents(status, review_interval);
CREATE INDEX IF NOT EXISTS idx_limit_order_review_result_id_status ON limit_order(review_result_id, status);
CREATE INDEX IF NOT EXISTS idx_limit_order_user_id_status ON limit_order(user_id, status);
CREATE INDEX IF NOT EXISTS idx_limit_order_order_id ON limit_order(order_id);
CREATE INDEX IF NOT EXISTS idx_agent_review_raw_log_agent_id ON agent_review_raw_log(agent_id);
