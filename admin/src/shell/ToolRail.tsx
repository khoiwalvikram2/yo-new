import { forwardRef, useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useApolloClient, useQuery } from '@apollo/client'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { IconBell, IconCircleCheck, IconDownload, IconFileExport, IconListCheck, IconMessageCircle, IconMinus, IconSparkles, IconStar,
  IconStarFilled, IconX } from '@tabler/icons-react'
import clsx from 'clsx'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useSidebarStore } from '@/state/sidebarStore'
import { Button } from '@/ui/components/Button'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/IconButton'
import { Spinner } from '@/ui/components/Spinner'
import { StatusPill } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import { AiAssistantPanel, ASSISTANT_SUB, ASSISTANT_TITLE } from '@/modules/aiAssistant/AiAssistantPanel'
import { EXPORT_JOBS_QUERY } from '@/routes/reporting/exportsPageQueries'
import { exportJobFilename, exportJobStatusLabel, exportTypeName, isPendingJob, type ExportJob } from '@/routes/reporting/exportsPageModel'
import { downloadExportFile } from '@/routes/reporting/exportsPageDownload'
import { NotificationList } from './topbar/NotificationList'
import { useNotificationBell, type NotificationBellState } from './topbar/useNotificationBell'
import { useTopbarRoles } from './topbar/useTopbarRoles'
import { FavoriteStar } from './FavoriteStar'
import { PanelRow } from './PanelRow'
import { normalizePath } from './paths'
import { resolveSavedViews, SAVED_VIEWS_LIMIT_MESSAGE } from './savedViews'
import type { ShellSection } from './shellTypes'
import styles from './ToolRail.module.css'

const EXPORT_CENTER_PATH = '/reporting/exports'
const LIVE_CHAT_PATH = '/support/live-chat'
export const TOOL_PANEL_ID = 'shell-tool-panel'

type Tool = 'assistant' | 'alerts' | 'tasks' | 'favourites' | 'exports'

interface RailButtonProps {
  icon: ReactNode
  label: string
  /** Unread or waiting items; the badge shows 99+ past 99. */
  count?: number
  expanded: boolean
  onClick: (button: HTMLButtonElement) => void
}

/** Kit .rail-btn: the glyph over a short label, a red count badge, a red tile while its panel is open. */
const RailButton = forwardRef<HTMLButtonElement, RailButtonProps>(function RailButton(
  { icon, label, count = 0, expanded, onClick }, ref) {
  return (
    <button ref={ref} type="button" className={styles.button} aria-haspopup="dialog" aria-expanded={expanded}
      aria-controls={expanded ? TOOL_PANEL_ID : undefined}
      aria-label={count > 0 ? `${label}, ${count} unread` : label} onClick={(event) => onClick(event.currentTarget)}>
      {icon}
      <span className={styles.label} aria-hidden="true">{label}</span>
      {count > 0 && <b className={styles.badge} aria-hidden="true">{count > 99 ? '99+' : count}</b>}
    </button>
  )
})

/** Alerts and Tasks: the topbar bell's own rows, Clear all and View all. */
function NotificationPanel({ state, category }: { state: NotificationBellState; category: 'general' | 'task' }) {
  const { formatAmount } = useCurrency()
  return <NotificationList variant="sheet" category={category} titleId={`tool-rail-${category}-title`} notifications={state.notifications}
    loading={state.listLoading} formatAmount={formatAmount} onNotificationClick={state.onNotificationClick}
    onMarkAllAsRead={state.onMarkAllAsRead} onViewAll={state.onViewAll} />
}

