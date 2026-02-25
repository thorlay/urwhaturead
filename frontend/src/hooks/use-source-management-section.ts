import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { SourceManagementPanelController } from '@/components/source-management-panel'
import type { Notice, AppliedSourceGroupFilter } from '../lib/app-domain'
import type { ArticleDetail, Source, SourceStatus } from '../types'
import { useSourceManagementController } from './use-source-management-controller'
import { useSourceManagementFeature } from './use-source-management-feature'
import { useSourceManagementState } from './use-source-management-state'
import { useSourceProfileDerived } from './use-source-profile-derived'

type FeedLoadOverrides = {
  tag?: string
  sourceID?: string
  keyword?: string
  cursor?: string
}

type UseSourceManagementSectionParams = {
  core: {
    sources: Source[]
    sourceStatusMap: Map<number, SourceStatus>
    sourceSiteKeyMap: Map<number, string>
    sourceByID: Map<number, Source>
    availableTags: string[]
    mutedSiteKeys: string[]
    mutedSiteSet: Set<string>
  }
  profile: {
    sourceProfileSource: Source | null
    setSourceProfileSource: Dispatch<SetStateAction<Source | null>>
    sourceProfileTagInput: string
    setSourceProfileTagInput: Dispatch<SetStateAction<string>>
  }
  deletion: {
    pendingDeleteSource: Source | null
    setPendingDeleteSource: Dispatch<SetStateAction<Source | null>>
  }
  article: {
    selectedArticle: ArticleDetail | null
    setSelectedArticle: Dispatch<SetStateAction<ArticleDetail | null>>
    setSelectedArticleID: Dispatch<SetStateAction<number | null>>
  }
  filters: {
    sourceFilter: string
    setSourceFilter: Dispatch<SetStateAction<string>>
    setSourceGroupFilter: Dispatch<SetStateAction<AppliedSourceGroupFilter | null>>
    setSidebarTagFilters: Dispatch<SetStateAction<string[]>>
  }
  controller: {
    aiModel: string
    aiModelOptions: string[]
    showManageModelPicker: boolean
    setShowManageModelPicker: Dispatch<SetStateAction<boolean>>
    onChangeAIModel: (nextModel: string) => void
    enabledSourceCount: number
    unhealthySourceCount: number
    loadingStatus: boolean
    loadStatus: () => Promise<void>
    loadSources: () => Promise<void>
    loadingSources: boolean
    sourcesError: string | null
    statusError: string | null
    sourceSelectAllRef: RefObject<HTMLInputElement | null>
    toggleSiteMuted: (siteKey: string) => void
  }
  dataOps: {
    setNotice: Dispatch<SetStateAction<Notice | null>>
    setSources: Dispatch<SetStateAction<Source[]>>
    closeSourceContextMenu: () => void
    loadFeed: (append?: boolean, overrides?: FeedLoadOverrides) => Promise<void>
    refreshStatusIfVisible: () => Promise<void>
  }
  helpers: {
    resolveSourceHealth: (source: Pick<Source, 'id' | 'enabled'>, statusMap: Map<number, SourceStatus>) => SourceStatus['health']
    sourceHealthPriority: (health: SourceStatus['health']) => number
    sourceTagList: (source: Pick<Source, 'tags'>) => string[]
    parseSourceTagInput: (input: string) => string[]
    parseRSSLines: (input: string) => string[]
    parseSourceIDFilter: (input: string) => number[]
    normalizeSourceTags: (values?: string[]) => string[]
    equalStringList: (left: string[], right: string[]) => boolean
    bulkActionLabel: (
      action: 'enable' | 'disable' | 'refresh' | 'test' | 'add_tags' | 'remove_tags',
    ) => string
    toErrorMessage: (error: unknown) => string
    resolveSourceSiteKey: (source: Pick<Source, 'site_key' | 'rss_url'>) => string
    normalizeSourceKind: (kind?: string) => 'feed' | 'thread'
    sourceClickCount: (source: Pick<Source, 'click_count'>) => number
    formatTimeAgo: (input: string) => string
    healthLabel: (health: SourceStatus['health']) => string
    healthToneClass: (health: SourceStatus['health']) => string
    confidenceLabel: SourceManagementPanelController['confidenceLabel']
  }
}

