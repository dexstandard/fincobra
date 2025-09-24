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
  model TEXT,
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

CREATE TABLE IF NOT EXISTS portfolio_workflow(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  exchange_key_id BIGINT REFERENCES exchange_keys(id),
  ai_api_key_id BIGINT REFERENCES ai_api_keys(id),
  model TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  start_balance REAL,
  name VARCHAR(100),
  cash_token VARCHAR(20) NOT NULL DEFAULT 'USDT',
  risk VARCHAR(20) NOT NULL,
  review_interval VARCHAR(20) NOT NULL,
  agent_instructions VARCHAR(1000) NOT NULL,
  manual_rebalance BOOLEAN NOT NULL DEFAULT FALSE,
  use_earn BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS portfolio_workflow_tokens(
  portfolio_workflow_id BIGINT NOT NULL REFERENCES portfolio_workflow(id) ON DELETE CASCADE,
  token VARCHAR(20) NOT NULL,
  min_allocation INTEGER NOT NULL DEFAULT 0,
  position SMALLINT NOT NULL,
  PRIMARY KEY(portfolio_workflow_id, position),
  UNIQUE(portfolio_workflow_id, token)
);

CREATE TABLE IF NOT EXISTS review_raw_log(
  id BIGSERIAL PRIMARY KEY,
  portfolio_workflow_id BIGINT NOT NULL REFERENCES portfolio_workflow(id),
  prompt TEXT NOT NULL,
  response TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS review_result(
  id BIGSERIAL PRIMARY KEY,
  portfolio_workflow_id BIGINT NOT NULL REFERENCES portfolio_workflow(id),
  log TEXT NOT NULL,
  rebalance BOOLEAN NOT NULL DEFAULT FALSE,
  short_report TEXT,
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  raw_log_id BIGINT REFERENCES review_raw_log(id)
);

CREATE TABLE IF NOT EXISTS limit_order(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  planned_json TEXT NOT NULL,
  status TEXT NOT NULL,
  review_result_id BIGINT NOT NULL REFERENCES review_result(id),
  order_id TEXT NOT NULL,
  cancellation_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS news(
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  link TEXT NOT NULL UNIQUE,
  pub_date TIMESTAMP,
  tokens TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS idx_users_email_enc ON users(email_enc);
CREATE INDEX IF NOT EXISTS idx_portfolio_workflow_user_id_status ON portfolio_workflow(user_id, status);
CREATE INDEX IF NOT EXISTS idx_portfolio_workflow_status_review_interval ON portfolio_workflow(status, review_interval);
CREATE INDEX IF NOT EXISTS idx_portfolio_workflow_tokens_portfolio_workflow_id ON portfolio_workflow_tokens(portfolio_workflow_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_workflow_tokens_token ON portfolio_workflow_tokens(token);
CREATE INDEX IF NOT EXISTS idx_review_raw_log_portfolio_workflow_id ON review_raw_log(portfolio_workflow_id);
CREATE INDEX IF NOT EXISTS idx_review_result_portfolio_workflow_id_created_at ON review_result(portfolio_workflow_id, created_at);
CREATE INDEX IF NOT EXISTS idx_limit_order_review_result_id_status ON limit_order(review_result_id, status);
CREATE INDEX IF NOT EXISTS idx_limit_order_user_id_status ON limit_order(user_id, status);
CREATE INDEX IF NOT EXISTS idx_limit_order_order_id ON limit_order(order_id);
CREATE INDEX IF NOT EXISTS idx_news_pub_date ON news(pub_date);
CREATE INDEX IF NOT EXISTS idx_news_tokens ON news USING GIN (tokens);
