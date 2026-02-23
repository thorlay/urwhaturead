import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  createFeedBriefing,
  getArticle,
  getArticleSummary,
  listFeed,
  listSources,
  listSourceStatus,
  summarizeArticle,
  trackArticleThread,
} from './api'
import type {
  ArticleDetail,
  FeedBriefingInputItem,
  FeedItem,
  Source,
  SourceStatus,
} from './types'
import { AppTopbar } from '@/components/app-topbar'
import { NoticeBanner } from '@/components/notice-banner'
import { ReaderFeedPanel } from '@/components/reader-feed-panel'
import { ReaderSubscriptionSidebar } from '@/components/reader-subscription-sidebar'
import { MarkdownBlock, SafeHTMLBlock } from '@/components/rich-content-blocks'
import type { SourceManagementPanelController } from '@/components/source-management-panel'
import { SummaryTaskStrip } from '@/components/summary-task-strip'
import { Button } from '@/components/ui/button'
import {
  SourceContextMenuOverlay,
  SourceDeleteConfirmDialog,
  SourceProfileDialog,
} from '@/components/source-overlays'
import { ReaderDetailPanel } from '@/components/reader-detail-panel'
import { useReaderStream } from './hooks/use-reader-stream'
import { useDetailPanel } from './hooks/use-detail-panel'
import { useFeedBriefingCacheRestore } from './hooks/use-feed-briefing-cache-restore'
import { useSummaryTaskPoller } from './hooks/use-summary-task-poller'
import { useSourceManagementState } from './hooks/use-source-management-state'
import { useSourceManagementActions } from './hooks/use-source-management-actions'
import {
  aiModelOptions,
  aiModelStorageKey,
  type AppTab,
  type AppliedSourceGroupFilter,
  type FeedBriefingSnapshot,
  type Notice,
  readArticleStorageKey,
  readMarkMinScrollProgress,
  type ReaderSession,
  type ReaderView,
  sidebarTagCollapseCount,
  type SidebarTagFilterMode,
  type SourceContextMenuState,
  type SourceGroup,
  type SummaryTask,
  threadPreviewCommentLimit,
  trackedSidebarPreviewLimit,
} from './lib/app-domain'
import {
  buildCompactTitleParts,
  bulkActionLabel,
  clampContextMenuPosition,
  compareSourcesByClicksDesc,
  compareTrackedSourcesByActivityDesc,
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
  parseStoredReadArticleIDs,
  plainText,
  plainTextBlock,
  resolveReadDwellThresholdMs,
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
  buildSummaryTaskKey,
  isArticleSummaryReadyResponse,
  isPollableArticleSummaryTask,
  isSummaryTaskPending,
  normalizeSummaryTaskStatus,
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

function App() {
  const floatingDetailRef = useRef<HTMLElement | null>(null)
  const sourceSelectAllRef = useRef<HTMLInputElement | null>(null)
  const sourceContextMenuRef = useRef<HTMLDivElement | null>(null)
  const feedAIMoreRef = useRef<HTMLDivElement | null>(null)
  const feedBriefingCacheAttemptedRef = useRef<Map<string, number>>(new Map())
  const sidebarSourceItemRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const previousSidebarSourceItemRectsRef = useRef<Map<number, DOMRect>>(new Map())
  const previousSidebarSourceIDsRef = useRef<number[]>([])
  const feedAutoLoadRef = useRef<HTMLDivElement | null>(null)
  const sidebarTagFilterTimerRef = useRef<number | null>(null)
  const feedAutoLoadCooldownRef = useRef(0)
  const streamScrollYRef = useRef<number | null>(null)
  const feedRequestSeqRef = useRef(0)
  const articleRequestSeqRef = useRef(0)
  const summaryRequestSeqRef = useRef(0)
  const summaryTaskNotifiedRef = useRef<Set<string>>(new Set())
  const readerSessionRef = useRef<ReaderSession | null>(null)

  const [sources, setSources] = useState<Source[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [selectedArticle, setSelectedArticle] = useState<ArticleDetail | null>(null)
  const [selectedArticleID, setSelectedArticleID] = useState<number | null>(null)
  const [articleSummary, setArticleSummary] = useState('')
  const [articleSummaryMeta, setArticleSummaryMeta] = useState('')
  const [summaryTasks, setSummaryTasks] = useState<SummaryTask[]>([])
  const [loadingArticleSummary, setLoadingArticleSummary] = useState(false)
  const [articleSummaryError, setArticleSummaryError] = useState<string | null>(null)
  const [feedBriefing, setFeedBriefing] = useState('')
  const [feedBriefingMeta, setFeedBriefingMeta] = useState('')
  const [feedBriefingItems, setFeedBriefingItems] = useState<FeedBriefingInputItem[]>([])
  const [feedBriefingArticleCount, setFeedBriefingArticleCount] = useState(0)
  const [feedBriefingScopeLabel, setFeedBriefingScopeLabel] = useState('')
  const [feedBriefingGeneratedAt, setFeedBriefingGeneratedAt] = useState('')
  const [feedBriefingAnchorArticleIDs, setFeedBriefingAnchorArticleIDs] = useState<number[]>([])
  const [feedBriefingTaskKey, setFeedBriefingTaskKey] = useState('')
  const [feedBriefingSnapshots, setFeedBriefingSnapshots] = useState<Record<string, FeedBriefingSnapshot>>({})
  const [loadingFeedBriefing, setLoadingFeedBriefing] = useState(false)
  const [feedBriefingError, setFeedBriefingError] = useState<string | null>(null)
  const [aiModel, setAIModel] = useState(() => {
    if (typeof window === 'undefined') {
      return aiModelOptions[0]
    }
    const cached = window.localStorage.getItem(aiModelStorageKey)?.trim()
    if (cached) {
      return cached
    }
    return aiModelOptions[0]
  })

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
  const [sourceStatus, setSourceStatus] = useState<SourceStatus[]>([])

  const [keyword, setKeyword] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [sourceGroupFilter, setSourceGroupFilter] = useState<AppliedSourceGroupFilter | null>(null)
  const [sidebarTagFilters, setSidebarTagFilters] = useState<string[]>([])
  const [sidebarTagFilterMode, setSidebarTagFilterMode] = useState<SidebarTagFilterMode>('or')
  const [showAllSidebarTags, setShowAllSidebarTags] = useState(false)
  const [mutedSiteKeys, setMutedSiteKeys] = useState<string[]>([])
  const [feedTitleOnlyMode, setFeedTitleOnlyMode] = useState(true)
  const [showFeedImages, setShowFeedImages] = useState(false)
  const [showFeedSearch, setShowFeedSearch] = useState(false)
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [showFeedAIMoreMenu, setShowFeedAIMoreMenu] = useState(false)
  const [showManageModelPicker, setShowManageModelPicker] = useState(false)
  const [, setNowTick] = useState(Date.now())

  const [activeTab, setActiveTab] = useState<AppTab>('reader')
  const [readerView, setReaderView] = useState<ReaderView>('stream')
  const [showFloatingReader, setShowFloatingReader] = useState(false)
  const [selectedFeedBriefing, setSelectedFeedBriefing] = useState(false)
  const [expandedThreadComments, setExpandedThreadComments] = useState(false)
  const [threadCommentsNewestFirst, setThreadCommentsNewestFirst] = useState(false)
  const [showSubscriptionSidebar, setShowSubscriptionSidebar] = useState(() => {
    if (typeof window === 'undefined') return true
    return !window.matchMedia('(max-width: 980px)').matches
  })
  const [showTrackedSidebar, setShowTrackedSidebar] = useState(false)
  const [showAllTrackedSidebar, setShowAllTrackedSidebar] = useState(false)
  const [readArticleIDs, setReadArticleIDs] = useState<number[]>(() => {
    if (typeof window === 'undefined') {
      return []
    }
    return parseStoredReadArticleIDs(window.localStorage.getItem(readArticleStorageKey))
  })
  const [sourceContextMenu, setSourceContextMenu] = useState<SourceContextMenuState | null>(null)
  const [sourceProfileSource, setSourceProfileSource] = useState<Source | null>(null)
  const [sourceProfileTagPickerOpen, setSourceProfileTagPickerOpen] = useState(false)
  const [sourceProfileTagInput, setSourceProfileTagInput] = useState('')
  const [pendingDeleteSource, setPendingDeleteSource] = useState<Source | null>(null)

  const readerFeedSources = useMemo(
    () =>
      sources
        .filter((source) => normalizeSourceKind(source.kind) === 'feed' && !source.hidden_in_sidebar)
        .sort(compareSourcesByClicksDesc),
    [sources],
  )

  const readerTrackedSources = useMemo(
    () =>
      sources
        .filter((source) => normalizeSourceKind(source.kind) === 'thread' && !source.hidden_in_sidebar)
        .sort(compareTrackedSourcesByActivityDesc),
    [sources],
  )

  const readerSources = useMemo(() => [...readerFeedSources, ...readerTrackedSources], [readerFeedSources, readerTrackedSources])

  const visibleTrackedSidebarSources = useMemo(
    () => (showAllTrackedSidebar ? readerTrackedSources : readerTrackedSources.slice(0, trackedSidebarPreviewLimit)),
    [readerTrackedSources, showAllTrackedSidebar],
  )

  const hasMoreTrackedSidebarSources = readerTrackedSources.length > trackedSidebarPreviewLimit

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

  const sourceGroups = useMemo<SourceGroup[]>(() => {
    const groupMap = new Map<string, SourceGroup>()
    for (const source of readerFeedSources) {
      for (const label of sourceTagList(source)) {
        const key = label.toLowerCase()
        const bucket = groupMap.get(key)
        if (bucket) {
          bucket.sources.push(source)
          bucket.clickTotal += sourceClickCount(source)
        } else {
          groupMap.set(key, {
            key,
            label,
            clickTotal: sourceClickCount(source),
            sources: [source],
          })
        }
      }
    }

    const groups = Array.from(groupMap.values()).map((group) => ({
      ...group,
      sources: [...group.sources].sort(compareSourcesByClicksDesc),
    }))
    groups.sort((a, b) => {
      if (a.clickTotal !== b.clickTotal) {
        return b.clickTotal - a.clickTotal
      }
      return a.label.localeCompare(b.label)
    })
    return groups
  }, [readerFeedSources])

  const sidebarTagFilterSet = useMemo(() => new Set(sidebarTagFilters), [sidebarTagFilters])

  const sidebarVisibleFeedSources = useMemo(() => {
    if (sidebarTagFilterSet.size === 0) {
      return readerFeedSources
    }
    return readerFeedSources.filter((source) => {
      const tagSet = new Set(sourceTagList(source).map((tag) => tag.toLowerCase()))
      if (sidebarTagFilterMode === 'and') {
        return sidebarTagFilters.every((tag) => tagSet.has(tag))
      }
      return sidebarTagFilters.some((tag) => tagSet.has(tag))
    })
  }, [readerFeedSources, sidebarTagFilterMode, sidebarTagFilterSet, sidebarTagFilters])

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
  }, [selectedSummaryTask])

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
  }, [])

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
  }, [])

  const removeSummaryTask = useCallback((taskKey: string) => {
    setSummaryTasks((previous) => previous.filter((task) => task.key !== taskKey))
    summaryTaskNotifiedRef.current.delete(taskKey)
  }, [])

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
  }, [])

  const cancelSidebarTagFeedReload = useCallback(() => {
    if (sidebarTagFilterTimerRef.current !== null) {
      window.clearTimeout(sidebarTagFilterTimerRef.current)
      sidebarTagFilterTimerRef.current = null
    }
  }, [])

  async function loadSources() {
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
  }

  async function loadStatus() {
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
  }

  async function refreshStatusIfVisible() {
    if (activeTab !== 'sources') return
    await loadStatus()
  }

  async function loadFeed(
    append = false,
    overrides?: Partial<{ tag: string; sourceID: string; keyword: string; cursor: string }>,
  ) {
    const requestID = ++feedRequestSeqRef.current
    try {
      setLoadingFeed(true)
      setFeedError(null)
      const activeTag = overrides?.tag ?? tagFilter
      const activeSourceID = overrides?.sourceID ?? sourceFilter
      const activeKeyword = (overrides?.keyword ?? keyword).trim()
      const filteredSourceIDs = parseSourceIDFilter(activeSourceID)
      const includeHidden = filteredSourceIDs.some((sourceID) => normalizeSourceKind(sourceByID.get(sourceID)?.kind) === 'thread')

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
  }

  function scheduleSidebarTagFeedReload(sourceID: string) {
    cancelSidebarTagFeedReload()
    sidebarTagFilterTimerRef.current = window.setTimeout(() => {
      sidebarTagFilterTimerRef.current = null
      void loadFeed(false, { sourceID })
    }, 180)
  }

  useEffect(() => {
    return () => {
      cancelSidebarTagFeedReload()
    }
  }, [cancelSidebarTagFeedReload])

  const markArticleRead = useCallback((articleID: number) => {
    setReadArticleIDs((previous) => upsertReadArticleID(previous, articleID))
  }, [])

  const startReaderSession = useCallback((articleID: number, minDwellMs: number) => {
    readerSessionRef.current = {
      articleID,
      openedAt: Date.now(),
      maxScrollProgress: 0,
      minDwellMs,
    }
  }, [])

  const finalizeReaderSession = useCallback(
    (reason: 'close' | 'navigate') => {
      const session = readerSessionRef.current
      if (!session) return
      readerSessionRef.current = null

      if (reason === 'navigate') {
        markArticleRead(session.articleID)
        return
      }

      const dwellMs = Date.now() - session.openedAt
      if (dwellMs >= session.minDwellMs || session.maxScrollProgress >= readMarkMinScrollProgress) {
        markArticleRead(session.articleID)
      }
    },
    [markArticleRead],
  )

  const closeFloatingReader = useCallback(() => {
    finalizeReaderSession('close')
    setShowFloatingReader(false)
    closeDetailMoreMenu()
  }, [closeDetailMoreMenu, finalizeReaderSession])

  const openFeedBriefing = useCallback(() => {
    finalizeReaderSession('close')
    ++articleRequestSeqRef.current
    ++summaryRequestSeqRef.current
    closeDetailMoreMenu()
    setLoadingArticle(false)
    setArticleError(null)
    setSelectedArticle(null)
    setSelectedArticleID(null)
    setSelectedFeedBriefing(true)
    setArticleSummary('')
    setArticleSummaryMeta('')
    setArticleSummaryError(null)
    setLoadingArticleSummary(false)
    setExpandedThreadComments(false)
    setThreadCommentsNewestFirst(false)
    setReaderView('stream')
    setShowFloatingReader(true)

    if (floatingDetailRef.current) {
      floatingDetailRef.current.scrollTo({ top: 0, behavior: 'auto' })
    }
  }, [closeDetailMoreMenu, finalizeReaderSession])

  const applyFeedBriefingSnapshot = useCallback((snapshot: FeedBriefingSnapshot) => {
    setFeedBriefing(snapshot.summary)
    setFeedBriefingMeta(snapshot.meta)
    setFeedBriefingItems(snapshot.items)
    setFeedBriefingArticleCount(snapshot.articleCount)
    setFeedBriefingTaskKey(snapshot.taskKey)
    setFeedBriefingScopeLabel(snapshot.scopeLabel)
    setFeedBriefingGeneratedAt(snapshot.generatedAt)
    setFeedBriefingAnchorArticleIDs(snapshot.anchorArticleIDs)
    setFeedBriefingError(snapshot.error)
    setSelectedFeedBriefing(false)
  }, [])

  const saveFeedBriefingSnapshot = useCallback((snapshot: FeedBriefingSnapshot) => {
    setFeedBriefingSnapshots((previous) => ({
      ...previous,
      [snapshot.taskKey]: snapshot,
    }))
  }, [])

  const openArticle = useCallback(async (articleID: number) => {
    const activeSession = readerSessionRef.current
    if (activeSession && activeSession.articleID !== articleID) {
      finalizeReaderSession('navigate')
    }

    const articleRequestID = ++articleRequestSeqRef.current
    const summaryRequestID = ++summaryRequestSeqRef.current
    try {
      setLoadingArticle(true)
      closeDetailMoreMenu()
      setReaderView('stream')
      setShowFloatingReader(true)
      setArticleError(null)
      setSelectedFeedBriefing(false)
      setSelectedArticleID(articleID)
      setArticleSummary('')
      setArticleSummaryMeta('')
      setArticleSummaryError(null)
      setLoadingArticleSummary(false)
      setExpandedThreadComments(false)
      setThreadCommentsNewestFirst(false)

      if (floatingDetailRef.current) {
        floatingDetailRef.current.scrollTo({ top: 0, behavior: 'auto' })
      }

      const detail = await getArticle(articleID)
      if (articleRequestID !== articleRequestSeqRef.current) {
        return
      }
      setSelectedArticle(detail)
      setExpandedThreadComments(isTrackableForumLink(detail.link))
      setThreadCommentsNewestFirst(normalizeSourceKind(sourceByID.get(detail.source_id)?.kind) === 'thread')
      startReaderSession(articleID, resolveReadDwellThresholdMs(detail))
      void loadCachedSummary(articleID, aiModel, summaryRequestID)
    } catch (error) {
      if (articleRequestID !== articleRequestSeqRef.current) {
        return
      }
      const message = toErrorMessage(error)
      setArticleError(message)
      setNotice({
        kind: 'error',
        text: `加载文章详情失败: ${message}`,
      })
    } finally {
      if (articleRequestID === articleRequestSeqRef.current) {
        setLoadingArticle(false)
      }
    }
  }, [aiModel, closeDetailMoreMenu, finalizeReaderSession, loadCachedSummary, sourceByID, startReaderSession])

  async function onSummarizeArticle(refresh = false) {
    if (!selectedArticleID || selectedArticleID <= 0) {
      setNotice({ kind: 'error', text: '当前文章不支持 AI 摘要。' })
      return
    }

    const requestID = ++summaryRequestSeqRef.current
    const articleID = selectedArticleID

    try {
      setLoadingArticleSummary(true)
      setArticleSummaryError(null)
      const response = await summarizeArticle(articleID, refresh, aiModel)
      if (requestID !== summaryRequestSeqRef.current) {
        return
      }
      if (isArticleSummaryReadyResponse(response)) {
        setArticleSummary(response.data.summary)
        setArticleSummaryMeta(
          `${response.data.cache_hit ? '缓存命中' : '新生成'} · ${response.data.provider} · ${response.data.model}`,
        )
        setNotice({ kind: 'info', text: response.data.cache_hit ? '已加载缓存摘要。' : 'AI 摘要已生成。' })
        return
      }

      if (response.data.status === 'failed') {
        throw new Error(response.data.error || 'AI 摘要生成失败')
      }

      const taskModel = response.data.model?.trim() || aiModel
      const taskKey = buildSummaryTaskKey(articleID, taskModel)
      const identity = resolveSummaryTaskIdentity(articleID)
      summaryTaskNotifiedRef.current.delete(taskKey)
      upsertSummaryTask({
        kind: 'article_summary',
        key: taskKey,
        articleID,
        title: identity.title,
        sourceName: identity.sourceName,
        sourceID: identity.sourceID,
        model: taskModel,
        status: normalizeSummaryTaskStatus(response.data.status),
        updatedAt: response.data.updated_at || new Date().toISOString(),
        error: response.data.error,
      })
      setArticleSummaryMeta(`后台生成中 · ${response.data.status} · ${taskModel}`)
      setNotice({ kind: 'info', text: 'AI 摘要已进入后台任务，正在生成中。' })
    } catch (error) {
      if (requestID !== summaryRequestSeqRef.current) {
        return
      }
      const message = toErrorMessage(error)
      setArticleSummaryError(message)
      const identity = resolveSummaryTaskIdentity(articleID)
      const taskKey = buildSummaryTaskKey(articleID, aiModel)
      upsertSummaryTask({
        kind: 'article_summary',
        key: taskKey,
        articleID,
        title: identity.title,
        sourceName: identity.sourceName,
        sourceID: identity.sourceID,
        model: aiModel,
        status: 'failed',
        updatedAt: new Date().toISOString(),
        error: message,
      })
      setNotice({ kind: 'error', text: `AI 摘要失败: ${message}` })
    } finally {
      if (requestID === summaryRequestSeqRef.current) {
        setLoadingArticleSummary(false)
      }
    }
  }

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

  async function onTrackThread() {
    if (!selectedArticleID) {
      setNotice({ kind: 'error', text: '请先选择文章。' })
      return
    }
    try {
      const response = await trackArticleThread(selectedArticleID)
      setNotice({
        kind: 'info',
        text: response.created
          ? `已开始持续跟踪评论：${response.source.name}`
          : `该帖子已在跟踪中：${response.source.name}`,
      })
      await loadSources()
      await refreshStatusIfVisible()
    } catch (error) {
      setNotice({
        kind: 'error',
        text: `持续跟踪失败: ${toErrorMessage(error)}`,
      })
    }
  }

  function resetFeedBriefingState() {
    setFeedBriefing('')
    setFeedBriefingMeta('')
    setFeedBriefingItems([])
    setFeedBriefingArticleCount(0)
    setFeedBriefingTaskKey('')
    setFeedBriefingScopeLabel('')
    setFeedBriefingGeneratedAt('')
    setFeedBriefingAnchorArticleIDs([])
    setFeedBriefingError(null)
    setLoadingFeedBriefing(false)
    setSelectedFeedBriefing(false)
  }

  async function onGenerateFeedBriefing(refresh = false) {
    const articleIDs = activeFeedBriefingAnchorArticleIDs
    if (articleIDs.length === 0) {
      setNotice({ kind: 'error', text: '当前没有可用文章，无法生成 AI 速览。' })
      return
    }
    const sourceIDs = activeFeedBriefingSourceIDs
    const taskScopeLabel = activeFeedBriefingScopeLabel
    const taskKey = activeFeedBriefingTaskKey
    setFeedBriefingTaskKey(taskKey)
    setFeedBriefingScopeLabel(taskScopeLabel)
    setFeedBriefingAnchorArticleIDs(articleIDs)
    upsertSummaryTask({
      kind: 'feed_briefing',
      key: taskKey,
      sourceIDs,
      sourceID: sourceIDs.length === 1 ? sourceIDs[0] : undefined,
      title: 'AI 聚合速览',
      sourceName: taskScopeLabel,
      model: aiModel,
      status: 'running',
      updatedAt: new Date().toISOString(),
      error: '',
    })

    try {
      setLoadingFeedBriefing(true)
      setFeedBriefingError(null)
      const response = await createFeedBriefing({
        limit: Math.min(articleIDs.length, 30),
        tag: tagFilter || undefined,
        keyword: activeFeedBriefingKeyword || undefined,
        model: aiModel,
        source_ids: sourceIDs.length > 0 ? sourceIDs : undefined,
        article_ids: articleIDs,
        refresh,
      })
      setFeedBriefing(response.data.summary)
      setFeedBriefingItems(response.data.input_items ?? [])
      setFeedBriefingArticleCount(response.data.article_count ?? 0)
      setFeedBriefingTaskKey(taskKey)
      setFeedBriefingGeneratedAt(response.data.generated_at || new Date().toISOString())
      saveFeedBriefingSnapshot({
        taskKey,
        summary: response.data.summary,
        meta: `${response.data.cache_hit ? '缓存命中' : '新生成'} · ${response.data.provider} · ${response.data.model} · ${response.data.article_count} 篇`,
        items: response.data.input_items ?? [],
        articleCount: response.data.article_count ?? 0,
        scopeLabel: taskScopeLabel,
        generatedAt: response.data.generated_at || new Date().toISOString(),
        anchorArticleIDs: articleIDs,
        error: null,
      })
      upsertSummaryTask({
        kind: 'feed_briefing',
        key: taskKey,
        sourceIDs,
        sourceID: sourceIDs.length === 1 ? sourceIDs[0] : undefined,
        title: 'AI 聚合速览',
        sourceName: taskScopeLabel,
        model: response.data.model || aiModel,
        status: 'succeeded',
        updatedAt: response.data.generated_at || new Date().toISOString(),
        error: '',
      })
      setFeedBriefingMeta(
        `${response.data.cache_hit ? '缓存命中' : '新生成'} · ${response.data.provider} · ${response.data.model} · ${response.data.article_count} 篇`,
      )
      setNotice({
        kind: 'info',
        text: response.data.cache_hit ? '已加载缓存速览。' : 'AI 聚合速览已生成。',
      })
    } catch (error) {
      const message = toErrorMessage(error)
      setFeedBriefingTaskKey(taskKey)
      setFeedBriefingError(message)
      saveFeedBriefingSnapshot({
        taskKey,
        summary: '',
        meta: '',
        items: [],
        articleCount: 0,
        scopeLabel: taskScopeLabel,
        generatedAt: new Date().toISOString(),
        anchorArticleIDs: articleIDs,
        error: message,
      })
      upsertSummaryTask({
        kind: 'feed_briefing',
        key: taskKey,
        sourceIDs,
        sourceID: sourceIDs.length === 1 ? sourceIDs[0] : undefined,
        title: 'AI 聚合速览',
        sourceName: taskScopeLabel,
        model: aiModel,
        status: 'failed',
        updatedAt: new Date().toISOString(),
        error: message,
      })
      setNotice({
        kind: 'error',
        text: `AI 聚合速览失败: ${message}`,
      })
    } finally {
      setLoadingFeedBriefing(false)
    }
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
      setSourceContextMenu(null)
    },
    [pendingDeleteSource, selectedArticle, sourceProfileSource],
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
    clearSourceContextMenu: () => setSourceContextMenu(null),
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

  function applyFilters() {
    cancelSidebarTagFeedReload()
    resetFeedBriefingState()
    setSelectedArticle(null)
    setSelectedArticleID(null)
    setFeedCursor('')
    void loadFeed(false)
  }

  function clearFilters() {
    cancelSidebarTagFeedReload()
    resetFeedBriefingState()
    setKeyword('')
    setTagFilter('')
    setSourceFilter('')
    setUnreadOnly(false)
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
  }

  function removeFilter(type: 'keyword' | 'tag' | 'source' | 'muted_sites' | 'unread') {
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

    setSourceFilter('')
    setSourceGroupFilter(null)
    setSidebarTagFilters([])
    resetFeedBriefingState()
    void loadFeed(false, { sourceID: '' })
  }

  function onChangeAIModel(nextModel: string) {
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
  }

  function toggleSiteMuted(siteKey: string) {
    resetFeedBriefingState()
    setMutedSiteKeys((previous) => {
      if (previous.includes(siteKey)) {
        return previous.filter((item) => item !== siteKey)
      }
      return [...previous, siteKey]
    })
  }

  function applySourceFilterFromSidebar(sourceID: string, options?: { preserveSidebarTags?: boolean }) {
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
  }

  const registerSidebarSourceItemRef = useCallback((sourceID: number, node: HTMLDivElement | null) => {
    if (!node) {
      sidebarSourceItemRefs.current.delete(sourceID)
      return
    }
    sidebarSourceItemRefs.current.set(sourceID, node)
  }, [])

  function applySidebarTagFilters(nextKeys: string[], mode: SidebarTagFilterMode = sidebarTagFilterMode) {
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
  }

  function toggleSidebarTagFilter(tagKey: string) {
    if (sidebarTagFilterSet.has(tagKey)) {
      applySidebarTagFilters(sidebarTagFilters.filter((item) => item !== tagKey))
      return
    }
    applySidebarTagFilters([...sidebarTagFilters, tagKey])
  }

  function switchSidebarTagFilterMode(mode: SidebarTagFilterMode) {
    if (mode === sidebarTagFilterMode) {
      return
    }
    if (sidebarTagFilters.length === 0) {
      setSidebarTagFilterMode(mode)
      return
    }
    applySidebarTagFilters(sidebarTagFilters, mode)
  }

  function openSourceContextMenu(event: ReactMouseEvent<HTMLElement>, source: Source) {
    event.preventDefault()
    event.stopPropagation()
    const margin = 10
    const x = Math.max(margin, Math.min(event.clientX, window.innerWidth - margin))
    const y = Math.max(margin, Math.min(event.clientY, window.innerHeight - margin))
    setSourceContextMenu({
      source,
      x,
      y,
    })
  }

  function openSourceContextMenuAt(source: Source, x: number, y: number) {
    const margin = 10
    setSourceContextMenu({
      source,
      x: Math.max(margin, Math.min(x, window.innerWidth - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - margin)),
    })
  }

  function openSourceProfile(source: Source) {
    setSourceProfileSource(source)
    setSourceProfileTagPickerOpen(false)
    setSourceProfileTagInput('')
    setSourceContextMenu(null)
  }

  function openDeleteSourceConfirm(source: Source) {
    setPendingDeleteSource(source)
    setSourceContextMenu(null)
  }

  async function refreshAll() {
    const tasks = [loadSources(), loadFeed(false)]
    if (activeTab === 'sources') {
      tasks.push(loadStatus())
    }
    await Promise.allSettled(tasks)
    setNotice({ kind: 'info', text: '已刷新最新数据。' })
  }

  function loadMore() {
    if (!feedCursor || loadingFeed) return
    void loadFeed(true)
  }

  useEffect(() => {
    void loadSources()
    void loadFeed(false)
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
  }, [])

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

  useEffect(() => {
    if (activeTab === 'sources' && sourceStatus.length === 0 && !loadingStatus) {
      void loadStatus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  useEffect(() => {
    const validSiteKeys = new Set(sourceSiteKeyMap.values())
    setMutedSiteKeys((previous) => previous.filter((siteKey) => validSiteKeys.has(siteKey)))
  }, [sourceSiteKeyMap])

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
    if (sourceGroups.length <= sidebarTagCollapseCount) {
      setShowAllSidebarTags(false)
    }
  }, [sourceGroups.length])

  useEffect(() => {
    if (sidebarTagFilters.length > 0) {
      setShowAllSidebarTags(true)
    }
  }, [sidebarTagFilters.length])

  useEffect(() => {
    if (showTrackedSidebar) return
    setShowAllTrackedSidebar(false)
  }, [showTrackedSidebar])

  useEffect(() => {
    if (readerTrackedSources.length > trackedSidebarPreviewLimit) return
    setShowAllTrackedSidebar(false)
  }, [readerTrackedSources])

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
  }, [allVisibleSelected, selectedVisibleCount])

  useEffect(() => {
    if (!sourceContextMenu) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest('.source-context-menu')) {
        return
      }
      setSourceContextMenu(null)
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSourceContextMenu(null)
      }
    }

    function handleScroll() {
      setSourceContextMenu(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [sourceContextMenu])

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
  }, [showFeedAIMoreMenu])

  useEffect(() => {
    if (activeTab !== 'reader' && showFeedAIMoreMenu) {
      setShowFeedAIMoreMenu(false)
    }
  }, [activeTab, showFeedAIMoreMenu])

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
  }, [activeTab, showSubscriptionSidebar, sidebarVisibleFeedSources])

  useEffect(() => {
    if (!sourceContextMenu) return
    const activeMenu = sourceContextMenu

    function adjustSourceContextMenuPosition() {
      const menu = sourceContextMenuRef.current
      if (!menu) return
      const rect = menu.getBoundingClientRect()
      const next = clampContextMenuPosition(activeMenu.x, activeMenu.y, rect.width, rect.height)
      if (next.x === activeMenu.x && next.y === activeMenu.y) {
        return
      }
      setSourceContextMenu((previous) => {
        if (!previous) return previous
        if (previous.x === next.x && previous.y === next.y) {
          return previous
        }
        return { ...previous, x: next.x, y: next.y }
      })
    }

    const frame = window.requestAnimationFrame(adjustSourceContextMenuPosition)
    window.addEventListener('resize', adjustSourceContextMenuPosition)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', adjustSourceContextMenuPosition)
    }
  }, [sourceContextMenu])

  useEffect(() => {
    if (activeTab === 'reader' && showSubscriptionSidebar) return
    setSourceContextMenu(null)
    setPendingDeleteSource(null)
  }, [activeTab, showSubscriptionSidebar])

  useEffect(() => {
    if (activeTab !== 'sources') {
      setShowManageModelPicker(false)
    }
  }, [activeTab])

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
  }, [showManageModelPicker])

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
  }, [sourceByID, sourceProfileSource])

  useEffect(() => {
    if (sourceProfileSource) return
    setSourceProfileTagPickerOpen(false)
    setSourceProfileTagInput('')
  }, [sourceProfileSource])

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
  }, [sourceByID, pendingDeleteSource])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }

      if (sourceProfileSource || sourceContextMenu || pendingDeleteSource || showFeedAIMoreMenu || showDetailMoreMenu) {
        if (event.key === 'Escape') {
          setSourceProfileSource(null)
          setSourceContextMenu(null)
          setPendingDeleteSource(null)
          setShowFeedAIMoreMenu(false)
          closeDetailMoreMenu()
        }
        return
      }

      if (event.key === 'j' || event.key === 'k') {
        if (readerStreamItems.length === 0) return
        event.preventDefault()

        const direction = event.key === 'j' ? 1 : -1
        const baseIndex = selectedFeedIndex >= 0 ? selectedFeedIndex : event.key === 'j' ? -1 : 0
        const nextIndex = Math.min(Math.max(baseIndex + direction, 0), readerStreamItems.length - 1)
        const nextItem = readerStreamItems[nextIndex]
        if (nextItem?.kind === 'briefing') {
          openFeedBriefing()
          return
        }
        if (nextItem?.kind === 'article') {
          void openArticle(nextItem.articleID)
        }
        return
      }

      if (event.key === 'o') {
        if (selectedArticle?.link) {
          event.preventDefault()
          window.open(selectedArticle.link, '_blank', 'noopener,noreferrer')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    readerStreamItems,
    selectedFeedIndex,
    selectedArticle,
    openArticle,
    openFeedBriefing,
    sourceProfileSource,
    sourceContextMenu,
    pendingDeleteSource,
    showFeedAIMoreMenu,
    showDetailMoreMenu,
    closeDetailMoreMenu,
  ])

  useEffect(() => {
    const target = feedAutoLoadRef.current
    if (!target) return
    if (activeTab !== 'reader' || !hasMoreFeed) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting) return
        if (loadingFeed) return
        const now = Date.now()
        if (now - feedAutoLoadCooldownRef.current < 900) {
          return
        }
        feedAutoLoadCooldownRef.current = now
        void loadFeed(true)
      },
      {
        root: null,
        rootMargin: '0px 0px 420px 0px',
        threshold: 0,
      },
    )

    observer.observe(target)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, hasMoreFeed, loadingFeed, feedCursor])

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (activeTab !== 'reader' || readerView !== 'stream' || !showFloatingReader) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const panel = floatingDetailRef.current
      if (!panel) return

      const target = event.target as Node | null
      if (target && panel.contains(target)) {
        return
      }
      closeFloatingReader()
    }

    function handleEscKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeFloatingReader()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleEscKey)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleEscKey)
    }
  }, [activeTab, readerView, showFloatingReader, closeFloatingReader])

  useEffect(() => {
    if (!selectedArticleID) {
      return
    }
    if (activeTab !== 'reader') {
      return
    }
    if (!showFloatingReader && readerView !== 'detail') {
      return
    }
    const panel = floatingDetailRef.current
    if (!panel) {
      return
    }
    const panelElement = panel

    function updateReaderSessionProgress() {
      const session = readerSessionRef.current
      if (!session || session.articleID !== selectedArticleID) {
        return
      }
      const scrollable = panelElement.scrollHeight - panelElement.clientHeight
      if (scrollable <= 0) {
        return
      }
      const progress = panelElement.scrollTop / scrollable
      if (progress > session.maxScrollProgress) {
        session.maxScrollProgress = progress
      }
    }

    updateReaderSessionProgress()
    panelElement.addEventListener('scroll', updateReaderSessionProgress, { passive: true })
    window.addEventListener('resize', updateReaderSessionProgress)
    return () => {
      panelElement.removeEventListener('scroll', updateReaderSessionProgress)
      window.removeEventListener('resize', updateReaderSessionProgress)
    }
  }, [activeTab, selectedArticleID, readerView, showFloatingReader])

  useEffect(() => {
    if (activeTab !== 'reader' || readerView !== 'detail') {
      return
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [activeTab, readerView])

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
      />

      <NoticeBanner notice={notice} onClose={() => setNotice(null)} />

      <SummaryTaskStrip
        tasks={visibleSummaryTasks}
        stats={summaryTaskStats}
        onClearCompleted={clearCompletedSummaryTasks}
        onOpenTask={onOpenSummaryTask}
        onDismissTask={onDismissSummaryTask}
        summaryTaskKindLabel={summaryTaskKindLabel}
        summaryTaskStatusLabel={summaryTaskStatusLabel}
        formatTimeAgo={formatTimeAgo}
      />

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
                getSummaryTaskStatus={(articleID) => summaryTaskByArticleID.get(articleID)?.status ?? null}
                summaryTaskStatusLabel={summaryTaskStatusLabel}
              />
            </div>
          </main>

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
            MarkdownBlock={MarkdownBlock}
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
            SafeHTMLBlock={SafeHTMLBlock}
            visibleThreadComments={visibleThreadComments}
            threadComments={threadComments}
            threadCommentsNewestFirst={threadCommentsNewestFirst}
            onToggleThreadCommentsNewestFirst={() => setThreadCommentsNewestFirst((value) => !value)}
            threadPreviewCommentLimit={threadPreviewCommentLimit}
            expandedThreadComments={expandedThreadComments}
            onToggleExpandedThreadComments={() => setExpandedThreadComments((value) => !value)}
            hasHiddenThreadComments={hasHiddenThreadComments}
          />
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

      <SourceContextMenuOverlay
        contextMenuRef={sourceContextMenuRef}
        sourceContextMenu={sourceContextMenu}
        busySourceID={busySourceID}
        onQuickSetSourceEnabled={onQuickSetSourceEnabled}
        onOpenSourceProfile={openSourceProfile}
        onOpenDeleteConfirm={openDeleteSourceConfirm}
      />

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

      <SourceDeleteConfirmDialog
        pendingDeleteSource={pendingDeleteSource}
        busySourceID={busySourceID}
        onCloseDeleteConfirm={() => setPendingDeleteSource(null)}
        onConfirmDeleteSource={onConfirmDeleteSource}
      />
    </div>
  )
}

export default App
