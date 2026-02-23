import { useEffect } from 'react'

type ReaderStreamKeyboardItem =
  | { kind: 'article'; articleID: number }
  | { kind: 'briefing' }

type UseReaderKeyboardShortcutsParams = {
  readerStreamItems: ReaderStreamKeyboardItem[]
  selectedFeedIndex: number
  selectedArticleLink?: string
  onOpenArticle: (articleID: number) => void
  onOpenFeedBriefing: () => void
  isBlockingOverlayOpen: boolean
  onCloseOverlays: () => void
}

export function useReaderKeyboardShortcuts({
  readerStreamItems,
  selectedFeedIndex,
  selectedArticleLink,
  onOpenArticle,
  onOpenFeedBriefing,
  isBlockingOverlayOpen,
  onCloseOverlays,
}: UseReaderKeyboardShortcutsParams) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }

      if (isBlockingOverlayOpen) {
        if (event.key === 'Escape') {
          onCloseOverlays()
        }
        return
      }

      if (event.key === 'j' || event.key === 'k') {
        if (readerStreamItems.length === 0) return
        event.preventDefault()

        const direction = event.key === 'j' ? 1 : -1
        const baseIndex = selectedFeedIndex >= 0 ? selectedFeedIndex : event.key === 'j' ? -1 : 0
        const nextIndex = Math.min(Math.max(baseIndex + direction, 0), readerStreamItems.length - 1)
        const nextItem = readerStreamItems[nextIndex]
        if (nextItem?.kind === 'briefing') {
          onOpenFeedBriefing()
          return
        }
        if (nextItem?.kind === 'article') {
          onOpenArticle(nextItem.articleID)
        }
        return
      }

      if (event.key === 'o' && selectedArticleLink) {
        event.preventDefault()
        window.open(selectedArticleLink, '_blank', 'noopener,noreferrer')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    isBlockingOverlayOpen,
    onCloseOverlays,
    onOpenArticle,
    onOpenFeedBriefing,
    readerStreamItems,
    selectedArticleLink,
    selectedFeedIndex,
  ])
}
