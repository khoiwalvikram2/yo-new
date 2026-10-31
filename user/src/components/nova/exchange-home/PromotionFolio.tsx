import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAppSettings } from '../../../lib/app-settings'
import { useAuth } from '../../../lib/auth'
import { useFeatureFlags } from '../../../hooks/useAppSettings'
import './promotion-folio.css'

type Campaign = { key: string; title: string; image: string; to?: string }
const DWELL_MS = 7000

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const sync = () => setMatches(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [query])
  return matches
}

function Artwork({ campaign, active, className, children }: { campaign: Campaign; active: boolean; className: string; children: ReactNode }) {
  const props = { className, 'aria-hidden': !active, tabIndex: active ? undefined : -1 }
  if (!campaign.to) return <div {...props}>{children}</div>
  if (/^https?:\/\//i.test(campaign.to)) return <a {...props} href={campaign.to} target="_blank" rel="noopener noreferrer" aria-label={campaign.title}>{children}</a>
  return <Link {...props} to={campaign.to} aria-label={campaign.title}>{children}</Link>
}

/** One full-width artwork at a time, with inset navigation and a decorative torch mask. */
export default function PromotionFolio() {
  const { t } = useTranslation()
  const { advertisements } = useAppSettings()
  const { user } = useAuth()
  const features = useFeatureFlags()
  const phone = useMediaQuery('(max-width: 767px)')
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const showBonuses = features.bonusesEnabled && user?.playerType !== 'AGENT_CREDIT' && user?.playerType !== 'WHITELABEL_CREDIT'
  const campaigns = useMemo<Campaign[]>(() => advertisements
    .filter(ad => ad.image && (ad.deviceType || 'BOTH') !== (phone ? 'DESKTOP' : 'MOBILE'))
    .slice(0, 5)
    .map(ad => ({
      key: ad.id || ad._id || ad.image,
      title: ad.title || t('promotionFolio.promotion'),
      image: ad.image,
      to: !showBonuses && ad.url?.startsWith('/bonus') ? undefined : ad.url,
    })), [advertisements, phone, showBonuses, t])
  const [view, setView] = useState<{ active: string | null; previous: string | null }>({ active: null, previous: null })
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [measured, setMeasured] = useState<{ key: string; ratio: number } | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const keyboardMove = useRef(false)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const swiped = useRef(false)
  const index = Math.max(0, campaigns.findIndex(campaign => campaign.key === view.active))
  const current = campaigns[index]
  const count = campaigns.length
  const paused = hovered || focused

  // Updating CSS variables keeps pointer motion out of React's render cycle.
  const pointTorch = (element: HTMLDivElement, clientX: number, clientY: number) => {
    if (reducedMotion) return
    const bounds = element.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    const x = Math.max(0, Math.min(100, (clientX - bounds.left) / bounds.width * 100))
    const y = Math.max(0, Math.min(100, (clientY - bounds.top) / bounds.height * 100))
    element.style.setProperty('--torch-x', `${x}%`)
    element.style.setProperty('--torch-y', `${y}%`)
    element.dataset.torchActive = 'true'
  }

  const move = useCallback((direction: 1 | -1) => {
    if (campaigns.length < 2) return
    setView(previous => {
      const from = Math.max(0, campaigns.findIndex(campaign => campaign.key === previous.active))
      const to = (from + direction + campaigns.length) % campaigns.length
      return { active: campaigns[to].key, previous: campaigns[from].key }
    })
  }, [campaigns])

  useEffect(() => {
    if (paused || reducedMotion || count < 2) return
    const timer = window.setTimeout(() => move(1), DWELL_MS)
    return () => window.clearTimeout(timer)
  }, [paused, reducedMotion, count, current?.key, move])

  useEffect(() => {
    if (!keyboardMove.current) return
    keyboardMove.current = false
    const link = Array.from(stage.current?.querySelectorAll<HTMLElement>('a.nova-ex-hero-ad') ?? [])
      .find(element => element.classList.contains('is-active'))
    ;(link ?? stage.current)?.focus({ preventScroll: true })
  }, [current?.key])

  if (!current) return null
  const ratio = measured?.key === campaigns[0].key ? measured.ratio : phone ? 1320 / 800 : 1600 / 430

  return <section
    className="nova-ex-hero"
    // eslint-disable-next-line no-restricted-syntax -- CSS variable supplies the soft continuation below the current artwork
    style={{ '--promo-bleed-art': `url(${JSON.stringify(current.image)})` } as CSSProperties}
    data-campaigns={count}
    aria-label={t('nova.platformPromotions')}
    aria-roledescription="carousel"
    onMouseEnter={() => setHovered(true)}
    onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)}
    onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
    }}
    onKeyDown={event => {
      if (count < 2 || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
      event.preventDefault()
      keyboardMove.current = true
      move(event.key === 'ArrowRight' ? 1 : -1)
    }}
  >
    <div
      ref={stage}
      className="nova-promo-stage"
      tabIndex={!current.to && count > 1 ? 0 : -1}
      // eslint-disable-next-line no-restricted-syntax -- CSS variable for the uploaded artwork's measured ratio
      style={{ '--promo-ratio': ratio } as CSSProperties}
      aria-live={paused ? 'polite' : 'off'}
      onPointerDown={event => {
        pointTorch(event.currentTarget, event.clientX, event.clientY)
        swiped.current = false
        swipe.current = count > 1 ? { x: event.clientX, y: event.clientY } : null
      }}
      onPointerUp={event => {
        if (event.pointerType !== 'mouse') delete event.currentTarget.dataset.torchActive
        const start = swipe.current
        swipe.current = null
        if (!start) return
        const dx = event.clientX - start.x
        if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(event.clientY - start.y)) return
        swiped.current = true
        move(dx < 0 ? 1 : -1)
      }}
      onPointerEnter={event => {
        if (event.pointerType === 'mouse') pointTorch(event.currentTarget, event.clientX, event.clientY)
      }}
      onPointerMove={event => {
        if (event.pointerType === 'mouse' || event.currentTarget.dataset.torchActive === 'true') pointTorch(event.currentTarget, event.clientX, event.clientY)
      }}
      onPointerLeave={event => { delete event.currentTarget.dataset.torchActive }}
      onPointerCancel={event => {
        swipe.current = null
        delete event.currentTarget.dataset.torchActive
      }}
      onClickCapture={event => {
        if (!swiped.current) return
        swiped.current = false
        event.preventDefault()
      }}
      onDragStart={event => event.preventDefault()}
    >
      {campaigns.map((campaign, position) => <Artwork
        key={campaign.key}
        campaign={campaign}
        active={campaign.key === current.key}
        className={`nova-ex-hero-ad${campaign.key === current.key ? ' is-active' : campaign.key === view.previous ? ' is-leaving' : ''}`}
      >
        <img src={campaign.image} alt={campaign.title} draggable={false} decoding="async" onLoad={position === 0 ? event => {
          const { naturalWidth, naturalHeight } = event.currentTarget
          if (naturalWidth && naturalHeight) setMeasured({ key: campaign.key, ratio: Math.min(4.4, Math.max(1.2, naturalWidth / naturalHeight)) })
        } : undefined} />
      </Artwork>)}
      <span className="nova-promo-lighting" aria-hidden="true">
        <span className="nova-promo-beam is-left" />
        <span className="nova-promo-beam is-right" />
        <span className="nova-promo-touch-light" />
      </span>
    </div>
    {count > 1 && <>
      <button type="button" className="nova-promo-previous" onClick={() => move(-1)} aria-label={t('promotionFolio.previous')}><ArrowLeft aria-hidden="true" /></button>
      <button type="button" className="nova-promo-next" onClick={() => move(1)} aria-label={t('promotionFolio.next')}><ArrowRight aria-hidden="true" /></button>
      <span className="nova-promo-count" aria-hidden="true"><strong>{String(index + 1).padStart(2, '0')}</strong><span>/</span>{String(count).padStart(2, '0')}</span>
    </>}
  </section>
}
