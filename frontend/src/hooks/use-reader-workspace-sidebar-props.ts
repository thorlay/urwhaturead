import type { Dispatch, SetStateAction } from 'react'
import type { ReaderWorkspaceProps } from '@/components/reader-workspace'

type SidebarProps = ReaderWorkspaceProps['sidebarProps']

type UseReaderWorkspaceSidebarPropsParams = {
  showSubscriptionSidebar: boolean
  sourceFilter: SidebarProps['sourceFilter']
  readerSources: SidebarProps['readerSources']
  sourceGroups: SidebarProps['sourceGroups']
  sidebarTagFilterMode: SidebarProps['sidebarTagFilterMode']
  sidebarTagFilters: SidebarProps['sidebarTagFilters']
  sidebarTagFilterSet: SidebarProps['sidebarTagFilterSet']
  showAllSidebarTags: SidebarProps['showAllSidebarTags']
  sidebarTagCollapseCount: SidebarProps['sidebarTagCollapseCount']
  sidebarVisibleFeedSources: SidebarProps['sidebarVisibleFeedSources']
  sourceGroupFilterKey: SidebarProps['sourceGroupFilterKey']
  isSourceGroupFilterActive: SidebarProps['isSourceGroupFilterActive']
  readerTrackedSources: SidebarProps['readerTrackedSources']
  showTrackedSidebar: SidebarProps['showTrackedSidebar']
  visibleTrackedSidebarSources: SidebarProps['visibleTrackedSidebarSources']
  hasMoreTrackedSidebarSources: SidebarProps['hasMoreTrackedSidebarSources']
  showAllTrackedSidebar: SidebarProps['showAllTrackedSidebar']
  onApplySourceFilterFromSidebar: SidebarProps['onApplySourceFilterFromSidebar']
  onApplySourceGroupFilterFromSidebar: SidebarProps['onApplySourceGroupFilterFromSidebar']
  onSwitchSidebarTagFilterMode: SidebarProps['onSwitchSidebarTagFilterMode']
  onApplySidebarTagFilters: SidebarProps['onApplySidebarTagFilters']
  onToggleSidebarTagFilter: SidebarProps['onToggleSidebarTagFilter']
  onRegisterSidebarSourceItemRef: SidebarProps['onRegisterSidebarSourceItemRef']
  onOpenSourceContextMenu: SidebarProps['onOpenSourceContextMenu']
  onOpenSourceContextMenuAt: SidebarProps['onOpenSourceContextMenuAt']
  setShowSubscriptionSidebar: Dispatch<SetStateAction<boolean>>
  setShowAllSidebarTags: Dispatch<SetStateAction<boolean>>
  setShowTrackedSidebar: Dispatch<SetStateAction<boolean>>
  setShowAllTrackedSidebar: Dispatch<SetStateAction<boolean>>
}

export function useReaderWorkspaceSidebarProps(
  params: UseReaderWorkspaceSidebarPropsParams,
): SidebarProps {
  return {
    showSubscriptionSidebar: params.showSubscriptionSidebar,
    sourceFilter: params.sourceFilter,
    readerSources: params.readerSources,
    sourceGroups: params.sourceGroups,
    sidebarTagFilterMode: params.sidebarTagFilterMode,
    sidebarTagFilters: params.sidebarTagFilters,
    sidebarTagFilterSet: params.sidebarTagFilterSet,
    showAllSidebarTags: params.showAllSidebarTags,
    sidebarTagCollapseCount: params.sidebarTagCollapseCount,
    sidebarVisibleFeedSources: params.sidebarVisibleFeedSources,
    sourceGroupFilterKey: params.sourceGroupFilterKey,
    isSourceGroupFilterActive: params.isSourceGroupFilterActive,
    readerTrackedSources: params.readerTrackedSources,
    showTrackedSidebar: params.showTrackedSidebar,
    visibleTrackedSidebarSources: params.visibleTrackedSidebarSources,
    hasMoreTrackedSidebarSources: params.hasMoreTrackedSidebarSources,
    showAllTrackedSidebar: params.showAllTrackedSidebar,
    onToggleSubscriptionSidebar: () => params.setShowSubscriptionSidebar((value) => !value),
    onApplySourceFilterFromSidebar: params.onApplySourceFilterFromSidebar,
    onApplySourceGroupFilterFromSidebar: params.onApplySourceGroupFilterFromSidebar,
    onSwitchSidebarTagFilterMode: params.onSwitchSidebarTagFilterMode,
    onApplySidebarTagFilters: params.onApplySidebarTagFilters,
    onToggleShowAllSidebarTags: () => params.setShowAllSidebarTags((value) => !value),
    onToggleSidebarTagFilter: params.onToggleSidebarTagFilter,
    onRegisterSidebarSourceItemRef: params.onRegisterSidebarSourceItemRef,
    onOpenSourceContextMenu: params.onOpenSourceContextMenu,
    onOpenSourceContextMenuAt: params.onOpenSourceContextMenuAt,
    onToggleShowTrackedSidebar: () => params.setShowTrackedSidebar((value) => !value),
    onToggleShowAllTrackedSidebar: () => params.setShowAllTrackedSidebar((value) => !value),
  }
}
