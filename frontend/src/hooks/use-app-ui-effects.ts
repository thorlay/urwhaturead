import { useEffect, useLayoutEffect, type MutableRefObject, type RefObject } from 'react'
import type { AppliedSourceGroupFilter, AppTab, SidebarTagFilterMode } from '../lib/app-domain'
import type { Source, SourceStatus } from '../types'

type SourceGroup = {
  key: string
}

type UseAppUIEffectsParams = {
  activeTab: AppTab
  sourceStatus: SourceStatus[]
  loadingStatus: boolean
  loadStatus: () => Promise<void>
  sourceSiteKeyMap: Map<number, string>
  setMutedSiteKeys: (updater: (previous: string[]) => string[]) => void
  sidebarState: {
    sourceGroups: SourceGroup[]
    sidebarTagFilters: string[]
    sidebarTagFilterMode: SidebarTagFilterMode
    sourceGroupFilter: AppliedSourceGroupFilter | null
    setSourceGroupFilter: (value: AppliedSourceGroupFilter | null) => void
    readerSources: Source[]
    showSubscriptionSidebar: boolean
    sidebarVisibleFeedSources: Source[]
  }
  applySidebarTagFilters: (keys: string[], mode?: SidebarTagFilterMode) => void
  setSourceFilter: (value: string) => void
  loadFeed: (append?: boolean, overrides?: Partial<{ tag: string; sourceID: string; keyword: string; cursor: string }>) => Promise<void>
  sourceFilter: string
  parseSourceIDFilter: (value: string) => number[]
  sourceSelectAllRef: RefObject<HTMLInputElement | null>
  selectedVisibleCount: number
  allVisibleSelected: boolean
  showFeedAIMoreMenu: boolean
  feedAIMoreRef: RefObject<HTMLDivElement | null>
  setShowFeedAIMoreMenu: (show: boolean) => void
  previousSidebarSourceItemRectsRef: MutableRefObject<Map<number, DOMRect>>
  previousSidebarSourceIDsRef: MutableRefObject<number[]>
  sidebarSourceItemRefs: MutableRefObject<Map<number, HTMLDivElement>>
  closeSourceContextMenu: () => void
  setPendingDeleteSource: (source: Source | null) => void
  setShowManageModelPicker: (show: boolean) => void
  showManageModelPicker: boolean
  sourceProfileSource: Source | null
  sourceByID: Map<number, Source>
  setSourceProfileSource: (source: Source | null) => void
  setSourceProfileTagPickerOpen: (open: boolean) => void
  setSourceProfileTagInput: (value: string) => void
  pendingDeleteSource: Source | null
}

