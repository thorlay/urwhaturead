import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import {
  adminLogin as adminLoginRequest,
  adminLogout as adminLogoutRequest,
  getAdminSession,
  getArticleSummary,
} from './api'
import type { Source, SourceStatus } from './types'
import { AppTopbar } from '@/components/app-topbar'
import { NoticeBanner } from '@/components/notice-banner'
import { ReaderFeedPanel } from '@/components/reader-feed-panel'
import { ReaderSubscriptionSidebar } from '@/components/reader-subscription-sidebar'
import type { SourceManagementPanelController } from '@/components/source-management-panel'
import { Button } from '@/components/ui/button'
import { useReaderStream } from './hooks/use-reader-stream'
import { useDetailPanel } from './hooks/use-detail-panel'
import { useFeedBriefingCacheRestore } from './hooks/use-feed-briefing-cache-restore'
import { useFeedBriefingActions } from './hooks/use-feed-briefing-actions'
import { useAppState } from './hooks/use-app-state'
import { useReaderArticleActions } from './hooks/use-reader-article-actions'
import { useReaderDataController } from './hooks/use-reader-data-controller'
import { useReaderFilterControls } from './hooks/use-reader-filter-controls'
import { useReaderKeyboardShortcuts } from './hooks/use-reader-keyboard-shortcuts'
import { useReaderRuntimeEffects } from './hooks/use-reader-runtime-effects'
import { useReaderSessionActions } from './hooks/use-reader-session-actions'
import { useReaderSidebarState } from './hooks/use-reader-sidebar-state'
import { useSourceContextMenu } from './hooks/use-source-context-menu'
import { useSummaryTaskPoller } from './hooks/use-summary-task-poller'
import { useSourceManagementState } from './hooks/use-source-management-state'
import { useSourceManagementActions } from './hooks/use-source-management-actions'
import {
  aiModelOptions,
  aiModelStorageKey,
  readArticleStorageKey,
  readMarkMinScrollProgress,
  sidebarTagCollapseCount,
  type SidebarTagFilterMode,
  type SummaryTask,
  threadPreviewCommentLimit,
} from './lib/app-domain'
import {
  buildCompactTitleParts,
  bulkActionLabel,
  confidenceLabel,
  equalStringList,
  formatDateTime,
  formatReplyCount,
  formatTimeAgo,
  formatTimeAgoCompact,
  healthLabel,
  healthToneClass,
  isTrackableForumLink,
  maxStoredReadArticles,
  normalizeImageURL,
  normalizeSourceKind,
  normalizeSourceTags,
  parseRSSLines,
  parseSourceIDFilter,
  parseSourceTagInput,
  plainText,
  plainTextBlock,
  resolveSourceHealth,
  resolveSourceSiteKey,
  sourceClickCount,
  sourceHealthPriority,
  sourceTagList,
  toErrorMessage,
  truncate,
  upsertReadArticleID,
} from './lib/app-utils'
import {
  buildFeedBriefingTaskKey,
  isPollableArticleSummaryTask,
  isSummaryTaskPending,
  parseTimestamp,
  pruneSummaryTasks,
  resolveFeedBriefingScopeLabel,
  summaryTaskKindLabel,
  summaryTaskStatusLabel,
  summaryTaskStatusPriority,
  upsertSummaryTaskState,
} from './lib/summary-task-utils'
import './App.css'

const SourceManagementPanel = lazy(async () => {
  const module = await import('@/components/source-management-panel')
  return { default: module.SourceManagementPanel }
})

const SummaryTaskStripPanel = lazy(async () => {
  const module = await import('@/components/summary-task-strip-panel')
  return { default: module.SummaryTaskStripPanel }
})

const ReaderDetailPanel = lazy(async () => {
  const module = await import('@/components/reader-detail-panel')
  return { default: module.ReaderDetailPanel }
})

const SourceContextMenuOverlay = lazy(async () => {
  const module = await import('@/components/source-overlays')
  return { default: module.SourceContextMenuOverlay }
})

const SourceProfileDialog = lazy(async () => {
  const module = await import('@/components/source-overlays')
  return { default: module.SourceProfileDialog }
})

const SourceDeleteConfirmDialog = lazy(async () => {
  const module = await import('@/components/source-overlays')
  return { default: module.SourceDeleteConfirmDialog }
})

