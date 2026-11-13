import type { FeedQueryController } from './use-feed-query'
import type { ReaderStateController } from './use-reader-state'
import { useState } from 'react'
import type { Notice } from '../lib/app-domain'

export function useAppStateRequest(reader: Pick<ReaderStateController, 'loadingArticle' | 'setLoadingArticle' | 'articleError' | 'setArticleError'>, feedQuery: FeedQueryController) {
  const { loadingArticle, setLoadingArticle, articleError, setArticleError } = reader
  const [loadingSources, setLoadingSources] = useState(false)
  const { loadingFeed, feedError, feedCursor, hasMoreFeed } = feedQuery
  const [loadingStatus, setLoadingStatus] = useState(false)

  const [sourcesError, setSourcesError] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)

  const [notice, setNotice] = useState<Notice | null>(null)
  const [, setNowTick] = useState(0)

  return {
    loadingSources,
    setLoadingSources,
    loadingFeed,
    loadingArticle,
    setLoadingArticle,
    loadingStatus,
    setLoadingStatus,
    sourcesError,
    setSourcesError,
    feedError,
    articleError,
    setArticleError,
    statusError,
    setStatusError,
    feedCursor,
    hasMoreFeed,
    notice,
    setNotice,
    setNowTick,
  }
}

export type AppStateRequest = ReturnType<typeof useAppStateRequest>
