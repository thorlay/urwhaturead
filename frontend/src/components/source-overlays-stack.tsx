import { lazy, Suspense } from 'react'
import type {
  SourceContextMenuOverlayProps,
  SourceDeleteConfirmDialogProps,
  SourceProfileDialogProps,
} from '@/components/source-overlays'

const SourceContextMenuOverlay = lazy(async () => {
  const module = await import('@/components/source-overlays')
  return { default: module.SourceContextMenuOverlay }
})

const SourceProfileDialog = lazy(async () => {
  const module = await import('@/components/source-overlays')
  return { default: module.SourceProfileDialog }
})

const SourceDeleteConfirmDialog = lazy(async () => {
  const module = await import('@/components/source-overlays')
  return { default: module.SourceDeleteConfirmDialog }
})

export type SourceOverlaysStackProps = {
  contextMenuProps: SourceContextMenuOverlayProps
  profileDialogProps: SourceProfileDialogProps
  deleteConfirmProps: SourceDeleteConfirmDialogProps
}

export function SourceOverlaysStack({ contextMenuProps, profileDialogProps, deleteConfirmProps }: SourceOverlaysStackProps) {
  return (
    <>
      {contextMenuProps.sourceContextMenu && (
        <Suspense fallback={null}>
          <SourceContextMenuOverlay {...contextMenuProps} />
        </Suspense>
      )}

      {profileDialogProps.sourceProfileSource && (
        <Suspense fallback={null}>
          <SourceProfileDialog {...profileDialogProps} />
        </Suspense>
      )}

      {deleteConfirmProps.pendingDeleteSource && (
        <Suspense fallback={null}>
          <SourceDeleteConfirmDialog {...deleteConfirmProps} />
        </Suspense>
      )}
    </>
  )
}
