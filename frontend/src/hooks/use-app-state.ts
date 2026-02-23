import { useRef, useState } from 'react'
import type { ArticleDetail, FeedBriefingInputItem, FeedItem, Source, SourceStatus } from '../types'
import {
  aiModelOptions,
  aiModelStorageKey,
  type AppTab,
  type FeedBriefingSnapshot,
  type Notice,
  readArticleStorageKey,
  type ReaderSession,
  type ReaderView,
  type SummaryTask,
} from '../lib/app-domain'
import { parseStoredReadArticleIDs } from '../lib/app-utils'

export function useAppState() {
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
  const [mutedSiteKeys, setMutedSiteKeys] = useState<string[]>([])
  const [feedTitleOnlyMode, setFeedTitleOnlyMode] = useState(true)
  const [showFeedImages, setShowFeedImages] = useState(false)
  const [showFeedSearch, setShowFeedSearch] = useState(false)
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [showFeedAIMoreMenu, setShowFeedAIMoreMenu] = useState(false)
  const [showManageModelPicker, setShowManageModelPicker] = useState(false)
  const [, setNowTick] = useState(0)

  const [activeTab, setActiveTab] = useState<AppTab>('reader')
  const [readerView, setReaderView] = useState<ReaderView>('stream')
  const [showFloatingReader, setShowFloatingReader] = useState(false)
  const [selectedFeedBriefing, setSelectedFeedBriefing] = useState(false)
  const [expandedThreadComments, setExpandedThreadComments] = useState(false)
  const [threadCommentsNewestFirst, setThreadCommentsNewestFirst] = useState(false)
  const [readArticleIDs, setReadArticleIDs] = useState<number[]>(() => {
    if (typeof window === 'undefined') {
      return []
    }
    return parseStoredReadArticleIDs(window.localStorage.getItem(readArticleStorageKey))
  })
  const [sourceProfileSource, setSourceProfileSource] = useState<Source | null>(null)
  const [sourceProfileTagPickerOpen, setSourceProfileTagPickerOpen] = useState(false)
  const [sourceProfileTagInput, setSourceProfileTagInput] = useState('')
  const [pendingDeleteSource, setPendingDeleteSource] = useState<Source | null>(null)

  return {
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
  }
}
