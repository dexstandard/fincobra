ALTER TABLE portfolio_workflow
  ADD COLUMN trade_mode TEXT NOT NULL DEFAULT 'spot';

CREATE TABLE IF NOT EXISTS futures_position_plan(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  planned_json TEXT NOT NULL,
  status TEXT NOT NULL,
  review_result_id BIGINT NOT NULL REFERENCES review_result(id),
  position_id TEXT NOT NULL,
  cancellation_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS idx_futures_position_plan_review_result_id_status
  ON futures_position_plan(review_result_id, status);
CREATE INDEX IF NOT EXISTS idx_futures_position_plan_user_id_status
  ON futures_position_plan(user_id, status);
CREATE INDEX IF NOT EXISTS idx_futures_position_plan_position_id
  ON futures_position_plan(position_id);
