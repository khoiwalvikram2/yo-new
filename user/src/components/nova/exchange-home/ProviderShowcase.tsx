import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building2, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getCasinoGames, getCasinoProviders } from '@/lib/api/user'
import aviatrixLogo from '../../../assets/provider-logos/aviatrix.png'
import evolutionLogo from '../../../assets/provider-logos/evolution.png'
import ezugiLogo from '../../../assets/provider-logos/ezugi.png'
import jiliLogo from '../../../assets/provider-logos/jili.png'
import playngoLogo from '../../../assets/provider-logos/playngo.png'
import playtechLogo from '../../../assets/provider-logos/playtech.png'
import redTigerLogo from '../../../assets/provider-logos/red-tiger.png'
import smartsoftLogo from '../../../assets/provider-logos/smartsoft.png'
import spinomenalLogo from '../../../assets/provider-logos/spinomenal.png'
import spribeLogo from '../../../assets/provider-logos/spribe.png'
import tvbetLogo from '../../../assets/provider-logos/tvbet.png'
import wazdanLogo from '../../../assets/provider-logos/wazdan.png'
import { buildProviders, type ShowcaseProvider as Provider } from './providerModel'
import SectionHeader from './SectionHeader'
import './provider-showcase.css'

/**
 * Original logos we hold, keyed by the provider's name in letters and digits only (several API names share one).
 * Only these studios are shown (owner, 2026-10-30); a new logo here adds its studio to the home.
 */
const LOGOS: Record<string, string> = {
  evolution: evolutionLogo, evolutiongaming: evolutionLogo, ezugi: ezugiLogo, playtech: playtechLogo, playngo: playngoLogo,
  spribe: spribeLogo, jili: jiliLogo, redtiger: redTigerLogo, redtigerasia: redTigerLogo, wazdan: wazdanLogo,
  smartsoft: smartsoftLogo, spinomenal: spinomenalLogo, tvbet: tvbetLogo, aviatrix: aviatrixLogo,
}

/** The platform's active providers that we hold an original logo for, A to Z. */
function useProviders() {
  const [state, setState] = useState<{ providers: Provider[]; loading: boolean; error: boolean }>({ providers: [], loading: true, error: false })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setState(current => ({ ...current, loading: true, error: false }))
    getCasinoProviders()
      .then(response => {
        if (cancelled) return
        const list: Array<{ name?: string }> = Array.isArray(response?.data) ? response.data : []
        const providers = buildProviders(list.map(entry => String(entry?.name || '')), LOGOS).filter(provider => provider.logo)
        setState({ providers, loading: false, error: false })
      })
      .catch(() => { if (!cancelled) setState({ providers: [], loading: false, error: true }) })
    return () => { cancelled = true }
  }, [attempt])
  return { ...state, retry: () => setAttempt(value => value + 1) }
}

/**
 * One provider. A plain click asks the API where the studio has more games and opens that lobby filtered to it
 * (Spinomenal has 2 live tables and 532 slots); a modified click (new tab) or a failed check uses the live lobby.
 */
function ProviderTile({ provider }: { provider: Provider }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  const query = `?providers=${encodeURIComponent(provider.name)}`

  const open = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (busy) return
    setBusy(true)
    let lobby = '/casino'
    try {
      const [live, slots] = await Promise.all([
        getCasinoGames({ providers: [provider.name], liveOnly: true, page: 1, limit: 1 }),
        getCasinoGames({ providers: [provider.name], slots: true, page: 1, limit: 1 }),
      ])
      const total = (response: unknown) => Number((response as { meta?: { total?: unknown } })?.meta?.total) || 0
      if (total(slots) > total(live)) lobby = '/slots'
    } catch { /* the live lobby, filtered */ }
    if (mounted.current) setBusy(false)
    navigate(lobby + query)
  }

  return <Link to={`/casino${query}`} onClick={open} className="pv-tile" aria-busy={busy || undefined}
    aria-label={t('exchangeHome.providerGames', { defaultValue: '{{name}} games', name: provider.label })}>
    <span className="pv-plate">
      <img src={provider.logo} alt="" width={160} height={60} loading="lazy" decoding="async" draggable={false} />
      {provider.tagged && <span className="pv-tag" aria-hidden="true">{provider.label}</span>}
    </span>
    {busy && <span className="pv-busy" aria-hidden="true"><LoaderCircle /></span>}
  </Link>
}

/**
 * Game providers at the foot of the exchange home: the platform's active studios that have an original logo
 * (owner, 2026-10-30: the rest are left out). The plates stay light in both themes, the logos being dark ink.
 * With none to show, the section is left out; a failed request offers a retry.
 */
export default function ProviderShowcase() {
  const { t } = useTranslation()
  const { providers, loading, error, retry } = useProviders()
  if (!loading && !error && providers.length === 0) return null

  return <section className="pv" aria-labelledby="pv-title" data-real-adapter="casino-providers">
    <SectionHeader icon={<Building2 className="nova-ex-strip-icon" aria-hidden="true" />} title={t('exchangeHome.providers', { defaultValue: 'Game providers' })} titleId="pv-title" count={!loading && !error ? providers.length : undefined}>
      <Link to="/casino" className="nova-ex-section-all">{t('exchangeHome.seeAll', { defaultValue: 'See All' })}</Link>
    </SectionHeader>

    {loading
      ? <ul className="pv-grid is-skeleton" aria-busy="true">{Array.from({ length: Object.keys(LOGOS).length }, (_, index) => <li key={index}><span className="pv-tile" /></li>)}</ul>
      : error
        ? <div className="pv-note" role="alert"><p>{t('exchangeHome.providersError', { defaultValue: 'Providers could not be loaded.' })}</p><button type="button" onClick={retry}>{t('nova.tryAgain')}</button></div>
        : <ul className="pv-grid">
          {providers.map(provider => <li key={provider.name}><ProviderTile provider={provider} /></li>)}
        </ul>}
  </section>
}