function App() {
  const [adminAuthenticated, setAdminAuthenticated] = useState(false)
  const {
    floatingDetailRef,
    sourceSelectAllRef,
    sourceContextMenuRef,
    feedAIMoreRef,
    feedBriefingCacheAttemptedRef,
    sidebarSourceItemRefs,
    previousSidebarSourceItemRectsRef,
    previousSidebarSourceIDsRef,
    feedAutoLoadRef,
    sidebarTagFilterTimerRef,
    feedAutoLoadCooldownRef,
    streamScrollYRef,
    feedRequestSeqRef,
    articleRequestSeqRef,
    summaryRequestSeqRef,
    summaryTaskNotifiedRef,
    readerSessionRef,
    sources,
    setSources,
    feed,
    setFeed,
    selectedArticle,
    setSelectedArticle,
    selectedArticleID,
    setSelectedArticleID,
    articleSummary,
    setArticleSummary,
    articleSummaryMeta,
    setArticleSummaryMeta,
    summaryTasks,
    setSummaryTasks,
    loadingArticleSummary,
    setLoadingArticleSummary,
    articleSummaryError,
    setArticleSummaryError,
    feedBriefing,
    setFeedBriefing,
    feedBriefingMeta,
    setFeedBriefingMeta,
    feedBriefingItems,
    setFeedBriefingItems,
    feedBriefingArticleCount,
    setFeedBriefingArticleCount,
    feedBriefingScopeLabel,
    setFeedBriefingScopeLabel,
    feedBriefingGeneratedAt,
    setFeedBriefingGeneratedAt,
    feedBriefingAnchorArticleIDs,
    setFeedBriefingAnchorArticleIDs,
    feedBriefingTaskKey,
    setFeedBriefingTaskKey,
    feedBriefingSnapshots,
    setFeedBriefingSnapshots,
    loadingFeedBriefing,
    setLoadingFeedBriefing,
    feedBriefingError,
    setFeedBriefingError,
    aiModel,
    setAIModel,
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
    sourceStatus,
    setSourceStatus,
    keyword,
    setKeyword,
    tagFilter,
    setTagFilter,
    sourceFilter,
    setSourceFilter,
    unreadOnly,
    setUnreadOnly,
    mutedSiteKeys,
    setMutedSiteKeys,
    feedTitleOnlyMode,
    setFeedTitleOnlyMode,
    showFeedImages,
    setShowFeedImages,
    showFeedSearch,
    setShowFeedSearch,
    showAdvancedFilters,
    setShowAdvancedFilters,
    showFeedAIMoreMenu,
    setShowFeedAIMoreMenu,
    showManageModelPicker,
    setShowManageModelPicker,
    setNowTick,
    activeTab,
    setActiveTab,
    readerView,
    setReaderView,
    showFloatingReader,
    setShowFloatingReader,
    selectedFeedBriefing,
    setSelectedFeedBriefing,
    expandedThreadComments,
    setExpandedThreadComments,
    threadCommentsNewestFirst,
    setThreadCommentsNewestFirst,
    readArticleIDs,
    setReadArticleIDs,
    sourceProfileSource,
    setSourceProfileSource,
    sourceProfileTagPickerOpen,
    setSourceProfileTagPickerOpen,
    sourceProfileTagInput,
    setSourceProfileTagInput,
    pendingDeleteSource,
    setPendingDeleteSource,
  } = useAppState()

  const {
    sourceGroupFilter,
    setSourceGroupFilter,
    sidebarTagFilters,
    setSidebarTagFilters,
    sidebarTagFilterMode,
    setSidebarTagFilterMode,
    showAllSidebarTags,
    setShowAllSidebarTags,
    showSubscriptionSidebar,
    setShowSubscriptionSidebar,
    showTrackedSidebar,
    setShowTrackedSidebar,
    showAllTrackedSidebar,
    setShowAllTrackedSidebar,
    readerFeedSources,
    readerTrackedSources,
    readerSources,
    visibleTrackedSidebarSources,
    hasMoreTrackedSidebarSources,
    sourceGroups,
    sidebarTagFilterSet,
    sidebarVisibleFeedSources,
  } = useReaderSidebarState({
    sources,
    sourceTagList,
  })

  const {
    sourceContextMenu,
    closeSourceContextMenu,
    openSourceContextMenu,
    openSourceContextMenuAt,
  } = useSourceContextMenu({
    sourceContextMenuRef,
  })

  const availableTags = useMemo(() => {
    const values = sources.flatMap((source) => sourceTagList(source))
    return Array.from(new Set(values)).sort()
  }, [sources])

  const sourceSiteKeyMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const source of sources) {
      map.set(source.id, resolveSourceSiteKey(source))
    }
    return map
  }, [sources])

  const sourceByID = useMemo(() => {
    const map = new Map<number, Source>()
    for (const source of sources) {
      map.set(source.id, source)
    }
    return map
  }, [sources])

  const sourceStatusMap = useMemo(() => {
    const map = new Map<number, SourceStatus>()
    for (const item of sourceStatus) {
      map.set(item.source_id, item)
    }
    return map
  }, [sourceStatus])

  const {
    sourceManageKeyword,
    setSourceManageKeyword,
    sourceManageTagFilter,
    setSourceManageTagFilter,
    sourceManageHealthFilter,
    setSourceManageHealthFilter,
    sourceHealthCounts,
    filteredSources,
    selectedSourceIDs,
    selectedSourceIDSet,
    visibleSourceIDs,
    selectedVisibleCount,
    allVisibleSelected,
    hasSelectedSources,
    bulkSourceAction,
    setBulkSourceAction,
    bulkTagInput,
    setBulkTagInput,
    editingSourceID,
    editSourceName,
    setEditSourceName,
    editSourceURL,
    setEditSourceURL,
    editSourceTags,
    setEditSourceTags,
    editSourcePollSec,
    setEditSourcePollSec,
    onStartEdit,
    onCancelEdit,
    toggleSourceSelection,
    toggleSelectAllVisibleSources,
    clearSourceManageFilters,
    clearSelectedSourceIDs,
    newSourceName,
    setNewSourceName,
    newSourceURL,
    setNewSourceURL,
    newSourceTags,
    setNewSourceTags,
    batchSourceURLs,
    setBatchSourceURLs,
    batchSourceTags,
    setBatchSourceTags,
    batchCreatingSources,
    setBatchCreatingSources,
    batchCreateResult,
    setBatchCreateResult,
    discoverURL,
    setDiscoverURL,
    discoveringSources,
    setDiscoveringSources,
    discoveredSources,
    setDiscoveredSources,
    reclassifyingSources,
    setReclassifyingSources,
    creatingSource,
    setCreatingSource,
    busySourceID,
    setBusySourceID,
  } = useSourceManagementState({
    sources,
    sourceStatusMap,
    sourceSiteKeyMap,
    sourceTagList,
    resolveSourceHealth,
    sourceHealthPriority,
  })

  const mutedSiteSet = useMemo(() => new Set(mutedSiteKeys), [mutedSiteKeys])
  const readArticleIDSet = useMemo(() => new Set(readArticleIDs), [readArticleIDs])
  const hasFeedBriefingEntry = Boolean(feedBriefing || feedBriefingError || loadingFeedBriefing)
  const {
    visibleFeed,
    feedBriefingInsertIndex,
    feedBriefingNewArticleCount,
    readerStreamItems,
    selectedFeedIndex,
    unreadVisibleCount,
  } = useReaderStream({
    feed,
    unreadOnly,
    readArticleIDSet,
    sourceSiteKeyMap,
    mutedSiteSet,
    hasFeedBriefingEntry,
    feedBriefingAnchorArticleIDs,
    selectedFeedBriefing,
    selectedArticleID,
  })
  const sourceProfileStatus = sourceProfileSource ? sourceStatusMap.get(sourceProfileSource.id) ?? null : null
  const sourceProfileHealth = sourceProfileSource ? resolveSourceHealth(sourceProfileSource, sourceStatusMap) : null
  const sourceProfileTags = useMemo(() => sourceTagList(sourceProfileSource ?? { tags: [] }), [sourceProfileSource])
  const sourceProfileTagSet = useMemo(() => new Set(sourceProfileTags), [sourceProfileTags])
  const sourceProfileTagCandidates = useMemo(() => {
    const keyword = sourceProfileTagInput.trim().toLowerCase()
    return availableTags.filter((tag) => {
      if (sourceProfileTagSet.has(tag)) {
        return false
      }
      if (!keyword) {
        return true
      }
      return tag.includes(keyword)
    })
  }, [availableTags, sourceProfileTagInput, sourceProfileTagSet])
  const sourceProfileTagDrafts = useMemo(
    () => parseSourceTagInput(sourceProfileTagInput).filter((tag) => !sourceProfileTagSet.has(tag)),
    [sourceProfileTagInput, sourceProfileTagSet],
  )
  const sourceFilterIDs = useMemo(() => parseSourceIDFilter(sourceFilter), [sourceFilter])
  const activeFeedBriefingSourceIDs = useMemo(
    () => [...sourceFilterIDs].sort((left, right) => left - right),
    [sourceFilterIDs],
  )
  const activeFeedBriefingKeyword = useMemo(() => keyword.trim(), [keyword])
  const activeFeedBriefingMutedSiteKeys = useMemo(
    () => [...mutedSiteKeys].map((item) => item.trim().toLowerCase()).filter(Boolean).sort(),
    [mutedSiteKeys],
  )
  const activeFeedBriefingTaskKey = useMemo(
    () =>
      buildFeedBriefingTaskKey({
        model: aiModel,
        sourceIDs: activeFeedBriefingSourceIDs,
        tag: tagFilter,
        keyword: activeFeedBriefingKeyword,
        unreadOnly,
        mutedSiteKeys: activeFeedBriefingMutedSiteKeys,
      }),
    [aiModel, activeFeedBriefingKeyword, activeFeedBriefingMutedSiteKeys, activeFeedBriefingSourceIDs, tagFilter, unreadOnly],
  )
  const activeFeedBriefingScopeLabel = useMemo(
    () => resolveFeedBriefingScopeLabel(activeFeedBriefingSourceIDs, sourceByID, tagFilter),
    [activeFeedBriefingSourceIDs, sourceByID, tagFilter],
  )
  const activeFeedBriefingAnchorArticleIDs = useMemo(() => visibleFeed.slice(0, 30).map((item) => item.id), [visibleFeed])
  const sourceFilterSelectValue = useMemo(() => {
    if (sourceGroupFilter) return ''
    if (sourceFilterIDs.length !== 1) return ''
    return String(sourceFilterIDs[0])
  }, [sourceFilterIDs, sourceGroupFilter])
  const sourceFilterChipLabel = useMemo(() => {
    if (!sourceFilter) return ''
    if (sourceGroupFilter) return `标签: ${sourceGroupFilter.label}`
    if (sourceFilterIDs.length === 1) {
      const matched = readerSources.find((item) => item.id === sourceFilterIDs[0])
      return matched ? `来源: ${matched.name}` : `来源: ${sourceFilterIDs[0]}`
    }
    return `来源: ${sourceFilterIDs.length} 个来源`
  }, [sourceFilter, sourceGroupFilter, sourceFilterIDs, readerSources])
  const summaryTaskByArticleID = useMemo(() => {
    const map = new Map<number, SummaryTask>()
    for (const task of summaryTasks) {
      if (task.kind !== 'article_summary' || typeof task.articleID !== 'number' || task.articleID <= 0) {
        continue
      }
      const previous = map.get(task.articleID)
      if (!previous) {
        map.set(task.articleID, task)
        continue
      }
      const pendingGap = Number(isSummaryTaskPending(task.status)) - Number(isSummaryTaskPending(previous.status))
      if (pendingGap > 0) {
        map.set(task.articleID, task)
        continue
      }
      if (pendingGap < 0) {
        continue
      }
      if (summaryTaskStatusPriority(task.status) > summaryTaskStatusPriority(previous.status)) {
        map.set(task.articleID, task)
        continue
      }
      const currentUpdated = parseTimestamp(task.updatedAt)
      const previousUpdated = parseTimestamp(previous.updatedAt)
      if (currentUpdated >= previousUpdated) {
        map.set(task.articleID, task)
      }
    }
    return map
  }, [summaryTasks])
  const scopedSummaryTasks = useMemo(() => {
    if (sourceFilterIDs.length === 0) {
      return summaryTasks
    }
    const sourceIDSet = new Set(sourceFilterIDs)
    const visibleFeedArticleIDSet = new Set(visibleFeed.map((item) => item.id))
    return summaryTasks.filter((task) => {
      if (task.kind === 'feed_briefing') {
        if (!task.sourceIDs || task.sourceIDs.length === 0) {
          return false
        }
        return task.sourceIDs.some((sourceID) => sourceIDSet.has(sourceID))
      }
      if (typeof task.sourceID === 'number' && task.sourceID > 0) {
        return sourceIDSet.has(task.sourceID)
      }
      // Backward-compatible fallback for tasks created before sourceID was recorded.
      return typeof task.articleID === 'number' && visibleFeedArticleIDSet.has(task.articleID)
    })
  }, [sourceFilterIDs, summaryTasks, visibleFeed])
  const visibleSummaryTasks = useMemo(
    () =>
      [...scopedSummaryTasks]
        .sort((left, right) => {
          const statusGap = summaryTaskStatusPriority(right.status) - summaryTaskStatusPriority(left.status)
          if (statusGap !== 0) {
            return statusGap
          }
          const updatedGap = parseTimestamp(right.updatedAt) - parseTimestamp(left.updatedAt)
          if (updatedGap !== 0) {
            return updatedGap
          }
          const rightID = typeof right.articleID === 'number' ? right.articleID : 0
          const leftID = typeof left.articleID === 'number' ? left.articleID : 0
          return rightID - leftID
        })
        .slice(0, 8),
    [scopedSummaryTasks],
  )
  const summaryTaskStats = useMemo(() => {
    const stats = {
      running: 0,
      queued: 0,
      failed: 0,
      succeeded: 0,
    }
    for (const task of scopedSummaryTasks) {
      if (task.status === 'running') stats.running += 1
      else if (task.status === 'queued') stats.queued += 1
      else if (task.status === 'failed') stats.failed += 1
      else if (task.status === 'succeeded') stats.succeeded += 1
    }
    return stats
  }, [scopedSummaryTasks])
  const pendingArticleSummaryTasks = useMemo(
    () => summaryTasks.filter((task) => isPollableArticleSummaryTask(task) && isSummaryTaskPending(task.status)),
    [summaryTasks],
  )
  const selectedSummaryTask = selectedArticleID ? summaryTaskByArticleID.get(selectedArticleID) ?? null : null
  const getSummaryTaskStatus = useCallback(
    (articleID: number) => summaryTaskByArticleID.get(articleID)?.status ?? null,
    [summaryTaskByArticleID],
  )
  const feedBriefingPreviewText = useMemo(() => {
    if (feedBriefingError) {
      return `生成失败：${feedBriefingError}`
    }
    if (feedBriefing) {
      return truncate(plainText(feedBriefing), 190)
    }
    if (loadingFeedBriefing) {
      return '正在生成聚合速览...'
    }
    return '暂无可展示速览内容。'
  }, [feedBriefing, feedBriefingError, loadingFeedBriefing])
  const feedBriefingFreshnessLabel = useMemo(() => {
    if (!feedBriefingGeneratedAt) {
      return ''
    }
    return formatTimeAgo(feedBriefingGeneratedAt)
  }, [feedBriefingGeneratedAt])

  const hasActiveFilters = keyword.trim() || tagFilter || sourceFilter || unreadOnly || mutedSiteKeys.length > 0
  const enabledSourceCount = useMemo(() => sources.filter((source) => source.enabled).length, [sources])
  const unhealthySourceCount = useMemo(
    () => sourceStatus.filter((item) => item.health === 'warn' || item.health === 'error' || item.health === 'stale').length,
    [sourceStatus],
  )
  const {
    detailMoreMenuRef,
    showDetailMoreMenu,
    closeDetailMoreMenu,
    toggleDetailMoreMenu,
    isThreadArticle,
    threadPrimaryBody,
    canTrackThread,
    canForceRecalcSummary,
    hasDetailMoreActions,
  } = useDetailPanel({
    activeTab,
    selectedArticle,
    selectedArticleID,
    selectedFeedBriefing,
    isTrackableForumLink,
  })
  const threadComments = useMemo(
    () => selectedArticle?.thread?.comments ?? [],
    [selectedArticle?.thread?.comments],
  )
  const selectedArticleImageURL = useMemo(
    () => normalizeImageURL(selectedArticle?.image_url),
    [selectedArticle?.image_url],
  )
  const selectedArticleReplyCountLabel = useMemo(
    () => formatReplyCount(selectedArticle?.reply_count),
    [selectedArticle?.reply_count],
  )
  const hasHiddenThreadComments =
    Boolean(selectedArticle?.thread) && !expandedThreadComments && threadComments.length > threadPreviewCommentLimit
  const orderedThreadComments = useMemo(
    () => (threadCommentsNewestFirst ? [...threadComments].reverse() : threadComments),
    [threadComments, threadCommentsNewestFirst],
  )
  const visibleThreadComments = expandedThreadComments
    ? orderedThreadComments
    : orderedThreadComments.slice(0, threadPreviewCommentLimit)

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(aiModelStorageKey, aiModel)
  }, [aiModel])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (readArticleIDs.length === 0) {
      window.localStorage.removeItem(readArticleStorageKey)
      return
    }
    window.localStorage.setItem(
      readArticleStorageKey,
      JSON.stringify(readArticleIDs.slice(0, maxStoredReadArticles)),
    )
  }, [readArticleIDs])

  useEffect(() => {
    if (!selectedSummaryTask) return
    if (!isSummaryTaskPending(selectedSummaryTask.status)) return
    setArticleSummaryMeta(`后台生成中 · ${summaryTaskStatusLabel(selectedSummaryTask.status)} · ${selectedSummaryTask.model}`)
  }, [selectedSummaryTask, setArticleSummaryMeta])

  const loadCachedSummary = useCallback(async (articleID: number, model: string, requestID?: number) => {
    const activeRequestID = requestID ?? ++summaryRequestSeqRef.current
    try {
      const cachedSummary = await getArticleSummary(articleID, model)
      if (activeRequestID !== summaryRequestSeqRef.current) {
        return
      }
      if (cachedSummary?.data?.summary) {
        setArticleSummary(cachedSummary.data.summary)
        setArticleSummaryMeta(`缓存命中 · ${cachedSummary.data.provider} · ${cachedSummary.data.model}`)
        setArticleSummaryError(null)
      }
    } catch (error) {
      if (activeRequestID !== summaryRequestSeqRef.current) {
        return
      }
      setArticleSummaryError(`读取缓存摘要失败: ${toErrorMessage(error)}`)
    }
  }, [setArticleSummary, setArticleSummaryError, setArticleSummaryMeta, summaryRequestSeqRef])

  const resolveSummaryTaskIdentity = useCallback((articleID?: number) => {
    const resolvedArticleID = typeof articleID === 'number' && articleID > 0 ? articleID : null
    if (resolvedArticleID !== null && selectedArticle?.id === resolvedArticleID) {
      return {
        title: selectedArticle.title,
        sourceName: selectedArticle.source_name,
        sourceID: selectedArticle.source_id,
      }
    }
    const item = resolvedArticleID !== null ? feed.find((entry) => entry.id === resolvedArticleID) : null
    if (item) {
      return {
        title: item.title,
        sourceName: item.source_name,
        sourceID: item.source_id,
      }
    }
    return {
      title: resolvedArticleID !== null ? `文章 #${resolvedArticleID}` : '未知文章',
      sourceName: '未知来源',
      sourceID: undefined,
    }
  }, [feed, selectedArticle])

  const upsertSummaryTask = useCallback((task: SummaryTask) => {
    setSummaryTasks((previous) => upsertSummaryTaskState(previous, task))
  }, [setSummaryTasks])

  const removeSummaryTask = useCallback((taskKey: string) => {
    setSummaryTasks((previous) => previous.filter((task) => task.key !== taskKey))
    summaryTaskNotifiedRef.current.delete(taskKey)
  }, [setSummaryTasks, summaryTaskNotifiedRef])

  const clearCompletedSummaryTasks = useCallback(() => {
    setSummaryTasks((previous) => {
      const next = previous.filter((task) => isSummaryTaskPending(task.status))
      const keys = new Set(next.map((task) => task.key))
      for (const key of summaryTaskNotifiedRef.current) {
        if (!keys.has(key)) {
          summaryTaskNotifiedRef.current.delete(key)
        }
      }
      return next
    })
  }, [setSummaryTasks, summaryTaskNotifiedRef])

  const {
    loadSources,
    loadStatus,
    refreshStatusIfVisible,
    loadFeed,
    cancelSidebarTagFeedReload,
    scheduleSidebarTagFeedReload,
    refreshAll,
    loadMore,
  } = useReaderDataController({
    activeTab,
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
  })

  const { startReaderSession, finalizeReaderSession, closeFloatingReader, openFeedBriefing } = useReaderSessionActions({
    readerSessionRef,
    setReadArticleIDs,
    upsertReadArticleID,
    readMarkMinScrollProgress,
    closeDetailMoreMenu,
    setShowFloatingReader,
    articleRequestSeqRef,
    summaryRequestSeqRef,
    setLoadingArticle,
    setArticleError,
    setSelectedArticle,
    setSelectedArticleID,
    setSelectedFeedBriefing,
    setArticleSummary,
    setArticleSummaryMeta,
    setArticleSummaryError,
    setLoadingArticleSummary,
    setExpandedThreadComments,
    setThreadCommentsNewestFirst,
    setReaderView,
    floatingDetailRef,
  })

  const {
    applyFeedBriefingSnapshot,
    saveFeedBriefingSnapshot,
    resetFeedBriefingState,
    onGenerateFeedBriefing,
  } = useFeedBriefingActions({
    activeFeedBriefingAnchorArticleIDs,
    activeFeedBriefingSourceIDs,
    activeFeedBriefingScopeLabel,
    activeFeedBriefingTaskKey,
    activeFeedBriefingKeyword,
    tagFilter,
    aiModel,
    setFeedBriefingTaskKey,
    setFeedBriefingScopeLabel,
    setFeedBriefingAnchorArticleIDs,
    setLoadingFeedBriefing,
    setFeedBriefingError,
    setFeedBriefing,
    setFeedBriefingItems,
    setFeedBriefingArticleCount,
    setFeedBriefingGeneratedAt,
    setFeedBriefingMeta,
    setSelectedFeedBriefing,
    setFeedBriefingSnapshots,
    setNotice,
    upsertSummaryTask,
    toErrorMessage,
  })

  const { openArticle, onSummarizeArticle, onTrackThread } = useReaderArticleActions({
    aiModel,
    selectedArticleID,
    sourceByID,
    readerSessionRef,
    articleRequestSeqRef,
    summaryRequestSeqRef,
    summaryTaskNotifiedRef,
    closeDetailMoreMenu,
    finalizeReaderSession,
    startReaderSession,
    loadCachedSummary,
    resolveSummaryTaskIdentity,
    upsertSummaryTask,
    setLoadingArticle,
    setReaderView,
    setShowFloatingReader,
    setArticleError,
    setSelectedFeedBriefing,
    setSelectedArticleID,
    setArticleSummary,
    setArticleSummaryMeta,
    setArticleSummaryError,
    setLoadingArticleSummary,
    setExpandedThreadComments,
    setThreadCommentsNewestFirst,
    setSelectedArticle,
    floatingDetailRef,
    setNotice,
    loadSources,
    refreshStatusIfVisible,
  })

  function onOpenSummaryTask(task: SummaryTask) {
    if (task.kind === 'feed_briefing') {
      const snapshot = feedBriefingSnapshots[task.key]
      if (snapshot) {
        applyFeedBriefingSnapshot(snapshot)
      } else {
        setNotice({ kind: 'info', text: '该 AI 速览未在本地缓存，请重新生成一次。' })
      }
      setActiveTab('reader')
      openFeedBriefing()
      return
    }
    if (typeof task.articleID !== 'number' || task.articleID <= 0) {
      return
    }
    setActiveTab('reader')
    setReaderView('stream')
    void openArticle(task.articleID)
  }

  function onDismissSummaryTask(taskKey: string) {
    removeSummaryTask(taskKey)
  }

  const onAfterDeleteSourceStateSync = useCallback(
    (source: Source, containsSourceInFilter: boolean) => {
      if (containsSourceInFilter) {
        setSourceFilter('')
        setSourceGroupFilter(null)
        setSidebarTagFilters([])
      }
      if (selectedArticle?.source_id === source.id) {
        setSelectedArticle(null)
        setSelectedArticleID(null)
      }
      if (sourceProfileSource?.id === source.id) {
        setSourceProfileSource(null)
      }
      if (pendingDeleteSource?.id === source.id) {
        setPendingDeleteSource(null)
      }
      closeSourceContextMenu()
    },
    [
      closeSourceContextMenu,
      pendingDeleteSource,
      selectedArticle,
      setPendingDeleteSource,
      setSelectedArticle,
      setSelectedArticleID,
      setSidebarTagFilters,
      setSourceFilter,
      setSourceGroupFilter,
      setSourceProfileSource,
      sourceProfileSource,
    ],
  )

  const {
    onCreateSource,
    onDiscoverSources,
    onBatchCreateSources,
    onAddDiscoveredSource,
    onTestSource,
    onRefreshSource,
    onSaveSourceEdit,
    onToggleSourceEnabled,
    onDeleteSource,
    onReclassifySources,
    onRunBulkSourceAction,
    onRunBulkTagAction,
    onConfirmDeleteSource,
    onQuickSetSourceEnabled,
    onRemoveSourceProfileTag,
    onAddSourceProfileTags,
  } = useSourceManagementActions({
    newSourceName,
    newSourceURL,
    newSourceTags,
    batchSourceURLs,
    batchSourceTags,
    discoverURL,
    editSourceName,
    editSourceURL,
    editSourceTags,
    editSourcePollSec,
    sourceFilter,
    editingSourceID,
    selectedSourceIDs,
    bulkTagInput,
    sourceProfileSource,
    sourceProfileTags,
    pendingDeleteSource,
    sourceByID,
    setNotice,
    setCreatingSource,
    setNewSourceName,
    setNewSourceURL,
    setNewSourceTags,
    setBatchCreatingSources,
    setBatchCreateResult,
    setDiscoveringSources,
    setDiscoveredSources,
    setBusySourceID,
    setReclassifyingSources,
    setBulkSourceAction,
    setSources,
    setSourceProfileSource,
    setSourceProfileTagInput,
    clearSourceContextMenu: closeSourceContextMenu,
    onCancelEdit,
    onAfterDeleteSourceStateSync,
    loadSources,
    loadFeed,
    refreshStatusIfVisible,
    parseSourceTagInput,
    parseRSSLines,
    parseSourceIDFilter,
    normalizeSourceTags,
    sourceTagList,
    equalStringList,
    bulkActionLabel,
    toErrorMessage,
  })

  function openImmersiveReader() {
    streamScrollYRef.current = window.scrollY
    setReaderView('detail')
    setShowFloatingReader(false)
  }

  function returnToReaderStream() {
    finalizeReaderSession('close')
    setReaderView('stream')
    setShowFloatingReader(false)
    const targetY = streamScrollYRef.current
    if (targetY === null) return
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: targetY, behavior: 'auto' })
    })
  }

  const { applyFilters, clearFilters, removeFilter, onChangeAIModel, toggleSiteMuted } = useReaderFilterControls({
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
  })

  const applySourceFilterFromSidebar = useCallback((sourceID: string, options?: { preserveSidebarTags?: boolean }) => {
    cancelSidebarTagFeedReload()
    resetFeedBriefingState()
    const preserveSidebarTags = options?.preserveSidebarTags ?? false
    setSourceGroupFilter(null)
    if (!preserveSidebarTags) {
      setSidebarTagFilters([])
    }
    setSourceFilter(sourceID)
    setSelectedArticle(null)
    setSelectedArticleID(null)
    setFeedCursor('')
    void loadFeed(false, { sourceID })
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 980px)').matches) {
      setShowSubscriptionSidebar(false)
    }
  }, [
    cancelSidebarTagFeedReload,
    loadFeed,
    resetFeedBriefingState,
    setFeedCursor,
    setSelectedArticle,
    setSelectedArticleID,
    setShowSubscriptionSidebar,
    setSidebarTagFilters,
    setSourceFilter,
    setSourceGroupFilter,
  ])

  const registerSidebarSourceItemRef = useCallback((sourceID: number, node: HTMLDivElement | null) => {
    if (!node) {
      sidebarSourceItemRefs.current.delete(sourceID)
      return
    }
    sidebarSourceItemRefs.current.set(sourceID, node)
  }, [sidebarSourceItemRefs])

  const applySidebarTagFilters = useCallback((nextKeys: string[], mode: SidebarTagFilterMode = sidebarTagFilterMode) => {
    resetFeedBriefingState()
    const normalized = Array.from(
      new Set(
        nextKeys
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
      ),
    ).sort()

    setSidebarTagFilters(normalized)
    setSidebarTagFilterMode(mode)

    if (normalized.length === 0) {
      setSourceGroupFilter(null)
      setSourceFilter('')
      setFeedCursor('')
      scheduleSidebarTagFeedReload('')
      return
    }

    const sourceIDs = readerFeedSources
      .filter((source) => {
        const tagSet = new Set(sourceTagList(source).map((tag) => tag.toLowerCase()))
        if (mode === 'and') {
          return normalized.every((tag) => tagSet.has(tag))
        }
        return normalized.some((tag) => tagSet.has(tag))
      })
      .map((source) => source.id)
      .sort((left, right) => left - right)
    const sourceIDValue = sourceIDs.length > 0 ? sourceIDs.join(',') : '0'
    const labels = normalized.map((key) => sourceGroups.find((group) => group.key === key)?.label ?? key)
    const modeLabel = mode === 'and' ? 'AND' : 'OR'
    const label = labels.length === 1 ? `${labels[0]} (${modeLabel})` : `${modeLabel}: ${labels[0]} +${labels.length - 1}`

    setSourceGroupFilter({
      key: `tags:${mode}:${normalized.join(',')}`,
      label,
    })
    setSourceFilter(sourceIDValue)
    setFeedCursor('')
    scheduleSidebarTagFeedReload(sourceIDValue)
  }, [
    readerFeedSources,
    resetFeedBriefingState,
    scheduleSidebarTagFeedReload,
    setFeedCursor,
    setSidebarTagFilterMode,
    setSidebarTagFilters,
    setSourceFilter,
    setSourceGroupFilter,
    sidebarTagFilterMode,
    sourceGroups,
  ])

  const toggleSidebarTagFilter = useCallback((tagKey: string) => {
    if (sidebarTagFilterSet.has(tagKey)) {
      applySidebarTagFilters(sidebarTagFilters.filter((item) => item !== tagKey))
      return
    }
    applySidebarTagFilters([...sidebarTagFilters, tagKey])
  }, [applySidebarTagFilters, sidebarTagFilterSet, sidebarTagFilters])

  const switchSidebarTagFilterMode = useCallback((mode: SidebarTagFilterMode) => {
    if (mode === sidebarTagFilterMode) {
      return
    }
    if (sidebarTagFilters.length === 0) {
      setSidebarTagFilterMode(mode)
      return
    }
    applySidebarTagFilters(sidebarTagFilters, mode)
  }, [applySidebarTagFilters, setSidebarTagFilterMode, sidebarTagFilterMode, sidebarTagFilters])

  function openSourceProfile(source: Source) {
    setSourceProfileSource(source)
    setSourceProfileTagPickerOpen(false)
    setSourceProfileTagInput('')
    closeSourceContextMenu()
  }

  function openDeleteSourceConfirm(source: Source) {
    setPendingDeleteSource(source)
    closeSourceContextMenu()
  }

  const refreshAdminSession = useCallback(async () => {
    try {
      const response = await getAdminSession()
      setAdminAuthenticated(Boolean(response.data.authenticated))
    } catch {
      setAdminAuthenticated(false)
    }
  }, [])

  const onAdminLogin = useCallback(async () => {
    if (typeof window === 'undefined') {
      return
    }

    const username = window.prompt('管理员账号', 'admin')?.trim() ?? ''
    if (!username) {
      return
    }
    const password = window.prompt(`管理员密码 (${username})`) ?? ''
    if (!password) {
      setNotice({ kind: 'error', text: '管理员密码不能为空。' })
      return
    }

    try {
      await adminLoginRequest(username, password)
      setAdminAuthenticated(true)
      setNotice({ kind: 'info', text: '管理员登录成功。' })
    } catch (error) {
      setNotice({ kind: 'error', text: `管理员登录失败: ${toErrorMessage(error)}` })
    }
  }, [setNotice])

  const onAdminLogout = useCallback(async () => {
    try {
      await adminLogoutRequest()
    } catch {
      // keep logout UX idempotent
    }
    try {
      window.localStorage.removeItem('quick_admin_token')
    } catch {
      // ignore storage failure
    }
    setAdminAuthenticated(false)
    setNotice({ kind: 'info', text: '已退出管理权限。' })
  }, [setNotice])

  useEffect(() => {
    void loadSources()
    void loadFeed(false)
    void refreshAdminSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSummaryTasks((previous) => {
        const next = pruneSummaryTasks(previous)
        const keys = new Set(next.map((task) => task.key))
        for (const key of summaryTaskNotifiedRef.current) {
          if (!keys.has(key)) {
            summaryTaskNotifiedRef.current.delete(key)
          }
        }
        return next
      })
    }, 60 * 1000)
    return () => window.clearInterval(timer)
  }, [setSummaryTasks, summaryTaskNotifiedRef])

  useSummaryTaskPoller({
    aiModel,
    pendingArticleSummaryTasks,
    resolveSummaryTaskIdentity,
    selectedArticleID,
    upsertSummaryTask,
    setArticleSummary,
    setArticleSummaryMeta,
    setArticleSummaryError,
    setNotice: (notice) => setNotice(notice),
    summaryTaskNotifiedRef,
  })

  useFeedBriefingCacheRestore({
    activeTab,
    loadingFeed,
    loadingFeedBriefing,
    activeFeedBriefingAnchorArticleIDs,
    hasFeedBriefingEntry,
    feedBriefingTaskKey,
    activeFeedBriefingTaskKey,
    feedBriefingSnapshots,
    applyFeedBriefingSnapshot,
    activeFeedBriefingKeyword,
    tagFilter,
    aiModel,
    activeFeedBriefingSourceIDs,
    activeFeedBriefingScopeLabel,
    saveFeedBriefingSnapshot,
    upsertSummaryTask,
    feedBriefingCacheAttemptedRef,
  })

  useReaderRuntimeEffects({
    activeTab,
    hasMoreFeed,
    loadingFeed,
    feedCursor,
    feedAutoLoadRef,
    feedAutoLoadCooldownRef,
    loadMoreFeed: loadMore,
    setNowTick,
    readerView,
    showFloatingReader,
    floatingDetailRef,
    closeFloatingReader,
    selectedArticleID,
    readerSessionRef,
  })

  const closeTransientOverlays = useCallback(() => {
    setSourceProfileSource(null)
    closeSourceContextMenu()
    setPendingDeleteSource(null)
    setShowFeedAIMoreMenu(false)
    closeDetailMoreMenu()
  }, [closeDetailMoreMenu, closeSourceContextMenu, setPendingDeleteSource, setShowFeedAIMoreMenu, setSourceProfileSource])

  const openArticleFromKeyboard = useCallback(
    (articleID: number) => {
      void openArticle(articleID)
    },
    [openArticle],
  )

  const hasBlockingOverlayOpen = Boolean(
    sourceProfileSource || sourceContextMenu || pendingDeleteSource || showFeedAIMoreMenu || showDetailMoreMenu,
  )

  useReaderKeyboardShortcuts({
    readerStreamItems,
    selectedFeedIndex,
    selectedArticleLink: selectedArticle?.link,
    onOpenArticle: openArticleFromKeyboard,
    onOpenFeedBriefing: openFeedBriefing,
    isBlockingOverlayOpen: hasBlockingOverlayOpen,
    onCloseOverlays: closeTransientOverlays,
  })

  useEffect(() => {
    if (activeTab === 'sources' && sourceStatus.length === 0 && !loadingStatus) {
      void loadStatus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  useEffect(() => {
    const validSiteKeys = new Set(sourceSiteKeyMap.values())
    setMutedSiteKeys((previous) => previous.filter((siteKey) => validSiteKeys.has(siteKey)))
  }, [setMutedSiteKeys, sourceSiteKeyMap])

  useEffect(() => {
    const validTagKeys = new Set(sourceGroups.map((group) => group.key))
    const nextTagFilters = sidebarTagFilters.filter((key) => validTagKeys.has(key))
    if (nextTagFilters.length === sidebarTagFilters.length) {
      return
    }
    applySidebarTagFilters(nextTagFilters, sidebarTagFilterMode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceGroups, sidebarTagFilters, sidebarTagFilterMode])

  useEffect(() => {
    if (!sourceGroupFilter) return
    if (sourceGroupFilter.key.startsWith('tags:')) return
    const exists = sourceGroups.some((group) => group.key === sourceGroupFilter.key)
    if (exists) return
    setSourceGroupFilter(null)
    setSourceFilter('')
    void loadFeed(false, { sourceID: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceGroupFilter, sourceGroups])

  useEffect(() => {
    if (!sourceFilter.trim()) return
    const validSourceIDs = new Set(readerSources.map((source) => source.id))
    const selectedIDs = parseSourceIDFilter(sourceFilter)
    if (selectedIDs.length === 0) return
    const allValid = selectedIDs.every((sourceID) => validSourceIDs.has(sourceID))
    if (allValid) return
    setSourceGroupFilter(null)
    setSourceFilter('')
    void loadFeed(false, { sourceID: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readerSources, sourceFilter])

  useEffect(() => {
    const input = sourceSelectAllRef.current
    if (!input) return
    input.indeterminate = selectedVisibleCount > 0 && !allVisibleSelected
  }, [allVisibleSelected, selectedVisibleCount, sourceSelectAllRef])

  useEffect(() => {
    if (!showFeedAIMoreMenu) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (target && feedAIMoreRef.current?.contains(target)) {
        return
      }
      setShowFeedAIMoreMenu(false)
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setShowFeedAIMoreMenu(false)
      }
    }

    function handleScroll() {
      setShowFeedAIMoreMenu(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [feedAIMoreRef, setShowFeedAIMoreMenu, showFeedAIMoreMenu])

  useEffect(() => {
    if (activeTab !== 'reader' && showFeedAIMoreMenu) {
      setShowFeedAIMoreMenu(false)
    }
  }, [activeTab, setShowFeedAIMoreMenu, showFeedAIMoreMenu])

  useLayoutEffect(() => {
    if (activeTab !== 'reader' || !showSubscriptionSidebar) {
      previousSidebarSourceItemRectsRef.current = new Map()
      previousSidebarSourceIDsRef.current = []
      return
    }

    const reduceMotion =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const nextIDs = sidebarVisibleFeedSources.map((source) => source.id)
    const nextRects = new Map<number, DOMRect>()

    for (const sourceID of nextIDs) {
      const node = sidebarSourceItemRefs.current.get(sourceID)
      if (!node) continue
      nextRects.set(sourceID, node.getBoundingClientRect())
    }

    if (!reduceMotion) {
      const previousRects = previousSidebarSourceItemRectsRef.current
      const previousIDs = previousSidebarSourceIDsRef.current

      for (const sourceID of nextIDs) {
        const node = sidebarSourceItemRefs.current.get(sourceID)
        if (!node) continue

        const previousRect = previousRects.get(sourceID)
        const nextRect = nextRects.get(sourceID)
        if (previousRect && nextRect) {
          const deltaY = previousRect.top - nextRect.top
          if (Math.abs(deltaY) > 1) {
            node.animate([{ transform: `translateY(${deltaY}px)` }, { transform: 'translateY(0)' }], {
              duration: 170,
              easing: 'cubic-bezier(.2,.8,.2,1)',
            })
          }
          continue
        }

        if (previousIDs.length > 0) {
          node.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], {
            duration: 150,
            easing: 'ease-out',
          })
        }
      }
    }

    previousSidebarSourceItemRectsRef.current = nextRects
    previousSidebarSourceIDsRef.current = nextIDs
  }, [
    activeTab,
    previousSidebarSourceIDsRef,
    previousSidebarSourceItemRectsRef,
    sidebarSourceItemRefs,
    showSubscriptionSidebar,
    sidebarVisibleFeedSources,
  ])

  useEffect(() => {
    if (activeTab === 'reader' && showSubscriptionSidebar) return
    closeSourceContextMenu()
    setPendingDeleteSource(null)
  }, [activeTab, closeSourceContextMenu, setPendingDeleteSource, showSubscriptionSidebar])

  useEffect(() => {
    if (activeTab !== 'sources') {
      setShowManageModelPicker(false)
    }
  }, [activeTab, setShowManageModelPicker])

  useEffect(() => {
    if (!showManageModelPicker) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest('.manage-model-entry')) {
        return
      }
      setShowManageModelPicker(false)
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setShowManageModelPicker(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [setShowManageModelPicker, showManageModelPicker])

  useEffect(() => {
    if (!sourceProfileSource) return
    const latest = sourceByID.get(sourceProfileSource.id)
    if (!latest) {
      setSourceProfileSource(null)
      return
    }
    if (latest !== sourceProfileSource) {
      setSourceProfileSource(latest)
    }
  }, [setSourceProfileSource, sourceByID, sourceProfileSource])

  useEffect(() => {
    if (sourceProfileSource) return
    setSourceProfileTagPickerOpen(false)
    setSourceProfileTagInput('')
  }, [setSourceProfileTagInput, setSourceProfileTagPickerOpen, sourceProfileSource])

  useEffect(() => {
    if (!pendingDeleteSource) return
    const latest = sourceByID.get(pendingDeleteSource.id)
    if (!latest) {
      setPendingDeleteSource(null)
      return
    }
    if (latest !== pendingDeleteSource) {
      setPendingDeleteSource(latest)
    }
  }, [pendingDeleteSource, setPendingDeleteSource, sourceByID])

  const sourceManagementController: SourceManagementPanelController = {
    aiModel,
    aiModelOptions,
    showManageModelPicker,
    onToggleManageModelPicker: () => setShowManageModelPicker((value) => !value),
    onChangeAIModel,
    sources,
    enabledSourceCount,
    unhealthySourceCount,
    mutedSiteKeys,
    sourceHealthCounts,
    healthToneClass,
    loadingStatus,
    onLoadStatus: loadStatus,
    reclassifyingSources,
    onReclassifySources,
    sourceManageKeyword,
    onSetSourceManageKeyword: setSourceManageKeyword,
    sourceManageTagFilter,
    onSetSourceManageTagFilter: setSourceManageTagFilter,
    sourceManageHealthFilter,
    onSetSourceManageHealthFilter: setSourceManageHealthFilter,
    availableTags,
    onClearSourceManageFilters: clearSourceManageFilters,
    loadingSources,
    onLoadSources: loadSources,
    selectedSourceIDs,
    visibleSourceIDs,
    bulkTagInput,
    onSetBulkTagInput: setBulkTagInput,
    bulkSourceAction,
    hasSelectedSources,
    onRunBulkTagAction,
    onRunBulkSourceAction,
    onClearSelectedSourceIDs: clearSelectedSourceIDs,
    sourcesError,
    statusError,
    sourceSelectAllRef,
    allVisibleSelected,
    onToggleSelectAllVisibleSources: toggleSelectAllVisibleSources,
    filteredSources,
    sourceStatusMap,
    resolveSourceHealth,
    sourceSiteKeyMap,
    resolveSourceSiteKey,
    busySourceID,
    editingSourceID,
    selectedSourceIDSet,
    onToggleSourceSelection: toggleSourceSelection,
    editSourceName,
    onSetEditSourceName: setEditSourceName,
    editSourceTags,
    onSetEditSourceTags: setEditSourceTags,
    editSourcePollSec,
    onSetEditSourcePollSec: setEditSourcePollSec,
    editSourceURL,
    onSetEditSourceURL: setEditSourceURL,
    sourceTagList,
    normalizeSourceKind,
    sourceClickCount,
    formatTimeAgo,
    healthLabel,
    onSaveSourceEdit,
    onCancelEdit,
    onTestSource,
    onRefreshSource,
    onStartEdit,
    onToggleSourceEnabled,
    onToggleSiteMuted: toggleSiteMuted,
    mutedSiteSet,
    onDeleteSource,
    newSourceName,
    onSetNewSourceName: setNewSourceName,
    newSourceURL,
    onSetNewSourceURL: setNewSourceURL,
    newSourceTags,
    onSetNewSourceTags: setNewSourceTags,
    creatingSource,
    onCreateSource,
    batchSourceURLs,
    onSetBatchSourceURLs: setBatchSourceURLs,
    batchSourceTags,
    onSetBatchSourceTags: setBatchSourceTags,
    batchCreatingSources,
    onBatchCreateSources,
    batchCreateResult,
    discoverURL,
    onSetDiscoverURL: setDiscoverURL,
    discoveringSources,
    onDiscoverSources,
    discoveredSources,
    confidenceLabel,
    onAddDiscoveredSource,
  }

  return (
    <div className="app-shell">
      <AppTopbar
        activeTab={activeTab}
        sourcesCount={sources.length}
        loadingSources={loadingSources}
        loadingFeed={loadingFeed}
        adminAuthenticated={adminAuthenticated}
        onOpenReaderTab={() => {
          finalizeReaderSession('close')
          setActiveTab('reader')
          setReaderView('stream')
          setShowFloatingReader(false)
        }}
        onOpenSourcesTab={() => {
          finalizeReaderSession('close')
          setShowFloatingReader(false)
          setReaderView('stream')
          setActiveTab('sources')
        }}
        onRefreshAll={() => {
          void refreshAll()
        }}
        onAdminLogin={() => {
          void onAdminLogin()
        }}
        onAdminLogout={() => {
          void onAdminLogout()
        }}
      />

      <NoticeBanner notice={notice} onClose={() => setNotice(null)} />

      {visibleSummaryTasks.length > 0 && (
        <Suspense fallback={null}>
          <SummaryTaskStripPanel
            tasks={visibleSummaryTasks}
            stats={summaryTaskStats}
            onClearCompleted={clearCompletedSummaryTasks}
            onOpenTask={onOpenSummaryTask}
            onDismissTask={onDismissSummaryTask}
            summaryTaskKindLabel={summaryTaskKindLabel}
            summaryTaskStatusLabel={summaryTaskStatusLabel}
            formatTimeAgo={formatTimeAgo}
          />
        </Suspense>
      )}

      {activeTab === 'reader' && (
        <>
          <div className="mobile-reader-toolbar">
            <Button
              type="button"
              variant={showSubscriptionSidebar ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowSubscriptionSidebar((value) => !value)}
            >
              {showSubscriptionSidebar ? '收起来源' : '来源与标签'}
            </Button>
          </div>

          {showSubscriptionSidebar && (
            <button
              type="button"
              className="mobile-sidebar-backdrop"
              aria-label="关闭来源侧栏"
              onClick={() => setShowSubscriptionSidebar(false)}
            />
          )}

          <main className="reader-layout">
            <div className={`reader-stack ${showSubscriptionSidebar ? 'sidebar-open' : 'sidebar-closed'}`}>
              <ReaderSubscriptionSidebar
                showSubscriptionSidebar={showSubscriptionSidebar}
                sourceFilter={sourceFilter}
                readerSources={readerSources}
                sourceGroups={sourceGroups}
                sidebarTagFilterMode={sidebarTagFilterMode}
                sidebarTagFilters={sidebarTagFilters}
                sidebarTagFilterSet={sidebarTagFilterSet}
                showAllSidebarTags={showAllSidebarTags}
                sidebarTagCollapseCount={sidebarTagCollapseCount}
                sidebarVisibleFeedSources={sidebarVisibleFeedSources}
                isSourceGroupFilterActive={Boolean(sourceGroupFilter)}
                readerTrackedSources={readerTrackedSources}
                showTrackedSidebar={showTrackedSidebar}
                visibleTrackedSidebarSources={visibleTrackedSidebarSources}
                hasMoreTrackedSidebarSources={hasMoreTrackedSidebarSources}
                showAllTrackedSidebar={showAllTrackedSidebar}
                onToggleSubscriptionSidebar={() => setShowSubscriptionSidebar((value) => !value)}
                onApplySourceFilterFromSidebar={applySourceFilterFromSidebar}
                onSwitchSidebarTagFilterMode={switchSidebarTagFilterMode}
                onApplySidebarTagFilters={(keys) => applySidebarTagFilters(keys)}
                onToggleShowAllSidebarTags={() => setShowAllSidebarTags((value) => !value)}
                onToggleSidebarTagFilter={toggleSidebarTagFilter}
                onRegisterSidebarSourceItemRef={registerSidebarSourceItemRef}
                onOpenSourceContextMenu={openSourceContextMenu}
                onOpenSourceContextMenuAt={openSourceContextMenuAt}
                onToggleShowTrackedSidebar={() => setShowTrackedSidebar((value) => !value)}
                onToggleShowAllTrackedSidebar={() => setShowAllTrackedSidebar((value) => !value)}
              />

              <ReaderFeedPanel
                showFloatingReader={showFloatingReader}
                readerView={readerView}
                feedTitleOnlyMode={feedTitleOnlyMode}
                showFeedImages={showFeedImages}
                showFeedSearch={showFeedSearch}
                showAdvancedFilters={showAdvancedFilters}
                showFeedAIMoreMenu={showFeedAIMoreMenu}
                loadingFeedBriefing={loadingFeedBriefing}
                unreadVisibleCount={unreadVisibleCount}
                unreadOnly={unreadOnly}
                hasActiveFilters={Boolean(hasActiveFilters)}
                keyword={keyword}
                tagFilter={tagFilter}
                sourceFilter={sourceFilter}
                mutedSiteKeys={mutedSiteKeys}
                availableTags={availableTags}
                readerSources={readerSources}
                sourceFilterSelectValue={sourceFilterSelectValue}
                sourceFilterChipLabel={sourceFilterChipLabel}
                loadingFeed={loadingFeed}
                feedError={feedError}
                feed={feed}
                visibleFeed={visibleFeed}
                hasFeedBriefingEntry={hasFeedBriefingEntry}
                feedBriefingInsertIndex={feedBriefingInsertIndex}
                selectedArticleID={selectedArticleID}
                selectedFeedBriefing={selectedFeedBriefing}
                readArticleIDSet={readArticleIDSet}
                feedAIMoreRef={feedAIMoreRef}
                feedAutoLoadRef={feedAutoLoadRef}
                hasMoreFeed={hasMoreFeed}
                feedBriefingPreviewText={feedBriefingPreviewText}
                feedBriefingScopeLabel={feedBriefingScopeLabel}
                feedBriefingFreshnessLabel={feedBriefingFreshnessLabel}
                feedBriefingNewArticleCount={feedBriefingNewArticleCount}
                feedBriefingArticleCount={feedBriefingArticleCount}
                feedBriefingItems={feedBriefingItems}
                onGenerateFeedBriefing={onGenerateFeedBriefing}
                onCloseFeedAIMoreMenu={() => setShowFeedAIMoreMenu(false)}
                onToggleFeedAIMoreMenu={() => setShowFeedAIMoreMenu((value) => !value)}
                onSetUnreadOnly={setUnreadOnly}
                onToggleFeedTitleOnlyMode={() => setFeedTitleOnlyMode((value) => !value)}
                onToggleFeedImages={() => setShowFeedImages((value) => !value)}
                onToggleFeedSearch={() => {
                  setShowFeedSearch((value) => {
                    const next = !value
                    if (!next) {
                      setShowAdvancedFilters(false)
                    }
                    return next
                  })
                }}
                onApplyFilters={applyFilters}
                onToggleAdvancedFilters={() => setShowAdvancedFilters((value) => !value)}
                onChangeKeyword={setKeyword}
                onChangeTagFilter={setTagFilter}
                onChangeSourceFilter={(value) => {
                  setSourceGroupFilter(null)
                  setSidebarTagFilters([])
                  setSourceFilter(value)
                }}
                onClearFilters={clearFilters}
                onRemoveFilter={removeFilter}
                onRetryLoadFeed={() => loadFeed(false)}
                onOpenArticle={openArticle}
                onOpenFeedBriefing={openFeedBriefing}
                onLoadMore={loadMore}
                normalizeImageURL={normalizeImageURL}
                formatTimeAgo={formatTimeAgo}
                formatTimeAgoCompact={formatTimeAgoCompact}
                formatReplyCount={formatReplyCount}
                buildCompactTitleParts={buildCompactTitleParts}
                plainText={plainText}
                truncate={truncate}
                getSummaryTaskStatus={getSummaryTaskStatus}
                summaryTaskStatusLabel={summaryTaskStatusLabel}
              />
            </div>
          </main>

          {(showFloatingReader || readerView === 'detail') && (
            <Suspense
              fallback={
                <section className={`panel detail reader-panel ${readerView === 'detail' ? 'detail-page' : 'detail-floating'}`}>
                  <div className="detail-content">
                    <div className="skeleton skeleton-title" />
                    <div className="skeleton skeleton-line" />
                    <div className="skeleton skeleton-line short" />
                  </div>
                </section>
              }
            >
              <ReaderDetailPanel
                floatingDetailRef={floatingDetailRef}
                showFloatingReader={showFloatingReader}
                readerView={readerView}
                selectedArticle={selectedArticle}
                selectedFeedBriefing={selectedFeedBriefing}
                loadingArticle={loadingArticle}
                articleError={articleError}
                selectedArticleID={selectedArticleID}
                openArticle={openArticle}
                feedBriefingScopeLabel={feedBriefingScopeLabel}
                feedBriefingFreshnessLabel={feedBriefingFreshnessLabel}
                returnToReaderStream={returnToReaderStream}
                closeFloatingReader={closeFloatingReader}
                openImmersiveReader={openImmersiveReader}
                aiModel={aiModel}
                onGenerateFeedBriefing={onGenerateFeedBriefing}
                loadingFeedBriefing={loadingFeedBriefing}
                feedBriefingMeta={feedBriefingMeta}
                feedBriefingNewArticleCount={feedBriefingNewArticleCount}
                feedBriefingError={feedBriefingError}
                feedBriefing={feedBriefing}
                feedBriefingItems={feedBriefingItems}
                feedBriefingArticleCount={feedBriefingArticleCount}
                formatTimeAgo={formatTimeAgo}
                selectedArticleReplyCountLabel={selectedArticleReplyCountLabel}
                selectedArticleImageURL={selectedArticleImageURL}
                closeDetailMoreMenu={closeDetailMoreMenu}
                onSummarizeArticle={onSummarizeArticle}
                loadingArticleSummary={loadingArticleSummary}
                hasDetailMoreActions={hasDetailMoreActions}
                detailMoreMenuRef={detailMoreMenuRef}
                showDetailMoreMenu={showDetailMoreMenu}
                toggleDetailMoreMenu={toggleDetailMoreMenu}
                canTrackThread={canTrackThread}
                onTrackThread={onTrackThread}
                canForceRecalcSummary={canForceRecalcSummary}
                articleSummaryError={articleSummaryError}
                articleSummary={articleSummary}
                articleSummaryMeta={articleSummaryMeta}
                selectedSummaryTask={selectedSummaryTask}
                isThreadArticle={isThreadArticle}
                threadPrimaryBody={threadPrimaryBody}
                plainTextBlock={plainTextBlock}
                visibleThreadComments={visibleThreadComments}
                threadComments={threadComments}
                threadCommentsNewestFirst={threadCommentsNewestFirst}
                onToggleThreadCommentsNewestFirst={() => setThreadCommentsNewestFirst((value) => !value)}
                threadPreviewCommentLimit={threadPreviewCommentLimit}
                expandedThreadComments={expandedThreadComments}
                onToggleExpandedThreadComments={() => setExpandedThreadComments((value) => !value)}
                hasHiddenThreadComments={hasHiddenThreadComments}
              />
            </Suspense>
          )}
        </>
      )}

      {activeTab === 'sources' && (
        <Suspense
          fallback={
            <main className="source-management-page">
              <section className="panel sources source-manage-panel">
                <p className="hint">加载管理页面中...</p>
              </section>
            </main>
          }
        >
          <SourceManagementPanel controller={sourceManagementController} />
        </Suspense>
      )}

      {sourceContextMenu && (
        <Suspense fallback={null}>
          <SourceContextMenuOverlay
            contextMenuRef={sourceContextMenuRef}
            sourceContextMenu={sourceContextMenu}
            busySourceID={busySourceID}
            onQuickSetSourceEnabled={onQuickSetSourceEnabled}
            onOpenSourceProfile={openSourceProfile}
            onOpenDeleteConfirm={openDeleteSourceConfirm}
          />
        </Suspense>
      )}

      {sourceProfileSource && (
        <Suspense fallback={null}>
          <SourceProfileDialog
            sourceProfileSource={sourceProfileSource}
            sourceProfileStatus={sourceProfileStatus}
            sourceProfileHealth={sourceProfileHealth}
            sourceProfileTags={sourceProfileTags}
            sourceProfileTagPickerOpen={sourceProfileTagPickerOpen}
            onToggleSourceProfileTagPicker={() => setSourceProfileTagPickerOpen((value) => !value)}
            sourceProfileTagInput={sourceProfileTagInput}
            onSetSourceProfileTagInput={setSourceProfileTagInput}
            sourceProfileTagDrafts={sourceProfileTagDrafts}
            sourceProfileTagCandidates={sourceProfileTagCandidates}
            busySourceID={busySourceID}
            onRemoveSourceProfileTag={onRemoveSourceProfileTag}
            onAddSourceProfileTags={onAddSourceProfileTags}
            onQuickSetSourceEnabled={onQuickSetSourceEnabled}
            onOpenDeleteConfirm={openDeleteSourceConfirm}
            onCloseSourceProfile={() => setSourceProfileSource(null)}
            normalizeSourceKind={normalizeSourceKind}
            resolveSourceSiteKey={resolveSourceSiteKey}
            formatDateTime={formatDateTime}
            healthToneClass={healthToneClass}
            healthLabel={healthLabel}
            formatTimeAgo={formatTimeAgo}
            sourceClickCount={sourceClickCount}
          />
        </Suspense>
      )}

      {pendingDeleteSource && (
        <Suspense fallback={null}>
          <SourceDeleteConfirmDialog
            pendingDeleteSource={pendingDeleteSource}
            busySourceID={busySourceID}
            onCloseDeleteConfirm={() => setPendingDeleteSource(null)}
            onConfirmDeleteSource={onConfirmDeleteSource}
          />
        </Suspense>
      )}
    </div>
  )
}

export default App
