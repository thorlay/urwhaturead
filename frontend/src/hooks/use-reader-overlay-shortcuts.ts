import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useReaderKeyboardShortcuts } from './use-reader-keyboard-shortcuts'
import type { SourceContextMenuState } from '../lib/app-domain'
import type { Source } from '../types'

type ReaderStreamKeyboardItem =
  | { kind: 'article'; articleID: number }
  | { kind: 'briefing' }

type UseReaderOverlayShortcutsParams = {
  sourceProfileSource: Source | null
  sourceContextMenu: SourceContextMenuState | null
  pendingDeleteSource: Source | null
  showFeedAIMoreMenu: boolean
  showDetailMoreMenu: boolean
  setSourceProfileSource: Dispatch<SetStateAction<Source | null>>
  closeSourceContextMenu: () => void
  setPendingDeleteSource: Dispatch<SetStateAction<Source | null>>
  setShowFeedAIMoreMenu: Dispatch<SetStateAction<boolean>>
  closeDetailMoreMenu: () => void
  readerStreamItems: ReaderStreamKeyboardItem[]
  selectedFeedIndex: number
  selectedArticleLink?: string
  openArticle: (articleID: number) => Promise<void>
  openFeedBriefing: () => void
}

export function useReaderOverlayShortcuts({
  sourceProfileSource,
  sourceContextMenu,
  pendingDeleteSource,
  showFeedAIMoreMenu,
  showDetailMoreMenu,
  setSourceProfileSource,
  closeSourceContextMenu,
  setPendingDeleteSource,
  setShowFeedAIMoreMenu,
  closeDetailMoreMenu,
  readerStreamItems,
  selectedFeedIndex,
  selectedArticleLink,
  openArticle,
  openFeedBriefing,
}: UseReaderOverlayShortcutsParams) {
  const closeTransientOverlays = useCallback(() => {
    setSourceProfileSource(null)
    closeSourceContextMenu()
    setPendingDeleteSource(null)
    setShowFeedAIMoreMenu(false)
    closeDetailMoreMenu()
  }, [closeDetailMoreMenu, closeSourceContextMenu, setPendingDeleteSource, setShowFeedAIMoreMenu, setSourceProfileSource])

  const openArticleFromKeyboard = useCallback(
    (articleID: number) => {
      void openArticle(articleID)
    },
    [openArticle],
  )

  const hasBlockingOverlayOpen = Boolean(
    sourceProfileSource || sourceContextMenu || pendingDeleteSource || showFeedAIMoreMenu || showDetailMoreMenu,
  )

  useReaderKeyboardShortcuts({
    readerStreamItems,
    selectedFeedIndex,
    selectedArticleLink,
    onOpenArticle: openArticleFromKeyboard,
    onOpenFeedBriefing: openFeedBriefing,
    isBlockingOverlayOpen: hasBlockingOverlayOpen,
    onCloseOverlays: closeTransientOverlays,
  })
}
