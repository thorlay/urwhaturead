import type {
  AdminLoginResponse,
  AdminSessionResponse,
  ArticleSummaryResponse,
  ArticleSummaryLibraryResponse,
  ArticleSummaryStatusResponse,
  DiscoverSourcesResponse,
  ArticleDetail,
  FeedBriefingResponse,
  FeedBriefingLibraryResponse,
  FeedResponse,
  FeedTestResult,
  ReclassifySourcesResponse,
  Source,
  SourceExportPayload,
  SourceImportResponse,
  SourceStatusResponse,
  SourcesResponse,
  SystemStatusResponse,
  TrackThreadResponse,
} from './types'

function isWriteMethod(method?: string): boolean {
  const value = (method ?? 'GET').toUpperCase()
  return value === 'POST' || value === 'PUT' || value === 'PATCH' || value === 'DELETE'
}

function getAdminToken(): string {
  if (typeof window === 'undefined') {
    return ''
  }
  try {
    return window.localStorage.getItem('quick_admin_token')?.trim() ?? ''
  } catch {
    return ''
  }
}

function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  if (isWriteMethod(init?.method) && !headers.has('Authorization') && !headers.has('X-Admin-Token')) {
    const token = getAdminToken()
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
  }
  return headers
}

function buildAdminHeaders(): HeadersInit {
  const token = getAdminToken()
  if (!token) {
    return {}
  }
  return {
    Authorization: `Bearer ${token}`,
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: buildHeaders(init),
  })

  if (!response.ok) {
    const fallback = `${response.status} ${response.statusText}`
    let message = fallback

    try {
      const payload = (await response.json()) as { error?: string; details?: string }
      if (payload.error) {
        message = payload.details ? `${payload.error}: ${payload.details}` : payload.error
      }
    } catch {
      // keep fallback
    }

    throw new Error(message)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `${response.status} ${response.statusText}`
  try {
    const payload = (await response.json()) as { error?: string; details?: string }
    if (payload.error) {
      return payload.details ? `${payload.error}: ${payload.details}` : payload.error
    }
  } catch {
    // keep fallback
  }
  return fallback
}

export async function listSources(): Promise<Source[]> {
  const data = await request<SourcesResponse>('/api/v1/sources?limit=100')
  return data.data
}

export async function getSystemStatus(): Promise<SystemStatusResponse> {
  return request<SystemStatusResponse>('/api/v1/system/status', {
    headers: buildAdminHeaders(),
  })
}

