export type Source = {
  id: number
  owner_user_id: number | null
  name: string
  rss_url: string
  site_key: string
  kind?: 'feed' | 'thread' | string
  topic_url?: string
  hidden_in_sidebar?: boolean
  tags?: string[]
  new_articles_24h?: number
  click_count?: number
  last_clicked_at?: string
  last_fetched_at?: string
  ai_briefing_enabled?: boolean
  ai_briefing_interval_min?: number
  ai_briefing_last_run_at?: string
  ai_briefing_last_generated_at?: string
  enabled: boolean
  poll_interval_sec: number
  created_at: string
  updated_at: string
}

export type SourceTransferItem = {
  name: string
  rss_url: string
  tags?: string[]
  enabled?: boolean
  poll_interval_sec?: number
  kind?: 'feed' | 'thread' | string
  hidden_in_sidebar?: boolean
}

export type SourceExportPayload = {
  version: string
  exported_at: string
  count: number
  sources: SourceTransferItem[]
}

export type SourceImportResult = {
  rss_url: string
  source_id?: number
  action: 'created' | 'updated' | 'skipped' | 'failed' | string
  error?: string
}

export type SourceImportResponse = {
  ok: boolean
  meta: {
    total: number
    created: number
    updated: number
    skipped: number
    failed: number
  }
  data: SourceImportResult[]
}

export type FeedItem = {
  id: number
  source_id: number
  cluster_id?: number
  source_name: string
  source_tag: string
  title: string
  link: string
  summary?: string
  content?: string
  author?: string
  published_at?: string
  image_url?: string
  reply_count?: number
  duplicate_count?: number
  created_at: string
}

export type FeedResponse = {
  data: FeedItem[]
  meta: {
    limit: number
    count: number
    next_cursor: string
    elapsed_ms?: number
    dedupe?: boolean
    dedupe_candidate_limit?: number
    since?: string
    total_count?: number
  }
}

export type SourcesResponse = {
  data: Source[]
  meta: {
    limit: number
    offset: number
    count: number
    elapsed_ms?: number
  }
}

export type ArticleDetail = {
  id: number
  source_id: number
  source_name: string
  source_tag: string
  raw_guid?: string
  title: string
  link: string
  summary?: string
  content?: string
  content_html?: string
  author?: string
  published_at?: string
  image_url?: string
  reply_count?: number
  enrichment_status?: 'loading' | 'complete' | 'failed'
  external?: {
    url: string
    title: string
    content: string
    truncated: boolean
  }
  thread?: {
    topic_url: string
    feed_url: string
    topic_title: string
    full_content: string
    total_posts: number
    truncated: boolean
    comments: Array<{
      post_number: number
      author: string
      published_at?: string
      link: string
      content: string
    }>
  }
  created_at: string
}

export type FeedTestResult = {
  ok: boolean
  source_id: number
  url: string
  http_status: number
  feed_type: string
  title: string
  item_count: number
}

export type SourceStatus = {
  source_id: number
  name: string
  primary_tag: string
  enabled: boolean
  rss_url: string
  poll_interval_sec: number
  effective_poll_interval_sec: number
  consecutive_failures: number
  last_fetched_at?: string
  last_error_at?: string
  latest_status?: string
  latest_fetched_at?: string
  latest_http_status?: number
  latest_item_count?: number
  latest_duration_ms?: number
  last_error?: string
  next_due_at?: string
  is_stale: boolean
  window_hours: number
  window_total: number
  window_success: number
  window_not_modified: number
  window_failed: number
  window_success_rate: number
  health: 'ok' | 'warn' | 'error' | 'stale' | 'disabled' | 'new'
}

export type SourceStatusResponse = {
  data: SourceStatus[]
  meta: {
    window_hours: number
    count: number
    generated_at: string
  }
}

export type SystemComponentStatus = {
  status: 'ok' | 'warn' | 'error' | 'disabled' | string
  detail?: string
  latency_ms?: number
}

export type SystemStatusResponse = {
  data: {
    api: SystemComponentStatus
    db: SystemComponentStatus
    rsshub: SystemComponentStatus
    ai: SystemComponentStatus
    version: string
    uptime_sec: number
    checked_at: string
  }
}

export type ArticleSummaryResponse = {
  data: {
    article_id: number
    summary: string
    model: string
    input_chars: number
    truncated: boolean
    stop_reason: string
    provider: string
    generated_at: string
    cache_hit: boolean
  }
}

export type ArticleSummaryLibraryItem = {
  article_id: number
  source_id: number
  source_name: string
  title: string
  link: string
  published_at?: string
  summary: string
  model: string
  provider: string
  input_chars: number
  truncated: boolean
  stop_reason: string
  generated_at: string
}

export type ArticleSummaryLibraryResponse = {
  data: ArticleSummaryLibraryItem[]
  meta: {
    limit: number
    offset: number
    count: number
  }
}

export type FeedBriefingLibraryItem = {
  digest_key: string
  scope_label: string
  tag: string
  keyword: string
  source_ids: string
  article_ids: string
  article_refs: Array<{
    id: number
    source_id: number
    source_name: string
    title: string
    link: string
    published_at?: string
  }>
  limit: number
  summary: string
  model: string
  provider: string
  input_chars: number
  truncated: boolean
  stop_reason: string
  generated_at: string
  article_count: number
}

export type FeedBriefingLibraryResponse = {
  data: FeedBriefingLibraryItem[]
  meta: {
    limit: number
    offset: number
    count: number
  }
}

export type ArticleSummaryStatusResponse = {
  data: {
    article_id: number
    model: string
    status: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed'
    error?: string
    updated_at: string
  }
}

export type TrackThreadResponse = {
  ok: boolean
  created: boolean
  article_id: number
  topic_url: string
  feed_url: string
  source: Source
}

export type DiscoverSourceCandidate = {
  rss_url: string
  name: string
  feed_type: string
  item_count: number
  http_status: number
  confidence: 'high' | 'medium' | 'low'
  reason: string
  existing: boolean
  source_id?: number
  source_name?: string
  suggested_tag: string
}

export type DiscoverSourcesResponse = {
  data: DiscoverSourceCandidate[]
  meta: {
    seed_url: string
    count: number
    probed_count: number
  }
}

export type ReclassifySourceResult = {
  source_id: number
  name: string
  rss_url: string
  old_tags: string[]
  new_tags: string[]
  changed: boolean
  reason: string
  error?: string
}

export type ReclassifySourcesResponse = {
  data: ReclassifySourceResult[]
  meta: {
    count: number
    changed: number
    errors: number
    only_general: boolean
    probe: boolean
    dry_run: boolean
    limit: number
  }
}

export type FeedBriefingResponse = {
  data: {
    digest_key: string
    summary: string
    model: string
    provider: string
    input_chars: number
    truncated: boolean
    stop_reason: string
    generated_at: string
    cache_hit: boolean
    article_count: number
    input_items: FeedBriefingInputItem[]
  }
}

export type FeedBriefingInputItem = {
  id: number
  source_id: number
  source_name: string
  title: string
  link: string
  published_at?: string
}

export type AdminLoginResponse = {
  ok: boolean
  username: string
  expires_in_sec: number
}

export type AdminSessionResponse = {
  data: {
    enabled: boolean
    configured: boolean
    authenticated: boolean
    username?: string
    ai_model?: string
  }
}
