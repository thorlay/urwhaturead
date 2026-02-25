import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { listFeed, listSources, listSourceStatus } from '../api'
import type { Notice, AppTab } from '../lib/app-domain'
import type { FeedItem, Source, SourceStatus } from '../types'

type FeedLoadOverrides = Partial<{ tag: string; sourceID: string; keyword: string; cursor: string }>

type UseReaderDataControllerParams = {
  activeTab: AppTab
  feed: FeedItem[]
  tagFilter: string
  sourceFilter: string
  keyword: string
  feedCursor: string
  loadingFeed: boolean
  sourceByID: Map<number, Source>
  feedRequestSeqRef: MutableRefObject<number>
  sidebarTagFilterTimerRef: MutableRefObject<number | null>
  setLoadingSources: Dispatch<SetStateAction<boolean>>
  setSourcesError: Dispatch<SetStateAction<string | null>>
  setSources: Dispatch<SetStateAction<Source[]>>
  setLoadingStatus: Dispatch<SetStateAction<boolean>>
  setStatusError: Dispatch<SetStateAction<string | null>>
  setSourceStatus: Dispatch<SetStateAction<SourceStatus[]>>
  setLoadingFeed: Dispatch<SetStateAction<boolean>>
  setFeedError: Dispatch<SetStateAction<string | null>>
  setFeed: Dispatch<SetStateAction<FeedItem[]>>
  setFeedCursor: Dispatch<SetStateAction<string>>
  setHasMoreFeed: Dispatch<SetStateAction<boolean>>
  setNotice: Dispatch<SetStateAction<Notice | null>>
  parseSourceIDFilter: (value: string) => number[]
  normalizeSourceKind: (value?: string) => 'feed' | 'thread'
  toErrorMessage: (error: unknown) => string
}

export function useReaderDataController({
  activeTab,
  feed,
  tagFilter,
  sourceFilter,
  keyword,
  feedCursor,
  loadingFeed,
  sourceByID,
  feedRequestSeqRef,
  sidebarTagFilterTimerRef,
  setLoadingSources,
  setSourcesError,
  setSources,
  setLoadingStatus,
  setStatusError,
  setSourceStatus,
  setLoadingFeed,
  setFeedError,
  setFeed,
  setFeedCursor,
  setHasMoreFeed,
  setNotice,
  parseSourceIDFilter,
  normalizeSourceKind,
  toErrorMessage,
}: UseReaderDataControllerParams) {
  const [pendingFeedCount, setPendingFeedCount] = useState(0)
  const [checkingFeedUpdates, setCheckingFeedUpdates] = useState(false)

  const resolveFeedScope = useCallback((overrides?: FeedLoadOverrides) => {
    const activeTag = overrides?.tag ?? tagFilter
    const activeSourceID = overrides?.sourceID ?? sourceFilter
    const activeKeyword = (overrides?.keyword ?? keyword).trim()
    const filteredSourceIDs = parseSourceIDFilter(activeSourceID)
    const includeHidden = filteredSourceIDs.some(
      (sourceID) => normalizeSourceKind(sourceByID.get(sourceID)?.kind) === 'thread',
    )

    return {
      activeTag,
      activeSourceID,
      activeKeyword,
      filteredSourceIDs,
      includeHidden,
    }
  }, [keyword, normalizeSourceKind, parseSourceIDFilter, sourceByID, sourceFilter, tagFilter])

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

  const loadFeed = useCallback(
    async (append = false, overrides?: FeedLoadOverrides) => {
      const requestID = ++feedRequestSeqRef.current
      try {
        setLoadingFeed(true)
        setFeedError(null)
        const { activeTag, activeSourceID, activeKeyword, filteredSourceIDs, includeHidden } = resolveFeedScope(overrides)

        const response = await listFeed({
          limit: 20,
          cursor: overrides?.cursor ?? (append ? feedCursor : ''),
          tag: activeTag,
          sourceID: activeSourceID,
          keyword: activeKeyword,
          includeHidden,
        })
        if (requestID !== feedRequestSeqRef.current) {
          return
        }

        const scopedItems =
          filteredSourceIDs.length > 0
            ? response.data.filter((item) => filteredSourceIDs.includes(item.source_id))
            : response.data
        const articleItems: FeedItem[] = scopedItems.map((item) => ({ ...item }))

        if (append) {
          setFeed((previous) => [...previous, ...articleItems])
        } else {
          setFeed(articleItems)
          setPendingFeedCount(0)
        }

        setFeedCursor(response.meta.next_cursor || '')
        setHasMoreFeed(Boolean(response.meta.next_cursor))
      } catch (error) {
        if (requestID !== feedRequestSeqRef.current) {
          return
        }
        const message = toErrorMessage(error)
        setFeedError(message)
        setNotice({
          kind: 'error',
          text: `加载 feed 失败: ${message}`,
        })
      } finally {
        if (requestID === feedRequestSeqRef.current) {
          setLoadingFeed(false)
        }
      }
    },
    [
      feedCursor,
      feedRequestSeqRef,
      resolveFeedScope,
      setFeed,
      setFeedCursor,
      setFeedError,
      setHasMoreFeed,
      setLoadingFeed,
      setNotice,
      toErrorMessage,
    ],
  )

  const checkFeedUpdates = useCallback(async () => {
    if (activeTab !== 'reader' || loadingFeed || feed.length === 0) {
      return
    }

    try {
      setCheckingFeedUpdates(true)
      const { activeTag, activeSourceID, activeKeyword, filteredSourceIDs, includeHidden } = resolveFeedScope()
      const response = await listFeed({
        limit: Math.min(Math.max(feed.length, 20), 60),
        tag: activeTag,
        sourceID: activeSourceID,
        keyword: activeKeyword,
        includeHidden,
      })

      const scopedItems =
        filteredSourceIDs.length > 0
          ? response.data.filter((item) => filteredSourceIDs.includes(item.source_id))
          : response.data
      const currentIDs = new Set(feed.map((item) => item.id))
      const nextPendingCount = scopedItems.reduce(
        (count, item) => (currentIDs.has(item.id) ? count : count + 1),
        0,
      )
      setPendingFeedCount(nextPendingCount)
    } catch {
      // Silent fail: new-message checking should not interrupt reading.
    } finally {
      setCheckingFeedUpdates(false)
    }
  }, [activeTab, feed, loadingFeed, resolveFeedScope])

  const applyPendingFeedUpdates = useCallback(async () => {
    setPendingFeedCount(0)
    await loadFeed(false)
  }, [loadFeed])

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

  const loadMore = useCallback(() => {
    if (!feedCursor || loadingFeed) return
    void loadFeed(true)
  }, [feedCursor, loadFeed, loadingFeed])

  useEffect(() => {
    return () => {
      cancelSidebarTagFeedReload()
    }
  }, [cancelSidebarTagFeedReload])

  useEffect(() => {
    setPendingFeedCount(0)
  }, [activeTab, keyword, sourceFilter, tagFilter])

  useEffect(() => {
    if (activeTab !== 'reader') {
      return
    }

    void checkFeedUpdates()
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        return
      }
      void checkFeedUpdates()
    }, 60_000)

    return () => {
      window.clearInterval(timer)
    }
  }, [activeTab, checkFeedUpdates])

  return {
    loadSources,
    loadStatus,
    refreshStatusIfVisible,
    loadFeed,
    cancelSidebarTagFeedReload,
    scheduleSidebarTagFeedReload,
    refreshAll,
    loadMore,
    pendingFeedCount,
    checkingFeedUpdates,
    applyPendingFeedUpdates,
  }
}
