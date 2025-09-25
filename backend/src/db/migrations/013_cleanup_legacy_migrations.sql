DELETE FROM migrations
WHERE id IN (
  '001_add_agent_review_result_raw_log_id.sql',
  '002_add_model_to_ai_api_key_shares.sql',
  '003_add_news_table.sql',
  '004_add_news_tokens_index.sql',
  '005_rename_agents_to_portfolio_workflow.sql',
  '006_rename_agent_tokens_to_portfolio_workflow_tokens.sql',
  '007_add_use_earn_to_portfolio_workflow.sql',
  '008_add_cash_token_to_portfolio_workflow.sql',
  '009_add_cancellation_reason_to_limit_order.sql',
  '010_purge_portfolios.sql',
  '011_remove_new_allocation_from_agent_review_result.sql',
  '012_rename_agent_review_columns.sql'
);

