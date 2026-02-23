import { useEffect } from 'react'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import type { AppTab, ReaderSession, ReaderView } from '../lib/app-domain'

type UseReaderRuntimeEffectsParams = {
  activeTab: AppTab
  hasMoreFeed: boolean
  loadingFeed: boolean
  feedCursor: string
  feedAutoLoadRef: RefObject<HTMLDivElement | null>
  feedAutoLoadCooldownRef: MutableRefObject<number>
  loadMoreFeed: () => void
  setNowTick: Dispatch<SetStateAction<number>>
  readerView: ReaderView
  showFloatingReader: boolean
  floatingDetailRef: RefObject<HTMLElement | null>
  closeFloatingReader: () => void
  selectedArticleID: number | null
  readerSessionRef: MutableRefObject<ReaderSession | null>
}

export function useReaderRuntimeEffects({
  activeTab,
  hasMoreFeed,
  loadingFeed,
  feedCursor,
  feedAutoLoadRef,
  feedAutoLoadCooldownRef,
  loadMoreFeed,
  setNowTick,
  readerView,
  showFloatingReader,
  floatingDetailRef,
  closeFloatingReader,
  selectedArticleID,
  readerSessionRef,
}: UseReaderRuntimeEffectsParams) {
  useEffect(() => {
    const target = feedAutoLoadRef.current
    if (!target) return
    if (activeTab !== 'reader' || !hasMoreFeed) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting) return
        if (loadingFeed) return
        const now = Date.now()
        if (now - feedAutoLoadCooldownRef.current < 900) {
          return
        }
        feedAutoLoadCooldownRef.current = now
        loadMoreFeed()
      },
      {
        root: null,
        rootMargin: '0px 0px 420px 0px',
        threshold: 0,
      },
    )

    observer.observe(target)
    return () => observer.disconnect()
  }, [
    activeTab,
    hasMoreFeed,
    loadingFeed,
    feedCursor,
    feedAutoLoadCooldownRef,
    feedAutoLoadRef,
    loadMoreFeed,
  ])

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 60 * 1000)
    return () => window.clearInterval(timer)
  }, [setNowTick])

  useEffect(() => {
    if (activeTab !== 'reader' || readerView !== 'stream' || !showFloatingReader) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const panel = floatingDetailRef.current
      if (!panel) return

      const target = event.target as Node | null
      if (target && panel.contains(target)) {
        return
      }
      closeFloatingReader()
    }

    function handleEscKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeFloatingReader()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleEscKey)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleEscKey)
    }
  }, [activeTab, closeFloatingReader, floatingDetailRef, readerView, showFloatingReader])

  useEffect(() => {
    if (!selectedArticleID) {
      return
    }
    if (activeTab !== 'reader') {
      return
    }
    if (!showFloatingReader && readerView !== 'detail') {
      return
    }
    const panel = floatingDetailRef.current
    if (!panel) {
      return
    }
    const panelElement = panel

    function updateReaderSessionProgress() {
      const session = readerSessionRef.current
      if (!session || session.articleID !== selectedArticleID) {
        return
      }
      const scrollable = panelElement.scrollHeight - panelElement.clientHeight
      if (scrollable <= 0) {
        return
      }
      const progress = panelElement.scrollTop / scrollable
      if (progress > session.maxScrollProgress) {
        session.maxScrollProgress = progress
      }
    }

    updateReaderSessionProgress()
    panelElement.addEventListener('scroll', updateReaderSessionProgress, { passive: true })
    window.addEventListener('resize', updateReaderSessionProgress)
    return () => {
      panelElement.removeEventListener('scroll', updateReaderSessionProgress)
      window.removeEventListener('resize', updateReaderSessionProgress)
    }
  }, [activeTab, floatingDetailRef, readerSessionRef, readerView, selectedArticleID, showFloatingReader])

  useEffect(() => {
    if (activeTab !== 'reader' || readerView !== 'detail') {
      return
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [activeTab, readerView])
}
