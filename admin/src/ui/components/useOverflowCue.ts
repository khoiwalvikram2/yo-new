import { useCallback, useEffect, useState, type RefCallback } from 'react'

const EDGE_TOLERANCE_PX = 1

export interface OverflowCueState {
  /** The content is wider than its scroll container. */
  over: boolean
  /** The scroll position is at the inline start edge (within one physical pixel). */
  atStart: boolean
  /** The scroll position is at the inline end edge (within one physical pixel). */
  atEnd: boolean
}

const RESTING_CUE: OverflowCueState = { over: false, atStart: true, atEnd: true }

function readOverflowCue(element: HTMLElement): OverflowCueState {
  const distance = Math.max(0, element.scrollWidth - element.clientWidth)
  const over = distance > EDGE_TOLERANCE_PX

  if (!over) return RESTING_CUE

  // Modern browsers expose negative scrollLeft values for RTL scrollers. The table kit does
  // not change direction itself, but taking the absolute value makes the physical edge test
  // correct when it is mounted below an RTL application shell as well as in the default LTR
  // shell. The one-pixel tolerance absorbs sub-pixel layout and browser rounding.
  const position = Math.min(distance, Math.max(0, Math.abs(element.scrollLeft)))

  return {
    over: true,
    atStart: position <= EDGE_TOLERANCE_PX,
    atEnd: position >= distance - EDGE_TOLERANCE_PX,
  }
}

function sameCue(left: OverflowCueState, right: OverflowCueState): boolean {
  return left.over === right.over && left.atStart === right.atStart && left.atEnd === right.atEnd
}

export interface OverflowCueResult<T extends HTMLElement> {
  /** Callback ref for the element that owns horizontal scrolling. */
  ref: RefCallback<T>
  cue: OverflowCueState
  /** Re-measure on demand after an imperative layout change. */
  sync: () => void
}

/**
 * Reports a horizontal scroller's start/end state for the mockup fade cue.
 *
 * The hook owns its scroll and resize listeners. `deps` is only an additional signal for
 * content changes which do not resize either the container or its first child.
 */
export function useOverflowCue<T extends HTMLElement = HTMLDivElement>(
  deps: readonly unknown[] = [],
): OverflowCueResult<T> {
  const [element, setElement] = useState<T | null>(null)
  const [cue, setCue] = useState<OverflowCueState>(RESTING_CUE)

  const ref = useCallback<RefCallback<T>>((node) => {
    setElement(node)
  }, [])

  const sync = useCallback(() => {
    if (!element) return
    const next = readOverflowCue(element)
    setCue((previous) => (sameCue(previous, next) ? previous : next))
  }, [element])

  useEffect(() => {
    if (!element) return undefined

    sync()
    element.addEventListener('scroll', sync, { passive: true })
    window.addEventListener('resize', sync)

    // ResizeObserver callbacks run outside React's event system. Keep the callback explicit so
    // observer arguments are never accidentally forwarded to `sync`, and observe the rendered
    // content node as well as the scroll box: either side can change the overflow geometry.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => sync())
    observer?.observe(element)
    const content = element.firstElementChild
    if (content) observer?.observe(content)

    return () => {
      element.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
      observer?.disconnect()
    }
  }, [element, sync])

  useEffect(() => {
    sync()
    // `deps` deliberately mirrors React's dependency-list API: callers can signal a row or
    // column change without making the hook depend on the array object's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, ...deps])

  return { ref, cue, sync }
}
