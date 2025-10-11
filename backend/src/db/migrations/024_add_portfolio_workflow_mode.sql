CREATE TYPE portfolio_workflow_mode AS ENUM ('spot', 'futures');

CREATE TYPE portfolio_workflow_futures_margin_mode AS ENUM ('cross', 'isolated');

ALTER TABLE portfolio_workflow
  ADD COLUMN mode portfolio_workflow_mode NOT NULL DEFAULT 'spot',
  ADD COLUMN futures_default_leverage INTEGER,
  ADD COLUMN futures_margin_mode portfolio_workflow_futures_margin_mode;
