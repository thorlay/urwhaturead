export type Source = {
  id: number
  owner_user_id: number | null
  name: string
  rss_url: string
  site_key: string
  category: string
  enabled: boolean
  poll_interval_sec: number
  created_at: string
  updated_at: string
}

export type FeedItem = {
  id: number
  source_id: number
  source_name: string
  source_category: string
  title: string
  link: string
  summary?: string
  author?: string
  published_at?: string
  image_url?: string
  created_at: string
}

export type FeedResponse = {
  data: FeedItem[]
  meta: {
    limit: number
    count: number
    next_cursor: string
  }
}

export type SourcesResponse = {
  data: Source[]
  meta: {
    limit: number
    offset: number
    count: number
  }
}

export type ArticleDetail = {
  id: number
  source_id: number
  source_name: string
  source_category: string
  raw_guid?: string
  title: string
  link: string
  summary?: string
  content?: string
  author?: string
  published_at?: string
  image_url?: string
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
  category: string
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

export type ArticleSummaryResponse = {
  data: {
    article_id: number
    summary: string
    model: string
    input_chars: number
    truncated: boolean
    provider: string
    generated_at: string
    cache_hit: boolean
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
