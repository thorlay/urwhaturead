import { useEffect, type RefObject } from 'react'
import type { ReaderView } from '../lib/app-domain'

const READING_SCROLL_STORAGE_KEY = 'quick.reader.detail_scroll_positions'

function readStoredScrollPositions(): Record<string, number> {
  if (typeof window === 'undefined') {
    return {}
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(READING_SCROLL_STORAGE_KEY) || '{}') as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [key, typeof value === 'number' && Number.isFinite(value) ? value : 0] as const)
        .filter(([, value]) => value > 0),
    )
  } catch {
    return {}
  }
}

function writeStoredScrollPosition(articleID: number, scrollTop: number) {
  if (typeof window === 'undefined') {
    return
  }
  const positions = readStoredScrollPositions()
  positions[String(articleID)] = Math.max(0, Math.round(scrollTop))
  const entries = Object.entries(positions).slice(-200)
  try {
    window.localStorage.setItem(READING_SCROLL_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // Ignore storage failures; reading state is an enhancement, not core data.
  }
}

export function useReaderArticleScroll(
  floatingDetailRef: RefObject<HTMLElement | null>,
  readerView: ReaderView,
  articleID: number | undefined,
) {
  useEffect(() => {
    if (readerView !== 'detail' || !articleID) {
      return
    }
    const panel = floatingDetailRef.current
    if (!panel) {
      return
    }

    const storedTop = readStoredScrollPositions()[String(articleID)] ?? 0
    const restoreTimer = window.setTimeout(() => {
      panel.scrollTop = storedTop
    }, 0)
    let animationFrame = 0
    const savePosition = () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
      }
      animationFrame = window.requestAnimationFrame(() => {
        writeStoredScrollPosition(articleID, panel.scrollTop)
      })
    }
    panel.addEventListener('scroll', savePosition, { passive: true })
    return () => {
      window.clearTimeout(restoreTimer)
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
      }
      writeStoredScrollPosition(articleID, panel.scrollTop)
      panel.removeEventListener('scroll', savePosition)
    }
  }, [floatingDetailRef, readerView, articleID])
}
