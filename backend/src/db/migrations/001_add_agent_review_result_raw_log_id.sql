ALTER TABLE agent_review_result
  ADD COLUMN raw_log_id BIGINT REFERENCES agent_review_raw_log(id);
