import { useLayoutEffect, type RefObject } from 'react'

const EDGES = ['top', 'right', 'bottom', 'left'] as const

/**
 * Publishes the on-screen box of <main> as --shell-main-top / -right / -bottom / -left on <html>: the
 * distances from each viewport edge. Drawers (ui Drawer, player skin) confine their overlay to it, so every
 * drawer opens the way the tool rail's panel does: under the topbar, flush against the right rail, and as a
 * share of the content column's width. Kept current as the topbar, the side panel or the rail change size.
 * Without the shell the properties are absent and drawers keep the whole viewport.
 */
export function useShellMainBox(mainRef: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    const main = mainRef.current
    if (!main) return
    const root = document.documentElement
    const write = () => {
      const box = main.getBoundingClientRect()
      const distances = { top: box.top, right: window.innerWidth - box.right, bottom: window.innerHeight - box.bottom, left: box.left }
      for (const edge of EDGES) root.style.setProperty(`--shell-main-${edge}`, `${Math.max(0, Math.round(distances[edge]))}px`)
    }
    write()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(write)
    observer?.observe(main)
    window.addEventListener('resize', write)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', write)
      for (const edge of EDGES) root.style.removeProperty(`--shell-main-${edge}`)
    }
  }, [mainRef])
}
