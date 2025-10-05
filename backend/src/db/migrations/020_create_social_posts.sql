CREATE TABLE social_posts(
  id BIGSERIAL PRIMARY KEY,
  tweet_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  display_name TEXT,
  profile_image_url TEXT,
  text TEXT NOT NULL,
  permalink TEXT,
  posted_at TIMESTAMP NOT NULL,
  tokens TEXT[] NOT NULL,
  weight REAL NOT NULL,
  collected_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX idx_social_posts_posted_at ON social_posts(posted_at);
CREATE INDEX idx_social_posts_tokens ON social_posts USING GIN (tokens);
