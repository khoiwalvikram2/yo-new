import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Home, Trophy, Ticket, Gamepad2, Rocket, X, ChevronDown, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getUserBets } from '@/lib/api/user'
import { useAuth } from '@/lib/auth'
import { BetListCard, formatStart } from '@/components/sports'
import { generateEventId } from '@/lib/sportsHelpers'
import { useTranslation } from 'react-i18next'
import { useFeatureFlags } from '../hooks/useAppSettings'

type TabItem = {
  key: 'home' | 'sports' | 'bet-slip' | 'casino' | 'slots' | 'matka'
  label: string
  to: string
  icon: (props: { className?: string }) => React.JSX.Element
}

export default function MobileTabBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const [showBetsDrawer, setShowBetsDrawer] = useState(false)
  const [bets, setBets] = useState<any[]>([])
  const [betsLoading, setBetsLoading] = useState(false)
  const [betsError, setBetsError] = useState(false)
  const requestId = useRef(0)
  const inFlightRequest = useRef<number | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const { user, isAuthenticated, isHydrating, openAuthModal } = useAuth()
  const userId = user?.id
  const { t } = useTranslation()
  const features = useFeatureFlags()

  // Group bets by event (same approach as desktop Active Bets)
  const groupedActiveBets = useMemo(() => {
    const groups = new Map<string, { name: string; items: any[]; eventId?: string }>()
    for (const bet of bets) {
      const evIdVal = String(bet?.eventId?.id || bet?.eventId?._id || bet?.eventId || bet?.eventName || '')
      const evName = bet?.eventId?.name || bet?.eventId?.slugName || bet?.eventName || 'Event'
      const key = evIdVal || `${evName}`
      if (!groups.has(key)) groups.set(key, { name: evName, items: [], eventId: evIdVal || undefined })
      const g = groups.get(key)!
      g.items.push(bet)
      if (!g.eventId && evIdVal) g.eventId = evIdVal
    }
    const result = Array.from(groups.entries()).map(([eventKey, value]) => ({ eventKey, name: value.name, items: value.items, eventId: value.eventId }))
    
    return result
  }, [bets])

  const [openEventKeys, setOpenEventKeys] = useState<Set<string>>(new Set())
  const [hasInitOpen, setHasInitOpen] = useState<boolean>(false)
  useEffect(() => {
    // Initialize once: open the first group only on first load
    if (!hasInitOpen && groupedActiveBets.length > 0) {
      const first = groupedActiveBets[0].eventKey
      setOpenEventKeys(new Set([first]))
      setHasInitOpen(true)
    }
  }, [groupedActiveBets, hasInitOpen])

  const toggleEventOpen = (key: string) => {
    setOpenEventKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const fetchBets = useCallback(async () => {
    if (!isAuthenticated || isHydrating || !features.sportsEnabled) return
    if (inFlightRequest.current === requestId.current) return
    const currentRequest = ++requestId.current
    inFlightRequest.current = currentRequest
    setBetsLoading(true)
    setBetsError(false)
    try {
      const res = await getUserBets({ openOnly: true })
      if (currentRequest !== requestId.current) return
      if (res?.meta?.code !== 200 || !Array.isArray(res.data)) throw new Error('Unavailable bets')
      // Match the existing My Bets page; P/L may be present on an open bet.
      const openOnly = res.data.filter(b => ['matched', 'unmatched', 'pending', 'open'].includes((b.status || '').toLowerCase()))
      setBets(openOnly)
    } catch {
      if (currentRequest !== requestId.current) return
      setBets([])
      setBetsError(true)
    } finally {
      if (inFlightRequest.current === currentRequest) inFlightRequest.current = null
      if (currentRequest === requestId.current) setBetsLoading(false)
    }
  }, [isAuthenticated, isHydrating, features.sportsEnabled, userId])

  useEffect(() => {
    if (!isAuthenticated || isHydrating || !features.sportsEnabled) {
      ++requestId.current
      setBets([])
      setBetsLoading(false)
      setBetsError(false)
      setShowBetsDrawer(false)
      setHasInitOpen(false)
      setOpenEventKeys(new Set())
      return
    }
    if (showBetsDrawer) void fetchBets()
    return () => { ++requestId.current }
  }, [showBetsDrawer, isAuthenticated, isHydrating, features.sportsEnabled, fetchBets])

  useEffect(() => {
    if (!showBetsDrawer) return
    const onPlaced = () => { void fetchBets() }
    window.addEventListener('stakex:bet-placed', onPlaced)
    return () => window.removeEventListener('stakex:bet-placed', onPlaced)
  }, [showBetsDrawer, fetchBets])

  const closeDrawer = useCallback(() => setShowBetsDrawer(false), [])
  useEffect(closeDrawer, [location.pathname, location.search, closeDrawer])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!showBetsDrawer || !dialog) return
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    closeRef.current?.focus()
    const onResize = () => { if (window.innerWidth >= 801) closeDrawer() }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (dialog.open) dialog.close()
      document.body.style.overflow = originalOverflow
      if (triggerRef.current?.isConnected) triggerRef.current.focus()
    }
  }, [showBetsDrawer, closeDrawer])
  const tabs: TabItem[] = useMemo(
    () => {
      const allTabs: TabItem[] = [
      { key: 'home', label: t('nav.home'), to: '/', icon: (p) => <Home className={p.className} /> },
      { key: 'sports', label: t('nav.sports'), to: '/sports', icon: (p) => <Trophy className={p.className} /> },
      { key: 'bet-slip', label: t('nav.betSlip'), to: '/sports', icon: (p) => <Ticket className={p.className} /> },
      { key: 'matka', label: t('nav.matka', { defaultValue: 'Matka' }), to: '/matka', icon: (p) => <Gamepad2 className={p.className} /> },
      { key: 'casino', label: t('nav.casino'), to: '/casino', icon: (p) => <Gamepad2 className={p.className} /> },
      { key: 'slots', label: t('nav.slots'), to: '/slots', icon: (p) => <Rocket className={p.className} /> },
      ]
      
      // Filter tabs based on feature flags
      return allTabs.filter(tab => {
        if (tab.key === 'home') return true
        if (tab.key === 'matka') return features.matkaEnabled
        if (tab.key === 'sports' || tab.key === 'bet-slip') return features.sportsEnabled
        if (tab.key === 'casino' || tab.key === 'slots') return features.casinoEnabled
        return true
      })
    },
    [t, features]
  )

  // The glow sits under the tab for the current route (or Bet Slip while its sheet is open); none on other pages.
  const activeIndex = showBetsDrawer
    ? tabs.findIndex(tab => tab.key === 'bet-slip')
    : tabs.findIndex(tab => tab.key !== 'bet-slip' && (tab.to === '/' ? location.pathname === '/' : location.pathname.startsWith(tab.to)))
  // Bet Slip is raised only when it is the middle tab (all five tabs); otherwise it is an ordinary tab.
  const centerIndex = tabs.length % 2 === 1 && tabs[Math.floor(tabs.length / 2)]?.key === 'bet-slip' ? Math.floor(tabs.length / 2) : -1

  return (
    <div className="nova-mobile-nav min-[801px]:hidden fixed bottom-0 left-0 right-0 z-[9999]" data-ui-radius="square">
      {/* Floating dock (topbar-controls.css): a red glow slides to the active tab; Bet Slip, when it is the middle
          tab, is a raised red button carrying the open-bet count. */}
      <nav
        className="nova-dock"
        data-ui-radius="square"
        aria-label="Primary navigation"
        role="navigation"
        style={{ '--dock-count': tabs.length, '--dock-active': Math.max(activeIndex, 0) } as React.CSSProperties}
      >
        <span className={`nova-dock-glow${activeIndex < 0 || activeIndex === centerIndex ? ' is-hidden' : ''}`} aria-hidden="true" />
        {tabs.map((tab, index) => tab.key === 'bet-slip' ? (
          <button
            key={tab.key}
            type="button"
            ref={triggerRef}
            disabled={isHydrating}
            aria-haspopup="dialog"
            aria-expanded={showBetsDrawer}
            onClick={() => { if (isAuthenticated) setShowBetsDrawer(true); else openAuthModal('login') }}
            className={`nova-dock-item${index === centerIndex ? ' is-center' : ''}${showBetsDrawer ? ' is-active' : ''}`}
            aria-label={t('mobile.openBetSlip')}
          >
            <span className="nova-dock-icon">
              <Ticket aria-hidden="true" />
              {bets.length > 0 && <b className="nova-dock-badge">{bets.length}</b>}
            </span>
            <span className="nova-dock-label">{tab.label}</span>
          </button>
        ) : (
          <NavTabLink key={tab.key} item={tab} />
        ))}
      </nav>

      {/* Bets Drawer - mobile only (stake state slate colors) */}
      {showBetsDrawer && (
        <dialog ref={dialogRef} className="nova-mobile-bets-dialog fixed inset-0 m-0 h-full w-full max-h-none max-w-none border-0 bg-transparent p-0 min-[801px]:hidden" aria-labelledby="mobile-bets-title" onCancel={closeDrawer} onClose={event => { if (!event.currentTarget.open) closeDrawer() }}>
          <button type="button" tabIndex={-1} aria-label={t('common.close')} className="absolute inset-0 bg-[color:var(--ds-color-slate-975)]/80 backdrop-blur-sm" onClick={closeDrawer} />
          <Drawer onClose={closeDrawer}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-750)]">
              <h2 id="mobile-bets-title" className="text-sm font-semibold text-[color:var(--ds-color-slate-100)]">{t('nav.myBets')}</h2>
              <div className="flex items-center gap-2">
                <button type="button" className="text-[11px] font-medium text-[color:var(--brand-primary)] hover:underline" onClick={() => { closeDrawer(); navigate('/sports') }}>{t('nav.goToSports')}</button>
                <button type="button" ref={closeRef} aria-label={t('common.close')} className="p-2 rounded-md hover:bg-[color:var(--ds-color-slate-700)] text-[color:var(--ds-color-slate-300)]" onClick={closeDrawer}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-3 pb-[calc(env(safe-area-inset-bottom)+24px)] bg-[color:var(--ds-color-slate-800)]" aria-busy={betsLoading}>
              {betsLoading ? <p role="status" className="py-10 text-center text-sm text-[color:var(--ds-color-slate-450)]">{t('userPanel.betsLoading', { defaultValue: 'Loading your bets…' })}</p> : betsError ? <div className="py-10 text-center text-sm">
                <p role="alert">{t('userPanel.betsError', { defaultValue: 'Could not load your bets. Please try again.' })}</p>
                <button type="button" className="nova-text-link mt-3" onClick={() => { void fetchBets() }}>{t('nova.tryAgain')}</button>
              </div> : groupedActiveBets.length === 0 ? (
                <div className="py-10 text-center text-[color:var(--ds-color-slate-450)] text-sm">{t('userPanel.betsEmpty', { defaultValue: 'No open bets' })}</div>
              ) : (
                <div className="space-y-2">
                  {groupedActiveBets.map(group => (
                    <div key={group.eventKey} className="rounded-lg border border-[color:var(--ds-color-slate-700)] overflow-hidden">
                      <div className="w-full flex items-center gap-1 bg-[color:var(--ds-color-slate-750)] hover:bg-[color:var(--ds-color-slate-700)] transition-colors">
                        <button type="button" onClick={() => toggleEventOpen(group.eventKey)} aria-expanded={openEventKeys.has(group.eventKey)} className="flex min-w-0 flex-1 items-center justify-between px-2.5 py-2 text-left">
                        <span className="flex items-center gap-2 min-w-0 pr-2">
                          <span className="text-xs font-semibold text-[color:var(--ds-color-slate-100)] truncate">{group.name}</span>
                        </span>
                        <span className="flex items-center gap-2 text-[10px] text-[color:var(--ds-color-slate-400)]">
                          <span>{group.items.length}</span>
                          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${openEventKeys.has(group.eventKey) ? 'rotate-180' : ''}`} />
                        </span>
                        </button>
                        <button type="button" onClick={() => {
                          const urlId = group.eventId ? `${generateEventId(group.name)}?id=${encodeURIComponent(group.eventId)}` : generateEventId(group.name)
                          closeDrawer()
                          navigate(`/sports/event/${urlId}`)
                        }} className="mr-2 p-1 rounded-md text-white bg-[color:var(--brand-primary)] hover:opacity-90 border border-[color:var(--brand-primary)]/50 shadow-sm" aria-label={t('userPanel.openEvent', { event: group.name, defaultValue: `Open ${group.name}` })}>
                          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                      {openEventKeys.has(group.eventKey) && (
                        <div className="p-2 space-y-2 bg-[color:var(--ds-color-slate-800)]/80">
                          {group.items.map((bet: any, idx: number) => {
                            const dateISO = bet?.createdAt || (bet?.eventId?.date ? new Date(bet.eventId.date).toISOString() : new Date().toISOString())
                            const { dayMon, time } = formatStart(dateISO)
                            const betType = (bet?.selectionType || bet?.side || '').toString().toLowerCase() === 'back' ? 'Back' : 'Lay'
                            const odds = Number(bet?.odds) || 0
                            const stake = Number(bet?.stake) || 0
                            const plComputed = odds > 0 ? (betType.toLowerCase() === 'lay' ? -(stake * Math.max(0, odds - 1)) : stake * Math.max(0, odds - 1)) : 0
                            const pl = typeof bet?.pl === 'number' ? bet.pl : plComputed
                            return (
                              <BetListCard
                                key={bet?.id || bet?._id || idx}
                                dateTime={`${dayMon} ${time}`}
                                betType={betType}
                                selection={bet?.selection || '-'}
                                odds={odds}
                                stake={stake}
                                potential={pl}
                              />
                            )
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Drawer>
        </dialog>
      )}
    </div>
  )
}

function Drawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<HTMLDivElement | null>(null)
  const startY = useRef<number | null>(null)
  const currentY = useRef<number>(0)
  const dragging = useRef<boolean>(false)

  useEffect(() => {
    const el = sheetRef.current
    const handle = handleRef.current
    if (!el || !handle) return

    const setTranslate = (y: number) => {
      el.style.transform = `translateY(${y}px)`
    }

    const pointerDown = (clientY: number, e?: Event) => {
      startY.current = clientY
      currentY.current = 0
      dragging.current = true
      if (e) { try { (e as any).preventDefault?.() } catch {} }
    }
    const pointerMove = (clientY: number, e?: Event) => {
      if (!dragging.current || startY.current === null) return
      currentY.current = Math.max(0, clientY - startY.current)
      setTranslate(currentY.current)
      if (e) { try { (e as any).preventDefault?.() } catch {} }
    }
    const pointerUp = () => {
      if (!dragging.current) return
      dragging.current = false
      if (currentY.current > 80) onClose()
      setTranslate(0)
      startY.current = null
      currentY.current = 0
    }

    // Pointer Events
    const onPointerDown = (e: PointerEvent) => pointerDown(e.clientY, e)
    const onPointerMove = (e: PointerEvent) => pointerMove(e.clientY, e)
    const onPointerUp = () => pointerUp()

    // Touch fallback (iOS older versions)
    const onTouchStart = (e: TouchEvent) => pointerDown(e.touches[0]?.clientY || 0, e)
    const onTouchMove = (e: TouchEvent) => pointerMove(e.touches[0]?.clientY || 0, e)
    const onTouchEnd = () => pointerUp()

    handle.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    handle.addEventListener('touchstart', onTouchStart, { passive: false })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd)
    return () => {
      handle.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      handle.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [onClose])

  return (
    <div ref={sheetRef} className="nova-mobile-bets-sheet absolute inset-x-0 bottom-0 flex flex-col min-h-[50vh] max-h-[70vh] bg-[color:var(--ds-color-slate-800)] border-t border-[color:var(--ds-color-slate-700)] rounded-t-2xl shadow-2xl overflow-hidden will-change-transform">
      {/* drag handle - stake state */}
      <div ref={handleRef} className="flex items-center justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing select-none touch-none">
        <div className="h-1.5 w-10 rounded-[5px] bg-[color:var(--ds-color-slate-600)]" />
      </div>
      {children}
    </div>
  )
}

function NavTabLink({ item }: { item: TabItem }) {
  const Icon = item.icon

  return (
    <NavLink
      to={item.to}
      aria-label={`Navigate to ${item.label}`}
      className={({ isActive }) => `nova-dock-item${isActive ? ' is-active' : ''}`}
      end={item.to === '/'}
    >
      <span className="nova-dock-icon"><Icon /></span>
      <span className="nova-dock-label">{item.label}</span>
    </NavLink>
  )
}

// Bet slip now navigates to Sports; inline slips open by tapping odds within markets


