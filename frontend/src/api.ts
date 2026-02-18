import type {
  ArticleSummaryResponse,
  ArticleDetail,
  FeedResponse,
  FeedTestResult,
  Source,
  SourceStatusResponse,
  SourcesResponse,
  TrackThreadResponse,
} from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
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

export async function createSource(payload: {
  name?: string
  rss_url: string
  category: string
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
    category?: string
    enabled?: boolean
    poll_interval_sec?: number
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
  category?: string
  sourceID?: string
  keyword?: string
}): Promise<FeedResponse> {
  const query = new URLSearchParams()
  query.set('limit', String(params.limit ?? 20))
  if (params.cursor) query.set('cursor', params.cursor)
  if (params.category) query.set('category', params.category)
  if (params.sourceID) query.set('source_ids', params.sourceID)
  if (params.keyword) query.set('q', params.keyword)

  return request<FeedResponse>(`/api/v1/feed?${query.toString()}`)
}

export async function getArticle(articleID: number): Promise<ArticleDetail> {
  return request<ArticleDetail>(`/api/v1/articles/${articleID}`)
}

export async function summarizeArticle(articleID: number, refresh = false): Promise<ArticleSummaryResponse> {
  const query = new URLSearchParams()
  if (refresh) query.set('refresh', '1')

  return request<ArticleSummaryResponse>(`/api/v1/articles/${articleID}/summary${query.toString() ? `?${query.toString()}` : ''}`, {
    method: 'POST',
  })
}

export async function getArticleSummary(articleID: number): Promise<ArticleSummaryResponse | null> {
  const response = await fetch(`/api/v1/articles/${articleID}/summary`, {
    headers: {
      'Content-Type': 'application/json',
    },
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
