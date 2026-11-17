import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Radio, Ticket } from 'lucide-react'
import { useFeatureFlags, useSportsIconStyle } from '../../hooks/useAppSettings'
import { sportIcon, sportIconClass } from './exchange-home/exchangeShared'
import { ALL_SPORTS_SIDEBAR } from '../sports/allSportsList'
import { ChipIcon, CherriesIcon, MatkaIcon } from './productIcons'
import './mobile-menu.css'

/** The four sports the menu leads with, then In-Play (owner 2026-11-02: a "Top 5 sports" row). */
const TOP_SPORTS = ['cricket', 'football', 'tennis', 'horseracing']
/** Matchbook naming, as in the sidebar: the exchange calls football "Soccer". */
const sportLabel = (key: string, label: string) => (key === 'football' ? 'Soccer' : label)
const ALL_SPORTS_AZ = [...ALL_SPORTS_SIDEBAR].sort((a, b) => sportLabel(a.key, a.label).localeCompare(sportLabel(b.key, b.label)))

function Tile({ to, icon, label, active, className, onNavigate }: { to: string; icon: ReactNode; label: string; active: boolean; className: string; onNavigate: () => void }) {
  return <Link to={to} className={`${className}${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
    <span className="nova-mm-icon" aria-hidden="true">{icon}</span>
    <span className="nova-mm-label">{label}</span>
  </Link>
}

/**
 * The phone menu's body (NovaWorkspace's navigation drawer), laid out from the owner's reference of 2026-11-02:
 * a "Top 5 sports" row of square tiles, wide buttons for the products, then every sport as a grid of tiles.
 * Each part follows the whitelabel's product switches, like the sidebar and the bottom bar.
 */
export default function MobileMenuTiles({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useTranslation()
  const features = useFeatureFlags()
  const iconStyle = useSportsIconStyle()
  const { pathname, search } = useLocation()
  const selectedSport = pathname === '/sports' ? new URLSearchParams(search).get('sport') : null
  // The colourful set when the whitelabel chose one, else the list's own single-colour glyph (drawn white here).
  const icon = (key: string, src?: string) => {
    const colorful = sportIconClass(key, iconStyle)
    const image = colorful ? sportIcon(key, iconStyle) : src
    return image ? <img src={image} alt="" className={colorful} /> : null
  }
  const products = [
    ...(features.matkaEnabled ? [{ key: 'matka', to: '/matka', label: t('nav.matka', { defaultValue: 'Matka' }), icon: <MatkaIcon /> }] : []),
    ...(features.casinoEnabled ? [
      { key: 'casino', to: '/casino', label: t('nav.liveCasino'), icon: <ChipIcon /> },
      { key: 'slots', to: '/slots', label: t('nav.slots'), icon: <CherriesIcon /> },
    ] : []),
    { key: 'my-bets', to: '/my-bets', label: t('nav.myBets'), icon: <Ticket /> },
  ]

  return <div className="nova-mm">
    {features.sportsEnabled && <section className="nova-mm-section" aria-labelledby="nova-mm-top">
      <h3 id="nova-mm-top" className="nova-mm-heading">{t('mobileMenu.topSports', { defaultValue: 'Top 5 sports' })}</h3>
      <ul className="nova-mm-tiles is-top">
        {TOP_SPORTS.map(key => {
          const sport = ALL_SPORTS_SIDEBAR.find(item => item.key === key)
          return <li key={key}><Tile className="nova-mm-tile" to={`/sports?sport=${key}`} icon={icon(key, sport?.imageSrc)}
            label={sportLabel(key, sport?.label ?? key)} active={selectedSport === key} onNavigate={onNavigate} /></li>
        })}
        <li><Tile className="nova-mm-tile" to="/sports?sport=live" icon={<Radio />} label={t('nova.inPlay')} active={selectedSport === 'live'} onNavigate={onNavigate} /></li>
      </ul>
    </section>}

    <section className="nova-mm-section" aria-label={t('mobileMenu.products', { defaultValue: 'Products' })}>
      <ul className="nova-mm-wide">
        {products.map(item => <li key={item.key}><Tile className="nova-mm-wide-link" to={item.to} icon={item.icon} label={item.label}
          active={pathname.startsWith(item.to)} onNavigate={onNavigate} /></li>)}
      </ul>
    </section>

    {features.sportsEnabled && <section className="nova-mm-section" aria-labelledby="nova-mm-all">
      <h3 id="nova-mm-all" className="nova-mm-heading">{t('sidebar.allSports', { defaultValue: 'All Sports' })}</h3>
      <ul className="nova-mm-tiles is-grid">
        {ALL_SPORTS_AZ.map(sport => <li key={sport.key}><Tile className="nova-mm-tile" to={`/sports?sport=${sport.key}`} icon={icon(sport.key, sport.imageSrc)}
          label={sportLabel(sport.key, sport.label)} active={selectedSport === sport.key} onNavigate={onNavigate} /></li>)}
      </ul>
    </section>}
  </div>
}
