CREATE EXTENSION IF NOT EXISTS vector;

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
  kind TEXT NOT NULL DEFAULT 'feed',
  topic_url TEXT,
  hidden_in_sidebar BOOLEAN NOT NULL DEFAULT FALSE,
  tags TEXT[] NOT NULL DEFAULT '{}',
  click_count BIGINT NOT NULL DEFAULT 0,
  last_clicked_at TIMESTAMPTZ,
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
  cluster_id BIGINT,
  raw_guid TEXT,
  link TEXT NOT NULL,
  canonical_link TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL DEFAULT '',
  summary TEXT,
  content TEXT,
  author TEXT,
  published_at TIMESTAMPTZ,
  image_url TEXT,
  reply_count INT,
  tags TEXT[],
  content_hash TEXT NOT NULL,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS article_enrichments (
  article_id BIGINT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  thread JSONB,
  external JSONB,
  fetched_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_article_enrichments_fetched_at
ON article_enrichments(fetched_at DESC);

CREATE TABLE IF NOT EXISTS event_clusters (
  id BIGSERIAL PRIMARY KEY,
  canonical_link TEXT NOT NULL DEFAULT '',
  normalized_title TEXT NOT NULL DEFAULT '',
  representative_article_id BIGINT NOT NULL,
  article_count INT NOT NULL DEFAULT 1,
  first_published_at TIMESTAMPTZ,
  last_published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS article_vectors (
  article_id BIGINT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  model TEXT NOT NULL DEFAULT 'hash256-v1',
  embedding VECTOR(256) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

CREATE UNIQUE INDEX IF NOT EXISTS ux_articles_source_content_hash
ON articles(source_id, content_hash);

CREATE INDEX IF NOT EXISTS ix_articles_published_at
ON articles(published_at DESC);

CREATE INDEX IF NOT EXISTS ix_articles_created_at
ON articles(created_at DESC);

CREATE INDEX IF NOT EXISTS ix_articles_feed_sort
ON articles((COALESCE(published_at, created_at)) DESC, id DESC);

CREATE INDEX IF NOT EXISTS ix_articles_source_id
ON articles(source_id);

CREATE INDEX IF NOT EXISTS ix_articles_source_feed_sort
ON articles(source_id, (COALESCE(published_at, created_at)) DESC, id DESC);

CREATE INDEX IF NOT EXISTS ix_sources_click_count
ON sources(click_count DESC, last_clicked_at DESC);

CREATE INDEX IF NOT EXISTS ix_sources_kind_hidden
ON sources(kind, hidden_in_sidebar);

CREATE INDEX IF NOT EXISTS ix_sources_tags_gin
ON sources USING GIN(tags);

CREATE INDEX IF NOT EXISTS ix_articles_cluster_id
ON articles(cluster_id);

CREATE INDEX IF NOT EXISTS ix_articles_cluster_feed_sort
ON articles((COALESCE(cluster_id, id)), (COALESCE(published_at, created_at)) DESC, id DESC);

CREATE INDEX IF NOT EXISTS ix_articles_canonical_link
ON articles(canonical_link);

CREATE INDEX IF NOT EXISTS ix_articles_normalized_title
ON articles(normalized_title);

CREATE INDEX IF NOT EXISTS ix_event_clusters_last_published_at
ON event_clusters(last_published_at DESC);

CREATE INDEX IF NOT EXISTS ix_article_vectors_created_at
ON article_vectors(created_at DESC);

CREATE INDEX IF NOT EXISTS ix_article_vectors_embedding_ivfflat
ON article_vectors USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
