import { useCallback, useMemo, useState } from 'react'
import type { DiscoverSourceCandidate, Source, SourceStatus } from '../types'

export type SourceHealthFilter = 'all' | SourceStatus['health']
export type BulkSourceAction = 'enable' | 'disable' | 'refresh' | 'test' | 'add_tags' | 'remove_tags'
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
  const [selectedSourceIDsState, setSelectedSourceIDsState] = useState<number[]>([])
  const [bulkSourceAction, setBulkSourceAction] = useState<BulkSourceAction | null>(null)
  const [bulkTagInput, setBulkTagInput] = useState('')

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

      if (!normalizedKeyword) {
        return true
      }

      const siteKey = sourceSiteKeyMap.get(source.id) ?? ''
      const haystack = `${source.name} ${source.rss_url} ${sourceTagList(source).join(' ')} ${siteKey}`.toLowerCase()
      return haystack.includes(normalizedKeyword)
    })

    filtered.sort((left, right) => {
      const healthGap =
        sourceHealthPriority(resolveSourceHealth(right, sourceStatusMap)) -
        sourceHealthPriority(resolveSourceHealth(left, sourceStatusMap))
      if (healthGap !== 0) {
        return healthGap
      }
      if (left.enabled !== right.enabled) {
        return left.enabled ? -1 : 1
      }
      return right.id - left.id
    })
    return filtered
  }, [
    resolveSourceHealth,
    sourceHealthPriority,
    sourceManageHealthFilter,
    sourceManageKeyword,
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
    busySourceID,
    setBusySourceID,
  }
}
