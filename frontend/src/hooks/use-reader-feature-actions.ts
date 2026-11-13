import { useCallback } from 'react'
import { listFeed } from '../api'
import { buildFeedBriefingTaskKey } from '../lib/summary-task-utils'
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
import { useReaderCatchUp } from './use-reader-catch-up'
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
    openReaderArticle,
    openReaderBriefing,
    closeReader,
    enterImmersiveReader,
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
    feedMode,
    onChangeFeedMode,
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
    closeReader,
    openReaderBriefing,
    setLoadingArticle,
    setArticleError,
    setSelectedArticle,
    setArticleSummary,
    setArticleSummaryMeta,
    setArticleSummaryError,
    setLoadingArticleSummary,
    setExpandedThreadComments,
    setThreadCommentsNewestFirst,
    floatingDetailRef,
  })

  const {
    applyFeedBriefingSnapshot,
    saveFeedBriefingSnapshot,
    resetFeedBriefingState,
    generateFeedBriefing,
    onGenerateFeedBriefing: generateVisibleFeedBriefing,
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
    setFeedBriefingSnapshots,
    setSelectedFeedBriefing,
    setNotice,
    upsertSummaryTask,
    toErrorMessage,
  })

  const onGenerateFeedBriefing = useCallback(async (refresh = false, forum = false) => {
    if (forum) {
      try {
        setLoadingFeedBriefing(true)
        const response = await listFeed({ limit: 30, tag: 'forum', since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() })
        const articles = response.data.filter((item) =>
          !sourcesIndex.mutedSiteSet.has(sourcesIndex.sourceSiteKeyMap.get(item.source_id) ?? ''),
        )
        if (articles.length === 0) {
          setNotice({ kind: 'info', text: '最近 24 小时暂无论坛讨论。请检查 V2EX、HN 订阅的抓取状态。' })
          return
        }
        setSourceFilter('')
        setSourceGroupFilter(null)
        setSidebarTagFilters([])
        setTagFilter('forum')
        setKeyword('')
        setUnreadOnly(false)
        setFavoriteOnly(false)
        const succeeded = await generateFeedBriefing({
          articleIDs: articles.map((item) => item.id),
          scopeLabel: '论坛讨论简报',
          title: '论坛讨论简报',
          tag: 'forum',
          taskKey: buildFeedBriefingTaskKey({ model: aiModel, sourceIDs: [], tag: 'forum', keyword: '', unreadOnly: false, mutedSiteKeys: [...sourcesIndex.mutedSiteSet].sort() }),
          refresh,
          selectOnSuccess: true,
        })
        if (succeeded) openFeedBriefing()
      } catch (error) {
        setNotice({ kind: 'error', text: `加载论坛讨论失败：${toErrorMessage(error)}` })
      } finally {
        setLoadingFeedBriefing(false)
      }
      return
    }
    if (feedMode === 'all') return generateVisibleFeedBriefing(refresh)
    try {
      // Recommendations must not shrink the input of an independently requested briefing.
      const response = await listFeed({
        limit: 30,
        sourceID: sourceFilter,
        tag: tagFilter,
        keyword: activeFeedBriefingKeyword,
        includeHidden: activeFeedBriefingSourceIDs.some((id) => normalizeSourceKind(sourceByID.get(id)?.kind) === 'thread'),
      })
      const articles = response.data.filter((item) =>
        !sourcesIndex.mutedSiteSet.has(sourcesIndex.sourceSiteKeyMap.get(item.source_id) ?? '') &&
        (!ui.unreadOnly || !sourcesIndex.readArticleIDSet.has(item.id)) &&
        (!ui.favoriteOnly || sourcesIndex.favoriteArticleIDSet.has(item.id)),
      )
      await generateFeedBriefing({
        articleIDs: articles.map((item) => item.id),
        sourceIDs: activeFeedBriefingSourceIDs,
        scopeLabel: activeFeedBriefingScopeLabel,
        taskKey: activeFeedBriefingTaskKey,
        tag: tagFilter,
        keyword: activeFeedBriefingKeyword,
        refresh,
      })
    } catch (error) {
      setNotice({ kind: 'error', text: `加载速览候选失败：${toErrorMessage(error)}` })
    }
  }, [openFeedBriefing, aiModel, setLoadingFeedBriefing, setSourceFilter, setSourceGroupFilter, setSidebarTagFilters, setTagFilter, setKeyword, setUnreadOnly, setFavoriteOnly, feedMode, generateVisibleFeedBriefing, sourceFilter, tagFilter, activeFeedBriefingKeyword, activeFeedBriefingSourceIDs, sourceByID, sourcesIndex, ui.unreadOnly, ui.favoriteOnly, generateFeedBriefing, activeFeedBriefingScopeLabel, activeFeedBriefingTaskKey, setNotice])

  const catchUp = useReaderCatchUp({
    active: ui.activeTab === 'reader',
    aiModel,
    generateFeedBriefing,
    openFeedBriefing,
    setNotice,
    toErrorMessage,
  })

  const { openArticle, onSummarizeArticle, onTrackThread } = useReaderArticleActions({
    aiModel,
    selectedArticleID,
    feed,
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
    openReaderArticle,
    setArticleError,
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
    openArticle,
    removeSummaryTask,
  })

  const { openImmersiveReader, returnToReaderStream } = useReaderViewActions({
    closeReader,
    enterImmersiveReader,
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
    applySourceGroupFilterFromSidebar,
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
    feedMode,
    onChangeFeedMode,
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
    applySourceGroupFilterFromSidebar,
    registerSidebarSourceItemRef,
    applySidebarTagFilters,
    toggleSidebarTagFilter,
    switchSidebarTagFilterMode,
    openSourceProfile,
    openDeleteSourceConfirm,
    closeFloatingReader,
    openFeedBriefing,
    finalizeReaderSession,
    ...catchUp,
  }
}
