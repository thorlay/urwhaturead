import type { Dispatch, SetStateAction } from 'react'
import type { SourceOverlaysStackProps } from '@/components/source-overlays-stack'
import type { Source, SourceStatus } from '../types'

type UseSourceOverlaysPropsParams = {
  contextMenuRef: SourceOverlaysStackProps['contextMenuProps']['contextMenuRef']
  sourceContextMenu: SourceOverlaysStackProps['contextMenuProps']['sourceContextMenu']
  canManageSources: boolean
  busySourceID: number | null
  onQuickSetSourceEnabled: (source: Source, enabled: boolean) => Promise<void>
  onOpenSourceProfile: (source: Source) => void
  onOpenDeleteConfirm: (source: Source) => void
  sourceProfileSource: Source | null
  sourceProfileStatus: SourceStatus | null
  sourceProfileHealth: SourceStatus['health'] | null
  sourceProfileTags: string[]
  sourceProfileTagPickerOpen: boolean
  setSourceProfileTagPickerOpen: Dispatch<SetStateAction<boolean>>
  sourceProfileTagInput: string
  setSourceProfileTagInput: Dispatch<SetStateAction<string>>
  sourceProfileTagDrafts: string[]
  sourceProfileTagCandidates: string[]
  onRemoveSourceProfileTag: (tag: string) => Promise<void>
  onAddSourceProfileTags: (tags: string[]) => Promise<void>
  setSourceProfileSource: Dispatch<SetStateAction<Source | null>>
  normalizeSourceKind: (kind?: string) => 'feed' | 'thread'
  resolveSourceSiteKey: (source: Pick<Source, 'site_key' | 'rss_url'>) => string
  formatDateTime: (input?: string) => string
  healthToneClass: (health: SourceStatus['health']) => string
  healthLabel: (health: SourceStatus['health']) => string
  formatTimeAgo: (input: string) => string
  sourceClickCount: (source: Pick<Source, 'click_count'>) => number
  pendingDeleteSource: Source | null
  setPendingDeleteSource: Dispatch<SetStateAction<Source | null>>
  onConfirmDeleteSource: () => Promise<void>
}

export function useSourceOverlaysProps({
  contextMenuRef,
  sourceContextMenu,
  canManageSources,
  busySourceID,
  onQuickSetSourceEnabled,
  onOpenSourceProfile,
  onOpenDeleteConfirm,
  sourceProfileSource,
  sourceProfileStatus,
  sourceProfileHealth,
  sourceProfileTags,
  sourceProfileTagPickerOpen,
  setSourceProfileTagPickerOpen,
  sourceProfileTagInput,
  setSourceProfileTagInput,
  sourceProfileTagDrafts,
  sourceProfileTagCandidates,
  onRemoveSourceProfileTag,
  onAddSourceProfileTags,
  setSourceProfileSource,
  normalizeSourceKind,
  resolveSourceSiteKey,
  formatDateTime,
  healthToneClass,
  healthLabel,
  formatTimeAgo,
  sourceClickCount,
  pendingDeleteSource,
  setPendingDeleteSource,
  onConfirmDeleteSource,
}: UseSourceOverlaysPropsParams): SourceOverlaysStackProps {
  return {
    contextMenuProps: {
      contextMenuRef,
      sourceContextMenu,
      canManageSources,
      busySourceID,
      onQuickSetSourceEnabled,
      onOpenSourceProfile,
      onOpenDeleteConfirm,
    },
    profileDialogProps: {
      sourceProfileSource,
      sourceProfileStatus,
      sourceProfileHealth,
      canManageSources,
      sourceProfileTags,
      sourceProfileTagPickerOpen,
      onToggleSourceProfileTagPicker: () => setSourceProfileTagPickerOpen((value) => !value),
      sourceProfileTagInput,
      onSetSourceProfileTagInput: setSourceProfileTagInput,
      sourceProfileTagDrafts,
      sourceProfileTagCandidates,
      busySourceID,
      onRemoveSourceProfileTag,
      onAddSourceProfileTags,
      onQuickSetSourceEnabled,
      onOpenDeleteConfirm,
      onCloseSourceProfile: () => setSourceProfileSource(null),
      normalizeSourceKind,
      resolveSourceSiteKey,
      formatDateTime,
      healthToneClass,
      healthLabel,
      formatTimeAgo,
      sourceClickCount,
    },
    deleteConfirmProps: {
      pendingDeleteSource,
      busySourceID,
      onCloseDeleteConfirm: () => setPendingDeleteSource(null),
      onConfirmDeleteSource,
    },
  }
}
