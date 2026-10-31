import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Radio } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useFeatureFlags } from '../../../hooks/useAppSettings'
import { getPopularNavigation } from '../../sidebar/popularNavigation'
import './nova-exchange-home.css'

/** Home's live-first sports view followed by the sidebar's other Popular destinations. */
export default function PopularNavigation({ onInPlay }: { onInPlay?: () => void } = {}) {
  const { t } = useTranslation()
  const features = useFeatureFlags()
  const items = getPopularNavigation(features).filter(item => !features.sportsEnabled || item.key !== 'home')
  const { pathname } = useLocation()
  const track = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: true })
  const syncEdges = useCallback(() => {
    const el = track.current
    if (el) setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 })
  }, [])

  useEffect(() => {
    syncEdges()
    window.addEventListener('resize', syncEdges)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncEdges)
    if (track.current) observer?.observe(track.current)
    return () => { window.removeEventListener('resize', syncEdges); observer?.disconnect() }
  }, [syncEdges, items.length, features.sportsEnabled, t])

  const scrollBy = (direction: 1 | -1) => {
    const el = track.current
    el?.scrollBy({ left: direction * el.clientWidth * .7, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  return <nav className="nova-ex-sport-tabs-wrap nova-ex-popular-nav" aria-label={t('sidebar.popular', { defaultValue: 'Popular' })}>
    {!edges.start && <button type="button" className="nova-ex-tabs-arrow is-prev" tabIndex={-1} aria-hidden="true" onClick={() => scrollBy(-1)}><ChevronLeft /></button>}
    <div className="nova-ex-sport-tabs" ref={track} onScroll={syncEdges}>
      {features.sportsEnabled && <button type="button" className="active is-inplay" aria-pressed="true" aria-controls="nova-ex-games" onClick={() => {
        if (onInPlay) onInPlay()
        else document.getElementById('nova-ex-games')?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      }}>
        <Radio aria-hidden="true" /><span>{t('nova.inPlay')}</span>
      </button>}
      {items.map(item => {
        const Icon = item.icon
        const active = pathname === item.to || (item.to !== '/' && pathname.startsWith(`${item.to}/`))
        return <Link key={item.key} to={item.to} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
          <Icon aria-hidden="true" /><span>{t(item.labelKey, { defaultValue: item.defaultLabel })}</span>
        </Link>
      })}
    </div>
    {!edges.end && <button type="button" className="nova-ex-tabs-arrow" tabIndex={-1} aria-hidden="true" onClick={() => scrollBy(1)}><ChevronRight /></button>}
  </nav>
}
