import { lazy, Suspense, useEffect, useState } from 'react'
import { AppTopbar } from '@/components/app-topbar'
import { NoticeBanner } from '@/components/notice-banner'
import { ReaderWorkspace } from '@/components/reader-workspace'
import { SourceOverlaysStack } from '@/components/source-overlays-stack'
import { useAdminAccess } from './hooks/use-admin-access'
import { useAppUIEffects } from './hooks/use-app-ui-effects'
import { useAppState } from './hooks/use-app-state'
import { useReaderSidebarState } from './hooks/use-reader-sidebar-state'
import { useSourceContextMenu } from './hooks/use-source-context-menu'
import { useSourceOverlaysProps } from './hooks/use-source-overlays-props'
import { useSourcesIndex } from './hooks/use-sources-index'
import { useSourceManagementSection } from './hooks/use-source-management-section'
import { useAppBootstrap } from './hooks/use-app-bootstrap'
import { useAppTabActions } from './hooks/use-app-tab-actions'
import { useAILibrarySection } from './hooks/use-ai-library-section'
import { useReaderFeatureSection } from './hooks/use-reader-feature-section'
import { useReaderWorkspaceComposition } from './hooks/use-reader-workspace-composition'
import { aiModelOptions, areAIModelsProviderCompatible } from './lib/app-domain'
import {
  bulkActionLabel,
  confidenceLabel,
  equalStringList,
  formatDateTime,
  formatTimeAgo,
  healthLabel,
  healthToneClass,
  normalizeSourceKind,
  normalizeSourceTags,
  parseRSSLines,
  parseSourceIDFilter,
  parseSourceTagInput,
  resolveSourceHealth,
  resolveSourceSiteKey,
  sourceClickCount,
  sourceHealthPriority,
  sourceTagList,
  toErrorMessage,
} from './lib/app-utils'
import { summaryTaskKindLabel, summaryTaskStatusLabel } from './lib/summary-task-utils'
import type { FeedBriefingLibraryItem } from './types'
import './App.css'

const SourceManagementPanel = lazy(async () => {
  const module = await import('@/components/source-management-panel')
  return { default: module.SourceManagementPanel }
})

const SummaryTaskStripPanel = lazy(async () => {
  const module = await import('@/components/summary-task-strip-panel')
  return { default: module.SummaryTaskStripPanel }
})

const AILibraryPanel = lazy(async () => {
  const module = await import('@/components/ai-library-panel')
  return { default: module.AILibraryPanel }
})

