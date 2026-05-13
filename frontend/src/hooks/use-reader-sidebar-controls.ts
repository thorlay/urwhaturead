import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { AppliedSourceGroupFilter, SidebarTagFilterMode } from '../lib/app-domain'
import type { ArticleDetail, Source } from '../types'

type FeedLoadOverrides = Partial<{ tag: string; sourceID: string; keyword: string; cursor: string }>

type UseReaderSidebarControlsParams = {
  cancelSidebarTagFeedReload: () => void
  resetFeedBriefingState: () => void
  sidebarState: {
    setSourceGroupFilter: Dispatch<SetStateAction<AppliedSourceGroupFilter | null>>
    setSidebarTagFilters: Dispatch<SetStateAction<string[]>>
    setShowSubscriptionSidebar: Dispatch<SetStateAction<boolean>>
    sidebarTagFilterMode: SidebarTagFilterMode
    setSidebarTagFilterMode: Dispatch<SetStateAction<SidebarTagFilterMode>>
    readerFeedSources: Source[]
    sourceGroups: Array<{ key: string; label: string }>
    sidebarTagFilters: string[]
    sidebarTagFilterSet: Set<string>
  }
  setSourceFilter: Dispatch<SetStateAction<string>>
  setSelectedArticle: Dispatch<SetStateAction<ArticleDetail | null>>
  setSelectedArticleID: Dispatch<SetStateAction<number | null>>
  setFeedCursor: Dispatch<SetStateAction<string>>
  loadFeed: (append?: boolean, overrides?: FeedLoadOverrides) => Promise<void>
  sidebarSourceItemRefs: MutableRefObject<Map<number, HTMLDivElement>>
  sourceTagList: (source: Pick<Source, 'tags'>) => string[]
  closeSourceContextMenu: () => void
  setSourceProfileSource: Dispatch<SetStateAction<Source | null>>
  setSourceProfileTagPickerOpen: Dispatch<SetStateAction<boolean>>
  setSourceProfileTagInput: Dispatch<SetStateAction<string>>
  setPendingDeleteSource: Dispatch<SetStateAction<Source | null>>
}

