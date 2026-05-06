import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Notice, SidebarTagFilterMode } from '../lib/app-domain'
import type { ArticleDetail } from '../types'

type FeedLoadOverrides = Partial<{ tag: string; sourceID: string; keyword: string; cursor: string }>

type UseReaderFilterControlsParams = {
  aiModel: string
  setAIModel: Dispatch<SetStateAction<string>>
  selectedArticleID: number | null
  summaryRequestSeqRef: MutableRefObject<number>
  loadCachedSummary: (articleID: number, model: string, requestID?: number) => Promise<void>
  resetFeedBriefingState: () => void
  cancelSidebarTagFeedReload: () => void
  loadFeed: (append?: boolean, overrides?: FeedLoadOverrides) => Promise<void>
  setKeyword: Dispatch<SetStateAction<string>>
  setTagFilter: Dispatch<SetStateAction<string>>
  setSourceFilter: Dispatch<SetStateAction<string>>
  setUnreadOnly: Dispatch<SetStateAction<boolean>>
  setFavoriteOnly: Dispatch<SetStateAction<boolean>>
  setSourceGroupFilter: Dispatch<SetStateAction<{ key: string; label: string } | null>>
  setSidebarTagFilters: Dispatch<SetStateAction<string[]>>
  setSidebarTagFilterMode: Dispatch<SetStateAction<SidebarTagFilterMode>>
  setMutedSiteKeys: Dispatch<SetStateAction<string[]>>
  setSelectedArticle: Dispatch<SetStateAction<ArticleDetail | null>>
  setSelectedArticleID: Dispatch<SetStateAction<number | null>>
  setFeedCursor: Dispatch<SetStateAction<string>>
  setShowManageModelPicker: Dispatch<SetStateAction<boolean>>
  setArticleSummary: Dispatch<SetStateAction<string>>
  setArticleSummaryMeta: Dispatch<SetStateAction<string>>
  setArticleSummaryError: Dispatch<SetStateAction<string | null>>
  setNotice: Dispatch<SetStateAction<Notice | null>>
}

export function useReaderFilterControls({
  aiModel,
  setAIModel,
  selectedArticleID,
  summaryRequestSeqRef,
  loadCachedSummary,
  resetFeedBriefingState,
  cancelSidebarTagFeedReload,
  loadFeed,
  setKeyword,
  setTagFilter,
  setSourceFilter,
  setUnreadOnly,
  setFavoriteOnly,
  setSourceGroupFilter,
  setSidebarTagFilters,
  setSidebarTagFilterMode,
  setMutedSiteKeys,
  setSelectedArticle,
  setSelectedArticleID,
  setFeedCursor,
  setShowManageModelPicker,
  setArticleSummary,
  setArticleSummaryMeta,
  setArticleSummaryError,
  setNotice,
}: UseReaderFilterControlsParams) {
  const applyFilters = useCallback(() => {
    cancelSidebarTagFeedReload()
    resetFeedBriefingState()
    setSelectedArticle(null)
    setSelectedArticleID(null)
    setFeedCursor('')
    void loadFeed(false)
  }, [
    cancelSidebarTagFeedReload,
    loadFeed,
    resetFeedBriefingState,
    setFeedCursor,
    setSelectedArticle,
    setSelectedArticleID,
  ])

  const clearFilters = useCallback(() => {
    cancelSidebarTagFeedReload()
    resetFeedBriefingState()
    setKeyword('')
    setTagFilter('')
    setSourceFilter('')
    setUnreadOnly(false)
    setFavoriteOnly(false)
    setSourceGroupFilter(null)
    setSidebarTagFilters([])
    setMutedSiteKeys([])
    setSelectedArticle(null)
    setSelectedArticleID(null)
    setFeedCursor('')
    void loadFeed(false, {
      tag: '',
      sourceID: '',
      keyword: '',
      cursor: '',
    })
  }, [
    cancelSidebarTagFeedReload,
    loadFeed,
    resetFeedBriefingState,
    setFeedCursor,
    setKeyword,
    setMutedSiteKeys,
    setSelectedArticle,
    setSelectedArticleID,
    setSidebarTagFilters,
    setSourceFilter,
    setSourceGroupFilter,
    setTagFilter,
    setUnreadOnly,
    setFavoriteOnly,
  ])

  const removeFilter = useCallback(
    (type: 'keyword' | 'tag' | 'source' | 'muted_sites' | 'unread' | 'favorite') => {
      cancelSidebarTagFeedReload()
      if (type === 'keyword') {
        resetFeedBriefingState()
        setKeyword('')
        void loadFeed(false, { keyword: '' })
        return
      }
      if (type === 'tag') {
        resetFeedBriefingState()
        setTagFilter('')
        void loadFeed(false, { tag: '' })
        return
      }
      if (type === 'muted_sites') {
        setMutedSiteKeys([])
        return
      }
      if (type === 'unread') {
        setUnreadOnly(false)
        return
      }
      if (type === 'favorite') {
        setFavoriteOnly(false)
        return
      }

      setSourceFilter('')
      setSourceGroupFilter(null)
      setSidebarTagFilters([])
      resetFeedBriefingState()
      void loadFeed(false, { sourceID: '' })
    },
    [
      cancelSidebarTagFeedReload,
      loadFeed,
      resetFeedBriefingState,
      setKeyword,
      setMutedSiteKeys,
      setSidebarTagFilters,
      setSourceFilter,
      setSourceGroupFilter,
      setTagFilter,
      setUnreadOnly,
      setFavoriteOnly,
    ],
  )

  const onChangeAIModel = useCallback(
    (nextModel: string) => {
      const model = nextModel.trim()
      if (!model || model === aiModel) {
        return
      }
      const requestID = ++summaryRequestSeqRef.current
      setAIModel(model)
      resetFeedBriefingState()
      setArticleSummary('')
      setArticleSummaryMeta('')
      setArticleSummaryError(null)
      if (selectedArticleID) {
        void loadCachedSummary(selectedArticleID, model, requestID)
      }
      setShowManageModelPicker(false)
      setNotice({ kind: 'info', text: `已切换模型：${model}` })
    },
    [
      aiModel,
      loadCachedSummary,
      resetFeedBriefingState,
      selectedArticleID,
      setAIModel,
      setArticleSummary,
      setArticleSummaryError,
      setArticleSummaryMeta,
      setNotice,
      setShowManageModelPicker,
      summaryRequestSeqRef,
    ],
  )

  const toggleSiteMuted = useCallback((siteKey: string) => {
    resetFeedBriefingState()
    setMutedSiteKeys((previous) => {
      if (previous.includes(siteKey)) {
        return previous.filter((item) => item !== siteKey)
      }
      return [...previous, siteKey]
    })
  }, [resetFeedBriefingState, setMutedSiteKeys])

  const switchSidebarTagFilterMode = useCallback(
    (mode: SidebarTagFilterMode, currentMode: SidebarTagFilterMode, currentFilters: string[]) => {
      if (mode === currentMode) return false
      if (currentFilters.length === 0) {
        setSidebarTagFilterMode(mode)
        return false
      }
      return true
    },
    [setSidebarTagFilterMode],
  )

  return {
    applyFilters,
    clearFilters,
    removeFilter,
    onChangeAIModel,
    toggleSiteMuted,
    switchSidebarTagFilterMode,
  }
}
