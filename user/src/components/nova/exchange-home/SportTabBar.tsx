import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Radio, Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ALL_TAB, IN_PLAY_TAB, sportIcon, type SportTab } from './exchangeShared'
import './nova-exchange-home.css'

type Props = {
  tabs: SportTab[]
  active: string
  onSelect: (key: string) => void
  loading: boolean
  /** id of the list the tabs filter, for aria-controls. */
  controls: string
}

/** White strip of sport filters (All / In-Play / each sport, with counts); arrows appear when it overflows. */
export default function SportTabBar({ tabs, active, onSelect, loading, controls }: Props) {
  const { t } = useTranslation()
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
  const scrollBy = (direction: 1 | -1) => {
    const el = track.current
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  return <div className="nova-ex-sport-tabs-wrap">
    {!edges.start && <button type="button" className="nova-ex-tabs-arrow is-prev" tabIndex={-1} aria-hidden="true" onClick={() => scrollBy(-1)}><ChevronLeft /></button>}
    <div className="nova-ex-sport-tabs" ref={track} onScroll={syncEdges} role="group" aria-label={t('nova.discoverSports')}>
      {tabs.map(tab => {
        const icon = tab.sport && sportIcon(tab.sport)
        return <button
          key={tab.key}
          type="button"
          className={`${tab.key === active ? 'active' : ''}${tab.key === IN_PLAY_TAB ? ' is-inplay' : ''}`}
          aria-pressed={tab.key === active}
          aria-controls={controls}
          onClick={() => onSelect(tab.key)}
        >
          {tab.key === ALL_TAB ? <Trophy aria-hidden="true" /> : tab.key === IN_PLAY_TAB ? <Radio aria-hidden="true" /> : icon ? <img className="sport-img" src={icon} alt="" /> : null}
          <span>{tab.label}</span>
          <small>{loading ? '–' : tab.count}</small>
        </button>
      })}
    </div>
    {!edges.end && <button type="button" className="nova-ex-tabs-arrow" tabIndex={-1} aria-hidden="true" onClick={() => scrollBy(1)}><ChevronRight /></button>}
  </div>
}
