import { useCallback } from 'react'
import type { AppStateData } from './use-app-state-data'
import type { AppStateRefs } from './use-app-state-refs'
import type { AppStateRequest } from './use-app-state-request'
import type { AppStateUI } from './use-app-state-ui'
import type { ReaderSidebarState } from './use-reader-sidebar-state'
import type { SourceContextMenuController } from './use-source-context-menu'
import type { SourcesIndex } from './use-sources-index'
import type { useReaderFeatureDerived } from './use-reader-feature-derived'
import { useFeedBriefingActions } from './use-feed-briefing-actions'
import { useReaderArticleActions } from './use-reader-article-actions'
import { useReaderDataController } from './use-reader-data-controller'
import { useReaderFilterControls } from './use-reader-filter-controls'
import { useReaderSessionActions } from './use-reader-session-actions'
import { useReaderSidebarControls } from './use-reader-sidebar-controls'
import { useReaderViewActions } from './use-reader-view-actions'
import { useSummaryArticleState } from './use-summary-article-state'
import { useSummaryTaskActions } from './use-summary-task-actions'
import { useSummaryTaskStripActions } from './use-summary-task-strip-actions'
import { readMarkMinScrollProgress } from '../lib/app-domain'
import {
  normalizeSourceKind,
  parseSourceIDFilter,
  sourceTagList,
  toErrorMessage,
  toggleFavoriteArticleID,
  upsertReadArticleID,
} from '../lib/app-utils'

type UseReaderFeatureActionsParams = {
  refs: AppStateRefs
  data: AppStateData
  request: AppStateRequest
  ui: AppStateUI
  sidebarState: ReaderSidebarState
  sourcesIndex: SourcesIndex
  sourceContext: SourceContextMenuController
  derived: ReturnType<typeof useReaderFeatureDerived>
}

