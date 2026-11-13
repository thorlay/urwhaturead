import type { FeedItem, FeedResponse } from '../types'

export type FeedScope = {
  channel?: 'news' | 'forum' | 'all'
  mode: 'all' | 'important'
  tag: string
  sourceID: string
  keyword: string
  includeHidden: boolean
}
export type FeedLoadOverrides = Partial<Omit<FeedScope, 'includeHidden'> & { cursor: string }>
type PageRequest = { append: boolean; cursor: string }
export type FeedQueryState = {
  scope: FeedScope | null
  items: FeedItem[]
  cursor: string
  loading: boolean
  error: string | null
  failedPage: PageRequest | null
  pendingCount: number
  checkingUpdates: boolean
}
type FetchFeed = (params: FeedScope & { limit: number; cursor?: string }) => Promise<FeedResponse>

export function normalizeFeedScope(scope: FeedScope): FeedScope {
  const ids = [...new Set(scope.sourceID.split(',').map((id) => id.trim()).filter(Boolean).map(Number)
    .filter((id) => Number.isSafeInteger(id) && id >= 0))].sort((a, b) => a - b)
  return { ...scope, sourceID: ids.join(','), keyword: scope.keyword.trim() }
}
function scopeKey(scope: FeedScope) {
  return JSON.stringify([scope.channel, scope.mode, scope.tag, scope.sourceID, scope.keyword, scope.includeHidden])
}
function scopedItems(items: FeedItem[], scope: FeedScope) {
  const sourceIDs = new Set(scope.sourceID.split(',').filter(Boolean).map(Number))
  return items.filter((item) => sourceIDs.size === 0 || sourceIDs.has(item.source_id))
}
function uniqueItems(items: FeedItem[]) {
  const seen = new Set<number>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

// One store owns the applied query and its pages. React subscribes to immutable
// snapshots; request ownership changes synchronously, before a render can occur.
export function createFeedQuery(fetchFeed: FetchFeed) {
  let state: FeedQueryState = {
    scope: null, items: [], cursor: '', loading: false, error: null,
    failedPage: null, pendingCount: 0, checkingUpdates: false,
  }
  const listeners = new Set<() => void>()
  let generation = 0
  let active: { key: string; promise: Promise<string | null> } | null = null
  let probe: Promise<void> | null = null
  const publish = (patch: Partial<FeedQueryState>) => {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }

  function load(scopeInput: FeedScope, page: PageRequest): Promise<string | null> {
    const scope = normalizeFeedScope(scopeInput)
    const key = JSON.stringify([scopeKey(scope), page.append, page.cursor])
    if (active?.key === key) return active.promise
    const requestID = ++generation
    const scopeChanged = !state.scope || scopeKey(state.scope) !== scopeKey(scope)
    const modeChanged = state.scope && state.scope.mode !== scope.mode
    probe = null
    // A deferred start lets us register ownership before synchronous subscribers run.
    const promise = Promise.resolve().then(async () => {
      try {
        const response = await fetchFeed({ ...scope, limit: 20, cursor: page.cursor })
        if (requestID !== generation) return null
        const items = scopedItems(response.data, scope)
        const nextCursor = response.meta.next_cursor || ''
        active = null
        publish({
          items: uniqueItems(page.append ? [...state.items, ...items] : items),
          // A repeated cursor cannot make progress; avoid an infinite auto-load loop.
          cursor: page.append && nextCursor === page.cursor ? '' : nextCursor,
          loading: false, error: null, failedPage: null,
          ...(!page.append ? { pendingCount: 0 } : {}),
        })
        return null
      } catch (error) {
        if (requestID !== generation) return null
        const message = error instanceof Error ? error.message : String(error)
        active = null
        publish({ loading: false, error: message, failedPage: page })
        return message
      }
    })
    active = { key, promise }
    publish({
      scope, loading: true, error: null, failedPage: null, checkingUpdates: false,
      ...(scopeChanged ? { cursor: '', pendingCount: 0 } : {}),
      ...((modeChanged || scopeChanged) ? { items: [] } : {}),
    })
    return promise
  }

  const replace = (scope: FeedScope) => load(scope, { append: false, cursor: '' })
  const loadMore = (): Promise<string | null> => {
    if (active || !state.scope || !state.cursor || state.failedPage?.append === false) return Promise.resolve(null)
    return load(state.scope, { append: true, cursor: state.cursor })
  }
  const retry = (): Promise<string | null> => {
    if (!state.scope || !state.failedPage) return Promise.resolve(null)
    return load(state.scope, state.failedPage)
  }
  const refresh = () => state.scope ? replace(state.scope) : Promise.resolve(null)
  const checkUpdates = (): Promise<void> => {
    if (probe) return probe
    if (active || !state.scope || state.items.length === 0 || state.error) return Promise.resolve()
    const requestID = generation
    const scope = state.scope
    const task = Promise.resolve().then(async () => {
      try {
        const response = await fetchFeed({ ...scope, limit: Math.min(Math.max(state.items.length, 20), 60) })
        if (requestID !== generation) return
        const currentIDs = new Set(state.items.map((item) => item.id))
        const pendingCount = uniqueItems(scopedItems(response.data, scope)).filter((item) => !currentIDs.has(item.id)).length
        publish({ pendingCount })
      } catch {
        // Background checking must not interrupt reading or clear existing rows.
      } finally {
        if (requestID === generation) {
          probe = null
          publish({ checkingUpdates: false })
        }
      }
    })
    probe = task
    publish({ checkingUpdates: true })
    return task
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    replace, loadMore, retry, refresh, checkUpdates,
  }
}
export type FeedQuery = ReturnType<typeof createFeedQuery>
