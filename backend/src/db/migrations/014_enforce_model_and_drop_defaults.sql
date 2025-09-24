-- Ensure shared AI keys always have an explicit model
UPDATE ai_api_key_shares
SET model = 'gpt-5-nano'
WHERE model IS NULL OR LENGTH(TRIM(model)) = 0;

ALTER TABLE ai_api_key_shares
  ALTER COLUMN model SET NOT NULL;

-- Require callers to provide the desired cash token explicitly
ALTER TABLE portfolio_workflow
  ALTER COLUMN cash_token DROP DEFAULT;

-- Require explicit news tokens at insert time
ALTER TABLE news
  ALTER COLUMN tokens DROP DEFAULT;
