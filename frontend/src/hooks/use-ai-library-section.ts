import { useCallback, useEffect, useState } from 'react'
import { listArticleSummaries, listFeedBriefings } from '../api'
import type { AppTab, Notice } from '../lib/app-domain'
import type { ArticleSummaryLibraryItem, FeedBriefingLibraryItem } from '../types'
import { toErrorMessage } from '../lib/app-utils'

type UseAILibrarySectionParams = {
  activeTab: AppTab
  setActiveTab: (tab: AppTab) => void
  openArticle: (articleID: number) => Promise<void>
  openFeedBriefing: (item: FeedBriefingLibraryItem) => void
  setNotice: (notice: Notice | null) => void
}

export function useAILibrarySection({
  activeTab,
  setActiveTab,
  openArticle,
  openFeedBriefing,
  setNotice,
}: UseAILibrarySectionParams) {
  const [search, setSearch] = useState('')
  const [articleSummaries, setArticleSummaries] = useState<ArticleSummaryLibraryItem[]>([])
  const [feedBriefings, setFeedBriefings] = useState<FeedBriefingLibraryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedOnce, setLoadedOnce] = useState(false)

  const loadAILibrary = useCallback(
    async (keywordOverride?: string) => {
      const keyword = (keywordOverride ?? search).trim()
      try {
        setLoading(true)
        setError(null)
        const [summaryResponse, briefingResponse] = await Promise.all([
          listArticleSummaries({ limit: 50, keyword }),
          listFeedBriefings({ limit: 30, keyword }),
        ])
        setArticleSummaries(summaryResponse.data)
        setFeedBriefings(briefingResponse.data)
        setLoadedOnce(true)
      } catch (err) {
        const message = toErrorMessage(err)
        setError(message)
        setNotice({ kind: 'error', text: `AI 内容加载失败: ${message}` })
      } finally {
        setLoading(false)
      }
    },
    [search, setNotice],
  )

  useEffect(() => {
    if (activeTab !== 'ai' || loadedOnce) {
      return
    }
    void loadAILibrary('')
  }, [activeTab, loadedOnce, loadAILibrary])

  const applySearch = useCallback(() => {
    void loadAILibrary(search)
  }, [loadAILibrary, search])

  const refresh = useCallback(() => {
    void loadAILibrary(search)
  }, [loadAILibrary, search])

  const openArticleSummary = useCallback(
    async (articleID: number) => {
      setActiveTab('reader')
      await openArticle(articleID)
    },
    [openArticle, setActiveTab],
  )

  const openFeedBriefingSummary = useCallback(
    (item: FeedBriefingLibraryItem) => {
      setActiveTab('reader')
      openFeedBriefing(item)
    },
    [openFeedBriefing, setActiveTab],
  )

  return {
    search,
    setSearch,
    articleSummaries,
    feedBriefings,
    loading,
    error,
    loadedOnce,
    applySearch,
    refresh,
    openArticleSummary,
    openFeedBriefingSummary,
  }
}