export function useReaderSidebarControls({
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
}: UseReaderSidebarControlsParams) {
  const {
    setSourceGroupFilter,
    setSidebarTagFilters,
    setShowSubscriptionSidebar,
    sidebarTagFilterMode,
    setSidebarTagFilterMode,
    readerFeedSources,
    sourceGroups,
    sidebarTagFilters,
    sidebarTagFilterSet,
  } = sidebarState

  const applySourceFilterFromSidebar = useCallback((sourceID: string, options?: { preserveSidebarTags?: boolean }) => {
    cancelSidebarTagFeedReload()
    resetFeedBriefingState()
    const preserveSidebarTags = options?.preserveSidebarTags ?? false
    setSourceGroupFilter(null)
    if (!preserveSidebarTags) {
      setSidebarTagFilters([])
    }
    setSourceFilter(sourceID)
    setSelectedArticle(null)
    setSelectedArticleID(null)
    setFeedCursor('')
    void loadFeed(false, { sourceID })
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 980px)').matches) {
      setShowSubscriptionSidebar(false)
    }
  }, [
    cancelSidebarTagFeedReload,
    loadFeed,
    resetFeedBriefingState,
    setFeedCursor,
    setSelectedArticle,
    setSelectedArticleID,
    setShowSubscriptionSidebar,
    setSidebarTagFilters,
    setSourceFilter,
    setSourceGroupFilter,
  ])

  const registerSidebarSourceItemRef = useCallback((sourceID: number, node: HTMLDivElement | null) => {
    if (!node) {
      sidebarSourceItemRefs.current.delete(sourceID)
      return
    }
    sidebarSourceItemRefs.current.set(sourceID, node)
  }, [sidebarSourceItemRefs])

  const applySidebarTagFilters = useCallback((nextKeys: string[], mode: SidebarTagFilterMode = sidebarTagFilterMode) => {
    resetFeedBriefingState()
    const normalized = Array.from(
      new Set(
        nextKeys
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
      ),
    ).sort()

    setSidebarTagFilters(normalized)
    setSidebarTagFilterMode(mode)

    if (normalized.length === 0) {
      setSourceGroupFilter(null)
      setSourceFilter('')
      setFeedCursor('')
      void loadFeed(false, { sourceID: '' })
      return
    }

    const sourceIDs = readerFeedSources
      .filter((source) => {
        const tagSet = new Set(sourceTagList(source).map((tag) => tag.toLowerCase()))
        if (mode === 'and') {
          return normalized.every((tag) => tagSet.has(tag))
        }
        return normalized.some((tag) => tagSet.has(tag))
      })
      .map((source) => source.id)
      .sort((left, right) => left - right)
    const sourceIDValue = sourceIDs.length > 0 ? sourceIDs.join(',') : '0'
    const labels = normalized.map((key) => sourceGroups.find((group) => group.key === key)?.label ?? key)
    const modeLabel = mode === 'and' ? '全部' : '任一'
    const label = labels.length === 1 ? `${labels[0]} (${modeLabel})` : `${modeLabel}: ${labels[0]} +${labels.length - 1}`

    setSourceGroupFilter({
      key: `tags:${mode}:${normalized.join(',')}`,
      label,
      kind: 'tag',
    })
    setSourceFilter(sourceIDValue)
    setFeedCursor('')
    void loadFeed(false, { sourceID: sourceIDValue, cursor: '' })
  }, [
    readerFeedSources,
    resetFeedBriefingState,
    loadFeed,
    setFeedCursor,
    setSidebarTagFilterMode,
    setSidebarTagFilters,
    setSourceFilter,
    setSourceGroupFilter,
    sidebarTagFilterMode,
    sourceGroups,
    sourceTagList,
  ])

  const applySourceGroupFilterFromSidebar = useCallback((group: { key: string; label: string; sourceIDs: number[] }) => {
    cancelSidebarTagFeedReload()
    resetFeedBriefingState()
    const sourceIDValue = group.sourceIDs.length > 0 ? [...group.sourceIDs].sort((left, right) => left - right).join(',') : '0'
    setSourceGroupFilter({
      key: group.key,
      label: group.label,
      kind: 'site',
    })
    setSourceFilter(sourceIDValue)
    setSelectedArticle(null)
    setSelectedArticleID(null)
    setFeedCursor('')
    void loadFeed(false, { sourceID: sourceIDValue, cursor: '' })
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 980px)').matches) {
      setShowSubscriptionSidebar(false)
    }
  }, [
    cancelSidebarTagFeedReload,
    loadFeed,
    resetFeedBriefingState,
    setFeedCursor,
    setSelectedArticle,
    setSelectedArticleID,
    setShowSubscriptionSidebar,
    setSourceFilter,
    setSourceGroupFilter,
  ])

  const toggleSidebarTagFilter = useCallback((tagKey: string) => {
    if (sidebarTagFilterSet.has(tagKey)) {
      applySidebarTagFilters(sidebarTagFilters.filter((item) => item !== tagKey))
      return
    }
    applySidebarTagFilters([...sidebarTagFilters, tagKey])
  }, [applySidebarTagFilters, sidebarTagFilterSet, sidebarTagFilters])

  const switchSidebarTagFilterMode = useCallback((mode: SidebarTagFilterMode) => {
    if (mode === sidebarTagFilterMode) {
      return
    }
    if (sidebarTagFilters.length === 0) {
      setSidebarTagFilterMode(mode)
      return
    }
    applySidebarTagFilters(sidebarTagFilters, mode)
  }, [applySidebarTagFilters, setSidebarTagFilterMode, sidebarTagFilterMode, sidebarTagFilters])

  const openSourceProfile = useCallback((source: Source) => {
    setSourceProfileSource(source)
    setSourceProfileTagPickerOpen(false)
    setSourceProfileTagInput('')
    closeSourceContextMenu()
  }, [closeSourceContextMenu, setSourceProfileSource, setSourceProfileTagInput, setSourceProfileTagPickerOpen])

  const openDeleteSourceConfirm = useCallback((source: Source) => {
    setPendingDeleteSource(source)
    closeSourceContextMenu()
  }, [closeSourceContextMenu, setPendingDeleteSource])

  return {
    applySourceFilterFromSidebar,
    applySourceGroupFilterFromSidebar,
    registerSidebarSourceItemRef,
    applySidebarTagFilters,
    toggleSidebarTagFilter,
    switchSidebarTagFilterMode,
    openSourceProfile,
    openDeleteSourceConfirm,
  }
}
