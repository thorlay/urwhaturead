import { useFeedBriefingCacheRestore } from './use-feed-briefing-cache-restore'
import { useReaderLocalPersistence } from './use-reader-local-persistence'
import { useReaderOverlayShortcuts } from './use-reader-overlay-shortcuts'
import { useReaderRuntimeEffects } from './use-reader-runtime-effects'
import { useSummaryTaskPoller } from './use-summary-task-poller'
import { useSummaryTaskPruner } from './use-summary-task-pruner'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import { aiModelStorageKey, favoriteArticleStorageKey, readArticleStorageKey } from '../lib/app-domain'
import type { FeedBriefingSnapshot, Notice, ReaderSession, SourceContextMenuState, SummaryTask } from '../lib/app-domain'
import type { Source } from '../types'

type UseReaderFeatureEffectsParams = {
  aiModel: string
  readArticleIDs: number[]
  favoriteArticleIDs: number[]
  maxStoredReadArticles: number
  maxStoredFavoriteArticles: number
  setSummaryTasks: Dispatch<SetStateAction<SummaryTask[]>>
  summaryTaskNotifiedRef: MutableRefObject<Set<string>>
  pendingArticleSummaryTasks: SummaryTask[]
  resolveSummaryTaskIdentity: (articleID?: number) => {
    sourceName: string
    sourceID?: number
    title: string
  }
  selectedArticleID: number | null
  upsertSummaryTask: (task: SummaryTask) => void
  setArticleSummary: Dispatch<SetStateAction<string>>
  setArticleSummaryMeta: Dispatch<SetStateAction<string>>
  setArticleSummaryError: Dispatch<SetStateAction<string | null>>
  setNotice: (notice: Notice) => void
  activeTab: 'reader' | 'sources'
  loadingFeed: boolean
  loadingFeedBriefing: boolean
  activeFeedBriefingAnchorArticleIDs: number[]
  hasFeedBriefingEntry: boolean
  feedBriefingTaskKey: string
  activeFeedBriefingTaskKey: string
  feedBriefingSnapshots: Record<string, FeedBriefingSnapshot>
  applyFeedBriefingSnapshot: (snapshot: FeedBriefingSnapshot) => void
  activeFeedBriefingKeyword: string
  tagFilter: string
  activeFeedBriefingSourceIDs: number[]
  activeFeedBriefingScopeLabel: string
  saveFeedBriefingSnapshot: (snapshot: FeedBriefingSnapshot) => void
  feedBriefingCacheAttemptedRef: MutableRefObject<Map<string, number>>
  hasMoreFeed: boolean
  feedCursor: string
  feedAutoLoadRef: RefObject<HTMLDivElement | null>
  feedAutoLoadCooldownRef: MutableRefObject<number>
  loadMore: () => void
  setNowTick: Dispatch<SetStateAction<number>>
  readerView: 'stream' | 'detail'
  showFloatingReader: boolean
  floatingDetailRef: RefObject<HTMLElement | null>
  closeFloatingReader: () => void
  readerSessionRef: MutableRefObject<ReaderSession | null>
  sourceProfileSource: Source | null
  sourceContextMenu: SourceContextMenuState | null
  pendingDeleteSource: Source | null
  showFeedAIMoreMenu: boolean
  showDetailMoreMenu: boolean
  setSourceProfileSource: Dispatch<SetStateAction<Source | null>>
  closeSourceContextMenu: () => void
  setPendingDeleteSource: Dispatch<SetStateAction<Source | null>>
  setShowFeedAIMoreMenu: Dispatch<SetStateAction<boolean>>
  closeDetailMoreMenu: () => void
  readerStreamItems: Array<{ kind: 'article'; articleID: number } | { kind: 'briefing' }>
  selectedFeedIndex: number
  selectedArticleLink?: string
  openArticle: (articleID: number) => Promise<void>
  openFeedBriefing: () => void
}

export function useReaderFeatureEffects({
  aiModel,
  readArticleIDs,
  favoriteArticleIDs,
  maxStoredReadArticles,
  maxStoredFavoriteArticles,
  setSummaryTasks,
  summaryTaskNotifiedRef,
  pendingArticleSummaryTasks,
  resolveSummaryTaskIdentity,
  selectedArticleID,
  upsertSummaryTask,
  setArticleSummary,
  setArticleSummaryMeta,
  setArticleSummaryError,
  setNotice,
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
  activeFeedBriefingSourceIDs,
  activeFeedBriefingScopeLabel,
  saveFeedBriefingSnapshot,
  feedBriefingCacheAttemptedRef,
  hasMoreFeed,
  feedCursor,
  feedAutoLoadRef,
  feedAutoLoadCooldownRef,
  loadMore,
  setNowTick,
  readerView,
  showFloatingReader,
  floatingDetailRef,
  closeFloatingReader,
  readerSessionRef,
  sourceProfileSource,
  sourceContextMenu,
  pendingDeleteSource,
  showFeedAIMoreMenu,
  showDetailMoreMenu,
  setSourceProfileSource,
  closeSourceContextMenu,
  setPendingDeleteSource,
  setShowFeedAIMoreMenu,
  closeDetailMoreMenu,
  readerStreamItems,
  selectedFeedIndex,
  selectedArticleLink,
  openArticle,
  openFeedBriefing,
}: UseReaderFeatureEffectsParams) {
  useReaderLocalPersistence({
    aiModel,
    readArticleIDs,
    favoriteArticleIDs,
    aiModelStorageKey,
    readArticleStorageKey,
    favoriteArticleStorageKey,
    maxStoredReadArticles,
    maxStoredFavoriteArticles,
  })

  useSummaryTaskPruner({
    setSummaryTasks,
    summaryTaskNotifiedRef,
  })

  useSummaryTaskPoller({
    aiModel,
    pendingArticleSummaryTasks,
    resolveSummaryTaskIdentity,
    selectedArticleID,
    upsertSummaryTask,
    setArticleSummary,
    setArticleSummaryMeta,
    setArticleSummaryError,
    setNotice,
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

  useReaderOverlayShortcuts({
    sourceProfileSource,
    sourceContextMenu,
    pendingDeleteSource,
    showFeedAIMoreMenu,
    showDetailMoreMenu,
    setSourceProfileSource,
    closeSourceContextMenu,
    setPendingDeleteSource,
    setShowFeedAIMoreMenu,
    closeDetailMoreMenu,
    readerStreamItems,
    selectedFeedIndex,
    selectedArticleLink,
    openArticle,
    openFeedBriefing,
  })
}
