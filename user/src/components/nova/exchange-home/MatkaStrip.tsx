import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Dices } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useFeatureFlags } from '../../../hooks/useAppSettings'
import { useAuth } from '../../../lib/auth'
import { getWhitelabelId } from '../../../lib/whitelabel'
import { getMatkaMarkets, type MatkaMarket } from '../../../lib/api/matka'
import { hasMatkaResult, matkaCutoff, matkaMarketResult } from '../../../features/matka/marketDisplay'
import SectionHeader from './SectionHeader'
import './matka-strip.css'

const KIND_LABELS = { WORLI: 'Worli', STARLINE: 'Starline', JACKPOT: 'Jackpot', SATTA_MATKA: 'Satta Matka' }
const STATUS_KEYS: Record<string, string> = { Open: 'statusOpen', Closed: 'statusClosed', Upcoming: 'statusUpcoming', Suspended: 'statusSuspended', Result: 'statusResult' }

function MarketCard({ market }: { market: MatkaMarket }) {
  const { t, i18n } = useTranslation()
  const locale = i18n?.resolvedLanguage || 'en'
  const timezone = /Asia\/(Kolkata|Calcutta)/.test(market.timezone) ? 'IST' : market.timezone
  const statusKey = STATUS_KEYS[market.status]
  const published = hasMatkaResult(market)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(market.runDate) ? new Date(`${market.runDate}T12:00:00Z`) : null
  const dateLabel = date && Number.isFinite(date.getTime()) ? date.toLocaleDateString(locale, { day: '2-digit', month: 'short', timeZone: 'UTC' }) : ''
  return <Link className="nova-ex-matka-card" to={`/matka/markets/${encodeURIComponent(market.code || market.id)}`}
    aria-label={t('homeMatka.openMarket', { name: market.name })}>
    <span className="nova-ex-matka-meta"><span>{KIND_LABELS[market.kind] || market.kind}</span><span className={`nova-ex-matka-status${market.status === 'Open' ? ' is-open' : ''}`}>{statusKey ? t(`homeMatka.${statusKey}`) : market.status || t('homeMatka.unavailable')}</span></span>
    <span className="nova-ex-matka-name"><strong>{market.name}</strong><ChevronRight aria-hidden="true" /></span>
    <span className="nova-ex-matka-result"><small>{t('homeMatka.currentResult')}{dateLabel && <time dateTime={market.runDate}>{dateLabel}</time>}</small>
      <span className={published ? 'is-published' : 'is-awaiting'}>{published ? matkaMarketResult(market) : t('homeMatka.awaiting')}</span>
    </span>
    <span className="nova-ex-matka-zone">{timezone}</span>
    <dl className="nova-ex-matka-times">
      <div><dt>{t('homeMatka.openCutoff')}</dt><dd>{matkaCutoff(market, 'OPEN', locale)}</dd></div>
      <div><dt>{t('homeMatka.closeCutoff')}</dt><dd>{matkaCutoff(market, 'CLOSE', locale)}</dd></div>
    </dl>
  </Link>
}

function MatkaMarkets() {
  const { t } = useTranslation()
  const headingId = useId()
  const { user, isAuthenticated, isHydrating } = useAuth()
  const tenant = getWhitelabelId()
  const owner = isAuthenticated ? `user:${user?.id ?? 'pending'}` : 'guest'
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['home', 'matka-markets', tenant, owner],
    queryFn: async () => {
      const response = await getMatkaMarkets({ page: 1, limit: 12 })
      if (response?.meta?.code !== 200 || !Array.isArray(response.data)) throw new Error('Invalid Matka catalogue')
      return response
    },
    enabled: !isHydrating && (!isAuthenticated || Boolean(user?.id)),
    staleTime: 5000, refetchInterval: 15000, refetchIntervalInBackground: false, retry: 1,
  })
  const markets = data?.data.filter(market => market.id && market.name) ?? []
  const track = useRef<HTMLUListElement>(null)
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
  }, [syncEdges, markets.length, isPending, isError])
  const step = (direction: 1 | -1) => {
    const el = track.current
    const width = el?.firstElementChild?.getBoundingClientRect().width
    if (el && width) el.scrollBy({ left: direction * (width + 10), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  return <section className="nova-ex-matka" aria-labelledby={headingId} data-real-adapter="matka-strip">
    <SectionHeader icon={<Dices aria-hidden="true" />} title={t('homeMatka.title')} titleId={headingId} count={!isPending && !isError ? data?.meta.total ?? markets.length : undefined}>
      <Link to="/matka" className="nova-ex-section-all">{t('exchangeHome.seeAll', { defaultValue: 'See All' })}</Link>
      {!isPending && !isError && markets.length > 0 && !(edges.start && edges.end) && <span className="nova-ex-section-arrows">
        <button type="button" disabled={edges.start} aria-label={t('nova.scrollLeft')} onClick={() => step(-1)}><ChevronLeft aria-hidden="true" /></button>
        <button type="button" disabled={edges.end} aria-label={t('nova.scrollRight')} onClick={() => step(1)}><ChevronRight aria-hidden="true" /></button>
      </span>}
    </SectionHeader>
    {isPending ? <div className="nova-ex-matka-loading" role="status"><span className="sr-only">{t('homeMatka.loading')}</span><i /><i /><i /><i /></div>
      : isError ? <div className="nova-ex-matka-note" role="alert"><p>{t('homeMatka.error')}</p><button type="button" onClick={() => { void refetch() }}>{t('homeMatka.retry')}</button></div>
        : markets.length === 0 ? <p className="nova-ex-matka-note" role="status">{t('homeMatka.empty')}</p>
          : <ul className="nova-ex-matka-track" ref={track}>{markets.map(market => <li key={market.id}><MarketCard market={market} /></li>)}</ul>}
  </section>
}

export default function MatkaStrip() {
  const { matkaEnabled } = useFeatureFlags()
  return matkaEnabled ? <MatkaMarkets /> : null
}
