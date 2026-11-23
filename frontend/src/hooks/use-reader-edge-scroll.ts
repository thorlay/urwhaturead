import { useEffect } from 'react'

export function useReaderEdgeScroll() {
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 981px)')

    function handleWheel(event: WheelEvent) {
      if (!event.deltaY || event.ctrlKey || event.metaKey || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return

      // Leave wheel handling to native controls and scrollable panes, including portals.
      for (const target of event.composedPath()) {
        if (!(target instanceof HTMLElement)) continue
        if (target === document.body || target === document.documentElement) break
        if (target.matches('select, textarea')) return
        if (target.scrollHeight > target.clientHeight && /^(auto|scroll|overlay)$/.test(getComputedStyle(target).overflowY)) return
      }
      if (event.cancelable) event.preventDefault()
    }

    function sync() {
      if (desktop.matches) document.addEventListener('wheel', handleWheel, { passive: false })
      else document.removeEventListener('wheel', handleWheel)
    }

    sync()
    desktop.addEventListener('change', sync)
    return () => {
      desktop.removeEventListener('change', sync)
      document.removeEventListener('wheel', handleWheel)
    }
  }, [])
}
