import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// Feed rows have variable height because summaries, images, and AI states differ.
// Keep infinite loading, but avoid early virtualization because fixed-height estimates
// can create visible blank gaps while scrolling.
const FEED_VIRTUAL_MIN_ROWS = 1000
const FEED_VIRTUAL_OVERSCAN_ROWS = 8

type ReaderFeedScrollOptions = {
  rowCount: number
  feedTitleOnlyMode: boolean
  showFeedImages: boolean
  selectedArticleID: number | null
  selectedFeedBriefing: boolean
  showFloatingReader: boolean
  readerView: 'stream' | 'detail'
}

export function useReaderFeedScroll({
  rowCount,
  feedTitleOnlyMode,
  showFeedImages,
  selectedArticleID,
  selectedFeedBriefing,
  showFloatingReader,
  readerView,
}: ReaderFeedScrollOptions) {
  const feedListRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (!showFloatingReader || readerView !== 'stream') return
    const list = feedListRef.current
    if (!list) return
    // Opening the split pane changes the toolbar height and available list area.
    // Keep the selected row visible without scrolling the surrounding page.
    const revealSelection = () => {
      if (!window.matchMedia('(min-width: 981px)').matches) return
      const selected = list.querySelector<HTMLElement>('.feed-item.active')
      if (!selected) return
      const bounds = list.getBoundingClientRect()
      const row = selected.getBoundingClientRect()
      if (row.top < bounds.top) list.scrollTop += row.top - bounds.top
      else if (row.bottom > bounds.bottom) list.scrollTop += row.bottom - bounds.bottom
    }
    revealSelection()
    const observer = new ResizeObserver(revealSelection)
    observer.observe(list)
    return () => observer.disconnect()
  }, [selectedArticleID, selectedFeedBriefing, showFloatingReader, readerView])

  const [virtualRange, setVirtualRange] = useState({ start: 0, end: 0 })
  const shouldVirtualizeFeed = rowCount >= FEED_VIRTUAL_MIN_ROWS
  const estimatedFeedRowHeight = feedTitleOnlyMode ? 48 : showFeedImages ? 138 : 116

  useEffect(() => {
    if (!shouldVirtualizeFeed) {
      return
    }

    let animationFrame = 0
    const updateVirtualRange = () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
      }
      animationFrame = window.requestAnimationFrame(() => {
        const list = feedListRef.current
        if (!list) {
          return
        }
        const visibleStart = Math.max(0, list.scrollTop)
        const visibleEnd = visibleStart + list.clientHeight
        const start = Math.max(0, Math.floor(visibleStart / estimatedFeedRowHeight) - FEED_VIRTUAL_OVERSCAN_ROWS)
        const end = Math.min(
          rowCount,
          Math.ceil(visibleEnd / estimatedFeedRowHeight) + FEED_VIRTUAL_OVERSCAN_ROWS,
        )
        setVirtualRange((current) => (current.start === start && current.end === end ? current : { start, end }))
      })
    }

    updateVirtualRange()
    const list = feedListRef.current
    list?.addEventListener('scroll', updateVirtualRange, { passive: true })
    window.addEventListener('resize', updateVirtualRange)
    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
      }
      list?.removeEventListener('scroll', updateVirtualRange)
      window.removeEventListener('resize', updateVirtualRange)
    }
  }, [estimatedFeedRowHeight, rowCount, shouldVirtualizeFeed])

  const virtualStart = shouldVirtualizeFeed ? Math.min(virtualRange.start, rowCount) : 0
  const virtualEnd = shouldVirtualizeFeed ? Math.max(virtualStart, Math.min(virtualRange.end, rowCount)) : rowCount
  const virtualTopSpacer = shouldVirtualizeFeed ? virtualStart * estimatedFeedRowHeight : 0
  const virtualBottomSpacer = shouldVirtualizeFeed
    ? Math.max(0, (rowCount - virtualEnd) * estimatedFeedRowHeight)
    : 0
  return {
    feedListRef,
    shouldVirtualizeFeed,
    virtualStart,
    virtualEnd,
    virtualTopSpacer,
    virtualBottomSpacer,
  }
}
