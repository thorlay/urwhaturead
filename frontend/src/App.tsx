import { lazy, Suspense } from 'react'
import { AppTopbar } from '@/components/app-topbar'
import { NoticeBanner } from '@/components/notice-banner'
import { ReaderWorkspace } from '@/components/reader-workspace'
import { SourceOverlaysStack } from '@/components/source-overlays-stack'
import { useReaderStream } from './hooks/use-reader-stream'
import { useDetailPanel } from './hooks/use-detail-panel'
import { useFeedBriefingDerived } from './hooks/use-feed-briefing-derived'
import { useFeedBriefingCacheRestore } from './hooks/use-feed-briefing-cache-restore'
import { useFeedBriefingActions } from './hooks/use-feed-briefing-actions'
import { useAdminAccess } from './hooks/use-admin-access'
import { useAppUIEffects } from './hooks/use-app-ui-effects'
import { useAppState } from './hooks/use-app-state'
import { useReaderArticleActions } from './hooks/use-reader-article-actions'
import { useReaderDataController } from './hooks/use-reader-data-controller'
import { useReaderFilterControls } from './hooks/use-reader-filter-controls'
import { useReaderOverlayShortcuts } from './hooks/use-reader-overlay-shortcuts'
import { useReaderRuntimeEffects } from './hooks/use-reader-runtime-effects'
import { useReaderSessionActions } from './hooks/use-reader-session-actions'
import { useReaderSidebarControls } from './hooks/use-reader-sidebar-controls'
import { useReaderSidebarState } from './hooks/use-reader-sidebar-state'
import { useReaderViewActions } from './hooks/use-reader-view-actions'
import { useAppDerivedState } from './hooks/use-app-derived-state'
import { useSourceContextMenu } from './hooks/use-source-context-menu'
import { useSourceOverlaysProps } from './hooks/use-source-overlays-props'
import { useSourcesIndex } from './hooks/use-sources-index'
import { useSummaryTaskView } from './hooks/use-summary-task-view'
import { useSummaryTaskPoller } from './hooks/use-summary-task-poller'
import { useReaderWorkspaceProps } from './hooks/use-reader-workspace-props'
import { useReaderWorkspaceSidebarProps } from './hooks/use-reader-workspace-sidebar-props'
import { useReaderWorkspaceFeedProps } from './hooks/use-reader-workspace-feed-props'
import { useReaderWorkspaceDetailProps } from './hooks/use-reader-workspace-detail-props'
import { useReaderLocalPersistence } from './hooks/use-reader-local-persistence'
import { useSourceManagementSection } from './hooks/use-source-management-section'
import { useSummaryTaskActions } from './hooks/use-summary-task-actions'
import { useSummaryTaskPruner } from './hooks/use-summary-task-pruner'
import { useSummaryTaskStripActions } from './hooks/use-summary-task-strip-actions'
import { useAppBootstrap } from './hooks/use-app-bootstrap'
import { useAppTabActions } from './hooks/use-app-tab-actions'
import { useSummaryArticleState } from './hooks/use-summary-article-state'
import {
  aiModelOptions,
  aiModelStorageKey,
  readArticleStorageKey,
  readMarkMinScrollProgress,
  sidebarTagCollapseCount,
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
import { summaryTaskKindLabel, summaryTaskStatusLabel } from './lib/summary-task-utils'
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
  const { refs, data, request, ui } = useAppState()

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
  } = refs

  const {
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
    sourceStatus,
    setSourceStatus,
    readArticleIDs,
    setReadArticleIDs,
  } = data

  const {
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
    setNowTick,
  } = request

  const {
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
    sourceProfileSource,
    setSourceProfileSource,
    sourceProfileTagPickerOpen,
    setSourceProfileTagPickerOpen,
    sourceProfileTagInput,
    setSourceProfileTagInput,
    pendingDeleteSource,
    setPendingDeleteSource,
  } = ui

  const sidebarState = useReaderSidebarState({
    sources,
    sourceTagList,
  })

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
    readerTrackedSources,
    readerSources,
    visibleTrackedSidebarSources,
    hasMoreTrackedSidebarSources,
    sourceGroups,
    sidebarTagFilterSet,
    sidebarVisibleFeedSources,
  } = sidebarState

  const {
    sourceContextMenu,
    closeSourceContextMenu,
    openSourceContextMenu,
    openSourceContextMenuAt,
  } = useSourceContextMenu({
    sourceContextMenuRef,
  })

  const {
    availableTags,
    sourceSiteKeyMap,
    sourceByID,
    sourceStatusMap,
    mutedSiteSet,
    readArticleIDSet,
  } = useSourcesIndex({
    sources,
    sourceStatus,
    mutedSiteKeys,
    readArticleIDs,
    sourceTagList,
    resolveSourceSiteKey,
  })

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
  const {
    sourceFilterIDs,
    activeFeedBriefingSourceIDs,
    activeFeedBriefingKeyword,
    activeFeedBriefingTaskKey,
    activeFeedBriefingScopeLabel,
    visibleFeedArticleIDs,
    activeFeedBriefingAnchorArticleIDs,
    sourceFilterSelectValue,
    sourceFilterChipLabel,
  } = useFeedBriefingDerived({
    sourceFilter,
    sourceGroupFilter,
    readerSources,
    visibleFeed,
    aiModel,
    tagFilter,
    keyword,
    unreadOnly,
    mutedSiteKeys,
    sourceByID,
    parseSourceIDFilter,
  })
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
  const {
    feedBriefingPreviewText,
    feedBriefingFreshnessLabel,
    hasActiveFilters,
    enabledSourceCount,
    unhealthySourceCount,
    threadComments,
    selectedArticleImageURL,
    selectedArticleReplyCountLabel,
    hasHiddenThreadComments,
    visibleThreadComments,
  } = useAppDerivedState({
    feedBriefing,
    feedBriefingError,
    loadingFeedBriefing,
    feedBriefingGeneratedAt,
    keyword,
    tagFilter,
    sourceFilter,
    unreadOnly,
    mutedSiteKeys,
    sources,
    sourceStatus,
    selectedArticle,
    expandedThreadComments,
    threadCommentsNewestFirst,
    threadPreviewCommentLimit,
    truncate,
    plainText,
    formatTimeAgo,
    normalizeImageURL,
    formatReplyCount,
  })
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
  useReaderLocalPersistence({
    aiModel,
    readArticleIDs,
    aiModelStorageKey,
    readArticleStorageKey,
    maxStoredReadArticles,
  })

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
    sourceManagementState,
    sourceProfile: {
      sourceProfileStatus,
      sourceProfileHealth,
      sourceProfileTags,
      sourceProfileTagCandidates,
      sourceProfileTagDrafts,
    },
    sourceManagementActions,
    sourceManagementController,
  } = useSourceManagementSection({
    core: {
      sources,
      sourceStatusMap,
      sourceSiteKeyMap,
      sourceByID,
      availableTags,
      mutedSiteKeys,
      mutedSiteSet,
    },
    profile: {
      sourceProfileSource,
      setSourceProfileSource,
      sourceProfileTagInput,
      setSourceProfileTagInput,
    },
    deletion: {
      pendingDeleteSource,
      setPendingDeleteSource,
    },
    article: {
      selectedArticle,
      setSelectedArticle,
      setSelectedArticleID,
    },
    filters: {
      sourceFilter,
      setSourceFilter,
      setSourceGroupFilter,
      setSidebarTagFilters,
    },
    controller: {
      aiModel,
      aiModelOptions,
      showManageModelPicker,
      setShowManageModelPicker,
      onChangeAIModel,
      enabledSourceCount,
      unhealthySourceCount,
      loadingStatus,
      loadStatus,
      loadSources,
      loadingSources,
      sourcesError,
      statusError,
      sourceSelectAllRef,
      toggleSiteMuted,
    },
    dataOps: {
      setNotice,
      setSources,
      closeSourceContextMenu,
      loadFeed,
      refreshStatusIfVisible,
    },
    helpers: {
      resolveSourceHealth,
      sourceHealthPriority,
      sourceTagList,
      parseSourceTagInput,
      parseRSSLines,
      parseSourceIDFilter,
      normalizeSourceTags,
      equalStringList,
      bulkActionLabel,
      toErrorMessage,
      resolveSourceSiteKey,
      normalizeSourceKind,
      sourceClickCount,
      formatTimeAgo,
      healthLabel,
      healthToneClass,
      confidenceLabel,
    },
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

  useAppBootstrap({
    loadSources,
    loadFeed,
    refreshAdminSession,
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
    selectedArticleLink: selectedArticle?.link,
    openArticle,
    openFeedBriefing,
  })

  useAppUIEffects({
    activeTab,
    sourceStatus,
    loadingStatus,
    loadStatus,
    sourceSiteKeyMap,
    setMutedSiteKeys,
    sidebarState,
    applySidebarTagFilters,
    setSourceFilter,
    loadFeed,
    sourceFilter,
    parseSourceIDFilter,
    sourceSelectAllRef,
    selectedVisibleCount: sourceManagementState.selectedVisibleCount,
    allVisibleSelected: sourceManagementState.allVisibleSelected,
    showFeedAIMoreMenu,
    feedAIMoreRef,
    setShowFeedAIMoreMenu,
    previousSidebarSourceItemRectsRef,
    previousSidebarSourceIDsRef,
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

  const {
    onOpenReaderTab,
    onOpenSourcesTab,
    onRefreshAllClick,
    onAdminLogoutClick,
  } = useAppTabActions({
    canAccessManagement,
    finalizeReaderSession,
    setActiveTab,
    setReaderView,
    setShowFloatingReader,
    refreshAll,
    onAdminLogout,
  })

  const readerSidebarProps = useReaderWorkspaceSidebarProps({
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
    onApplySourceFilterFromSidebar: applySourceFilterFromSidebar,
    onSwitchSidebarTagFilterMode: switchSidebarTagFilterMode,
    onApplySidebarTagFilters: applySidebarTagFilters,
    onToggleSidebarTagFilter: toggleSidebarTagFilter,
    onRegisterSidebarSourceItemRef: registerSidebarSourceItemRef,
    onOpenSourceContextMenu: openSourceContextMenu,
    onOpenSourceContextMenuAt: openSourceContextMenuAt,
    setShowSubscriptionSidebar,
    setShowAllSidebarTags,
    setShowTrackedSidebar,
    setShowAllTrackedSidebar,
  })

  const readerFeedProps = useReaderWorkspaceFeedProps({
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
    onSetUnreadOnly: setUnreadOnly,
    onApplyFilters: applyFilters,
    onChangeKeyword: setKeyword,
    onChangeTagFilter: setTagFilter,
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
    setShowFeedAIMoreMenu,
    setFeedTitleOnlyMode,
    setShowFeedImages,
    setShowFeedSearch,
    setShowAdvancedFilters,
    setSourceGroupFilter,
    setSidebarTagFilters,
    setSourceFilter,
  })

  const readerDetailProps = useReaderWorkspaceDetailProps({
    floatingDetailRef,
    showFloatingReader,
    readerView,
    selectedArticle,
    selectedFeedBriefing,
    loadingArticle,
    articleError,
    selectedArticleID,
    onOpenArticle: openArticle,
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
    threadPreviewCommentLimit,
    expandedThreadComments,
    hasHiddenThreadComments,
    setThreadCommentsNewestFirst,
    setExpandedThreadComments,
  })

  const readerWorkspaceProps = useReaderWorkspaceProps({
    showSubscriptionSidebar,
    setShowSubscriptionSidebar,
    sidebarProps: readerSidebarProps,
    feedProps: readerFeedProps,
    showFloatingReader,
    readerView,
    detailProps: readerDetailProps,
  })

  const sourceOverlaysProps = useSourceOverlaysProps({
    contextMenuRef: sourceContextMenuRef,
    sourceContextMenu,
    busySourceID: sourceManagementState.busySourceID,
    onQuickSetSourceEnabled: sourceManagementActions.onQuickSetSourceEnabled,
    onOpenSourceProfile: openSourceProfile,
    onOpenDeleteConfirm: openDeleteSourceConfirm,
    sourceProfileSource,
    sourceProfileStatus,
    sourceProfileHealth,
    sourceProfileTags,
    sourceProfileTagPickerOpen,
    setSourceProfileTagPickerOpen,
    sourceProfileTagInput,
    setSourceProfileTagInput,
    sourceProfileTagDrafts,
    sourceProfileTagCandidates,
    onRemoveSourceProfileTag: sourceManagementActions.onRemoveSourceProfileTag,
    onAddSourceProfileTags: sourceManagementActions.onAddSourceProfileTags,
    setSourceProfileSource,
    normalizeSourceKind,
    resolveSourceSiteKey,
    formatDateTime,
    healthToneClass,
    healthLabel,
    formatTimeAgo,
    sourceClickCount,
    pendingDeleteSource,
    setPendingDeleteSource,
    onConfirmDeleteSource: sourceManagementActions.onConfirmDeleteSource,
  })

  return (
    <div className="app-shell">
      <AppTopbar
        activeTab={activeTab}
        sourcesCount={sources.length}
        loadingSources={loadingSources}
        loadingFeed={loadingFeed}
        pendingFeedCount={pendingFeedCount}
        checkingFeedUpdates={checkingFeedUpdates}
        canAccessManagement={canAccessManagement}
        showAdminLogout={adminAuthEnabled && adminAuthenticated}
        onOpenReaderTab={onOpenReaderTab}
        onOpenSourcesTab={onOpenSourcesTab}
        onRefreshAll={onRefreshAllClick}
        onApplyPendingFeedUpdates={() => void applyPendingFeedUpdates()}
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
