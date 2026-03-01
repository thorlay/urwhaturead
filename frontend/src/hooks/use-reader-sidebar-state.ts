import { useMemo, useState } from 'react'
import type { Source } from '../types'
import type { AppliedSourceGroupFilter, SidebarTagFilterMode, SourceGroup } from '../lib/app-domain'
import { compareSourcesByClicksDesc, compareTrackedSourcesByActivityDesc, normalizeSourceKind, sourceClickCount } from '../lib/app-utils'

const trackedSidebarPreviewLimit = 10
const sidebarTagCollapseCount = 8

type UseReaderSidebarStateParams = {
  sources: Source[]
  sourceTagList: (source: Pick<Source, 'tags'>) => string[]
}

export function useReaderSidebarState(params: UseReaderSidebarStateParams) {
  const { sources, sourceTagList } = params

  const [sourceGroupFilter, setSourceGroupFilter] = useState<AppliedSourceGroupFilter | null>(null)
  const [sidebarTagFilters, setSidebarTagFilters] = useState<string[]>([])
  const [sidebarTagFilterMode, setSidebarTagFilterMode] = useState<SidebarTagFilterMode>('or')
  const [showAllSidebarTags, setShowAllSidebarTags] = useState(false)
  const [showSubscriptionSidebar, setShowSubscriptionSidebar] = useState(() => {
    if (typeof window === 'undefined') return true
    return !window.matchMedia('(max-width: 980px)').matches
  })
  const [showTrackedSidebar, setShowTrackedSidebar] = useState(false)
  const [showAllTrackedSidebar, setShowAllTrackedSidebar] = useState(false)

  const readerFeedSources = useMemo(
    () =>
      sources
        .filter((source) => normalizeSourceKind(source.kind) === 'feed' && !source.hidden_in_sidebar)
        .sort(compareSourcesByClicksDesc),
    [sources],
  )

  const readerTrackedSources = useMemo(
    () =>
      sources
        .filter((source) => normalizeSourceKind(source.kind) === 'thread' && !source.hidden_in_sidebar)
        .sort(compareTrackedSourcesByActivityDesc),
    [sources],
  )

  const readerSources = useMemo(() => [...readerFeedSources, ...readerTrackedSources], [readerFeedSources, readerTrackedSources])

  const effectiveShowAllTrackedSidebar = showTrackedSidebar && readerTrackedSources.length > trackedSidebarPreviewLimit && showAllTrackedSidebar

  const visibleTrackedSidebarSources = useMemo(
    () => (effectiveShowAllTrackedSidebar ? readerTrackedSources : readerTrackedSources.slice(0, trackedSidebarPreviewLimit)),
    [effectiveShowAllTrackedSidebar, readerTrackedSources],
  )

  const hasMoreTrackedSidebarSources = readerTrackedSources.length > trackedSidebarPreviewLimit

  const sourceGroups = useMemo<SourceGroup[]>(() => {
    const groupMap = new Map<string, SourceGroup>()
    for (const source of readerFeedSources) {
      for (const label of sourceTagList(source)) {
        const key = label.toLowerCase()
        const bucket = groupMap.get(key)
        if (bucket) {
          bucket.sources.push(source)
          bucket.clickTotal += sourceClickCount(source)
        } else {
          groupMap.set(key, {
            key,
            label,
            clickTotal: sourceClickCount(source),
            sources: [source],
          })
        }
      }
    }

    const groups = Array.from(groupMap.values()).map((group) => ({
      ...group,
      sources: [...group.sources].sort(compareSourcesByClicksDesc),
    }))
    groups.sort((a, b) => {
      if (a.clickTotal !== b.clickTotal) {
        return b.clickTotal - a.clickTotal
      }
      return a.label.localeCompare(b.label)
    })
    return groups
  }, [readerFeedSources, sourceTagList])

  const sidebarTagFilterSet = useMemo(() => new Set(sidebarTagFilters), [sidebarTagFilters])

  const sidebarVisibleFeedSources = useMemo(() => {
    if (sidebarTagFilterSet.size === 0) {
      return readerFeedSources
    }
    return readerFeedSources.filter((source) => {
      const tagSet = new Set(sourceTagList(source).map((tag) => tag.toLowerCase()))
      if (sidebarTagFilterMode === 'and') {
        return sidebarTagFilters.every((tag) => tagSet.has(tag))
      }
      return sidebarTagFilters.some((tag) => tagSet.has(tag))
    })
  }, [readerFeedSources, sidebarTagFilterMode, sidebarTagFilterSet, sidebarTagFilters, sourceTagList])

  const effectiveShowAllSidebarTags =
    sidebarTagFilters.length > 0 ? true : sourceGroups.length > sidebarTagCollapseCount ? showAllSidebarTags : false

  return {
    sourceGroupFilter,
    setSourceGroupFilter,
    sidebarTagFilters,
    setSidebarTagFilters,
    sidebarTagFilterMode,
    setSidebarTagFilterMode,
    showAllSidebarTags: effectiveShowAllSidebarTags,
    setShowAllSidebarTags,
    showSubscriptionSidebar,
    setShowSubscriptionSidebar,
    showTrackedSidebar,
    setShowTrackedSidebar,
    showAllTrackedSidebar: effectiveShowAllTrackedSidebar,
    setShowAllTrackedSidebar,
    readerFeedSources,
    readerTrackedSources,
    readerSources,
    visibleTrackedSidebarSources,
    hasMoreTrackedSidebarSources,
    sourceGroups,
    sidebarTagFilterSet,
    sidebarVisibleFeedSources,
  }
}

export type ReaderSidebarState = ReturnType<typeof useReaderSidebarState>
