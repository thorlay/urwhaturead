import { lazy, Suspense, useCallback, useEffect, useMemo } from 'react'
import {
  getArticleSummary,
} from './api'
import type { Source, SourceStatus } from './types'
import { AppTopbar } from '@/components/app-topbar'
import { NoticeBanner } from '@/components/notice-banner'
import { ReaderWorkspace, type ReaderWorkspaceProps } from '@/components/reader-workspace'
import { SourceOverlaysStack, type SourceOverlaysStackProps } from '@/components/source-overlays-stack'
import { useReaderStream } from './hooks/use-reader-stream'
import { useDetailPanel } from './hooks/use-detail-panel'
import { useFeedBriefingCacheRestore } from './hooks/use-feed-briefing-cache-restore'
import { useFeedBriefingActions } from './hooks/use-feed-briefing-actions'
import { useAdminAccess } from './hooks/use-admin-access'
import { useAppUIEffects } from './hooks/use-app-ui-effects'
import { useAppState } from './hooks/use-app-state'
import { useReaderArticleActions } from './hooks/use-reader-article-actions'
import { useReaderDataController } from './hooks/use-reader-data-controller'
import { useReaderFilterControls } from './hooks/use-reader-filter-controls'
import { useReaderKeyboardShortcuts } from './hooks/use-reader-keyboard-shortcuts'
import { useReaderRuntimeEffects } from './hooks/use-reader-runtime-effects'
import { useReaderSessionActions } from './hooks/use-reader-session-actions'
import { useReaderSidebarControls } from './hooks/use-reader-sidebar-controls'
import { useReaderSidebarState } from './hooks/use-reader-sidebar-state'
import { useSourceContextMenu } from './hooks/use-source-context-menu'
import { useSourceManagementController } from './hooks/use-source-management-controller'
import { useSummaryTaskView } from './hooks/use-summary-task-view'
import { useSummaryTaskPoller } from './hooks/use-summary-task-poller'
import { useSourceManagementState } from './hooks/use-source-management-state'
import { useSourceManagementActions } from './hooks/use-source-management-actions'
import {
  aiModelOptions,
  aiModelStorageKey,
  readArticleStorageKey,
  readMarkMinScrollProgress,
  sidebarTagCollapseCount,
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
  isSummaryTaskPending,
  pruneSummaryTasks,
  resolveFeedBriefingScopeLabel,
  summaryTaskKindLabel,
  summaryTaskStatusLabel,
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

function App() {
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
  const visibleFeedArticleIDs = useMemo(() => visibleFeed.map((item) => item.id), [visibleFeed])
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
  const {
    visibleSummaryTasks,
    summaryTaskStats,
    pendingArticleSummaryTasks,
    selectedSummaryTask,
    getSummaryTaskStatus,
  } = useSummaryTaskView({
    summaryTasks,
    sourceFilterIDs,
    visibleFeedArticleIDs,
    selectedArticleID,
  })
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

  const {
    applySourceFilterFromSidebar,
    registerSidebarSourceItemRef,
    applySidebarTagFilters,
    toggleSidebarTagFilter,
    switchSidebarTagFilterMode,
    openSourceProfile,
    openDeleteSourceConfirm,
  } = useReaderSidebarControls({
    cancelSidebarTagFeedReload,
    resetFeedBriefingState,
    setSourceGroupFilter,
    setSidebarTagFilters,
    setSourceFilter,
    setSelectedArticle,
    setSelectedArticleID,
    setFeedCursor,
    loadFeed,
    setShowSubscriptionSidebar,
    sidebarSourceItemRefs,
    sidebarTagFilterMode,
    setSidebarTagFilterMode,
    readerFeedSources,
    sourceTagList,
    sourceGroups,
    sidebarTagFilters,
    sidebarTagFilterSet,
    closeSourceContextMenu,
    setSourceProfileSource,
    setSourceProfileTagPickerOpen,
    setSourceProfileTagInput,
    setPendingDeleteSource,
  })

  const {
    adminAuthEnabled,
    adminAuthenticated,
    canAccessManagement,
    refreshAdminSession,
    onAdminLogout,
  } = useAdminAccess({
    activeTab,
    setActiveTab,
    setReaderView,
    setShowFloatingReader,
    setNotice,
  })

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

  useAppUIEffects({
    activeTab,
    sourceStatus,
    loadingStatus,
    loadStatus,
    sourceSiteKeyMap,
    setMutedSiteKeys,
    sourceGroups,
    sidebarTagFilters,
    sidebarTagFilterMode,
    applySidebarTagFilters,
    sourceGroupFilter,
    setSourceGroupFilter,
    setSourceFilter,
    loadFeed,
    sourceFilter,
    readerSources,
    parseSourceIDFilter,
    sourceSelectAllRef,
    selectedVisibleCount,
    allVisibleSelected,
    showFeedAIMoreMenu,
    feedAIMoreRef,
    setShowFeedAIMoreMenu,
    showSubscriptionSidebar,
    previousSidebarSourceItemRectsRef,
    previousSidebarSourceIDsRef,
    sidebarVisibleFeedSources,
    sidebarSourceItemRefs,
    closeSourceContextMenu,
    setPendingDeleteSource,
    setShowManageModelPicker,
    showManageModelPicker,
    sourceProfileSource,
    sourceByID,
    setSourceProfileSource,
    setSourceProfileTagPickerOpen,
    setSourceProfileTagInput,
    pendingDeleteSource,
  })

  const sourceManagementController = useSourceManagementController({
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
  })

  const onOpenReaderTab = useCallback(() => {
    finalizeReaderSession('close')
    setActiveTab('reader')
    setReaderView('stream')
    setShowFloatingReader(false)
  }, [finalizeReaderSession, setActiveTab, setReaderView, setShowFloatingReader])

  const onOpenSourcesTab = useCallback(() => {
    if (!canAccessManagement) {
      return
    }
    finalizeReaderSession('close')
    setShowFloatingReader(false)
    setReaderView('stream')
    setActiveTab('sources')
  }, [canAccessManagement, finalizeReaderSession, setActiveTab, setReaderView, setShowFloatingReader])

  const onRefreshAllClick = useCallback(() => {
    void refreshAll()
  }, [refreshAll])

  const onAdminLogoutClick = useCallback(() => {
    void onAdminLogout()
  }, [onAdminLogout])

  const readerWorkspaceProps: ReaderWorkspaceProps = {
    showSubscriptionSidebar,
    onToggleSubscriptionSidebar: () => setShowSubscriptionSidebar((value) => !value),
    onCloseSubscriptionSidebar: () => setShowSubscriptionSidebar(false),
    sidebarProps: {
      showSubscriptionSidebar,
      sourceFilter,
      readerSources,
      sourceGroups,
      sidebarTagFilterMode,
      sidebarTagFilters,
      sidebarTagFilterSet,
      showAllSidebarTags,
      sidebarTagCollapseCount,
      sidebarVisibleFeedSources,
      isSourceGroupFilterActive: Boolean(sourceGroupFilter),
      readerTrackedSources,
      showTrackedSidebar,
      visibleTrackedSidebarSources,
      hasMoreTrackedSidebarSources,
      showAllTrackedSidebar,
      onToggleSubscriptionSidebar: () => setShowSubscriptionSidebar((value) => !value),
      onApplySourceFilterFromSidebar: applySourceFilterFromSidebar,
      onSwitchSidebarTagFilterMode: switchSidebarTagFilterMode,
      onApplySidebarTagFilters: applySidebarTagFilters,
      onToggleShowAllSidebarTags: () => setShowAllSidebarTags((value) => !value),
      onToggleSidebarTagFilter: toggleSidebarTagFilter,
      onRegisterSidebarSourceItemRef: registerSidebarSourceItemRef,
      onOpenSourceContextMenu: openSourceContextMenu,
      onOpenSourceContextMenuAt: openSourceContextMenuAt,
      onToggleShowTrackedSidebar: () => setShowTrackedSidebar((value) => !value),
      onToggleShowAllTrackedSidebar: () => setShowAllTrackedSidebar((value) => !value),
    },
    feedProps: {
      showFloatingReader,
      readerView,
      feedTitleOnlyMode,
      showFeedImages,
      showFeedSearch,
      showAdvancedFilters,
      showFeedAIMoreMenu,
      loadingFeedBriefing,
      unreadVisibleCount,
      unreadOnly,
      hasActiveFilters: Boolean(hasActiveFilters),
      keyword,
      tagFilter,
      sourceFilter,
      mutedSiteKeys,
      availableTags,
      readerSources,
      sourceFilterSelectValue,
      sourceFilterChipLabel,
      loadingFeed,
      feedError,
      feed,
      visibleFeed,
      hasFeedBriefingEntry,
      feedBriefingInsertIndex,
      selectedArticleID,
      selectedFeedBriefing,
      readArticleIDSet,
      feedAIMoreRef,
      feedAutoLoadRef,
      hasMoreFeed,
      feedBriefingPreviewText,
      feedBriefingScopeLabel,
      feedBriefingFreshnessLabel,
      feedBriefingNewArticleCount,
      feedBriefingArticleCount,
      feedBriefingItems,
      onGenerateFeedBriefing,
      onCloseFeedAIMoreMenu: () => setShowFeedAIMoreMenu(false),
      onToggleFeedAIMoreMenu: () => setShowFeedAIMoreMenu((value) => !value),
      onSetUnreadOnly: setUnreadOnly,
      onToggleFeedTitleOnlyMode: () => setFeedTitleOnlyMode((value) => !value),
      onToggleFeedImages: () => setShowFeedImages((value) => !value),
      onToggleFeedSearch: () => {
        setShowFeedSearch((value) => {
          const next = !value
          if (!next) {
            setShowAdvancedFilters(false)
          }
          return next
        })
      },
      onApplyFilters: applyFilters,
      onToggleAdvancedFilters: () => setShowAdvancedFilters((value) => !value),
      onChangeKeyword: setKeyword,
      onChangeTagFilter: setTagFilter,
      onChangeSourceFilter: (value) => {
        setSourceGroupFilter(null)
        setSidebarTagFilters([])
        setSourceFilter(value)
      },
      onClearFilters: clearFilters,
      onRemoveFilter: removeFilter,
      onRetryLoadFeed: () => loadFeed(false),
      onOpenArticle: openArticle,
      onOpenFeedBriefing: openFeedBriefing,
      onLoadMore: loadMore,
      normalizeImageURL,
      formatTimeAgo,
      formatTimeAgoCompact,
      formatReplyCount,
      buildCompactTitleParts,
      plainText,
      truncate,
      getSummaryTaskStatus,
      summaryTaskStatusLabel,
    },
    showFloatingReader,
    readerView,
    detailProps: {
      floatingDetailRef,
      showFloatingReader,
      readerView,
      selectedArticle,
      selectedFeedBriefing,
      loadingArticle,
      articleError,
      selectedArticleID,
      openArticle,
      feedBriefingScopeLabel,
      feedBriefingFreshnessLabel,
      returnToReaderStream,
      closeFloatingReader,
      openImmersiveReader,
      aiModel,
      onGenerateFeedBriefing,
      loadingFeedBriefing,
      feedBriefingMeta,
      feedBriefingNewArticleCount,
      feedBriefingError,
      feedBriefing,
      feedBriefingItems,
      feedBriefingArticleCount,
      formatTimeAgo,
      selectedArticleReplyCountLabel,
      selectedArticleImageURL,
      closeDetailMoreMenu,
      onSummarizeArticle,
      loadingArticleSummary,
      hasDetailMoreActions,
      detailMoreMenuRef,
      showDetailMoreMenu,
      toggleDetailMoreMenu,
      canTrackThread,
      onTrackThread,
      canForceRecalcSummary,
      articleSummaryError,
      articleSummary,
      articleSummaryMeta,
      selectedSummaryTask,
      isThreadArticle,
      threadPrimaryBody,
      plainTextBlock,
      visibleThreadComments,
      threadComments,
      threadCommentsNewestFirst,
      onToggleThreadCommentsNewestFirst: () => setThreadCommentsNewestFirst((value) => !value),
      threadPreviewCommentLimit,
      expandedThreadComments,
      onToggleExpandedThreadComments: () => setExpandedThreadComments((value) => !value),
      hasHiddenThreadComments,
    },
  }

  const sourceOverlaysProps: SourceOverlaysStackProps = {
    contextMenuProps: {
      contextMenuRef: sourceContextMenuRef,
      sourceContextMenu,
      busySourceID,
      onQuickSetSourceEnabled,
      onOpenSourceProfile: openSourceProfile,
      onOpenDeleteConfirm: openDeleteSourceConfirm,
    },
    profileDialogProps: {
      sourceProfileSource,
      sourceProfileStatus,
      sourceProfileHealth,
      sourceProfileTags,
      sourceProfileTagPickerOpen,
      onToggleSourceProfileTagPicker: () => setSourceProfileTagPickerOpen((value) => !value),
      sourceProfileTagInput,
      onSetSourceProfileTagInput: setSourceProfileTagInput,
      sourceProfileTagDrafts,
      sourceProfileTagCandidates,
      busySourceID,
      onRemoveSourceProfileTag,
      onAddSourceProfileTags,
      onQuickSetSourceEnabled,
      onOpenDeleteConfirm: openDeleteSourceConfirm,
      onCloseSourceProfile: () => setSourceProfileSource(null),
      normalizeSourceKind,
      resolveSourceSiteKey,
      formatDateTime,
      healthToneClass,
      healthLabel,
      formatTimeAgo,
      sourceClickCount,
    },
    deleteConfirmProps: {
      pendingDeleteSource,
      busySourceID,
      onCloseDeleteConfirm: () => setPendingDeleteSource(null),
      onConfirmDeleteSource,
    },
  }

  return (
    <div className="app-shell">
      <AppTopbar
        activeTab={activeTab}
        sourcesCount={sources.length}
        loadingSources={loadingSources}
        loadingFeed={loadingFeed}
        canAccessManagement={canAccessManagement}
        showAdminLogout={adminAuthEnabled && adminAuthenticated}
        onOpenReaderTab={onOpenReaderTab}
        onOpenSourcesTab={onOpenSourcesTab}
        onRefreshAll={onRefreshAllClick}
        onAdminLogout={onAdminLogoutClick}
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

      {activeTab === 'reader' && <ReaderWorkspace {...readerWorkspaceProps} />}

      {activeTab === 'sources' && canAccessManagement && (
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

      <SourceOverlaysStack {...sourceOverlaysProps} />
    </div>
  )
}

export default App
