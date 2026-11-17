import { useId, type PointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, LoaderCircle, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCasinoLoungeGames, type LoungeGame } from '../../casino/useCasinoLoungeGames'
import { useLaunchGame } from '../../casino/useLaunchGame'
import SectionHeader from './SectionHeader'
import './casino-lounge.css'

const formats = ['feature', 'wide', 'compact', 'room', 'room', 'room', 'room']

function followLight(event: PointerEvent<HTMLButtonElement>) {
  if (event.pointerType !== 'mouse' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const box = event.currentTarget.getBoundingClientRect()
  if (!box.width || !box.height) return
  event.currentTarget.style.setProperty('--lg-light-x', `${Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * 100}%`)
  event.currentTarget.style.setProperty('--lg-light-y', `${Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) * 100}%`)
}

function LoungeCard({ game, index }: { game: LoungeGame; index: number }) {
  const { t } = useTranslation()
  const { launch, loading, error } = useLaunchGame(game.gameId)
  const errorId = useId()
  const format = formats[index % formats.length]
  return <div className={`lg-cell is-${format}`}>
    <button type="button" className="lg-portal" disabled={loading}
      aria-label={t('nova.openGame', { title: game.title })} aria-describedby={error ? errorId : undefined}
      onClick={() => void launch()} onPointerMove={followLight}
      onPointerLeave={event => {
        event.currentTarget.style.removeProperty('--lg-light-x')
        event.currentTarget.style.removeProperty('--lg-light-y')
      }}>
      <img className="lg-game-image" src={game.image || '/dice-bg.svg'} alt="" loading="lazy" decoding="async" onError={event => {
        const image = event.currentTarget
        if (image.dataset.fallbackApplied) { image.style.visibility = 'hidden'; return }
        image.dataset.fallbackApplied = 'true'
        image.src = '/dice-bg.svg'
      }} />
      <span className="lg-game-shade" aria-hidden="true" />
      <span className="lg-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <span className="lg-copy"><span className="lg-kicker">{game.provider}</span><strong>{game.title}</strong></span>
      <span className="lg-enter" aria-hidden="true">
        {format === 'feature' && <span className="lg-enter-label">{t('common.play')}</span>}
        {loading ? <LoaderCircle className="lg-spinner" /> : <ArrowUpRight />}
      </span>
      {loading && <span className="sr-only" role="status">{t('casinoLounge.opening')}</span>}
    </button>
    {error && <p id={errorId} className="lg-launch-error" role="alert">{error}</p>}
  </div>
}

/** Mixed card sizes, populated exclusively by the admin's Casino lounge collection. */
export default function CasinoLounge() {
  const { t } = useTranslation()
  const id = useId()
  const { items, loading, error, hasMore, loadMore, retry } = useCasinoLoungeGames()
  if (!loading && !error && items.length === 0) return null

  return <section className="lg" aria-labelledby={id} data-real-adapter="casino-lounge">
    <SectionHeader icon={<Sparkles className="nova-ex-strip-icon" aria-hidden="true" />} title={t('casinoLounge.title')} titleId={id}>
      <Link to="/casino" className="nova-ex-section-all">{t('exchangeHome.seeAll', { defaultValue: 'See All' })}</Link>
    </SectionHeader>
    {items.length > 0 && <div className={`lg-grid${items.length < 3 ? ` has-${items.length}` : ''}`}>
      {items.map((game, index) => <LoungeCard key={game.id} game={game} index={index} />)}
    </div>}
    {loading && <div className={`lg-loading${items.length ? ' is-more' : ''}`} role="status">
      <span className="sr-only">{t('nova.loadingCasino')}</span>
      {items.length ? <LoaderCircle className="lg-spinner" aria-hidden="true" /> : <><i /><i /><i /></>}
    </div>}
    {error && <div className="lg-feedback"><p role="alert">{error}</p><button type="button" onClick={retry} disabled={loading}>{t('casinoLounge.retry')}</button></div>}
    {hasMore && !loading && !error && <button type="button" className="lg-more" onClick={loadMore}>{t('casinoLounge.more')}</button>}
  </section>
}
