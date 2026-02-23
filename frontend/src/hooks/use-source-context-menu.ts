import { useCallback, useEffect, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react'
import type { SourceContextMenuState } from '../lib/app-domain'
import { clampContextMenuPosition } from '../lib/app-utils'
import type { Source } from '../types'

type UseSourceContextMenuParams = {
  sourceContextMenuRef: RefObject<HTMLDivElement | null>
}

export function useSourceContextMenu({ sourceContextMenuRef }: UseSourceContextMenuParams) {
  const [sourceContextMenu, setSourceContextMenu] = useState<SourceContextMenuState | null>(null)

  const closeSourceContextMenu = useCallback(() => {
    setSourceContextMenu(null)
  }, [])

  const openSourceContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>, source: Source) => {
    event.preventDefault()
    event.stopPropagation()
    const margin = 10
    const x = Math.max(margin, Math.min(event.clientX, window.innerWidth - margin))
    const y = Math.max(margin, Math.min(event.clientY, window.innerHeight - margin))
    setSourceContextMenu({
      source,
      x,
      y,
    })
  }, [])

  const openSourceContextMenuAt = useCallback((source: Source, x: number, y: number) => {
    const margin = 10
    setSourceContextMenu({
      source,
      x: Math.max(margin, Math.min(x, window.innerWidth - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - margin)),
    })
  }, [])

  useEffect(() => {
    if (!sourceContextMenu) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest('.source-context-menu')) {
        return
      }
      closeSourceContextMenu()
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeSourceContextMenu()
      }
    }

    function handleScroll() {
      closeSourceContextMenu()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [closeSourceContextMenu, sourceContextMenu])

  useEffect(() => {
    if (!sourceContextMenu) return
    const activeMenu = sourceContextMenu

    function adjustSourceContextMenuPosition() {
      const menu = sourceContextMenuRef.current
      if (!menu) return
      const rect = menu.getBoundingClientRect()
      const next = clampContextMenuPosition(activeMenu.x, activeMenu.y, rect.width, rect.height)
      if (next.x === activeMenu.x && next.y === activeMenu.y) {
        return
      }
      setSourceContextMenu((previous) => {
        if (!previous) return previous
        if (previous.x === next.x && previous.y === next.y) {
          return previous
        }
        return { ...previous, x: next.x, y: next.y }
      })
    }

    const frame = window.requestAnimationFrame(adjustSourceContextMenuPosition)
    window.addEventListener('resize', adjustSourceContextMenuPosition)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', adjustSourceContextMenuPosition)
    }
  }, [sourceContextMenu, sourceContextMenuRef])

  return {
    sourceContextMenu,
    setSourceContextMenu,
    closeSourceContextMenu,
    openSourceContextMenu,
    openSourceContextMenuAt,
  }
}
