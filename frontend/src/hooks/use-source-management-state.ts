import { useCallback, useMemo, useState } from 'react'
import type { DiscoverSourceCandidate, Source, SourceStatus } from '../types'

export type SourceHealthFilter = 'all' | SourceStatus['health']
export type SourceQuickView = 'all' | 'attention' | 'ai' | 'disabled' | 'thread' | 'active'
export type SourceSortKey = 'health' | 'name' | 'new_articles' | 'clicks' | 'last_fetched' | 'last_clicked' | 'ai_generated'
export type BulkSourceAction =
  | 'enable'
  | 'disable'
  | 'refresh'
  | 'test'
  | 'add_tags'
  | 'remove_tags'
  | 'set_poll'
  | 'enable_ai'
  | 'disable_ai'
export type BatchCreateResult = {
  success: string[]
  failed: Array<{ url: string; error: string }>
}

type UseSourceManagementStateParams = {
  sources: Source[]
  sourceStatusMap: Map<number, SourceStatus>
  sourceSiteKeyMap: Map<number, string>
  sourceTagList: (source: Pick<Source, 'tags'>) => string[]
  resolveSourceHealth: (
    source: Pick<Source, 'id' | 'enabled'>,
    statusMap: Map<number, SourceStatus>,
  ) => SourceStatus['health']
  sourceHealthPriority: (health: SourceStatus['health']) => number
}

