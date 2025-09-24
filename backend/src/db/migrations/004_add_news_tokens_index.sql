CREATE INDEX IF NOT EXISTS idx_news_tokens ON news USING GIN (tokens);
