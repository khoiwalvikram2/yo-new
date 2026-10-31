import { useEffect, useRef, useState, type RefObject } from 'react'
import clsx from 'clsx'
import { IconAdjustmentsHorizontal, IconArrowsMaximize, IconArrowsMinimize, IconBallFootball, IconBallTennis, IconChevronRight, IconCricket, IconRefresh, IconShield, IconStack2 } from '@tabler/icons-react'
import { useAuthStore } from '@/shared/core/authStore'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Button } from '@/ui/components/Button'
import { IconButton } from '@/ui/components/IconButton'
import { PageHeader } from '@/ui/components/PageHeader'
import { StatusPill } from '@/ui/components/StatusPill'
import { Switch } from '@/ui/components/Switch'
import { toast } from '@/ui/components/toast'
import styles from './EventHead.module.css'

interface EventHeaderControlsProps {
  eventName?: string; eventSport?: string; eventCompetition?: string; eventStartTime?: string | Date; isLive?: boolean
  /** The event's own status, shown in the head pill while the event is not live. */
  eventStatus?: string; eventCode?: string
  autoRefresh: boolean; setAutoRefresh: (value: boolean) => void; handleRefresh: () => void
  /** The page's note on what auto-refresh covers; it describes the switch. */
  autoRefreshNoteId?: string
  /** Kit "Markets only" (the layers button): the page hides its side rails. No button without the handler. */
  marketsOnly?: boolean; onToggleMarketsOnly?: () => void
  compactMode: boolean; setCompactMode: (value: boolean) => void; pageContainerRef: RefObject<HTMLDivElement>
  eventId?: string; onRiskConfigClick?: () => void; onAutomationConfigClick?: () => void
}
type VendorFullscreenElement = HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> | void; mozRequestFullScreen?: () => Promise<void> | void; msRequestFullscreen?: () => Promise<void> | void }
type VendorFullscreenDocument = Document & { webkitExitFullscreen?: () => Promise<void> | void; mozCancelFullScreen?: () => Promise<void> | void; msExitFullscreen?: () => Promise<void> | void; webkitFullscreenElement?: Element | null; mozFullScreenElement?: Element | null; msFullscreenElement?: Element | null }
const sportImages = import.meta.glob('@/assets/images/sports/*.{png,jpg,jpeg,svg,webp}', { eager: true, import: 'default' }) as Record<string, string>
const sportIconMap = Object.fromEntries(Object.entries(sportImages).map(([path, url]) => [(path.split('/').pop() || '').replace(/\.(png|jpg|jpeg|svg|webp)$/i, '').toLowerCase(), url]))
/* Leaving /sports/event/* is a full page load everywhere in the shell (shell/navClick.ts), so back is one too. */
const backToEvents = () => window.location.assign('/sports/events')
const statusLabel = (status?: string) => {
  const words = (status || 'upcoming').replace(/_/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function EventHeaderControls({ eventName, eventSport, eventCompetition, eventStartTime, isLive, eventStatus, eventCode, autoRefresh, setAutoRefresh, handleRefresh, autoRefreshNoteId, marketsOnly = false, onToggleMarketsOnly, compactMode, setCompactMode, pageContainerRef, eventId, onRiskConfigClick, onAutomationConfigClick }: EventHeaderControlsProps) {
  const { formatDateTime } = useFormatDate()
  const isAgent = useAuthStore(state => state.isAgent())
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const [fullscreenBusy, setFullscreenBusy] = useState(false)
  const fullscreenLock = useRef(false)
  useEffect(() => {
    const target = document as VendorFullscreenDocument
    const update = () => setCompactMode(Boolean(target.fullscreenElement || target.webkitFullscreenElement || target.mozFullScreenElement || target.msFullscreenElement))
    const events = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange']
    events.forEach(name => document.addEventListener(name, update))
    return () => { events.forEach(name => document.removeEventListener(name, update)) }
  }, [setCompactMode])
  const sportKey = (eventSport || '').toLowerCase().replace(/\s+/g, '-')
  const sportIconUrl = sportIconMap[sportKey]
  const SportIcon = sportKey === 'cricket' ? IconCricket : sportKey === 'tennis' ? IconBallTennis : IconBallFootball
  async function handleFullscreen() {
    if (fullscreenLock.current) return
    fullscreenLock.current = true
    setFullscreenBusy(true)
    try {
      if (!compactMode) {
        const element = pageContainerRef.current as VendorFullscreenElement | null
        const request = element && (element.requestFullscreen || element.webkitRequestFullscreen || element.mozRequestFullScreen || element.msRequestFullscreen)
        if (!element || !request) throw new Error('Fullscreen is not available in this browser.')
        await request.call(element)
        setCompactMode(true)
      } else {
        const target = document as VendorFullscreenDocument
        const exit = target.exitFullscreen || target.webkitExitFullscreen || target.mozCancelFullScreen || target.msExitFullscreen
        if (!exit) throw new Error('Fullscreen exit is not available in this browser.')
        await exit.call(target)
        setCompactMode(false)
      }
    } catch (reason) { toast({ tone: 'error', title: 'Fullscreen unavailable', message: reason instanceof Error ? reason.message : 'The browser could not change fullscreen mode.' }) }
    finally { fullscreenLock.current = false; setFullscreenBusy(false) }
  }
  const meta = [
    eventCompetition && <span key="competition">{eventCompetition}</span>,
    eventStartTime && <span key="start">{formatDateTime(eventStartTime, 'MMM d, HH:mm')}</span>,
    eventCode && <span key="code">Event {eventCode}</span>,
  ].filter(Boolean)
  return <div className={styles.head}>
    <PageHeader className={styles.pageHeader} back={{ label: 'Back to Running Events', onClick: backToEvents }}
      eyebrow={<span className={styles.crumb}>
        Trading<IconChevronRight size={12} aria-hidden="true" />Running Events
        {eventSport && <><IconChevronRight size={12} aria-hidden="true" />{eventSport}</>}
      </span>}
      title={<>{eventName || 'Event Details'}{isLive
        ? <StatusPill className={styles.state} tone="ok" icon={<span className={styles.dot} />}>In play</StatusPill>
        : <StatusPill className={styles.state} tone="neutral">{statusLabel(eventStatus)}</StatusPill>}</>}
      meta={<><span className={styles.tile}>{sportIconUrl && failedImage !== sportIconUrl ? <img src={sportIconUrl} alt={eventSport || 'Sport'} onError={() => setFailedImage(sportIconUrl)} /> : <SportIcon size={22} aria-hidden="true" />}</span>{meta.length > 0 ? <span className={styles.meta}>{meta}</span> : null}</>}
      actions={<>
        {!isAgent && eventId && onRiskConfigClick && <Button size="sm" aria-label="Risk Configuration" icon={<IconShield size={16} />} onClick={onRiskConfigClick}><span className={styles.desktopLabel}>Risk config</span></Button>}
        {!isAgent && eventId && onAutomationConfigClick && <Button size="sm" aria-label="Automation Configuration" icon={<IconAdjustmentsHorizontal size={16} />} onClick={onAutomationConfigClick}><span className={styles.desktopLabel}>Automation</span></Button>}
        <span className={styles.auto}>
          <Switch checked={autoRefresh} onChange={setAutoRefresh} label="Auto-refresh" size="sm" aria-describedby={autoRefreshNoteId} />
          <span className={styles.autoNote} aria-hidden="true">10s</span>
        </span>
        <IconButton className={styles.barIcon} label="Refresh now" icon={<IconRefresh size={18} />} onClick={handleRefresh} />
        {onToggleMarketsOnly && <IconButton className={styles.barIcon} label="Markets only" aria-pressed={marketsOnly} icon={<IconStack2 size={18} />} onClick={onToggleMarketsOnly} />}
        <IconButton className={clsx(styles.barIcon, styles.fullscreen)} label={compactMode ? 'Exit fullscreen' : 'Fullscreen'} icon={compactMode ? <IconArrowsMinimize size={18} /> : <IconArrowsMaximize size={18} />} disabled={fullscreenBusy} onClick={() => void handleFullscreen()} />
      </>} />
  </div>
}

