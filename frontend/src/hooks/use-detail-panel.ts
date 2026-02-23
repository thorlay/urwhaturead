import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArticleDetail } from '../types'

type UseDetailPanelParams = {
  activeTab: string
  selectedArticle: ArticleDetail | null
  selectedArticleID: number | null
  selectedFeedBriefing: boolean
  isTrackableForumLink: (rawURL: string) => boolean
}

export function useDetailPanel(params: UseDetailPanelParams) {
  const detailMoreMenuRef = useRef<HTMLDivElement | null>(null)
  const [detailMoreMenuOpen, setDetailMoreMenuOpen] = useState(false)

  const isThreadArticle = Boolean(params.selectedArticle?.thread)
  const threadPrimaryBody = params.selectedArticle?.thread?.full_content?.trim() ?? ''
  const canTrackThread = Boolean(params.selectedArticle && params.isTrackableForumLink(params.selectedArticle.link))
  const canForceRecalcSummary = Boolean(params.selectedArticleID && params.selectedArticleID > 0)
  const hasDetailMoreActions = canTrackThread || canForceRecalcSummary
  const canShowDetailMoreMenu =
    params.activeTab === 'reader' && Boolean(params.selectedArticle) && !params.selectedFeedBriefing
  const showDetailMoreMenu = detailMoreMenuOpen && canShowDetailMoreMenu

  const closeDetailMoreMenu = useCallback(() => {
    setDetailMoreMenuOpen(false)
  }, [])

  const toggleDetailMoreMenu = useCallback(() => {
    if (!canShowDetailMoreMenu) {
      setDetailMoreMenuOpen(false)
      return
    }
    setDetailMoreMenuOpen((value) => !value)
  }, [canShowDetailMoreMenu])

  useEffect(() => {
    if (!showDetailMoreMenu) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (target && detailMoreMenuRef.current?.contains(target)) {
        return
      }
      setDetailMoreMenuOpen(false)
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setDetailMoreMenuOpen(false)
      }
    }

    function handleScroll() {
      setDetailMoreMenuOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [showDetailMoreMenu])

  return {
    detailMoreMenuRef,
    showDetailMoreMenu,
    closeDetailMoreMenu,
    toggleDetailMoreMenu,
    isThreadArticle,
    threadPrimaryBody,
    canTrackThread,
    canForceRecalcSummary,
    hasDetailMoreActions,
  }
}
