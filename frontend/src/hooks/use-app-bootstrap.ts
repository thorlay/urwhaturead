import { useEffect } from 'react'

type FeedLoadOverrides = {
  tag?: string
  sourceID?: string
  keyword?: string
  cursor?: string
}

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
