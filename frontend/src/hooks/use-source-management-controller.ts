import type { RefObject } from 'react'
import type { SourceManagementPanelController } from '@/components/source-management-panel'
import type { Source, SourceStatus } from '../types'
import type { useSourceManagementActions } from './use-source-management-actions'
import type { useSourceManagementState } from './use-source-management-state'

type UseSourceManagementControllerParams = {
  aiModel: string
  aiModelOptions: string[]
  showManageModelPicker: boolean
  setShowManageModelPicker: (updater: (value: boolean) => boolean) => void
  onChangeAIModel: (nextModel: string) => void
  sources: Source[]
  enabledSourceCount: number
  unhealthySourceCount: number
  mutedSiteKeys: string[]
  healthToneClass: (health: SourceStatus['health']) => string
  loadingStatus: boolean
  loadStatus: () => Promise<void>
  loadSources: () => Promise<void>
  availableTags: string[]
  loadingSources: boolean
  sourcesError: string | null
  statusError: string | null
  sourceSelectAllRef: RefObject<HTMLInputElement | null>
  sourceStatusMap: Map<number, SourceStatus>
  resolveSourceHealth: (
    source: Pick<Source, 'id' | 'enabled'>,
    statusMap: Map<number, SourceStatus>,
  ) => SourceStatus['health']
  sourceSiteKeyMap: Map<number, string>
  resolveSourceSiteKey: (source: Pick<Source, 'site_key' | 'rss_url'>) => string
  sourceTagList: (source: Pick<Source, 'tags'>) => string[]
  normalizeSourceKind: (kind?: string) => 'feed' | 'thread'
  sourceClickCount: (source: Pick<Source, 'click_count'>) => number
  formatTimeAgo: (input: string) => string
  healthLabel: (health: SourceStatus['health']) => string
  mutedSiteSet: Set<string>
  toggleSiteMuted: (siteKey: string) => void
  confidenceLabel: SourceManagementPanelController['confidenceLabel']
  sourceManagementState: ReturnType<typeof useSourceManagementState>
  sourceManagementActions: ReturnType<typeof useSourceManagementActions>
}

