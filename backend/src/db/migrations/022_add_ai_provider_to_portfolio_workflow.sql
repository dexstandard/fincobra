ALTER TABLE portfolio_workflow
  ADD COLUMN ai_provider TEXT NOT NULL DEFAULT 'openai';

ALTER TABLE portfolio_workflow
  ALTER COLUMN ai_provider DROP DEFAULT;
