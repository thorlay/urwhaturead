import type { FeedLoadOverrides } from '../lib/feed-query'
import { useEffect } from 'react'

type UseAppBootstrapParams = {
  loadSources: () => Promise<void>
  loadFeed: (append?: boolean, overrides?: FeedLoadOverrides) => Promise<void>
  refreshAdminSession: () => Promise<void>
}

export function useAppBootstrap({
  loadSources,
  loadFeed,
  refreshAdminSession,
}: UseAppBootstrapParams) {
  useEffect(() => {
    void loadSources()
    void loadFeed(false)
    void refreshAdminSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