export function useSourceManagementController(params: UseSourceManagementControllerParams): SourceManagementPanelController {
  return {
    aiModel: params.aiModel,
    aiModelOptions: params.aiModelOptions,
    showManageModelPicker: params.showManageModelPicker,
    onToggleManageModelPicker: () => params.setShowManageModelPicker((value) => !value),
    onChangeAIModel: params.onChangeAIModel,
    sources: params.sources,
    enabledSourceCount: params.enabledSourceCount,
    unhealthySourceCount: params.unhealthySourceCount,
    mutedSiteKeys: params.mutedSiteKeys,
    sourceHealthCounts: params.sourceManagementState.sourceHealthCounts,
    healthToneClass: params.healthToneClass,
    loadingStatus: params.loadingStatus,
    onLoadStatus: params.loadStatus,
    reclassifyingSources: params.sourceManagementState.reclassifyingSources,
    onReclassifySources: params.sourceManagementActions.onReclassifySources,
    sourceManageKeyword: params.sourceManagementState.sourceManageKeyword,
    onSetSourceManageKeyword: params.sourceManagementState.setSourceManageKeyword,
    sourceManageTagFilter: params.sourceManagementState.sourceManageTagFilter,
    onSetSourceManageTagFilter: params.sourceManagementState.setSourceManageTagFilter,
    sourceManageHealthFilter: params.sourceManagementState.sourceManageHealthFilter,
    onSetSourceManageHealthFilter: params.sourceManagementState.setSourceManageHealthFilter,
    availableTags: params.availableTags,
    onClearSourceManageFilters: params.sourceManagementState.clearSourceManageFilters,
    loadingSources: params.loadingSources,
    onLoadSources: params.loadSources,
    selectedSourceIDs: params.sourceManagementState.selectedSourceIDs,
    visibleSourceIDs: params.sourceManagementState.visibleSourceIDs,
    bulkTagInput: params.sourceManagementState.bulkTagInput,
    onSetBulkTagInput: params.sourceManagementState.setBulkTagInput,
    bulkSourceAction: params.sourceManagementState.bulkSourceAction,
    hasSelectedSources: params.sourceManagementState.hasSelectedSources,
    onRunBulkTagAction: params.sourceManagementActions.onRunBulkTagAction,
    onRunBulkSourceAction: params.sourceManagementActions.onRunBulkSourceAction,
    onClearSelectedSourceIDs: params.sourceManagementState.clearSelectedSourceIDs,
    sourcesError: params.sourcesError,
    statusError: params.statusError,
    sourceSelectAllRef: params.sourceSelectAllRef,
    allVisibleSelected: params.sourceManagementState.allVisibleSelected,
    onToggleSelectAllVisibleSources: params.sourceManagementState.toggleSelectAllVisibleSources,
    filteredSources: params.sourceManagementState.filteredSources,
    sourceStatusMap: params.sourceStatusMap,
    resolveSourceHealth: params.resolveSourceHealth,
    sourceSiteKeyMap: params.sourceSiteKeyMap,
    resolveSourceSiteKey: params.resolveSourceSiteKey,
    busySourceID: params.sourceManagementState.busySourceID,
    editingSourceID: params.sourceManagementState.editingSourceID,
    selectedSourceIDSet: params.sourceManagementState.selectedSourceIDSet,
    onToggleSourceSelection: params.sourceManagementState.toggleSourceSelection,
    editSourceName: params.sourceManagementState.editSourceName,
    onSetEditSourceName: params.sourceManagementState.setEditSourceName,
    editSourceTags: params.sourceManagementState.editSourceTags,
    onSetEditSourceTags: params.sourceManagementState.setEditSourceTags,
    editSourcePollSec: params.sourceManagementState.editSourcePollSec,
    onSetEditSourcePollSec: params.sourceManagementState.setEditSourcePollSec,
    editSourceURL: params.sourceManagementState.editSourceURL,
    onSetEditSourceURL: params.sourceManagementState.setEditSourceURL,
    sourceTagList: params.sourceTagList,
    normalizeSourceKind: params.normalizeSourceKind,
    sourceClickCount: params.sourceClickCount,
    formatTimeAgo: params.formatTimeAgo,
    healthLabel: params.healthLabel,
    onSaveSourceEdit: params.sourceManagementActions.onSaveSourceEdit,
    onCancelEdit: params.sourceManagementState.onCancelEdit,
    onTestSource: params.sourceManagementActions.onTestSource,
    onRefreshSource: params.sourceManagementActions.onRefreshSource,
    onStartEdit: params.sourceManagementState.onStartEdit,
    onToggleSourceEnabled: params.sourceManagementActions.onToggleSourceEnabled,
    onToggleSiteMuted: params.toggleSiteMuted,
    mutedSiteSet: params.mutedSiteSet,
    onDeleteSource: params.sourceManagementActions.onDeleteSource,
    newSourceName: params.sourceManagementState.newSourceName,
    onSetNewSourceName: params.sourceManagementState.setNewSourceName,
    newSourceURL: params.sourceManagementState.newSourceURL,
    onSetNewSourceURL: params.sourceManagementState.setNewSourceURL,
    newSourceTags: params.sourceManagementState.newSourceTags,
    onSetNewSourceTags: params.sourceManagementState.setNewSourceTags,
    creatingSource: params.sourceManagementState.creatingSource,
    onCreateSource: params.sourceManagementActions.onCreateSource,
    batchSourceURLs: params.sourceManagementState.batchSourceURLs,
    onSetBatchSourceURLs: params.sourceManagementState.setBatchSourceURLs,
    batchSourceTags: params.sourceManagementState.batchSourceTags,
    onSetBatchSourceTags: params.sourceManagementState.setBatchSourceTags,
    batchCreatingSources: params.sourceManagementState.batchCreatingSources,
    onBatchCreateSources: params.sourceManagementActions.onBatchCreateSources,
    batchCreateResult: params.sourceManagementState.batchCreateResult,
    discoverURL: params.sourceManagementState.discoverURL,
    onSetDiscoverURL: params.sourceManagementState.setDiscoverURL,
    discoveringSources: params.sourceManagementState.discoveringSources,
    onDiscoverSources: params.sourceManagementActions.onDiscoverSources,
    discoveredSources: params.sourceManagementState.discoveredSources,
    confidenceLabel: params.confidenceLabel,
    onAddDiscoveredSource: params.sourceManagementActions.onAddDiscoveredSource,
  }
}
