ALTER TABLE portfolio_workflow ADD COLUMN ai_provider TEXT;
UPDATE portfolio_workflow SET ai_provider = 'openai' WHERE ai_provider IS NULL;
ALTER TABLE portfolio_workflow ALTER COLUMN ai_provider SET NOT NULL;
ALTER TABLE portfolio_workflow ALTER COLUMN ai_provider SET DEFAULT 'openai';