export function useSourceManagementState(params: UseSourceManagementStateParams) {
  const {
    sources,
    sourceStatusMap,
    sourceSiteKeyMap,
    sourceTagList,
    resolveSourceHealth,
    sourceHealthPriority,
  } = params

  const [sourceManageKeyword, setSourceManageKeyword] = useState('')
  const [sourceManageTagFilter, setSourceManageTagFilter] = useState('')
  const [sourceManageHealthFilter, setSourceManageHealthFilter] = useState<SourceHealthFilter>('all')
  const [sourceManageQuickView, setSourceManageQuickView] = useState<SourceQuickView>('all')
  const [sourceManageSortKey, setSourceManageSortKey] = useState<SourceSortKey>('health')
  const [sourceManageSortDesc, setSourceManageSortDesc] = useState(true)
  const [selectedSourceIDsState, setSelectedSourceIDsState] = useState<number[]>([])
  const [bulkSourceAction, setBulkSourceAction] = useState<BulkSourceAction | null>(null)
  const [bulkTagInput, setBulkTagInput] = useState('')
  const [bulkPollSec, setBulkPollSec] = useState('1800')

  const [editingSourceID, setEditingSourceID] = useState<number | null>(null)
  const [editSourceName, setEditSourceName] = useState('')
  const [editSourceURL, setEditSourceURL] = useState('')
  const [editSourceTags, setEditSourceTags] = useState('')
  const [editSourcePollSec, setEditSourcePollSec] = useState('900')

  const [newSourceName, setNewSourceName] = useState('')
  const [newSourceURL, setNewSourceURL] = useState('')
  const [newSourceTags, setNewSourceTags] = useState('')
  const [batchSourceURLs, setBatchSourceURLs] = useState('')
  const [batchSourceTags, setBatchSourceTags] = useState('')
  const [batchCreatingSources, setBatchCreatingSources] = useState(false)
  const [batchCreateResult, setBatchCreateResult] = useState<BatchCreateResult | null>(null)
  const [discoverURL, setDiscoverURL] = useState('')
  const [discoveringSources, setDiscoveringSources] = useState(false)
  const [discoveredSources, setDiscoveredSources] = useState<DiscoverSourceCandidate[]>([])
  const [reclassifyingSources, setReclassifyingSources] = useState(false)
  const [creatingSource, setCreatingSource] = useState(false)
  const [exportingSources, setExportingSources] = useState(false)
  const [importingSources, setImportingSources] = useState(false)
  const [busySourceID, setBusySourceID] = useState<number | null>(null)

  const sourceHealthCounts = useMemo(() => {
    const counts: Record<SourceStatus['health'], number> = {
      ok: 0,
      warn: 0,
      error: 0,
      stale: 0,
      disabled: 0,
      new: 0,
    }
    for (const source of sources) {
      const health = resolveSourceHealth(source, sourceStatusMap)
      counts[health] += 1
    }
    return counts
  }, [resolveSourceHealth, sourceStatusMap, sources])

  const filteredSources = useMemo(() => {
    const normalizedKeyword = sourceManageKeyword.trim().toLowerCase()
    const filtered = sources.filter((source) => {
      if (sourceManageTagFilter && !sourceTagList(source).includes(sourceManageTagFilter)) {
        return false
      }

      const health = resolveSourceHealth(source, sourceStatusMap)
      if (sourceManageHealthFilter !== 'all' && health !== sourceManageHealthFilter) {
        return false
      }

      switch (sourceManageQuickView) {
        case 'attention':
          if (!(health === 'error' || health === 'warn' || health === 'stale')) {
            return false
          }
          break
        case 'ai':
          if (!source.ai_briefing_enabled) {
            return false
          }
          break
        case 'disabled':
          if (source.enabled) {
            return false
          }
          break
        case 'thread':
          if (source.kind !== 'thread') {
            return false
          }
          break
        case 'active':
          if ((source.new_articles_24h ?? 0) < 5) {
            return false
          }
          break
        default:
          break
      }

      if (!normalizedKeyword) {
        return true
      }

      const siteKey = sourceSiteKeyMap.get(source.id) ?? ''
      const haystack = `${source.name} ${source.rss_url} ${sourceTagList(source).join(' ')} ${siteKey}`.toLowerCase()
      return haystack.includes(normalizedKeyword)
    })

    filtered.sort((left, right) => {
      const leftHealth = resolveSourceHealth(left, sourceStatusMap)
      const rightHealth = resolveSourceHealth(right, sourceStatusMap)
      const compareNumber = (leftValue: number, rightValue: number) =>
        sourceManageSortDesc ? rightValue - leftValue : leftValue - rightValue
      const compareString = (leftValue: string, rightValue: string) =>
        sourceManageSortDesc ? rightValue.localeCompare(leftValue) : leftValue.localeCompare(rightValue)
      const compareTime = (leftValue?: string, rightValue?: string) =>
        compareNumber(Date.parse(leftValue ?? '') || 0, Date.parse(rightValue ?? '') || 0)

      switch (sourceManageSortKey) {
        case 'name': {
          const byName = compareString(left.name, right.name)
          if (byName !== 0) return byName
          break
        }
        case 'new_articles': {
          const byNew = compareNumber(left.new_articles_24h ?? 0, right.new_articles_24h ?? 0)
          if (byNew !== 0) return byNew
          break
        }
        case 'clicks': {
          const byClicks = compareNumber(left.click_count ?? 0, right.click_count ?? 0)
          if (byClicks !== 0) return byClicks
          break
        }
        case 'last_fetched': {
          const byFetched = compareTime(left.last_fetched_at, right.last_fetched_at)
          if (byFetched !== 0) return byFetched
          break
        }
        case 'last_clicked': {
          const byClicked = compareTime(left.last_clicked_at, right.last_clicked_at)
          if (byClicked !== 0) return byClicked
          break
        }
        case 'ai_generated': {
          const byGenerated = compareTime(left.ai_briefing_last_generated_at, right.ai_briefing_last_generated_at)
          if (byGenerated !== 0) return byGenerated
          break
        }
        default: {
          const healthGap =
            sourceHealthPriority(rightHealth) -
            sourceHealthPriority(leftHealth)
          if (healthGap !== 0) {
            return sourceManageSortDesc ? healthGap : -healthGap
          }
          break
        }
      }

      if (left.enabled !== right.enabled) {
        return left.enabled ? -1 : 1
      }
      return sourceManageSortDesc ? right.id - left.id : left.id - right.id
    })
    return filtered
  }, [
    resolveSourceHealth,
    sourceHealthPriority,
    sourceManageHealthFilter,
    sourceManageKeyword,
    sourceManageQuickView,
    sourceManageSortDesc,
    sourceManageSortKey,
    sourceManageTagFilter,
    sourceSiteKeyMap,
    sourceStatusMap,
    sourceTagList,
    sources,
  ])

  const validSourceIDSet = useMemo(() => new Set(sources.map((source) => source.id)), [sources])
  const selectedSourceIDs = useMemo(
    () => selectedSourceIDsState.filter((sourceID) => validSourceIDSet.has(sourceID)),
    [selectedSourceIDsState, validSourceIDSet],
  )
  const selectedSourceIDSet = useMemo(() => new Set(selectedSourceIDs), [selectedSourceIDs])
  const visibleSourceIDs = useMemo(() => filteredSources.map((source) => source.id), [filteredSources])
  const selectedVisibleCount = useMemo(
    () => visibleSourceIDs.filter((sourceID) => selectedSourceIDSet.has(sourceID)).length,
    [visibleSourceIDs, selectedSourceIDSet],
  )
  const allVisibleSelected = visibleSourceIDs.length > 0 && selectedVisibleCount === visibleSourceIDs.length
  const hasSelectedSources = selectedSourceIDs.length > 0

  const toggleSourceSelection = useCallback((sourceID: number) => {
    setSelectedSourceIDsState((previous) => {
      if (previous.includes(sourceID)) {
        return previous.filter((item) => item !== sourceID)
      }
      return [...previous, sourceID]
    })
  }, [])

  const toggleSelectAllVisibleSources = useCallback((nextSelected: boolean) => {
    setSelectedSourceIDsState((previous) => {
      const previousSet = new Set(previous)
      if (nextSelected) {
        for (const sourceID of visibleSourceIDs) {
          previousSet.add(sourceID)
        }
      } else {
        for (const sourceID of visibleSourceIDs) {
          previousSet.delete(sourceID)
        }
      }
      return Array.from(previousSet)
    })
  }, [visibleSourceIDs])

  const clearSourceManageFilters = useCallback(() => {
    setSourceManageKeyword('')
    setSourceManageTagFilter('')
    setSourceManageHealthFilter('all')
  }, [])

  const clearSelectedSourceIDs = useCallback(() => {
    setSelectedSourceIDsState([])
  }, [])

  const onStartEdit = useCallback(
    (source: Source) => {
      setEditingSourceID(source.id)
      setEditSourceName(source.name)
      setEditSourceURL(source.rss_url)
      setEditSourceTags(sourceTagList(source).join(', '))
      setEditSourcePollSec(String(source.poll_interval_sec))
    },
    [sourceTagList],
  )

  const onCancelEdit = useCallback(() => {
    setEditingSourceID(null)
    setEditSourceName('')
    setEditSourceURL('')
    setEditSourceTags('')
    setEditSourcePollSec('900')
  }, [])

  return {
    sourceManageKeyword,
    setSourceManageKeyword,
    sourceManageTagFilter,
    setSourceManageTagFilter,
    sourceManageHealthFilter,
    setSourceManageHealthFilter,
    sourceManageQuickView,
    setSourceManageQuickView,
    sourceManageSortKey,
    setSourceManageSortKey,
    sourceManageSortDesc,
    setSourceManageSortDesc,
    sourceHealthCounts,
    filteredSources,
    selectedSourceIDs,
    selectedSourceIDSet,
    visibleSourceIDs,
    selectedVisibleCount,
    allVisibleSelected,
    hasSelectedSources,
    bulkSourceAction,
    setBulkSourceAction,
    bulkTagInput,
    setBulkTagInput,
    bulkPollSec,
    setBulkPollSec,
    editingSourceID,
    editSourceName,
    setEditSourceName,
    editSourceURL,
    setEditSourceURL,
    editSourceTags,
    setEditSourceTags,
    editSourcePollSec,
    setEditSourcePollSec,
    onStartEdit,
    onCancelEdit,
    toggleSourceSelection,
    toggleSelectAllVisibleSources,
    clearSourceManageFilters,
    clearSelectedSourceIDs,
    newSourceName,
    setNewSourceName,
    newSourceURL,
    setNewSourceURL,
    newSourceTags,
    setNewSourceTags,
    batchSourceURLs,
    setBatchSourceURLs,
    batchSourceTags,
    setBatchSourceTags,
    batchCreatingSources,
    setBatchCreatingSources,
    batchCreateResult,
    setBatchCreateResult,
    discoverURL,
    setDiscoverURL,
    discoveringSources,
    setDiscoveringSources,
    discoveredSources,
    setDiscoveredSources,
    reclassifyingSources,
    setReclassifyingSources,
    creatingSource,
    setCreatingSource,
    exportingSources,
    setExportingSources,
    importingSources,
    setImportingSources,
    busySourceID,
    setBusySourceID,
  }
}