export function useAppUIEffects({
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
  selectedVisibleCount,
  allVisibleSelected,
  showFeedAIMoreMenu,
  feedAIMoreRef,
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
}: UseAppUIEffectsParams) {
  const {
    sourceGroups,
    sidebarTagFilters,
    sidebarTagFilterMode,
    sourceGroupFilter,
    setSourceGroupFilter,
    readerSources,
    showSubscriptionSidebar,
    sidebarVisibleFeedSources,
  } = sidebarState

  useEffect(() => {
    if (activeTab === 'sources' && sourceStatus.length === 0 && !loadingStatus) {
      void loadStatus()
    }
  }, [activeTab, loadStatus, loadingStatus, sourceStatus.length])

  useEffect(() => {
    const validSiteKeys = new Set(sourceSiteKeyMap.values())
    setMutedSiteKeys((previous) => previous.filter((siteKey) => validSiteKeys.has(siteKey)))
  }, [setMutedSiteKeys, sourceSiteKeyMap])

  useEffect(() => {
    const validTagKeys = new Set(sourceGroups.map((group) => group.key))
    const nextTagFilters = sidebarTagFilters.filter((key) => validTagKeys.has(key))
    if (nextTagFilters.length === sidebarTagFilters.length) {
      return
    }
    applySidebarTagFilters(nextTagFilters, sidebarTagFilterMode)
  }, [applySidebarTagFilters, sidebarTagFilterMode, sidebarTagFilters, sourceGroups])

  useEffect(() => {
    if (!sourceGroupFilter) return
    if (sourceGroupFilter.key.startsWith('tags:')) return
    if (sourceGroupFilter.key.startsWith('site:')) return
    const exists = sourceGroups.some((group) => group.key === sourceGroupFilter.key)
    if (exists) return
    setSourceGroupFilter(null)
    setSourceFilter('')
    void loadFeed(false, { sourceID: '' })
  }, [loadFeed, setSourceFilter, setSourceGroupFilter, sourceGroupFilter, sourceGroups])

  useEffect(() => {
    if (!sourceFilter.trim()) return
    const validSourceIDs = new Set(readerSources.map((source) => source.id))
    const selectedIDs = parseSourceIDFilter(sourceFilter)
    if (selectedIDs.length === 0) return
    const allValid = selectedIDs.every((sourceID) => validSourceIDs.has(sourceID))
    if (allValid) return
    setSourceGroupFilter(null)
    setSourceFilter('')
    void loadFeed(false, { sourceID: '' })
  }, [loadFeed, parseSourceIDFilter, readerSources, setSourceFilter, setSourceGroupFilter, sourceFilter])

  useEffect(() => {
    const input = sourceSelectAllRef.current
    if (!input) return
    input.indeterminate = selectedVisibleCount > 0 && !allVisibleSelected
  }, [allVisibleSelected, selectedVisibleCount, sourceSelectAllRef])

  useEffect(() => {
    if (!showFeedAIMoreMenu) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (target && feedAIMoreRef.current?.contains(target)) {
        return
      }
      setShowFeedAIMoreMenu(false)
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setShowFeedAIMoreMenu(false)
      }
    }

    function handleScroll() {
      setShowFeedAIMoreMenu(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [feedAIMoreRef, setShowFeedAIMoreMenu, showFeedAIMoreMenu])

  useEffect(() => {
    if (activeTab !== 'reader' && showFeedAIMoreMenu) {
      setShowFeedAIMoreMenu(false)
    }
  }, [activeTab, setShowFeedAIMoreMenu, showFeedAIMoreMenu])

  useLayoutEffect(() => {
    if (activeTab !== 'reader' || !showSubscriptionSidebar) {
      previousSidebarSourceItemRectsRef.current = new Map()
      previousSidebarSourceIDsRef.current = []
      return
    }

    const reduceMotion =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const nextIDs = sidebarVisibleFeedSources.map((source) => source.id)
    const nextRects = new Map<number, DOMRect>()

    for (const sourceID of nextIDs) {
      const node = sidebarSourceItemRefs.current.get(sourceID)
      if (!node) continue
      nextRects.set(sourceID, node.getBoundingClientRect())
    }

    if (!reduceMotion) {
      const previousRects = previousSidebarSourceItemRectsRef.current
      const previousIDs = previousSidebarSourceIDsRef.current

      for (const sourceID of nextIDs) {
        const node = sidebarSourceItemRefs.current.get(sourceID)
        if (!node) continue

        const previousRect = previousRects.get(sourceID)
        const nextRect = nextRects.get(sourceID)
        if (previousRect && nextRect) {
          const deltaY = previousRect.top - nextRect.top
          if (Math.abs(deltaY) > 1) {
            node.animate([{ transform: `translateY(${deltaY}px)` }, { transform: 'translateY(0)' }], {
              duration: 170,
              easing: 'cubic-bezier(.2,.8,.2,1)',
            })
          }
          continue
        }

        if (previousIDs.length > 0) {
          node.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], {
            duration: 150,
            easing: 'ease-out',
          })
        }
      }
    }

    previousSidebarSourceItemRectsRef.current = nextRects
    previousSidebarSourceIDsRef.current = nextIDs
  }, [
    activeTab,
    previousSidebarSourceIDsRef,
    previousSidebarSourceItemRectsRef,
    sidebarSourceItemRefs,
    showSubscriptionSidebar,
    sidebarVisibleFeedSources,
  ])

  useEffect(() => {
    if (activeTab === 'reader' && showSubscriptionSidebar) return
    closeSourceContextMenu()
    setPendingDeleteSource(null)
  }, [activeTab, closeSourceContextMenu, setPendingDeleteSource, showSubscriptionSidebar])

  useEffect(() => {
    if (activeTab !== 'sources') {
      setShowManageModelPicker(false)
    }
  }, [activeTab, setShowManageModelPicker])

  useEffect(() => {
    if (!showManageModelPicker) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest('.manage-model-entry')) {
        return
      }
      setShowManageModelPicker(false)
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setShowManageModelPicker(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [setShowManageModelPicker, showManageModelPicker])

  useEffect(() => {
    if (!sourceProfileSource) return
    const latest = sourceByID.get(sourceProfileSource.id)
    if (!latest) {
      setSourceProfileSource(null)
      return
    }
    if (latest !== sourceProfileSource) {
      setSourceProfileSource(latest)
    }
  }, [setSourceProfileSource, sourceByID, sourceProfileSource])

  useEffect(() => {
    if (sourceProfileSource) return
    setSourceProfileTagPickerOpen(false)
    setSourceProfileTagInput('')
  }, [setSourceProfileTagInput, setSourceProfileTagPickerOpen, sourceProfileSource])

  useEffect(() => {
    if (!pendingDeleteSource) return
    const latest = sourceByID.get(pendingDeleteSource.id)
    if (!latest) {
      setPendingDeleteSource(null)
      return
    }
    if (latest !== pendingDeleteSource) {
      setPendingDeleteSource(latest)
    }
  }, [pendingDeleteSource, setPendingDeleteSource, sourceByID])
}
