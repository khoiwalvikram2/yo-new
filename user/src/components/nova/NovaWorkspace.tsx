import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Activity, ArrowRight, ChevronRight, Clock3, Headphones, Menu, Settings2, ShieldCheck, Star, Ticket, Wallet, X } from 'lucide-react'
import type { EventItem } from '@/types'
import { useAuth } from '../../lib/auth'
import { useAppIdentity, useFeatureFlags, useParsedSettings } from '../../hooks/useAppSettings'
import { formatAmount } from '../../lib/currency'
import ThemeSwitch from '../ThemeSwitch'
import ChangePasswordModal from '../modals/ChangePasswordModal'
import AccountLinks from './AccountLinks'
import SportsList from '../sidebar/SportsList'
import { sports } from '../sidebar/navData'

type Panel = 'navigation' | 'matches' | 'account' | 'controls' | 'support'

/** The account drawer has no rail button: the header's account button (Topbar) opens it through these window
 *  events, `nova:toggle-panel` in and `nova:panel-change` out. */
export const TOGGLE_PANEL_EVENT = 'nova:toggle-panel'
export const PANEL_CHANGE_EVENT = 'nova:panel-change'
export type TogglePanelDetail = { panel: Panel; opener?: HTMLElement }

export function NovaUtilityRail() {
  return <NovaPanels />
}

export function NovaNavigationButton() {
  return <NovaPanels mobileNavigation />
}

