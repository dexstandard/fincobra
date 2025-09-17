ALTER TABLE agent_review_result
  RENAME COLUMN agent_id TO portfolio_workflow_id;

ALTER TABLE agent_review_result
  RENAME TO review_result;

ALTER INDEX IF EXISTS idx_agent_review_result_agent_id_created_at
  RENAME TO idx_review_result_portfolio_workflow_id_created_at;

ALTER SEQUENCE IF EXISTS agent_review_result_id_seq
  RENAME TO review_result_id_seq;

ALTER TABLE agent_review_raw_log
  RENAME COLUMN agent_id TO portfolio_workflow_id;

ALTER TABLE agent_review_raw_log
  RENAME TO review_raw_log;

ALTER INDEX IF EXISTS idx_agent_review_raw_log_agent_id
  RENAME TO idx_review_raw_log_portfolio_workflow_id;

ALTER SEQUENCE IF EXISTS agent_review_raw_log_id_seq
  RENAME TO review_raw_log_id_seq;
