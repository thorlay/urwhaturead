import { useState } from 'react'
import type { Notice } from '../lib/app-domain'

export function useAppStateRequest() {
  const [loadingSources, setLoadingSources] = useState(false)
  const [loadingFeed, setLoadingFeed] = useState(false)
  const [loadingArticle, setLoadingArticle] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(false)

  const [sourcesError, setSourcesError] = useState<string | null>(null)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [articleError, setArticleError] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)

  const [feedCursor, setFeedCursor] = useState('')
  const [hasMoreFeed, setHasMoreFeed] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [, setNowTick] = useState(0)

  return {
    loadingSources,
    setLoadingSources,
    loadingFeed,
    setLoadingFeed,
    loadingArticle,
    setLoadingArticle,
    loadingStatus,
    setLoadingStatus,
    sourcesError,
    setSourcesError,
    feedError,
    setFeedError,
    articleError,
    setArticleError,
    statusError,
    setStatusError,
    feedCursor,
    setFeedCursor,
    hasMoreFeed,
    setHasMoreFeed,
    notice,
    setNotice,
    setNowTick,
  }
}
