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

type AILibraryView = 'articles' | 'briefings'
type AILibraryRange = '24h' | '7d' | '30d' | 'all'

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
  const [activeView, setActiveView] = useState<AILibraryView>('articles')
  const [timeRange, setTimeRange] = useState<AILibraryRange>('7d')

  const describeAILibraryLoadError = useCallback((scope: 'article' | 'briefing', error: unknown) => {
    const message = toErrorMessage(error)
    if (scope === 'article' && message.includes('id must be an unsigned integer')) {
      return '文章摘要列表接口还没有在后端生效，请重启或重新部署 API。'
    }
    if (scope === 'briefing' && message.includes('404')) {
      return 'AI 速览列表接口还没有在后端生效，请重启或重新部署 API。'
    }
    return `${scope === 'article' ? '文章摘要' : 'AI 速览'}加载失败: ${message}`
  }, [])

  const loadAILibrary = useCallback(
    async (keywordOverride?: string) => {
      const keyword = (keywordOverride ?? search).trim()
      try {
        setLoading(true)
        setError(null)
        const [summaryResult, briefingResult] = await Promise.allSettled([
          listArticleSummaries({ limit: 50, keyword }),
          listFeedBriefings({ limit: 30, keyword }),
        ])

        const nextErrors: string[] = []

        if (summaryResult.status === 'fulfilled') {
          setArticleSummaries(summaryResult.value.data)
        } else {
          setArticleSummaries([])
          nextErrors.push(describeAILibraryLoadError('article', summaryResult.reason))
        }

        if (briefingResult.status === 'fulfilled') {
          setFeedBriefings(briefingResult.value.data)
        } else {
          setFeedBriefings([])
          nextErrors.push(describeAILibraryLoadError('briefing', briefingResult.reason))
        }

        setLoadedOnce(true)
        if (nextErrors.length > 0) {
          const message = nextErrors.join(' ')
          setError(message)
          setNotice({ kind: 'error', text: message })
        }
      } catch (err) {
        const message = toErrorMessage(err)
        setError(message)
        setNotice({ kind: 'error', text: `AI 内容加载失败: ${message}` })
      } finally {
        setLoading(false)
      }
    },
    [describeAILibraryLoadError, search, setNotice],
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
    activeView,
    setActiveView,
    timeRange,
    setTimeRange,
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