/** The saved views (the side panel's Saved views), and a star for the page in view. */
function FavouritesPanel({ sections, activeTo, onNavigate }: { sections: readonly ShellSection[]; activeTo: string | null; onNavigate: () => void }) {
  const favorites = useSidebarStore((state) => state.favorites)
  const maxFavorites = useSidebarStore((state) => state.maxFavorites)
  const addFavorite = useSidebarStore((state) => state.addFavorite)
  const removeFavorite = useSidebarStore((state) => state.removeFavorite)
  const rows = resolveSavedViews(favorites, sections)
  const current = activeTo === null ? undefined
    : sections.flatMap((section) => section.rows).find((row) => normalizePath(row.to) === activeTo)
  const currentSaved = current !== undefined && favorites.some((path) => normalizePath(path) === normalizePath(current.to))
  const atLimit = !currentSaved && favorites.length >= maxFavorites
  return <div className={styles.stack}>
    {current && <div className={styles.here}>
      <span className={styles.hereText}><small>This page</small><b>{current.label}</b><small>{current.sectionTitle}</small></span>
      <Button size="sm" variant={currentSaved ? 'secondary' : 'primary'} aria-pressed={currentSaved} disabled={atLimit}
        title={atLimit ? SAVED_VIEWS_LIMIT_MESSAGE : undefined}
        icon={currentSaved ? <IconStarFilled size={15} /> : <IconStar size={15} />}
        onClick={() => (currentSaved ? removeFavorite(current.to) : addFavorite(current.to, current.label, ''))}>
        {currentSaved ? 'Saved' : 'Save this page'}
      </Button>
    </div>}
    {atLimit && <p className={styles.note}>{SAVED_VIEWS_LIMIT_MESSAGE}</p>}
    {rows.length === 0 ? <EmptyState title="No saved pages yet" description="Save a page here to reach it from any screen in one click." />
      : <div className={styles.rows}>
        <p className={styles.heading}>Pages</p>
        {rows.map((row) => <PanelRow key={row.id} quiet row={row} isCurrent={normalizePath(row.to) === activeTo} announceCurrent={false}
          onNavigate={onNavigate} trailing={<FavoriteStar path={row.to} label={row.label} />} />)}
      </div>}
  </div>
}

/** The latest Export Center jobs: status, and a download once one is ready. Read only while open. */
function ExportsPanel() {
  const client = useApolloClient()
  const { data, loading, error, startPolling, stopPolling } = useQuery<{ exportJobs: ExportJob[] }>(EXPORT_JOBS_QUERY, {
    variables: { limit: 8 }, fetchPolicy: 'cache-and-network', errorPolicy: 'all',
  })
  const jobs = data?.exportJobs ?? []
  const pending = jobs.some(isPendingJob)
  // while a job is building, poll so it turns into a download in place
  useEffect(() => {
    if (pending) startPolling(5000)
    else stopPolling()
    return () => stopPolling()
  }, [pending, startPolling, stopPolling])
  if (loading && !jobs.length) return <div className={styles.loading}><Spinner size="md" /></div>
  if (error && !jobs.length) return <EmptyState title="Exports could not be loaded" description="Open the Export Center to try again." />
  if (!jobs.length) return <EmptyState title="No exports yet" description="Exports you start in the Export Center show here." />
  return <ul className={styles.jobs}>
    {jobs.map((job) => <li key={job.id} className={styles.job}>
      <span className={clsx(styles.jobIcon, job.status === 'completed' && styles.jobOk, job.status === 'failed' && styles.jobFail)} aria-hidden="true">
        {isPendingJob(job) ? <Spinner size="sm" /> : <IconFileExport size={17} stroke={1.6} />}
      </span>
      <span className={styles.jobMain}>
        <b>{exportTypeName(job.reportType)}</b>
        <small>{String(job.exportFormat || '').toUpperCase()} · {job.createdAt ? formatDistanceToNow(new Date(job.createdAt), { addSuffix: true }) : '—'}</small>
      </span>
      {job.status === 'completed'
        ? <Button size="sm" icon={<IconDownload size={15} />} aria-label={`Download ${exportTypeName(job.reportType)}`}
          onClick={() => void downloadExportFile(client, job.id, exportJobFilename(job))}>Download</Button>
        : <StatusPill status={job.status}>{exportJobStatusLabel(job.status)}</StatusPill>}
    </li>)}
  </ul>
}

export interface ToolRailProps {
  sections: readonly ShellSection[]
  /** the normalised path of the page in view (useShownSection) */
  activeTo: string | null
}

