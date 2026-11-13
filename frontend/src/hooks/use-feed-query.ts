import { useState, useSyncExternalStore } from 'react'
import { listFeed } from '../api'
import { createFeedQuery } from '../lib/feed-query'

export function useFeedQuery() {
  const [query] = useState(() => createFeedQuery(listFeed))
  const state = useSyncExternalStore(query.subscribe, query.getSnapshot, query.getSnapshot)
  return {
    query,
    feed: state.items,
    feedMode: state.scope?.mode ?? 'all',
    loadingFeed: state.loading,
    feedError: state.error,
    feedCursor: state.cursor,
    hasMoreFeed: Boolean(state.cursor),
    pendingFeedCount: state.pendingCount,
    checkingFeedUpdates: state.checkingUpdates,
  }
}
export type FeedQueryController = ReturnType<typeof useFeedQuery>