export function useReaderFeatureActions({
  refs,
  data,
  request,
  ui,
  sidebarState,
  sourcesIndex,
  sourceContext,
  derived,
}: UseReaderFeatureActionsParams) {
  const {
    floatingDetailRef,
    sidebarSourceItemRefs,
    sidebarTagFilterTimerRef,
    streamScrollYRef,
    feedRequestSeqRef,
    articleRequestSeqRef,
    summaryRequestSeqRef,
    summaryTaskNotifiedRef,
    readerSessionRef,
  } = refs
  const {
    setSources,
    feed,
    setFeed,
    selectedArticle,
    selectedArticleID,
    setSelectedArticle,
    setSelectedArticleID,
    setArticleSummary,
    setArticleSummaryMeta,
    setSummaryTasks,
    setLoadingArticleSummary,
    setArticleSummaryError,
    setFeedBriefing,
    setFeedBriefingMeta,
    setFeedBriefingItems,
    setFeedBriefingArticleCount,
    setFeedBriefingScopeLabel,
    setFeedBriefingGeneratedAt,
    setFeedBriefingAnchorArticleIDs,
    setFeedBriefingTaskKey,
    feedBriefingSnapshots,
    setFeedBriefingSnapshots,
    setLoadingFeedBriefing,
    setFeedBriefingError,
    aiModel,
    setAIModel,
    setSourceStatus,
    setReadArticleIDs,
    setFavoriteArticleIDs,
  } = data
  const {
    loadingFeed,
    setLoadingSources,
    setLoadingFeed,
    setLoadingArticle,
    setLoadingStatus,
    setSourcesError,
    setFeedError,
    setArticleError,
    setStatusError,
    feedCursor,
    setFeedCursor,
    setHasMoreFeed,
    setNotice,
  } = request
  const {
    setActiveTab,
    setReaderView,
    setShowFloatingReader,
    setSelectedFeedBriefing,
    setUnreadOnly,
    setFavoriteOnly,
    keyword,
    setKeyword,
    tagFilter,
    setTagFilter,
    sourceFilter,
    setSourceFilter,
    setMutedSiteKeys,
    setShowManageModelPicker,
    setExpandedThreadComments,
    setThreadCommentsNewestFirst,
    setSourceProfileSource,
    setSourceProfileTagPickerOpen,
    setSourceProfileTagInput,
    setPendingDeleteSource,
  } = ui
  const {
    setSourceGroupFilter,
    setSidebarTagFilters,
    setSidebarTagFilterMode,
  } = sidebarState
  const { closeSourceContextMenu } = sourceContext
  const { sourceByID, favoriteArticleIDSet } = sourcesIndex
  const {
    selectedSummaryTask,
    activeFeedBriefingAnchorArticleIDs,
    activeFeedBriefingSourceIDs,
    activeFeedBriefingKeyword,
    activeFeedBriefingTaskKey,
    activeFeedBriefingScopeLabel,
  } = derived

  const { loadCachedSummary, resolveSummaryTaskIdentity } = useSummaryArticleState({
    selectedSummaryTask,
    setArticleSummaryMeta,
    summaryRequestSeqRef,
    setArticleSummary,
    setArticleSummaryError,
    feed,
    selectedArticle,
    toErrorMessage,
  })

  const { upsertSummaryTask, removeSummaryTask, clearCompletedSummaryTasks } = useSummaryTaskActions({
    setSummaryTasks,
    summaryTaskNotifiedRef,
  })

  const {
    loadSources,
    loadStatus,
    refreshStatusIfVisible,
    loadFeed,
    cancelSidebarTagFeedReload,
    refreshAll,
    loadMore,
    pendingFeedCount,
    checkingFeedUpdates,
    applyPendingFeedUpdates,
  } = useReaderDataController({
    activeTab: ui.activeTab,
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
  })

  const { startReaderSession, finalizeReaderSession, closeFloatingReader, openFeedBriefing } = useReaderSessionActions({
    readerSessionRef,
    setReadArticleIDs,
    upsertReadArticleID,
    readMarkMinScrollProgress,
    closeDetailMoreMenu: derived.closeDetailMoreMenu,
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
    closeDetailMoreMenu: derived.closeDetailMoreMenu,
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

  const { onOpenSummaryTask, onDismissSummaryTask } = useSummaryTaskStripActions({
    feedBriefingSnapshots,
    applyFeedBriefingSnapshot,
    setNotice,
    setActiveTab,
    openFeedBriefing,
    setReaderView,
    openArticle,
    removeSummaryTask,
  })

  const { openImmersiveReader, returnToReaderStream } = useReaderViewActions({
    streamScrollYRef,
    setReaderView,
    setShowFloatingReader,
    finalizeReaderSession,
  })

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
  })

  const onToggleFavoriteArticle = useCallback(
    (articleID: number) => {
      setFavoriteArticleIDs((previous) => toggleFavoriteArticleID(previous, articleID))
    },
    [setFavoriteArticleIDs],
  )

  const isFavoriteArticle = Boolean(selectedArticleID && favoriteArticleIDSet.has(selectedArticleID))

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
    sidebarState,
    setSourceFilter,
    setSelectedArticle,
    setSelectedArticleID,
    setFeedCursor,
    loadFeed,
    sidebarSourceItemRefs,
    sourceTagList,
    closeSourceContextMenu,
    setSourceProfileSource,
    setSourceProfileTagPickerOpen,
    setSourceProfileTagInput,
    setPendingDeleteSource,
  })

  return {
    resolveSummaryTaskIdentity,
    upsertSummaryTask,
    clearCompletedSummaryTasks,
    loadSources,
    loadStatus,
    refreshStatusIfVisible,
    loadFeed,
    cancelSidebarTagFeedReload,
    refreshAll,
    loadMore,
    pendingFeedCount,
    checkingFeedUpdates,
    applyPendingFeedUpdates,
    applyFeedBriefingSnapshot,
    saveFeedBriefingSnapshot,
    onGenerateFeedBriefing,
    openArticle,
    onToggleFavoriteArticle,
    isFavoriteArticle,
    onSummarizeArticle,
    onTrackThread,
    onOpenSummaryTask,
    onDismissSummaryTask,
    openImmersiveReader,
    returnToReaderStream,
    applyFilters,
    clearFilters,
    removeFilter,
    onChangeAIModel,
    toggleSiteMuted,
    applySourceFilterFromSidebar,
    registerSidebarSourceItemRef,
    applySidebarTagFilters,
    toggleSidebarTagFilter,
    switchSidebarTagFilterMode,
    openSourceProfile,
    openDeleteSourceConfirm,
    closeFloatingReader,
    openFeedBriefing,
    finalizeReaderSession,
  }
}
