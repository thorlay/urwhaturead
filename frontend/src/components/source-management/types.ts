import type { FormEvent, RefObject } from 'react'
import type {
  BatchCreateResult,
  BulkSourceAction,
  SourceHealthFilter,
  SourceQuickView,
  SourceSortKey,
} from '../../hooks/use-source-management-state'
import type { DiscoverSourceCandidate, Source, SourceStatus } from '../../types'

export type SourceManagementPanelController = {
  aiModel: string
  aiModelOptions: string[]
  showManageModelPicker: boolean
  onToggleManageModelPicker: () => void
  onChangeAIModel: (nextModel: string) => void
  sources: Source[]
  enabledSourceCount: number
  unhealthySourceCount: number
  mutedSiteKeys: string[]
  sourceHealthCounts: Record<SourceStatus['health'], number>
  healthToneClass: (health: SourceStatus['health']) => string
  loadingStatus: boolean
  onLoadStatus: () => Promise<void>
  reclassifyingSources: boolean
  onReclassifySources: () => Promise<void>
  sourceManageKeyword: string
  onSetSourceManageKeyword: (value: string) => void
  sourceManageTagFilter: string
  onSetSourceManageTagFilter: (value: string) => void
  sourceManageHealthFilter: SourceHealthFilter
  onSetSourceManageHealthFilter: (value: SourceHealthFilter) => void
  sourceManageQuickView: SourceQuickView
  onSetSourceManageQuickView: (value: SourceQuickView) => void
  sourceManageSortKey: SourceSortKey
  onSetSourceManageSortKey: (value: SourceSortKey) => void
  sourceManageSortDesc: boolean
  onSetSourceManageSortDesc: (value: boolean) => void
  availableTags: string[]
  onClearSourceManageFilters: () => void
  loadingSources: boolean
  onLoadSources: () => Promise<void>
  selectedSourceIDs: number[]
  visibleSourceIDs: number[]
  bulkTagInput: string
  onSetBulkTagInput: (value: string) => void
  bulkPollSec: string
  onSetBulkPollSec: (value: string) => void
  bulkSourceAction: BulkSourceAction | null
  hasSelectedSources: boolean
  onRunBulkTagAction: (action: 'add' | 'remove') => Promise<void>
  onRunBulkPollIntervalUpdate: () => Promise<void>
  onRunBulkAIBriefingAction: (enabled: boolean, intervalMin?: number) => Promise<void>
  onRunBulkSourceAction: (action: 'enable' | 'disable' | 'refresh' | 'test') => Promise<void>
  onClearSelectedSourceIDs: () => void
  sourcesError: string | null
  statusError: string | null
  sourceSelectAllRef: RefObject<HTMLInputElement | null>
  allVisibleSelected: boolean
  onToggleSelectAllVisibleSources: (nextSelected: boolean) => void
  filteredSources: Source[]
  sourceStatusMap: Map<number, SourceStatus>
  resolveSourceHealth: (
    source: Pick<Source, 'id' | 'enabled'>,
    statusMap: Map<number, SourceStatus>,
  ) => SourceStatus['health']
  sourceSiteKeyMap: Map<number, string>
  resolveSourceSiteKey: (source: Pick<Source, 'site_key' | 'rss_url'>) => string
  busySourceID: number | null
  editingSourceID: number | null
  selectedSourceIDSet: Set<number>
  onToggleSourceSelection: (sourceID: number) => void
  editSourceName: string
  onSetEditSourceName: (value: string) => void
  editSourceTags: string
  onSetEditSourceTags: (value: string) => void
  editSourcePollSec: string
  onSetEditSourcePollSec: (value: string) => void
  editSourceURL: string
  onSetEditSourceURL: (value: string) => void
  sourceTagList: (source: Pick<Source, 'tags'>) => string[]
  normalizeSourceKind: (kind?: string) => 'feed' | 'thread'
  sourceClickCount: (source: Pick<Source, 'click_count'>) => number
  formatTimeAgo: (input: string) => string
  healthLabel: (health: SourceStatus['health']) => string
  onSaveSourceEdit: (sourceID: number) => Promise<void>
  onCancelEdit: () => void
  onTestSource: (sourceID: number) => Promise<void>
  onRefreshSource: (sourceID: number) => Promise<void>
  onStartEdit: (source: Source) => void
  onToggleSourceEnabled: (source: Source) => Promise<void>
  onToggleSiteMuted: (siteKey: string) => void
  mutedSiteSet: Set<string>
  onDeleteSource: (source: Source) => Promise<void>
  newSourceName: string
  onSetNewSourceName: (value: string) => void
  newSourceURL: string
  onSetNewSourceURL: (value: string) => void
  newSourceTags: string
  onSetNewSourceTags: (value: string) => void
  creatingSource: boolean
  onCreateSource: (event: FormEvent<HTMLFormElement>) => Promise<void>
  exportingSources: boolean
  importingSources: boolean
  onExportSources: () => Promise<void>
  onImportSourcesFile: (file: File) => Promise<void>
  batchSourceURLs: string
  onSetBatchSourceURLs: (value: string) => void
  batchSourceTags: string
  onSetBatchSourceTags: (value: string) => void
  batchCreatingSources: boolean
  onBatchCreateSources: (event: FormEvent<HTMLFormElement>) => Promise<void>
  batchCreateResult: BatchCreateResult | null
  discoverURL: string
  onSetDiscoverURL: (value: string) => void
  discoveringSources: boolean
  onDiscoverSources: (event: FormEvent<HTMLFormElement>) => Promise<void>
  discoveredSources: DiscoverSourceCandidate[]
  confidenceLabel: (confidence: DiscoverSourceCandidate['confidence']) => string
  onAddDiscoveredSource: (candidate: DiscoverSourceCandidate) => Promise<void>
}
