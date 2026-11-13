import { useCallback, useEffect } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { listSources, listSourceStatus } from '../api'
import type { Notice, AppTab } from '../lib/app-domain'
import type { Source, SourceStatus } from '../types'
import type { FeedQuery, FeedLoadOverrides } from '../lib/feed-query'

type UseReaderDataControllerParams = {
  activeTab: AppTab
  feedQuery: FeedQuery
  tagFilter: string
  sourceFilter: string
  keyword: string
  sourceByID: Map<number, Source>
  sidebarTagFilterTimerRef: MutableRefObject<number | null>
  setLoadingSources: Dispatch<SetStateAction<boolean>>
  setSourcesError: Dispatch<SetStateAction<string | null>>
  setSources: Dispatch<SetStateAction<Source[]>>
  setLoadingStatus: Dispatch<SetStateAction<boolean>>
  setStatusError: Dispatch<SetStateAction<string | null>>
  setSourceStatus: Dispatch<SetStateAction<SourceStatus[]>>
  setNotice: Dispatch<SetStateAction<Notice | null>>
  parseSourceIDFilter: (value: string) => number[]
  normalizeSourceKind: (value?: string) => 'feed' | 'thread'
  toErrorMessage: (error: unknown) => string
}

export function useReaderDataController({
  activeTab,
  feedQuery,
  tagFilter,
  sourceFilter,
  keyword,
  sourceByID,
  sidebarTagFilterTimerRef,
  setLoadingSources,
  setSourcesError,
  setSources,
  setLoadingStatus,
  setStatusError,
  setSourceStatus,
  setNotice,
  parseSourceIDFilter,
  normalizeSourceKind,
  toErrorMessage,
}: UseReaderDataControllerParams) {
  const snapshot = feedQuery.getSnapshot()
  const feedMode = snapshot.scope?.mode ?? 'all'
  const feed = snapshot.items
  const loadingFeed = snapshot.loading
  const pendingFeedCount = snapshot.pendingCount
  const checkingFeedUpdates = snapshot.checkingUpdates

  const resolveFeedScope = useCallback((overrides?: FeedLoadOverrides) => {
    const activeTag = overrides?.tag ?? tagFilter
    const activeSourceID = overrides?.sourceID ?? sourceFilter
    const activeKeyword = (overrides?.keyword ?? keyword).trim()
    const filteredSourceIDs = parseSourceIDFilter(activeSourceID)
    const includeHidden = filteredSourceIDs.some(
      (sourceID) => normalizeSourceKind(sourceByID.get(sourceID)?.kind) === 'thread',
    )

    return {
      tag: activeTag,
      sourceID: activeSourceID,
      keyword: activeKeyword,
      mode: overrides?.mode ?? feedQuery.getSnapshot().scope?.mode ?? 'all',
      includeHidden,
    }
  }, [feedQuery, keyword, normalizeSourceKind, parseSourceIDFilter, sourceByID, sourceFilter, tagFilter])

  const loadSources = useCallback(async () => {
    try {
      setLoadingSources(true)
      setSourcesError(null)
      const data = await listSources()
      setSources(data)
    } catch (error) {
      const message = toErrorMessage(error)
      setSourcesError(message)
      setNotice({
        kind: 'error',
        text: `加载来源失败: ${message}`,
      })
    } finally {
      setLoadingSources(false)
    }
  }, [setLoadingSources, setNotice, setSources, setSourcesError, toErrorMessage])

  const loadStatus = useCallback(async () => {
    try {
      setLoadingStatus(true)
      setStatusError(null)
      const response = await listSourceStatus(24)
      setSourceStatus(response.data)
    } catch (error) {
      const message = toErrorMessage(error)
      setStatusError(message)
      setNotice({
        kind: 'error',
        text: `加载来源状态失败: ${message}`,
      })
    } finally {
      setLoadingStatus(false)
    }
  }, [setLoadingStatus, setNotice, setSourceStatus, setStatusError, toErrorMessage])

  const refreshStatusIfVisible = useCallback(async () => {
    if (activeTab !== 'sources') return
    await loadStatus()
  }, [activeTab, loadStatus])

  const reportQueryError = useCallback(async (result: Promise<string | null>) => {
    const error = await result
    if (error) setNotice({ kind: 'error', text: `加载 feed 失败: ${error}` })
  }, [setNotice])

  const loadFeed = useCallback(async (append = false, overrides?: FeedLoadOverrides) => {
    await reportQueryError(append ? feedQuery.loadMore() : feedQuery.replace(resolveFeedScope(overrides)))
  }, [feedQuery, reportQueryError, resolveFeedScope])

  const retryFeed = useCallback(() => reportQueryError(feedQuery.retry()), [feedQuery, reportQueryError])
  const loadMore = useCallback(() => {
    void reportQueryError(feedQuery.loadMore())
  }, [feedQuery, reportQueryError])

  const onChangeFeedMode = useCallback((mode: 'all' | 'important') => {
    if (mode === (feedQuery.getSnapshot().scope?.mode ?? 'all')) return
    if (sidebarTagFilterTimerRef.current !== null) {
      window.clearTimeout(sidebarTagFilterTimerRef.current)
      sidebarTagFilterTimerRef.current = null
    }
    void loadFeed(false, { mode })
  }, [feedQuery, loadFeed, sidebarTagFilterTimerRef])

  const applyPendingFeedUpdates = useCallback(() => reportQueryError(feedQuery.refresh()), [feedQuery, reportQueryError])

  const cancelSidebarTagFeedReload = useCallback(() => {
    if (sidebarTagFilterTimerRef.current !== null) {
      window.clearTimeout(sidebarTagFilterTimerRef.current)
      sidebarTagFilterTimerRef.current = null
    }
  }, [sidebarTagFilterTimerRef])

  const scheduleSidebarTagFeedReload = useCallback(
    (sourceID: string) => {
      cancelSidebarTagFeedReload()
      sidebarTagFilterTimerRef.current = window.setTimeout(() => {
        sidebarTagFilterTimerRef.current = null
        void loadFeed(false, { sourceID })
      }, 180)
    },
    [cancelSidebarTagFeedReload, loadFeed, sidebarTagFilterTimerRef],
  )

  const refreshAll = useCallback(async () => {
    const tasks: Promise<unknown>[] = [loadSources(), loadFeed(false)]
    if (activeTab === 'sources') {
      tasks.push(loadStatus())
    }
    await Promise.allSettled(tasks)
    setNotice({ kind: 'info', text: '已更新视图数据（缓存优先）。' })
  }, [activeTab, loadFeed, loadSources, loadStatus, setNotice])

  useEffect(() => {
    return () => {
      cancelSidebarTagFeedReload()
    }
  }, [cancelSidebarTagFeedReload])

  useEffect(() => {
    if (activeTab !== 'reader') return
    const check = () => { if (!document.hidden) void feedQuery.checkUpdates() }
    check()
    const timer = window.setInterval(check, 60_000)
    return () => window.clearInterval(timer)
  }, [activeTab, feedQuery, feed, loadingFeed])

  return {
    feedMode,
    onChangeFeedMode,
    loadSources,
    loadStatus,
    refreshStatusIfVisible,
    loadFeed,
    cancelSidebarTagFeedReload,
    scheduleSidebarTagFeedReload,
    refreshAll,
    loadMore,
    retryFeed,
    pendingFeedCount,
    checkingFeedUpdates,
    applyPendingFeedUpdates,
  }
}
