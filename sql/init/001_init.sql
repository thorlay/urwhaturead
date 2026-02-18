CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sources (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT REFERENCES users(id),
  name TEXT NOT NULL,
  rss_url TEXT NOT NULL,
  site_key TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  poll_interval_sec INT NOT NULL DEFAULT 900,
  etag TEXT,
  last_modified TEXT,
  last_fetched_at TIMESTAMPTZ,
  consecutive_failures INT NOT NULL DEFAULT 0,
  last_error_at TIMESTAMPTZ,
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, rss_url)
);

CREATE TABLE IF NOT EXISTS user_source_subscriptions (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, source_id)
);

CREATE TABLE IF NOT EXISTS articles (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  raw_guid TEXT,
  link TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  content TEXT,
  author TEXT,
  published_at TIMESTAMPTZ,
  image_url TEXT,
  tags TEXT[],
  content_hash TEXT NOT NULL,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS source_fetch_logs (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL,
  http_status INT,
  item_count INT NOT NULL DEFAULT 0,
  duration_ms INT,
  error_message TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_articles_source_guid
ON articles(source_id, raw_guid) WHERE raw_guid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_articles_source_link
ON articles(source_id, link);

CREATE INDEX IF NOT EXISTS ix_articles_published_at
ON articles(published_at DESC);

CREATE INDEX IF NOT EXISTS ix_articles_source_id
ON articles(source_id);
