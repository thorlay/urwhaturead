import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Notice } from '../lib/app-domain'
import type { ArticleDetail, Source } from '../types'
import { useSourceManagementActions } from './use-source-management-actions'
import type { useSourceManagementState } from './use-source-management-state'

type FeedLoadOverrides = {
  tag?: string
  sourceID?: string
  keyword?: string
  cursor?: string
}

type UseSourceManagementFeatureParams = {
  sourceManagementState: ReturnType<typeof useSourceManagementState>
  sourceFilter: string
  sourceProfileSource: Source | null
  sourceProfileTags: string[]
  pendingDeleteSource: Source | null
  sourceByID: Map<number, Source>
  setNotice: Dispatch<SetStateAction<Notice | null>>
  setSources: Dispatch<SetStateAction<Source[]>>
  setSourceProfileSource: Dispatch<SetStateAction<Source | null>>
  setSourceProfileTagInput: Dispatch<SetStateAction<string>>
  closeSourceContextMenu: () => void
  selectedArticle: ArticleDetail | null
  setSelectedArticle: Dispatch<SetStateAction<ArticleDetail | null>>
  setSelectedArticleID: Dispatch<SetStateAction<number | null>>
  setPendingDeleteSource: Dispatch<SetStateAction<Source | null>>
  setSourceFilter: Dispatch<SetStateAction<string>>
  setSourceGroupFilter: Dispatch<SetStateAction<{ key: string; label: string } | null>>
  setSidebarTagFilters: Dispatch<SetStateAction<string[]>>
  loadSources: () => Promise<void>
  loadFeed: (append?: boolean, overrides?: FeedLoadOverrides) => Promise<void>
  refreshStatusIfVisible: () => Promise<void>
  parseSourceTagInput: (input: string) => string[]
  parseRSSLines: (input: string) => string[]
  parseSourceIDFilter: (input: string) => number[]
  normalizeSourceTags: (values?: string[]) => string[]
  sourceTagList: (source: Pick<Source, 'tags'>) => string[]
  equalStringList: (left: string[], right: string[]) => boolean
  bulkActionLabel: (
    action:
      | 'enable'
      | 'disable'
      | 'refresh'
      | 'test'
      | 'add_tags'
      | 'remove_tags'
      | 'set_poll'
      | 'enable_ai'
      | 'disable_ai',
  ) => string
  toErrorMessage: (error: unknown) => string
}

export function useSourceManagementFeature({
  sourceManagementState,
  sourceFilter,
  sourceProfileSource,
  sourceProfileTags,
  pendingDeleteSource,
  sourceByID,
  setNotice,
  setSources,
  setSourceProfileSource,
  setSourceProfileTagInput,
  closeSourceContextMenu,
  selectedArticle,
  setSelectedArticle,
  setSelectedArticleID,
  setPendingDeleteSource,
  setSourceFilter,
  setSourceGroupFilter,
  setSidebarTagFilters,
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
}: UseSourceManagementFeatureParams) {
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
      closeSourceContextMenu()
    },
    [
      closeSourceContextMenu,
      pendingDeleteSource,
      selectedArticle,
      setPendingDeleteSource,
      setSelectedArticle,
      setSelectedArticleID,
      setSidebarTagFilters,
      setSourceFilter,
      setSourceGroupFilter,
      setSourceProfileSource,
      sourceProfileSource,
    ],
  )

  return useSourceManagementActions({
    newSourceName: sourceManagementState.newSourceName,
    newSourceURL: sourceManagementState.newSourceURL,
    newSourceTags: sourceManagementState.newSourceTags,
    batchSourceURLs: sourceManagementState.batchSourceURLs,
    batchSourceTags: sourceManagementState.batchSourceTags,
    discoverURL: sourceManagementState.discoverURL,
    editSourceName: sourceManagementState.editSourceName,
    editSourceURL: sourceManagementState.editSourceURL,
    editSourceTags: sourceManagementState.editSourceTags,
    editSourcePollSec: sourceManagementState.editSourcePollSec,
    sourceFilter,
    editingSourceID: sourceManagementState.editingSourceID,
    selectedSourceIDs: sourceManagementState.selectedSourceIDs,
    bulkTagInput: sourceManagementState.bulkTagInput,
    bulkPollSec: sourceManagementState.bulkPollSec,
    sourceProfileSource,
    sourceProfileTags,
    pendingDeleteSource,
    sourceByID,
    setNotice,
    setCreatingSource: sourceManagementState.setCreatingSource,
    setNewSourceName: sourceManagementState.setNewSourceName,
    setNewSourceURL: sourceManagementState.setNewSourceURL,
    setNewSourceTags: sourceManagementState.setNewSourceTags,
    setBatchCreatingSources: sourceManagementState.setBatchCreatingSources,
    setBatchCreateResult: sourceManagementState.setBatchCreateResult,
    setDiscoveringSources: sourceManagementState.setDiscoveringSources,
    setDiscoveredSources: sourceManagementState.setDiscoveredSources,
    setBusySourceID: sourceManagementState.setBusySourceID,
    setReclassifyingSources: sourceManagementState.setReclassifyingSources,
    setExportingSources: sourceManagementState.setExportingSources,
    setImportingSources: sourceManagementState.setImportingSources,
    setBulkSourceAction: sourceManagementState.setBulkSourceAction,
    setSources,
    setSourceProfileSource,
    setSourceProfileTagInput,
    clearSourceContextMenu: closeSourceContextMenu,
    onCancelEdit: sourceManagementState.onCancelEdit,
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
}