/**
 * The kit's right tool rail (.app-rail) and its panel, opened the way the player panel opens its rail
 * drawers: under the topbar, flush against the rail, over the right of the page and without a backdrop, so the
 * page and the rail stay in use. Another rail button switches the panel, its own button closes it, and Escape,
 * a press elsewhere in the shell or a page change close it. Both render as cells of the shell's content grid
 * (AppShell .withTools), so the panel's edges are the topbar's bottom and the rail's left, whatever their size.
 *
 * Tools: the AI assistant (administrators only), Alerts and Tasks (the topbar bells' data, for the roles that
 * had them), Favourites (saved pages), Exports (where the user has the Export Center).
 */
export function ToolRail({ sections, activeTo }: ToolRailProps) {
  const roles = useTopbarRoles()
  const user = useAuthStore((state) => state.user)
  const isAgent = useAuthStore((state) => state.isAgent())
  const tenant = useUIStore((state) => state.tenant)
  const directorMode = useUIStore((state) => state.directorMode)
  const selectedWhitelabel = useUIStore((state) => state.selectedWhitelabelId)
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const hasExportCenter = sections.some((section) => section.rows.some((row) => normalizePath(row.to) === EXPORT_CENTER_PATH))
  const hasLiveChat = !isAgent && sections.some((section) => section.rows.some((row) => normalizePath(row.to) === LIVE_CHAT_PATH))
  const canAssist = Boolean(user) && !isAgent

  const [tool, setTool] = useState<Tool | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const railRef = useRef<HTMLElement>(null)
  const titleId = useId()

  // The bells keep counting while the panel is closed; each reads only for a role that had its bell.
  const general = useNotificationBell('general', roles.showGeneralBell)
  const task = useNotificationBell('task', roles.showTaskBell)
  const { setOpen: setGeneralOpen } = general
  const { setOpen: setTaskOpen } = task
  // A bell's "open" drives its faster poll and its refetch on open.
  useEffect(() => { setGeneralOpen(tool === 'alerts') }, [tool, setGeneralOpen])
  useEffect(() => { setTaskOpen(tool === 'tasks') }, [tool, setTaskOpen])

  const toggle = (key: Tool, button: HTMLElement) => {
    opener.current = button
    setTool((current) => (current === key ? null : key))
  }
  /** Close, handing focus back to the rail button when it was inside the panel. */
  const close = useCallback(() => {
    if (panelRef.current?.contains(document.activeElement)) opener.current?.focus()
    setTool(null)
  }, [])

  useEffect(() => { setTool(null) }, [pathname, search])
  useEffect(() => { if (tool) panelRef.current?.focus({ preventScroll: true }) }, [tool])
  useEffect(() => {
    if (!tool) return
    const inShell = (node: EventTarget | null) => node instanceof Element && node.closest('[data-shell-root]') !== null
    const onKey = (event: KeyboardEvent) => {
      // Escape inside a layer the panel opened (a menu, a list, a dialog) belongs to that layer.
      if (event.key === 'Escape' && !event.defaultPrevented && (inShell(event.target) || event.target === document.body)) close()
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !inShell(target)) return
      if (panelRef.current?.contains(target) || railRef.current?.contains(target)) return
      setTool(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [tool, close])

  let title = ''
  let sub: ReactNode = null
  let body: ReactNode = null
  let foot: ReactNode = null
  if (tool === 'alerts' || tool === 'tasks') {
    const state = tool === 'alerts' ? general : task
    title = tool === 'alerts' ? 'Alerts' : 'Tasks'
    sub = state.unreadCount > 0 ? `${state.unreadCount} unread` : tool === 'alerts' ? 'Notifications' : 'Pending tasks'
    body = <NotificationPanel state={state} category={tool === 'alerts' ? 'general' : 'task'} />
    foot = <>
      {state.notifications.length > 0 && <Button variant="ghost" icon={<IconCircleCheck size={16} stroke={strokeFor(16)} />} onClick={() => void state.onMarkAllAsRead()}>Clear all</Button>}
      <Button onClick={state.onViewAll}>View all</Button>
    </>
  } else if (tool === 'favourites') {
    title = 'Favourites'
    sub = 'Saved pages'
    body = <FavouritesPanel sections={sections} activeTo={activeTo} onNavigate={() => setTool(null)} />
  } else if (tool === 'exports') {
    title = 'Exports'
    sub = 'Your latest report exports'
    body = <ExportsPanel />
    foot = <Button onClick={() => { setTool(null); navigate(EXPORT_CENTER_PATH) }}>Open Export Center</Button>
  } else if (tool === 'assistant') {
    title = ASSISTANT_TITLE
    sub = ASSISTANT_SUB
  }

  return <>
    <section ref={panelRef} id={TOOL_PANEL_ID} hidden={!tool} className={clsx(styles.panel, tool === 'assistant' && styles.assistantPanel)}
      role="dialog" aria-modal="false" aria-labelledby={titleId} tabIndex={-1} data-ui-radius="square">
      <header className={styles.panelHead} data-ui-radius="square">
        {tool === 'assistant' && <span className={styles.assistantMark} aria-hidden="true"><IconSparkles size={20}/></span>}
        <div className={styles.panelTitle}><div className={styles.titleRow}><h2 id={titleId}>{title}</h2>{tool === 'assistant' && <span className={styles.aiBadge} aria-hidden="true">AI</span>}</div>{sub && <p>{sub}</p>}</div>
        <div className={styles.panelHeadActions}>
          {tool === 'assistant' && <IconButton className={styles.panelClose} label={`Minimize ${title}`} icon={<IconMinus size={18} />} onClick={close}/>}
          <IconButton className={styles.panelClose} label={`Close ${title}`} icon={<IconX size={18} />} onClick={close} />
        </div>
      </header>
      {canAssist && <div hidden={tool !== 'assistant'} className={styles.assistantBody} data-ui-radius="square">
        <AiAssistantPanel key={`${user?.id}:${tenant}:${directorMode}:${selectedWhitelabel}`} open={tool === 'assistant'} surface="inline" onClose={close} />
      </div>}
      {tool && tool !== 'assistant' && <div className={clsx(styles.panelBody, (tool === 'alerts' || tool === 'tasks') && styles.panelBodyList)} data-ui-radius="square">{body}</div>}
      {foot && <footer className={styles.panelFoot} data-ui-radius="square">{foot}</footer>}
    </section>
    <aside ref={railRef} className={styles.rail} aria-label="Tools" data-ui-radius="square">
      {canAssist && <RailButton icon={<IconSparkles size={20} stroke={1.6} />} label="Assistant" expanded={tool === 'assistant'}
        onClick={(button) => toggle('assistant', button)} />}
      {roles.showGeneralBell && (general.initialLoading ? <span className={styles.skeleton} aria-hidden="true" />
        : <RailButton icon={<IconBell size={20} stroke={1.6} />} label="Alerts" count={general.unreadCount} expanded={tool === 'alerts'}
          onClick={(button) => toggle('alerts', button)} />)}
      {roles.showTaskBell && (task.initialLoading ? <span className={styles.skeleton} aria-hidden="true" />
        : <RailButton icon={<IconListCheck size={20} stroke={1.6} />} label="Tasks" count={task.unreadCount} expanded={tool === 'tasks'}
          onClick={(button) => toggle('tasks', button)} />)}
      <RailButton icon={<IconStar size={20} stroke={1.6} />} label="Favourites" expanded={tool === 'favourites'}
        onClick={(button) => toggle('favourites', button)} />
      {hasExportCenter && <RailButton icon={<IconDownload size={20} stroke={1.6} />} label="Exports" expanded={tool === 'exports'}
        onClick={(button) => toggle('exports', button)} />}
      {hasLiveChat && <NavLink to={LIVE_CHAT_PATH} className={clsx(styles.button, styles.chatShortcut)}
        aria-label="Live Chat" title="Live Chat Inbox" onClick={() => setTool(null)}>
        <IconMessageCircle size={20} stroke={1.6} aria-hidden="true" />
        <span className={styles.label} aria-hidden="true">Live Chat</span>
      </NavLink>}
    </aside>
  </>
}
