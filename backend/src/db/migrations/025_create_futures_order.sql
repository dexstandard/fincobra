CREATE TABLE futures_order (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  planned_json TEXT NOT NULL,
  status TEXT NOT NULL,
  review_result_id BIGINT NOT NULL REFERENCES review_result(id),
  order_id TEXT NOT NULL,
  failure_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX idx_futures_order_review_result_id
  ON futures_order(review_result_id);

CREATE INDEX idx_futures_order_user_id_status
  ON futures_order(user_id, status);
