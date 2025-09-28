-- Backfill workflows created before the draft status removal
UPDATE portfolio_workflow
SET status = 'inactive'
WHERE status = 'draft';