function NovaPanels({ mobileNavigation = false }: { mobileNavigation?: boolean }) {
  const [panel, setPanel] = useState<Panel | null>(null)
  // The drawer slides out after it closes (nova-modals.css), so it keeps showing the last panel meanwhile.
  const [lastPanel, setLastPanel] = useState<Panel | null>(null)
  useEffect(() => { if (panel) setLastPanel(panel) }, [panel])
  const view = panel ?? lastPanel
  const dialog = useRef<HTMLDialogElement>(null)
  /** Rail button that opened the drawer; focus goes back to it on close. */
  const opener = useRef<HTMLElement | null>(null)
  const { pathname, search } = useLocation()
  const { isAuthenticated, openAuthModal, logout } = useAuth()
  const features = useFeatureFlags()
  const { supportEmail, supportPhone } = useAppIdentity()
  const { t } = useTranslation()
  const titles: Record<Panel, string> = {
    navigation: t('nova.exploreHomeGround'), matches: t('nova.matchCentre'), account: t('nova.yourAccount'),
    controls: t('nova.yourPreferences'), support: t('nova.helpSupport'),
  }

  useEffect(() => { setPanel(null) }, [pathname, search])
  useEffect(() => {
    const closeForChat = () => setPanel(null)
    window.addEventListener('support-chat:opening', closeForChat)
    return () => window.removeEventListener('support-chat:opening', closeForChat)
  }, [])
  // The mobile menu is a modal sheet. Rail drawers open non-modally over the right of the middle
  // section, so the page and the rail stay usable and another rail button switches the drawer.
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (panel && !element.open) {
      if (mobileNavigation) element.showModal()
      else element.show()
    }
    if (!panel && element.open) {
      const hadFocus = element.contains(document.activeElement)
      element.close()
      if (hadFocus) opener.current?.focus()
    }
  }, [panel, mobileNavigation])
  useEffect(() => () => { if (dialog.current?.open) dialog.current.close() }, [])
  // A non-modal dialog gets no Escape or backdrop handling of its own.
  useEffect(() => {
    if (mobileNavigation || !panel) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPanel(null) }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      // The rail buttons and the header account button toggle the drawer themselves.
      if (!target || dialog.current?.contains(target) || target.closest('.nova-utility-rail, .nova-profile-trigger')) return
      setPanel(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [panel, mobileNavigation])
  const toggle = useCallback((key: Panel, button: HTMLElement) => {
    opener.current = button
    setPanel(current => current === key ? null : key)
  }, [])
  useEffect(() => {
    if (mobileNavigation) return
    const onToggle = (event: Event) => {
      const { panel: key, opener: button } = (event as CustomEvent<TogglePanelDetail>).detail
      if (button) opener.current = button
      setPanel(current => current === key ? null : key)
    }
    window.addEventListener(TOGGLE_PANEL_EVENT, onToggle)
    return () => window.removeEventListener(TOGGLE_PANEL_EVENT, onToggle)
  }, [mobileNavigation])
  useEffect(() => {
    if (!mobileNavigation) window.dispatchEvent(new CustomEvent(PANEL_CHANGE_EVENT, { detail: { panel } }))
  }, [panel, mobileNavigation])

  const login = () => { setPanel(null); openAuthModal('login') }
  const signOut = () => { setPanel(null); logout() }
  const [passwordOpen, setPasswordOpen] = useState(false)
  const changePassword = () => { setPanel(null); setPasswordOpen(true) }
  const close = () => setPanel(null)
  const actions = [
    ...(features.sportsEnabled ? [{ key: 'matches' as const, label: t('nova.matchCentre'), icon: Activity }] : []),
    { key: 'controls' as const, label: t('nova.preferences'), icon: Settings2 },
    { key: 'support' as const, label: t('nova.helpSupport'), icon: Headphones },
  ]

  return <>
    {mobileNavigation ? (
      <button type="button" className="nova-menu-button" aria-label={t('nova.openNavigation')} aria-haspopup="dialog"
        onClick={() => setPanel('navigation')}><Menu size={20} /></button>
    ) : (
      <nav className="nova-utility-rail" aria-label={t('nova.workspaceShortcuts')} data-ui-radius="square">
        <div className="nova-utility-group">
          {actions.filter(({ key }) => key === 'matches').map(({ key, label, icon: Icon }) => <button key={key} type="button" aria-label={label}
            aria-haspopup="dialog" aria-pressed={panel === key} title={label} onClick={event => toggle(key, event.currentTarget)}><Icon size={20} /><span>{label}</span></button>)}
          <Link to="/my-bets" aria-label={t('nav.myBets')} title={t('nav.myBets')} aria-current={pathname.startsWith('/my-bets') ? 'page' : undefined}><Ticket size={20} /><span>{t('nav.myBets')}</span></Link>
        </div>
        <div className="nova-utility-group">
          {actions.filter(({ key }) => key === 'controls' || key === 'support').map(({ key, label, icon: Icon }) => <button key={key} type="button" aria-label={label}
            aria-haspopup="dialog" aria-pressed={panel === key} title={label} onClick={event => toggle(key, event.currentTarget)}><Icon size={20} /><span>{label}</span></button>)}
        </div>
      </nav>
    )}
    <dialog ref={dialog} className={`nova-panel ${mobileNavigation ? 'nova-navigation-panel' : 'nova-rail-panel'}`}
      aria-label={panel ? titles[panel] : t('nova.workspacePanel')} onCancel={close} onClose={event => { if (!event.currentTarget.open) close() }}
      onClick={event => { if (event.target === event.currentTarget) close() }}>
      <div className="nova-panel-content">
        <header><div><span className="nova-eyebrow">{t('nova.yourWorkspace')}</span><h2>{view ? titles[view] : ''}</h2></div>
          <button type="button" className="nova-icon-button" aria-label={t('nova.closePanel')} onClick={close}><X size={20} /></button></header>
        {view === 'navigation' && <>
          <nav className="nova-panel-links" aria-label={t('nova.mobileNavigation')}>
            <Link to="/" onClick={close}>{t('nav.home')} <ArrowRight size={16} /></Link>
            {features.sportsEnabled && <Link to="/sports" onClick={close}>{t('nova.allSports')} <ArrowRight size={16} /></Link>}
            <Link to="/my-bets" onClick={close}>{t('nav.myBets')} <Ticket size={16} /></Link>
            {features.matkaEnabled && <Link to="/matka" onClick={close}>{t('nav.matka', { defaultValue: 'Matka' })} <ArrowRight size={16} /></Link>}
            {features.casinoEnabled && <><Link to="/casino" onClick={close}>{t('nav.casino')} <ArrowRight size={16} /></Link>
              <Link to="/slots" onClick={close}>{t('nav.slots')} <ArrowRight size={16} /></Link></>}
            <Link to="/settings" onClick={close}>{t('nova.accountPreferences')} <Settings2 size={16} /></Link>
          </nav>
          <div className="nova-panel-mobile-theme">
            <span>{t('nova.lightDark')}</span>
            <ThemeSwitch />
          </div>
          {features.sportsEnabled && <div className="nova-panel-sports"><SportsList items={sports} initialActive="" /></div>}
        </>}
        {view === 'matches' && <div className="nova-panel-links">
          <p>{t('nova.matchesHelp')}</p>
          <Link to="/sports?sport=live" onClick={close}>{t('nova.inPlayMatches')} <Activity size={17} /></Link>
          <Link to="/sports" onClick={close}>{t('nova.fullSchedule')} <ArrowRight size={17} /></Link>
          <Link to="/my-bets" onClick={close}>{t('nova.yourBets')} <Ticket size={17} /></Link>
        </div>}
        {view === 'account' && (isAuthenticated
          ? <AccountLinks onClose={close} onChangePassword={changePassword} onLogout={signOut} />
          : <div className="nova-panel-links">
            <p>{t('nova.signInAccess')}</p>
            <button className="nova-button" type="button" onClick={login}>{t('nova.signIn')} <ArrowRight size={17} /></button>
          </div>)}
        {view === 'controls' && <div className="nova-panel-links">
          <div className="nova-panel-theme"><span>{t('nova.lightDark')}</span><ThemeSwitch /></div>
          <p>{t('nova.preferenceSaved')}</p>
          <Link to="/settings" onClick={close}>{t('nova.openPreferences')} <Settings2 size={17} /></Link>
          <Link to="/terms" onClick={close}>{t('nova.responsibleUse')} <ShieldCheck size={17} /></Link>
        </div>}
        {view === 'support' && <div className="nova-panel-links">
          <p>{t('nova.supportLead')}</p>
          {supportEmail && <a href={`mailto:${supportEmail}`}>{supportEmail}<ArrowRight size={17} /></a>}
          {supportPhone && <a href={`tel:${supportPhone.replace(/[^+\d]/g, '')}`}>{supportPhone}<Headphones size={17} /></a>}
          {!supportEmail && !supportPhone && <p className="nova-muted">{t('nova.supportUnavailable')}</p>}
          <Link to="/privacy" onClick={close}>{t('nova.privacyPolicy')} <ShieldCheck size={17} /></Link>
          <Link to="/terms" onClick={close}>{t('nova.termsConditions')} <ArrowRight size={17} /></Link>
        </div>}
      </div>
    </dialog>
    {!mobileNavigation && <ChangePasswordModal isOpen={passwordOpen} onClose={() => setPasswordOpen(false)} />}
  </>
}