export function useSourceManagementSection(params: UseSourceManagementSectionParams) {
  const sourceManagementState = useSourceManagementState({
    sources: params.core.sources,
    sourceStatusMap: params.core.sourceStatusMap,
    sourceSiteKeyMap: params.core.sourceSiteKeyMap,
    sourceTagList: params.helpers.sourceTagList,
    resolveSourceHealth: params.helpers.resolveSourceHealth,
    sourceHealthPriority: params.helpers.sourceHealthPriority,
  })

  const sourceProfile = useSourceProfileDerived({
    sourceProfileSource: params.profile.sourceProfileSource,
    sourceStatusMap: params.core.sourceStatusMap,
    resolveSourceHealth: params.helpers.resolveSourceHealth,
    sourceTagList: params.helpers.sourceTagList,
    availableTags: params.core.availableTags,
    sourceProfileTagInput: params.profile.sourceProfileTagInput,
    parseSourceTagInput: params.helpers.parseSourceTagInput,
  })

  const sourceManagementActions = useSourceManagementFeature({
    sourceManagementState,
    sourceFilter: params.filters.sourceFilter,
    sourceProfileSource: params.profile.sourceProfileSource,
    sourceProfileTags: sourceProfile.sourceProfileTags,
    pendingDeleteSource: params.deletion.pendingDeleteSource,
    sourceByID: params.core.sourceByID,
    setNotice: params.dataOps.setNotice,
    setSources: params.dataOps.setSources,
    setSourceProfileSource: params.profile.setSourceProfileSource,
    setSourceProfileTagInput: params.profile.setSourceProfileTagInput,
    closeSourceContextMenu: params.dataOps.closeSourceContextMenu,
    selectedArticle: params.article.selectedArticle,
    setSelectedArticle: params.article.setSelectedArticle,
    setSelectedArticleID: params.article.setSelectedArticleID,
    setPendingDeleteSource: params.deletion.setPendingDeleteSource,
    setSourceFilter: params.filters.setSourceFilter,
    setSourceGroupFilter: params.filters.setSourceGroupFilter,
    setSidebarTagFilters: params.filters.setSidebarTagFilters,
    loadSources: params.controller.loadSources,
    loadFeed: params.dataOps.loadFeed,
    refreshStatusIfVisible: params.dataOps.refreshStatusIfVisible,
    parseSourceTagInput: params.helpers.parseSourceTagInput,
    parseRSSLines: params.helpers.parseRSSLines,
    parseSourceIDFilter: params.helpers.parseSourceIDFilter,
    normalizeSourceTags: params.helpers.normalizeSourceTags,
    sourceTagList: params.helpers.sourceTagList,
    equalStringList: params.helpers.equalStringList,
    bulkActionLabel: params.helpers.bulkActionLabel,
    toErrorMessage: params.helpers.toErrorMessage,
  })

  const sourceManagementController = useSourceManagementController({
    aiModel: params.controller.aiModel,
    aiModelOptions: params.controller.aiModelOptions,
    showManageModelPicker: params.controller.showManageModelPicker,
    setShowManageModelPicker: params.controller.setShowManageModelPicker,
    onChangeAIModel: params.controller.onChangeAIModel,
    sources: params.core.sources,
    enabledSourceCount: params.controller.enabledSourceCount,
    unhealthySourceCount: params.controller.unhealthySourceCount,
    mutedSiteKeys: params.core.mutedSiteKeys,
    healthToneClass: params.helpers.healthToneClass,
    loadingStatus: params.controller.loadingStatus,
    loadStatus: params.controller.loadStatus,
    loadSources: params.controller.loadSources,
    availableTags: params.core.availableTags,
    loadingSources: params.controller.loadingSources,
    sourcesError: params.controller.sourcesError,
    statusError: params.controller.statusError,
    sourceSelectAllRef: params.controller.sourceSelectAllRef,
    sourceStatusMap: params.core.sourceStatusMap,
    resolveSourceHealth: params.helpers.resolveSourceHealth,
    sourceSiteKeyMap: params.core.sourceSiteKeyMap,
    resolveSourceSiteKey: params.helpers.resolveSourceSiteKey,
    sourceTagList: params.helpers.sourceTagList,
    normalizeSourceKind: params.helpers.normalizeSourceKind,
    sourceClickCount: params.helpers.sourceClickCount,
    formatTimeAgo: params.helpers.formatTimeAgo,
    healthLabel: params.helpers.healthLabel,
    mutedSiteSet: params.core.mutedSiteSet,
    toggleSiteMuted: params.controller.toggleSiteMuted,
    confidenceLabel: params.helpers.confidenceLabel,
    sourceManagementState,
    sourceManagementActions,
  })

  return {
    sourceManagementState,
    sourceProfile,
    sourceManagementActions,
    sourceManagementController,
  }
}