function App() {
  const { refs, data, request, ui } = useAppState()
  const [canReturnToAILibrary, setCanReturnToAILibrary] = useState(false)

  const {
    sourceSelectAllRef,
    sourceContextMenuRef,
    sidebarSourceItemRefs,
    previousSidebarSourceItemRectsRef,
    previousSidebarSourceIDsRef,
  } = refs

  const {
    sources,
    setSources,
    selectedArticle,
    setSelectedArticle,
    setSelectedArticleID,
    setFeedBriefing,
    setFeedBriefingMeta,
    setFeedBriefingItems,
    setFeedBriefingArticleCount,
    setFeedBriefingScopeLabel,
    setFeedBriefingGeneratedAt,
    setFeedBriefingAnchorArticleIDs,
    setFeedBriefingTaskKey,
    setLoadingFeedBriefing,
    setFeedBriefingError,
    aiModel,
    setAIModel,
    sourceStatus,
    readArticleIDs,
    favoriteArticleIDs,
  } = data

  const {
    loadingSources,
    loadingFeed,
    loadingStatus,
    sourcesError,
    statusError,
    notice,
    setNotice,
  } = request

  const {
    sourceFilter,
    setSourceFilter,
    mutedSiteKeys,
    setMutedSiteKeys,
    showManageModelPicker,
    setShowManageModelPicker,
    activeTab,
    setActiveTab,
    setReaderView,
    setShowFloatingReader,
    setSelectedFeedBriefing,
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
    setSourceGroupFilter,
    setSidebarTagFilters,
  } = sidebarState

  const sourceContext = useSourceContextMenu({
    sourceContextMenuRef,
  })
  const {
    sourceContextMenu,
    closeSourceContextMenu,
    openSourceContextMenu,
    openSourceContextMenuAt,
  } = sourceContext

  const {
    availableTags,
    sourceSiteKeyMap,
    sourceByID,
    sourceStatusMap,
    mutedSiteSet,
    readArticleIDSet,
    favoriteArticleIDSet,
  } = useSourcesIndex({
    sources,
    sourceStatus,
    mutedSiteKeys,
    readArticleIDs,
    favoriteArticleIDs,
    sourceTagList,
    resolveSourceSiteKey,
  })

  const readerSection = useReaderFeatureSection({
    refs,
    data,
    request,
    ui,
    sidebarState,
    sourcesIndex: {
      availableTags,
      sourceSiteKeyMap,
      sourceByID,
      sourceStatusMap,
      mutedSiteSet,
      readArticleIDSet,
      favoriteArticleIDSet,
    },
    sourceContext,
  })
  const {
    visibleSummaryTasks,
    summaryTaskStats,
    enabledSourceCount,
    unhealthySourceCount,
    clearCompletedSummaryTasks,
    loadSources,
    loadStatus,
    refreshStatusIfVisible,
    loadFeed,
    refreshAll,
    pendingFeedCount,
    checkingFeedUpdates,
    applyPendingFeedUpdates,
    onToggleFavoriteArticle,
    onOpenSummaryTask,
    onDismissSummaryTask,
    onChangeAIModel,
    toggleSiteMuted,
    applySidebarTagFilters,
    openSourceProfile,
    openDeleteSourceConfirm,
    finalizeReaderSession,
    showFeedAIMoreMenu,
    setShowFeedAIMoreMenu,
  } = readerSection

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

  const openFeedBriefingFromLibrary = (item: FeedBriefingLibraryItem) => {
    const anchorArticleIDs = item.article_ids
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0)

    setSelectedArticle(null)
    setSelectedArticleID(null)
    setReaderView('detail')
    setShowFloatingReader(false)
    setSelectedFeedBriefing(true)
    setFeedBriefing(item.summary)
    setFeedBriefingMeta(`${item.provider} · ${item.model} · ${item.article_count} 条信息`)
    setFeedBriefingItems([])
    setFeedBriefingArticleCount(item.article_count)
    setFeedBriefingScopeLabel(item.scope_label || '当前阅读流')
    setFeedBriefingGeneratedAt(item.generated_at)
    setFeedBriefingAnchorArticleIDs(anchorArticleIDs)
    setFeedBriefingTaskKey(item.digest_key)
    setFeedBriefingError(null)
    setLoadingFeedBriefing(false)
  }

  const returnToAILibrary = () => {
    finalizeReaderSession('navigate')
    setReaderView('stream')
    setShowFloatingReader(false)
    setActiveTab('ai')
    setCanReturnToAILibrary(false)
  }

  const aiLibrarySection = useAILibrarySection({
    activeTab,
    setActiveTab,
    openFeedBriefing: openFeedBriefingFromLibrary,
    onOpenFromAILibrary: () => setCanReturnToAILibrary(true),
    setNotice,
  })

  const {
    adminAuthEnabled,
    adminAuthenticated,
    adminSessionReady,
    publicAIModel,
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

  useEffect(() => {
    if (!adminSessionReady) {
      return
    }
    const lockedModel = publicAIModel.trim()
    if (!lockedModel || aiModel === lockedModel) {
      return
    }
    if (canAccessManagement && areAIModelsProviderCompatible(aiModel, lockedModel)) {
      return
    }
    setAIModel(lockedModel)
  }, [adminSessionReady, aiModel, canAccessManagement, publicAIModel, setAIModel])

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
    onOpenAITab,
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

  const onOpenReaderTabWithReset = () => {
    setCanReturnToAILibrary(false)
    onOpenReaderTab()
  }

  const { readerWorkspaceProps } = useReaderWorkspaceComposition({
    sidebarState,
    readerSection,
    availableTags,
    onOpenSourceContextMenu: openSourceContextMenu,
    onOpenSourceContextMenuAt: openSourceContextMenuAt,
    returnToAILibrary: canReturnToAILibrary ? returnToAILibrary : undefined,
    returnToAILibraryLabel: canReturnToAILibrary ? '返回 AI 内容库' : undefined,
  })

  const sourceOverlaysProps = useSourceOverlaysProps({
    contextMenuRef: sourceContextMenuRef,
    sourceContextMenu,
    canManageSources: canAccessManagement,
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
    onSetSourceProfileAIBriefing: sourceManagementActions.onSetSourceProfileAIBriefing,
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
        aiModel={aiModel}
        loadingSources={loadingSources}
        loadingFeed={loadingFeed}
        pendingFeedCount={pendingFeedCount}
        checkingFeedUpdates={checkingFeedUpdates}
        canAccessManagement={canAccessManagement}
        showAdminLogout={adminAuthEnabled && adminAuthenticated}
        onOpenReaderTab={onOpenReaderTabWithReset}
        onOpenAITab={onOpenAITab}
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

      {activeTab === 'ai' && (
        <Suspense fallback={null}>
          <AILibraryPanel
            search={aiLibrarySection.search}
            loading={aiLibrarySection.loading}
            error={aiLibrarySection.error}
            activeView={aiLibrarySection.activeView}
            timeRange={aiLibrarySection.timeRange}
            sourceFilter={aiLibrarySection.sourceFilter}
            statusFilter={aiLibrarySection.statusFilter}
            articleSummaries={aiLibrarySection.articleSummaries}
            feedBriefings={aiLibrarySection.feedBriefings}
            readerArticle={aiLibrarySection.readerArticle}
            readerArticleLoading={aiLibrarySection.readerArticleLoading}
            readerArticleError={aiLibrarySection.readerArticleError}
            favoriteArticleIDSet={favoriteArticleIDSet}
            sources={sources}
            formatTimeAgo={formatTimeAgo}
            onChangeSearch={aiLibrarySection.setSearch}
            onApplySearch={aiLibrarySection.applySearch}
            onRefresh={aiLibrarySection.refresh}
            onChangeView={aiLibrarySection.setActiveView}
            onChangeTimeRange={aiLibrarySection.setTimeRange}
            onChangeSourceFilter={aiLibrarySection.setSourceFilter}
            onChangeStatusFilter={aiLibrarySection.setStatusFilter}
            onOpenArticleSummary={aiLibrarySection.openArticleSummary}
            onCloseArticleReader={aiLibrarySection.closeArticleReader}
            onToggleFavoriteArticle={onToggleFavoriteArticle}
            onOpenFeedBriefing={aiLibrarySection.openFeedBriefingSummary}
          />
        </Suspense>
      )}

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
