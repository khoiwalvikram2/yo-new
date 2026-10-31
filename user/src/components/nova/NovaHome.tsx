import {
  ArrowRight,
  Gamepad2,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useFeatureFlags } from '../../hooks/useAppSettings'
import { useAppSettings } from '../../lib/app-settings'
import Banners from '../Banners'
import TopCasinoSlider from '../casino/TopCasinoSlider'
import { NovaMatchDesk } from './NovaWorkspace'
import NovaExchangeHome from './exchange-home/NovaExchangeHome'
import PopularNavigation from './exchange-home/PopularNavigation'
import MatkaStrip from './exchange-home/MatkaStrip'

export default function NovaHome() {
  const features = useFeatureFlags()
  const { advertisements } = useAppSettings()
  const { t } = useTranslation()

  if (!features.sportsEnabled) {
    const heroMode = features.casinoEnabled ? 'casino' : 'account'
    return <div className="nova-home nova-center-home nova-center-account">
      {advertisements.some(ad => ad.image) && <section className="nova-promotions nova-home-banners" aria-label={t('nova.platformPromotions')}><Banners /></section>}
      <PopularNavigation />
      <header className="nova-page-heading nova-page-heading-simple" data-page-header="title-only">
        <h1>{t('nova.findFavourite')}</h1>
      </header>
      <div className="nova-home-grid nova-home-grid-account">
        <div className="nova-home-main">
          <section className={`nova-hero nova-hero-${heroMode}`} aria-label={t('nova.platformDiscovery')}>
            <div className="nova-hero-copy">
              <span className="nova-eyebrow"><span className="nova-status-dot" /> {t('nova.homeGround')}</span>
              <h2>{features.casinoEnabled ? <>{t('nova.findYour')}<br /><em>{t('nova.favourite')}</em></> : <>{t('nova.yourSpace')}<br /><em>{t('nova.yourWay')}</em></>}</h2>
              <p>{features.casinoEnabled ? t('nova.casinoHeroCopy') : t('nova.accountHeroCopy')}</p>
              {features.casinoEnabled
                ? <Link to="/casino" className="nova-button">{t('nova.exploreCasino')} <ArrowRight size={18} /></Link>
                : <Link to="/settings" className="nova-button">{t('nova.yourAccount')} <ArrowRight size={18} /></Link>}
            </div>
            <span className="nova-hero-caption">{t('nova.generalCaption')}</span>
          </section>
          {features.matkaEnabled && <MatkaStrip />}
          {features.casinoEnabled && <section className="nova-casino-discovery" aria-label={t('nova.casinoDiscovery')}>
            <div className="nova-section-heading"><div><span className="nova-eyebrow">{t('nova.changePace')}</span><h2>{t('nova.differentGame')}</h2></div>
              <Link className="nova-text-link" to="/casino">{t('nova.exploreCasino')} <Gamepad2 size={17} /></Link></div>
            <TopCasinoSlider compact />
          </section>}
        </div>
        <NovaMatchDesk />
      </div>
    </div>
  }

  return <div className="nova-home nova-center-home nova-ex-home">
    <NovaExchangeHome />
  </div>
}
