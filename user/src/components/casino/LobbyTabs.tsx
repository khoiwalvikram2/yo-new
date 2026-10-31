import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react'
import { scrollBehavior } from './lobbyScroll'
import { ALL_TAB, categoryIconSrc, type LobbyCategory } from './lobbyModel'

type Props = {
  tabs: LobbyCategory[]
  active: string
  onSelect: (id: string) => void
  label: string
}

/** The lobby's category strip in the home page tab style (white, counts, red active tab). Edge arrows
 *  appear only while the strip overflows on that side; touch users swipe, keyboard users tab. */
export default function LobbyTabs({ tabs, active, onSelect, label }: Props) {
  const track = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: true })
  const syncEdges = useCallback(() => {
    const el = track.current
    if (el) setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 })
  }, [])
  useEffect(() => {
    syncEdges()
    window.addEventListener('resize', syncEdges)
    return () => window.removeEventListener('resize', syncEdges)
  }, [syncEdges, tabs.length])
  // Keep the active tab visible inside the strip; the page itself does not move.
  useEffect(() => {
    const el = track.current
    const button = el ? Array.from(el.children).find(child => (child as HTMLElement).dataset.tab === active) as HTMLElement | undefined : undefined
    if (!el || !button) return
    el.scrollTo({ left: Math.max(0, button.offsetLeft - (el.clientWidth - button.offsetWidth) / 2), behavior: scrollBehavior() })
  }, [active])
  const scrollBy = (direction: 1 | -1) => {
    const el = track.current
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: scrollBehavior() })
  }

  return <div className="nova-ex-sport-tabs-wrap nova-lobby-tabs">
    {!edges.start && <button type="button" className="nova-ex-tabs-arrow is-prev" tabIndex={-1} aria-hidden="true" onClick={() => scrollBy(-1)}><ChevronLeft /></button>}
    <div className="nova-ex-sport-tabs" ref={track} onScroll={syncEdges} role="group" aria-label={label}>
      {tabs.map(tab => <button
        key={tab.id}
        type="button"
        data-tab={tab.id}
        className={tab.id === active ? 'active' : undefined}
        aria-pressed={tab.id === active}
        onClick={() => onSelect(tab.id)}
      >
        {tab.id === ALL_TAB
          ? <LayoutGrid aria-hidden="true" />
          : tab.iconData ? <img src={categoryIconSrc(tab.iconData)} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none' }} /> : null}
        <span>{tab.name}</span>
        <small>{tab.count === null ? '–' : tab.count.toLocaleString()}</small>
      </button>)}
    </div>
    {!edges.end && <button type="button" className="nova-ex-tabs-arrow" tabIndex={-1} aria-hidden="true" onClick={() => scrollBy(1)}><ChevronRight /></button>}
  </div>
}