export async function createSource(payload: {
  name?: string
  rss_url: string
  tags?: string[]
  ai_briefing_enabled?: boolean
  ai_briefing_interval_min?: number
}): Promise<Source> {
  return request<Source>('/api/v1/sources', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateSource(
  sourceID: number,
  payload: {
    name?: string
    rss_url?: string
    tags?: string[]
    enabled?: boolean
    poll_interval_sec?: number
    ai_briefing_enabled?: boolean
    ai_briefing_interval_min?: number
  },
): Promise<Source> {
  return request<Source>(`/api/v1/sources/${sourceID}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function deleteSource(sourceID: number): Promise<void> {
  return request<void>(`/api/v1/sources/${sourceID}`, {
    method: 'DELETE',
  })
}

export async function testSource(sourceID: number): Promise<FeedTestResult> {
  return request<FeedTestResult>(`/api/v1/sources/${sourceID}/test`, {
    method: 'POST',
  })
}

export async function refreshSource(sourceID: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/sources/${sourceID}/refresh`, {
    method: 'POST',
  })
}

export async function listFeed(params: {
  limit?: number
  cursor?: string
  tag?: string
  sourceID?: string
  keyword?: string
  since?: string
  includeHidden?: boolean
}): Promise<FeedResponse> {
  const query = new URLSearchParams()
  query.set('limit', String(params.limit ?? 20))
  if (params.cursor) query.set('cursor', params.cursor)
  if (params.tag) query.set('tag', params.tag)
  if (params.sourceID) query.set('source_ids', params.sourceID)
  if (params.keyword) query.set('q', params.keyword)
  if (params.since) query.set('since', params.since)
  if (params.includeHidden) query.set('include_hidden', '1')

  return request<FeedResponse>(`/api/v1/feed?${query.toString()}`)
}

export async function getArticle(articleID: number, onInitial?: (article: ArticleDetail) => void): Promise<ArticleDetail> {
  if (!onInitial) return request<ArticleDetail>(`/api/v1/articles/${articleID}`)
  const article = await request<ArticleDetail>(`/api/v1/articles/${articleID}?enrich=0`)
  onInitial({ ...article, enrichment_status: 'loading' })
  try {
    const enriched = await request<ArticleDetail>(`/api/v1/articles/${articleID}?enrich=1`)
    return { ...enriched, enrichment_status: 'complete' }
  } catch {
    // Optional enrichment must not hide an already readable article.
    return { ...article, enrichment_status: 'failed' }
  }
}

export async function summarizeArticle(
  articleID: number,
  refresh = false,
  model?: string,
): Promise<ArticleSummaryResponse | ArticleSummaryStatusResponse> {
  const query = new URLSearchParams()
  query.set('async', '1')
  if (refresh) query.set('refresh', '1')
  if (model?.trim()) query.set('model', model.trim())

  return request<ArticleSummaryResponse | ArticleSummaryStatusResponse>(
    `/api/v1/articles/${articleID}/summary${query.toString() ? `?${query.toString()}` : ''}`,
    {
      method: 'POST',
    },
  )
}

export async function listArticleSummaries(params?: {
  limit?: number
  offset?: number
  keyword?: string
}): Promise<ArticleSummaryLibraryResponse> {
  const query = new URLSearchParams()
  query.set('limit', String(params?.limit ?? 50))
  query.set('offset', String(params?.offset ?? 0))
  if (params?.keyword?.trim()) query.set('q', params.keyword.trim())
  return request<ArticleSummaryLibraryResponse>(`/api/v1/articles/summaries?${query.toString()}`)
}

export async function getArticleSummaryStatus(articleID: number, model?: string): Promise<ArticleSummaryStatusResponse> {
  const query = new URLSearchParams()
  if (model?.trim()) query.set('model', model.trim())
  return request<ArticleSummaryStatusResponse>(
    `/api/v1/articles/${articleID}/summary/status${query.toString() ? `?${query.toString()}` : ''}`,
  )
}

export async function getArticleSummary(articleID: number, model?: string): Promise<ArticleSummaryResponse | null> {
  const query = new URLSearchParams()
  if (model?.trim()) query.set('model', model.trim())
  const response = await fetch(`/api/v1/articles/${articleID}/summary${query.toString() ? `?${query.toString()}` : ''}`, {
    headers: buildHeaders(),
  })

  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  return (await response.json()) as ArticleSummaryResponse
}

export async function trackArticleThread(articleID: number): Promise<TrackThreadResponse> {
  return request<TrackThreadResponse>(`/api/v1/articles/${articleID}/track-thread`, {
    method: 'POST',
  })
}

export async function listSourceStatus(windowHours = 24): Promise<SourceStatusResponse> {
  return request<SourceStatusResponse>(`/api/v1/admin/source-status?window_hours=${windowHours}`)
}

export async function listFeedBriefings(params?: {
  limit?: number
  offset?: number
  keyword?: string
}): Promise<FeedBriefingLibraryResponse> {
  const query = new URLSearchParams()
  query.set('limit', String(params?.limit ?? 30))
  query.set('offset', String(params?.offset ?? 0))
  if (params?.keyword?.trim()) query.set('q', params.keyword.trim())
  return request<FeedBriefingLibraryResponse>(`/api/v1/feed/briefings?${query.toString()}`)
}

export async function discoverSources(url: string): Promise<DiscoverSourcesResponse> {
  return request<DiscoverSourcesResponse>('/api/v1/sources/discover', {
    method: 'POST',
    body: JSON.stringify({ url }),
  })
}

export async function exportSources(): Promise<SourceExportPayload> {
  return request<SourceExportPayload>('/api/v1/sources/export', {
    method: 'POST',
  })
}

export async function importSources(payload: unknown): Promise<SourceImportResponse> {
  return request<SourceImportResponse>('/api/v1/sources/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function reclassifySources(payload?: {
  source_ids?: number[]
  only_general?: boolean
  probe?: boolean
  dry_run?: boolean
  limit?: number
}): Promise<ReclassifySourcesResponse> {
  return request<ReclassifySourcesResponse>('/api/v1/sources/reclassify', {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  })
}

export async function bulkUpdateSourceTags(payload: {
  source_ids: number[]
  action: 'add' | 'remove' | 'replace'
  tags: string[]
}): Promise<{ ok: boolean; action: string; updated: number; total: number }> {
  return request<{ ok: boolean; action: string; updated: number; total: number }>('/api/v1/sources/bulk/tags', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function createFeedBriefing(payload: {
  limit?: number
  tag?: string
  keyword?: string
  model?: string
  source_ids?: number[]
  article_ids?: number[]
  refresh?: boolean
  cache_only?: boolean
}): Promise<FeedBriefingResponse> {
  return request<FeedBriefingResponse>('/api/v1/feed/briefing', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getFeedBriefingCache(payload: {
  limit?: number
  tag?: string
  keyword?: string
  model?: string
  source_ids?: number[]
  article_ids?: number[]
}): Promise<FeedBriefingResponse | null> {
  const response = await fetch('/api/v1/feed/briefing', {
    method: 'POST',
    headers: buildHeaders({ method: 'POST' }),
    body: JSON.stringify({
      ...payload,
      cache_only: true,
      refresh: false,
    }),
  })

  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  return (await response.json()) as FeedBriefingResponse
}

export async function adminLogin(username: string, password: string): Promise<AdminLoginResponse> {
  return request<AdminLoginResponse>('/api/v1/admin/login', {
    method: 'POST',
    body: JSON.stringify({
      username: username.trim(),
      password,
    }),
  })
}

export async function adminLogout(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/v1/admin/logout', {
    method: 'POST',
  })
}

export async function getAdminSession(): Promise<AdminSessionResponse> {
  const response = await fetch('/api/v1/admin/session', {
    headers: buildHeaders({ method: 'POST' }),
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  return (await response.json()) as AdminSessionResponse
}