export function NovaMatchDesk({ events = [], loading = false, error = null }: { events?: EventItem[]; loading?: boolean; error?: string | null }) {
  const { user, isAuthenticated, openAuthModal } = useAuth()
  const settings = useParsedSettings()
  const features = useFeatureFlags()
  const { t } = useTranslation()
  const credit = user?.playerType === 'AGENT_CREDIT' || user?.playerType === 'WHITELABEL_CREDIT'
  const quickLeagues = Array.from(new Map(events.map(event => [event.league, event])).values()).slice(0, 4)

  if (!features.sportsEnabled) return <aside className="nova-match-desk" aria-label={t('nova.accountWorkspace')}>
    <section className="nova-desk-card nova-wallet-card">
      <header><Wallet size={18} /><h3>{t('nova.yourWallet')}</h3></header>
      {isAuthenticated ? <>
        <dl><div><dt>{credit ? t('nova.availableCredit') : t('nova.mainBalance')}</dt><dd>{formatAmount(Number(credit ? user?.creditAvailable ?? 0 : user?.balance ?? 0))}</dd></div>
          <div><dt>{t('nova.openExposure')}</dt><dd>{formatAmount(Math.abs(Number(user?.exposure ?? 0)))}</dd></div></dl>
        <Link to="/statements" className="nova-text-link">{t('nova.viewStatements')} <ArrowRight size={15} /></Link>
        {!settings.hideDW && !credit && <Link to="/deposit" className="nova-button nova-button-secondary">{t('nova.manageFunds')} <ArrowRight size={15} /></Link>}
      </> : <><p>{t('nova.signInBalance')}</p>
        <button className="nova-button nova-button-secondary" type="button" onClick={() => openAuthModal('login')}>{t('nova.signIn')} <ArrowRight size={16} /></button></>}
    </section>
    <section className="nova-desk-card nova-context-preferences">
      <header><ShieldCheck size={18} /><h3>{t('nova.playPace')}</h3></header>
      <p>{t('nova.playPaceCopy')}</p>
      <Link className="nova-text-link" to="/settings">{t('nova.accountPreferences')} <ArrowRight size={15} /></Link>
    </section>
    <p className="nova-desk-note">18+ · {t('nova.accountDataNote')}</p>
  </aside>

  return <aside className="nova-match-desk" aria-label={t('nova.accountMatchWorkspace')}>
    <section className="nova-desk-card nova-slip-card">
      <header className="nova-desk-heading"><h3><Ticket size={18} /> {t('nova.yourBets')}</h3></header>
      <p>{t('nova.matchesHelp')}</p>
      <Link className="nova-text-link" to="/my-bets">{t('nova.yourBets')} <ChevronRight size={15} /></Link>
    </section>
    <section className="nova-desk-card nova-quick-card">
      <header className="nova-desk-heading"><h3><Star size={17} /> {t('nova.quickLeagues')}</h3></header>
      {quickLeagues.length > 0
        ? <div>{quickLeagues.map(event => <Link key={`${event.sport}-${event.league}`} to={`/sports?sport=${event.sport}`}><span>{event.league}</span><ChevronRight size={14} /></Link>)}</div>
        : <p role={loading ? 'status' : undefined}>{loading ? t('nova.loadingEvents') : error ? t('nova.eventLoadError') : t('nova.noFeaturedMatchCopy')}</p>}
      <Link className="nova-text-link" to="/sports">{t('nova.allSports')} <ArrowRight size={15} /></Link>
    </section>
    <section className="nova-desk-card nova-context-preferences">
      <header><ShieldCheck size={18} /><h3>{t('nova.playPace')}</h3></header>
      <p>{t('nova.playPaceCopy')}</p>
      <Link className="nova-text-link" to="/settings">{t('nova.accountPreferences')} <ArrowRight size={15} /></Link>
    </section>
    <Link className="nova-desk-session" to="/settings">
      <span><Clock3 size={17} /><strong>{t('nova.session')}</strong></span>
      <span>{t('nova.playControls')} <ChevronRight size={14} /></span>
    </Link>
    <p className="nova-desk-note">18+ · {t('nova.accountDataNote')}</p>
  </aside>
}
