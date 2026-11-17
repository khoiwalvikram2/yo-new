import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useApolloClient, useLazyQuery, useMutation } from '@apollo/client'
import clsx from 'clsx'
import {
  IconAlertTriangle,
  IconBan,
  IconBook,
  IconCalendar,
  IconChartLine,
  IconChartPie,
  IconCircle,
  IconClock,
  IconCoins,
  IconDoorEnter,
  IconDoorExit,
  IconDownload,
  IconFingerprint,
  IconFlag,
  IconHistory,
  IconListCheck,
  IconLock,
  IconMessage,
  IconPlayerPause,
  IconPlayerPlay,
  IconQuote,
  IconRefresh,
  IconSpeakerphone,
  IconTicket,
  IconTrendingUp,
  IconUser,
  IconX,
} from '@tabler/icons-react'
import { OperatorControls } from './components/OperatorControls'
import {
  WORLI_INSTANCE, WORLI_BOOK, WORLI_BETS, VOID_BET, WORLI_ACTIVITY,
  WORLI_INSTANCE_UPDATED, WORLI_BET_CREATED
} from './gql'
import { StatusChip } from './components/StatusChip'
import { ReasonModal } from './components/ReasonModal'
import { MatkaWhitelabelGate } from '../MatkaWhitelabelGate'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { DescriptionList, type DescriptionListItem } from '@/ui/components/DescriptionList'
import { EmptyState } from '@/ui/components/EmptyState'
import { FilterBar } from '@/ui/components/FilterBar'
import { IconButton } from '@/ui/components/IconButton'
import { Grid } from '@/ui/components/LayoutPrimitives'
import { ListRow } from '@/ui/components/ListRow'
import { LoadingState } from '@/ui/components/LoadingState'
import { Meter } from '@/ui/components/Meter'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { SearchField } from '@/ui/components/SearchField'
import { Select } from '@/ui/components/Select'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { Switch } from '@/ui/components/Switch'
import { Tabs, type TabItem } from '@/ui/components/Tabs'
import { Tooltip } from '@/ui/components/Tooltip'
import { strokeFor } from '@/ui/components/icons'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { toast } from '@/ui/components/toast'
import {
  BET_EXPORT_PAGE_SIZE,
  BET_PAGE_SIZES,
  BET_TYPE_OPTIONS,
  BOOK_SORT_OPTIONS,
  DEFAULT_BET_PAGE_SIZE,
  DETAIL_TITLE,
  LIST_PATH,
  actionErrorText,
  activityStyle,
  badgeCount,
  betStatusTone,
  bettingNote,
  bookBidTypes,
  canVoidBet,
  exposureLevelTone,
  filterBookGroups,
  formatRate,
  formatStatisticValue,
  instanceView,
  isBookSort,
  isValidInstanceId,
  loadErrorText,
  plSign,
  prependLiveBet,
  sessionFigures,
  shortId,
  shortUserId,
  summaryStatusTone,
  topRiskSelections,
  worliBetsCsv,
  worliBetsCsvName,
  type ActivityHue,
  type BookSort,
  type WorliActivityData,
  type WorliBet,
  type WorliBetCreatedData,
  type WorliBetsData,
  type WorliBookData,
  type WorliInstanceData,
  type WorliLiveBet,
  type WorliSession,
} from './runningMarketDetailModel'
import styles from './RunningMarketDetailPage.module.css'

type DetailTab = 'overview' | 'book' | 'bets' | 'activity'

const TABS_ID = 'worli-detail'
// The legacy tabs and their glyphs: chart-pie, book, list-check and clock-rotate-left.
const TAB_ITEMS: readonly TabItem<DetailTab>[] = [
  { value: 'overview', label: 'Overview', icon: <IconChartPie size={15} stroke={strokeFor(15)} /> },
  { value: 'book', label: 'Book Analysis', icon: <IconBook size={15} stroke={strokeFor(15)} /> },
  { value: 'bets', label: 'Bets', icon: <IconListCheck size={15} stroke={strokeFor(15)} /> },
  { value: 'activity', label: 'Activity Log', icon: <IconHistory size={15} stroke={strokeFor(15)} /> },
]

const ACTION_ICONS: Record<string, ReactNode> = {
  PAUSE: <IconPlayerPause size={17} stroke={strokeFor(17)} />,
  RESUME: <IconPlayerPlay size={17} stroke={strokeFor(17)} />,
  LOCK: <IconLock size={17} stroke={strokeFor(17)} />,
  CLOSE: <IconDoorExit size={17} stroke={strokeFor(17)} />,
  MESSAGE: <IconMessage size={17} stroke={strokeFor(17)} />,
  SUSPEND_ADJUST: <IconClock size={17} stroke={strokeFor(17)} />,
}

const HUE_CLASS: Record<ActivityHue, string> = {
  amb: styles.hueAmb,
  grn: styles.hueGrn,
  red: styles.hueRed,
  vio: styles.hueVio,
  blu: styles.hueBlu,
  ind: styles.hueInd,
  none: styles.hueNone,
}

export default function RunningMarketDetailPage() {
  // A Super Admin in core mode is asked for a whitelabel, as the Worli list asks: the server refuses a session in
  // that mode, which showed as a failed load with a toast before the page went back to the list.
  return (
    <RBACGuard required={[{ domain: 'matka.worli', actions: ['view', 'update'] }]}>
      <MatkaWhitelabelGate title={DETAIL_TITLE}>
        <RunningMarketDetailPageContent />
      </MatkaWhitelabelGate>
    </RBACGuard>
  )
}

/** Hands the browser a CSV file to save, as the live Matka bet list's export does. */
function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/** The operator message notice. Closing it hides it until the message is cleared and set again, as the legacy
 *  closable alert did (it stayed closed while it stayed mounted). */
function OperatorMessage({ message }: { message: string }) {
  const [closed, setClosed] = useState(false)
  if (closed) return null
  return (
    <Notice
      tone="info"
      icon={<IconSpeakerphone size={18} stroke={strokeFor(18)} />}
      title="Operator Message"
      action={(
        <IconButton
          label="Close"
          icon={<IconX size={15} stroke={strokeFor(15)} />}
          onClick={() => setClosed(true)}
        />
      )}
    >
      {message}
    </Notice>
  )
}

function RunningMarketDetailPageContent() {
  const params = useParams()
  const navigate = useNavigate()
  const client = useApolloClient()
  const pageEyebrow = usePageEyebrow()
  const { formatAmount, convertFromWhitelabelCurrency, getCurrencySymbol } = useCurrency()
  const { formatDate, formatTime } = useFormatDate()
  const id = params.id as string

  // Validate ID - UUIDs are 36 characters: 8-4-4-4-12 format
  const isValidId = isValidInstanceId(id)

  // Redirect if invalid ID (e.g., "running" from old navigation)
  useEffect(() => {
    if (id && !isValidId) {
      navigate('/matka/worli', { replace: true })
    }
  }, [id, isValidId, navigate])

  const [autoRefresh, setAutoRefresh] = useState(true)
  const [liveBets, setLiveBets] = useState<WorliLiveBet[]>([])
  const [tab, setTab] = useState<DetailTab>('overview')
  // A tab stays mounted once opened (hidden when another is shown), as the legacy antd Tabs kept its panes,
  // so its filters survive a tab switch and its poll keeps running.
  const [visited, setVisited] = useState<ReadonlySet<DetailTab>>(() => new Set<DetailTab>(['overview']))
  const newBetToast = useRef<number | null>(null)

  const { data, refetch, error, loading } = useQuery<WorliInstanceData>(WORLI_INSTANCE, {
    variables: { id },
    pollInterval: autoRefresh ? 5000 : 0,
    skip: !isValidId
  })
  const inst = data?.worliInstance
  // The live feeds start once the lookup has found the session. For an id with no session the server refused each
  // feed with the same "Market session not found" the lookup reports, so three identical toasts went up at once.
  // A feed that fails after the session was found still reaches the error link, which shows it.
  const sessionFound = Boolean(inst)

  // Redirect if instance not found (after query completes) or on error
  useEffect(() => {
    if (!isValidId) return
    // Only redirect if query completed and instance not found, or on error
    if (error || (!loading && data && !inst)) {
      const timer = setTimeout(() => {
        navigate('/matka/worli', { replace: true })
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [error, loading, data, inst, isValidId, navigate])

  // Real-time subscription for instance updates
  useEffect(() => {
    if (!isValidId || !sessionFound) return
    const sub = client.subscribe({
      query: WORLI_INSTANCE_UPDATED,
      variables: { id }
    }).subscribe({
      next: () => refetch(),
      error: () => {},
    })
    return () => sub.unsubscribe()
  }, [id, isValidId, sessionFound, client, refetch])

  // Real-time subscription for new bets
  useEffect(() => {
    if (!isValidId || !sessionFound) return
    const sub = client.subscribe<WorliBetCreatedData>({
      query: WORLI_BET_CREATED,
      variables: { instanceId: id }
    }).subscribe({
      next: ({ data: payload }) => {
        const newBet = payload?.worliBetCreated
        if (newBet) {
          setLiveBets(prev => prependLiveBet(prev, newBet))
          // antd's message key 'new-bet' kept a single toast: the next bet replaces the last one's.
          if (newBetToast.current !== null) toast.dismiss(newBetToast.current)
          newBetToast.current = toast({ message: 'New bet placed!', tone: 'ok', duration: 2000 })
        }
      },
      error: () => {},
    })
    return () => sub.unsubscribe()
  }, [id, isValidId, sessionFound, client])

  if (!inst) {
    const view = instanceView({
      isValidId,
      loading,
      hasError: Boolean(error),
      hasData: Boolean(data),
      hasInstance: false,
      errorMessage: error?.message,
    })
    if (view === 'loading') {
      return (
        <Page maxWidth="wide">
          <LoadingState label="Loading market details..." minHeight={256} />
        </Page>
      )
    }
    return (
      <Page maxWidth="wide">
        <PageHeader eyebrow={pageEyebrow} back={{ to: LIST_PATH, label: 'Back' }} title={DETAIL_TITLE} />
        <Notice
          tone={view === 'error' ? 'error' : 'warn'}
          live="polite"
          title={view === 'error' ? loadErrorText(error?.message) : 'Market not found'}
        >
          Returning to Worli Running Markets…
        </Notice>
      </Page>
    )
  }

  const figures = sessionFigures(inst)
  const levelTone = exposureLevelTone(figures.level)
  const symbol = getCurrencySymbol()
  const betting = bettingNote(inst.status, figures.betCount)

  const selectTab = (next: DetailTab) => {
    setTab(next)
    setVisited((previous) => (previous.has(next) ? previous : new Set([...previous, next])))
  }

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        back={{ to: LIST_PATH, label: 'Back' }}
        title={inst.marketName || 'Worli Market'}
        meta={(
          <span className={styles.headMeta}>
            <StatusPill tone="info">{`${inst.side} SESSION`}</StatusPill>
            <span className={styles.metaItem}>
              <IconCalendar size={14} stroke={strokeFor(14)} aria-hidden="true" />
              {inst.runDate ? formatDate(inst.runDate, 'dd MMM yyyy') : '—'}
            </span>
            <span className={styles.metaItem}>
              <IconFingerprint size={14} stroke={strokeFor(14)} aria-hidden="true" />
              <code className={styles.mono}>{shortId(id)}</code>
            </span>
          </span>
        )}
        actions={(
          <>
            <Tooltip content={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}>
              <Switch label="Auto-refresh" checked={autoRefresh} onChange={setAutoRefresh} />
            </Tooltip>
            <Button icon={<IconRefresh size={16} stroke={strokeFor(16)} />} onClick={() => void refetch()}>
              Refresh
            </Button>
            <StatusChip status={inst.status} lockAt={inst.scheduledLockAt} closeAt={inst.scheduledCloseAt} />
          </>
        )}
      />

      <div className={styles.content}>
        {inst.operatorMessage ? <OperatorMessage message={inst.operatorMessage} /> : null}

        {/* The four stat tiles; their columns follow the row's own width, not the viewport. */}
        <div className={styles.statsZone}>
          <div className={styles.stats} role="group" aria-label="Session statistics">
            <div className={styles.statTile}>
              <Stat
                variant="bare"
                label="Total Bets"
                value={formatStatisticValue(figures.betCount)}
                icon={<IconChartLine size={18} stroke={strokeFor(18)} />}
                hue="blu"
                note={(
                  <span className={styles.statNote}>
                    <StatusPill tone={betting.tone}>{betting.label}</StatusPill>
                    <span className={styles.activeBetting}>
                      {betting.open ? <IconTrendingUp size={13} stroke={strokeFor(13)} aria-hidden="true" /> : null}
                      {betting.text}
                    </span>
                  </span>
                )}
              />
            </div>
            <div className={styles.statTile}>
              <Stat
                variant="bare"
                label="Total Stakes"
                value={`${symbol}${formatStatisticValue(figures.totalStake, 2)}`}
                icon={<IconCoins size={18} stroke={strokeFor(18)} />}
                hue="grn"
                note={`Avg: ${formatAmount(figures.averageStake)}`}
              />
            </div>
            <div className={styles.statTile}>
              <Stat
                variant="bare"
                label="Exposure Risk"
                value={`${symbol}${formatStatisticValue(figures.exposure, 2)}`}
                icon={<IconAlertTriangle size={18} stroke={strokeFor(18)} />}
                hue="red"
                note={<StatusPill tone={levelTone.pill} className={styles.level}>{figures.level}</StatusPill>}
              />
              <Meter className={styles.statMeter} value={figures.exposurePercent} tone={levelTone.meter} />
            </div>
            <div className={styles.statTile}>
              <Stat
                variant="bare"
                label="Worst Outcome"
                value={figures.worstOutcome}
                icon={<IconFlag size={18} stroke={strokeFor(18)} />}
                hue="vio"
                tooltip="Worst case profit/loss scenario"
                note={(
                  <span className={figures.worstPL < 0 ? styles.negative : styles.positive}>
                    {plSign(figures.worstPL)}
                    {formatAmount(convertFromWhitelabelCurrency(Math.abs(figures.worstPL)))}
                  </span>
                )}
              />
            </div>
          </div>
        </div>

        {/* The session's three times. The legacy card had no heading; this one is titled so the outline keeps
            an h2 per card (BEYOND-MOCKUP copy, named in the record). */}
        <Card title="Session Times">
          <ul className={styles.schedule}>
            <li className={styles.scheduleItem}>
              <span className={clsx(styles.scheduleTile, styles.hueBlu)} aria-hidden="true">
                <IconDoorEnter size={18} stroke={strokeFor(18)} />
              </span>
              <span className={styles.scheduleText}>
                <span className={styles.scheduleLabel}>Open Time</span>
                <span className={styles.scheduleValue}>
                  {inst.scheduledOpenAt ? formatTime(inst.scheduledOpenAt, 'h:mm a') : '-'}
                </span>
              </span>
            </li>
            <li className={styles.scheduleItem}>
              <span className={clsx(styles.scheduleTile, styles.hueAmb)} aria-hidden="true">
                <IconLock size={18} stroke={strokeFor(18)} />
              </span>
              <span className={styles.scheduleText}>
                <span className={styles.scheduleLabel}>Lock Time</span>
                <span className={styles.scheduleValue}>
                  {inst.scheduledLockAt ? formatTime(inst.scheduledLockAt, 'h:mm a') : '-'}
                </span>
              </span>
            </li>
            <li className={styles.scheduleItem}>
              <span className={clsx(styles.scheduleTile, styles.hueRed)} aria-hidden="true">
                <IconDoorExit size={18} stroke={strokeFor(18)} />
              </span>
              <span className={styles.scheduleText}>
                <span className={styles.scheduleLabel}>Close Time</span>
                <span className={styles.scheduleValue}>
                  {inst.scheduledCloseAt ? formatTime(inst.scheduledCloseAt, 'h:mm a') : '-'}
                </span>
              </span>
            </li>
          </ul>
        </Card>

        <Card title="Operator Controls">
          <OperatorControls id={id} status={inst.status} canUnlock={inst.canUnlock} onDone={() => refetch()} />
        </Card>

        {liveBets.length > 0 ? (
          <Card
            title="Live Bets Feed"
            live
            tools={<StatusPill tone="ok">{`${liveBets.length} recent`}</StatusPill>}
            body="flush"
          >
            <div className={styles.feedScroller} tabIndex={0} role="region" aria-label="Live bets">
              <ul className={styles.feedList}>
                {liveBets.map((bet, idx) => (
                  <ListRow
                    key={`${bet.id}-${idx}`}
                    variant="stat"
                    icon={<IconTicket size={15} stroke={strokeFor(15)} />}
                    label={(
                      <>
                        <span className={styles.selection}>{bet.betNumbers}</span>{' '}
                        <span className={styles.muted}>({bet.bidType})</span>
                      </>
                    )}
                    sub={bet.createdAt ? formatTime(bet.createdAt, 'HH:mm:ss') : '—'}
                    value={(
                      <span className={styles.positive}>
                        {formatAmount(convertFromWhitelabelCurrency(Number(bet.betAmount)))}
                      </span>
                    )}
                  />
                ))}
              </ul>
            </div>
          </Card>
        ) : null}

        <div className={styles.tabs}>
          <Tabs label="Market details" idPrefix={TABS_ID} value={tab} items={TAB_ITEMS} onChange={selectTab} />
        </div>
        {TAB_ITEMS.map(({ value }) => (visited.has(value) ? (
          <div
            key={value}
            role="tabpanel"
            id={tabPanelId(TABS_ID, value)}
            aria-labelledby={tabId(TABS_ID, value)}
            hidden={tab !== value}
            className={styles.panel}
          >
            {value === 'overview' ? <OverviewTab instanceId={id} inst={inst} /> : null}
            {value === 'book' ? <BookView instanceId={id} side={inst.side} /> : null}
            {value === 'bets' ? <BetsTable instanceId={id} onRefetch={refetch} /> : null}
            {value === 'activity' ? <ActivityTimeline instanceId={id} /> : null}
          </div>
        ) : null))}
      </div>
    </Page>
  )
}

function OverviewTab({ instanceId, inst }: { instanceId: string; inst: WorliSession }) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const { formatDate } = useFormatDate()
  const { data } = useQuery<WorliBookData>(WORLI_BOOK, { variables: { instanceId, side: inst.side } })
  const book = data?.worliBook

  const topRisks = useMemo(() => topRiskSelections(book), [book])

  const summary: DescriptionListItem[] = [
    { key: 'market', term: 'Market ID', value: <code className={styles.mono}>{inst.marketId}</code> },
    { key: 'date', term: 'Run Date', value: inst.runDate ? formatDate(inst.runDate, 'dd MMM yyyy') : '—' },
    { key: 'session', term: 'Session', value: <StatusPill tone="info">{inst.side}</StatusPill> },
    {
      key: 'status',
      term: 'Status',
      value: <StatusPill tone={summaryStatusTone(inst.status)}>{inst.status}</StatusPill>,
    },
    {
      key: 'rules',
      term: 'Bid Rules Version',
      value: <code className={styles.mono}>{inst.bidRulesVersionId?.slice(0, 8) || '-'}</code>,
    },
  ]

  return (
    <>
      <Grid cols={{ base: 1, md: 2 }} gap={16}>
        <Card title="Market Summary">
          <DescriptionList items={summary} />
        </Card>

        <Card title="Top Risk Selections">
          {topRisks.length === 0 ? (
            <EmptyState inset="none" title="No risk data available" />
          ) : (
            <ol className={styles.rowList}>
              {topRisks.map((item, idx) => (
                <ListRow
                  key={`${item.bidType}-${item.selection}`}
                  variant="stat"
                  icon={<span className={styles.rank}>{idx + 1}</span>}
                  label={(
                    <>
                      <span className={styles.selection}>{item.selection}</span>{' '}
                      <span className={styles.muted}>({item.bidType})</span>
                    </>
                  )}
                  sub={`${item.betCount} bets`}
                  value={(
                    <span className={styles.negative}>
                      -{formatAmount(convertFromWhitelabelCurrency(Math.abs(item.plMinor / 100)))}
                    </span>
                  )}
                />
              ))}
            </ol>
          )}
        </Card>
      </Grid>

      {book?.groups ? (
        <Card title="Bid Type Distribution">
          <ul className={styles.distribution}>
            {book.groups.map((g) => (
              <li key={g.bidType} className={styles.distributionTile}>
                <span className={styles.distributionType}>{g.bidType}</span>
                <span className={styles.distributionCount}>{g.items.length}</span>
                <span className={styles.distributionUnit}>selections</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  )
}

function BookView({ instanceId, side }: { instanceId: string; side: 'OPEN'|'CLOSE' }) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const { data, loading } = useQuery<WorliBookData>(WORLI_BOOK, { variables: { instanceId, side } })
  const book = data?.worliBook
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<BookSort>('default')
  const [selectedType, setSelectedType] = useState<string>('all')

  const bidTypes = useMemo(() => bookBidTypes(book), [book])

  const filteredGroups = useMemo(
    () => filterBookGroups(book, { query, sort, selectedType }),
    [book, query, sort, selectedType],
  )

  if (loading) {
    return (
      <Card title="Book Analysis">
        <LoadingState label="Loading book data" minHeight={192} />
      </Card>
    )
  }

  if (!book) {
    return (
      <Card title="Book Analysis">
        <EmptyState inset="none" title="No book data available" />
      </Card>
    )
  }

  const totalStake = book.totalStakeMinor / 100

  return (
    <>
      <Card title="Book Analysis">
        {/* The sort orders the selections rather than narrowing them, so it is not counted or cleared. */}
        <FilterBar
          label="Book filters"
          activeCount={(query ? 1 : 0) + (selectedType !== 'all' ? 1 : 0)}
          onClearAll={() => {
            setQuery('')
            setSelectedType('all')
          }}
          search={(
            <SearchField
              label="Search selection"
              placeholder="Search selection..."
              size="sm"
              value={query}
              onChange={setQuery}
            />
          )}
          summary={(
            <>
              <span>Total Book Stake</span> <b>{formatAmount(convertFromWhitelabelCurrency(totalStake))}</b>
            </>
          )}
        >
          <Select
            label="Bid type"
            hideLabel
            size="sm"
            value={selectedType}
            options={[
              { label: 'All Types', value: 'all' },
              ...bidTypes.map((t) => ({ label: t, value: t })),
            ]}
            onChange={setSelectedType}
          />
          <Select
            label="Sort"
            size="sm"
            value={sort}
            options={BOOK_SORT_OPTIONS}
            onChange={(value) => {
              if (isBookSort(value)) setSort(value)
            }}
          />
        </FilterBar>
      </Card>

      <div className={styles.bookGrid}>
        {filteredGroups.map((g) => (
          <Card key={g.bidType} title={g.bidType} sub={`(${g.items.length} selections)`}>
            <div
              className={styles.selectionScroller}
              tabIndex={0}
              role="region"
              aria-label={`${g.bidType} selections`}
            >
              <ul className={styles.selectionGrid}>
                {g.items.map((i) => (
                  <li key={`${g.bidType}-${i.selection}`} className={styles.selectionTile}>
                    <span className={styles.selection}>{i.selection}</span>
                    <span className={styles.betBadge}>
                      {badgeCount(i.betCount)}
                      <span className={styles.srOnly}> bets</span>
                    </span>
                    <span
                      className={clsx(
                        styles.plFigure,
                        i.plMinor < 0 ? styles.negative : i.plMinor > 0 ? styles.positive : styles.muted,
                      )}
                    >
                      {plSign(i.plMinor)}
                      {formatAmount(convertFromWhitelabelCurrency(Math.abs(i.plMinor / 100)))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        ))}
      </div>
    </>
  )
}

function ActivityTimeline({ instanceId }: { instanceId: string }) {
  const { formatDateTime } = useFormatDate()
  const { data, loading } = useQuery<WorliActivityData>(WORLI_ACTIVITY, { variables: { instanceId }, pollInterval: 10000 })
  const items = data?.worliActivity || []

  if (loading) {
    return (
      <Card title="Activity Log">
        <LoadingState label="Loading activity" minHeight={192} />
      </Card>
    )
  }

  if (items.length === 0) {
    return (
      <Card title="Activity Log">
        <EmptyState inset="none" title="No activity recorded yet" />
      </Card>
    )
  }

  return (
    <Card title="Activity Log">
      <ol className={styles.activityList}>
        {items.map((a, idx) => {
          const look = activityStyle(a.action)
          return (
            <li key={a.id} className={styles.activityItem}>
              <span className={clsx(styles.activityTile, HUE_CLASS[look.hue])} aria-hidden="true">
                {ACTION_ICONS[a.action] ?? <IconCircle size={17} stroke={strokeFor(17)} />}
              </span>
              <div className={styles.activityBody}>
                <div className={styles.activityHead}>
                  <StatusPill tone={look.tone}>{a.action}</StatusPill>
                  <span className={styles.activityTime}>
                    {a.createdAt ? formatDateTime(a.createdAt, 'dd MMM yyyy, HH:mm:ss') : '—'}
                  </span>
                </div>
                {a.reason ? (
                  <blockquote className={styles.activityReason}>
                    <IconQuote size={13} stroke={strokeFor(13)} aria-hidden="true" />
                    <span>{a.reason}</span>
                  </blockquote>
                ) : null}
                <p className={styles.activityActor}>
                  <IconUser size={13} stroke={strokeFor(13)} aria-hidden="true" />
                  <code className={styles.mono}>{a.actorId}</code>
                </p>
              </div>
              <span className={styles.activityIndex} aria-hidden="true">{items.length - idx}</span>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}

function BetsTable({ instanceId, onRefetch }: { instanceId: string; onRefetch?: () => void }) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const { formatTime } = useFormatDate()
  const [bidType, setBidType] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [modalFor, setModalFor] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_BET_PAGE_SIZE)
  const { data, refetch, loading } = useQuery<WorliBetsData>(WORLI_BETS, {
    variables: { instanceId, filters: { bidType: bidType || undefined, search: searchQuery.trim() || undefined }, page, limit: pageSize },
    pollInterval: 5000
  })
  const [voidBet] = useMutation<{ voidMatkaBet?: { success: boolean; message: string } | null }>(VOID_BET)
  const [fetchBetsPage] = useLazyQuery<WorliBetsData>(WORLI_BETS, { fetchPolicy: 'network-only' })
  const [exporting, setExporting] = useState(false)
  const items = useMemo(() => data?.worliBets?.items || [], [data])

  const total = data?.worliBets?.total ?? 0
  const current = page
  const pageItems = items
  useEffect(() => { setPage(1) }, [instanceId, bidType, searchQuery])
  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))

  // Every bet the filters match, not just this page: the server hands them out 100 at a time.
  const exportCsv = async () => {
    setExporting(true)
    try {
      const filters = { bidType: bidType || undefined, search: searchQuery.trim() || undefined }
      const all: WorliBet[] = []
      for (let next = 1; ; next += 1) {
        const result = await fetchBetsPage({ variables: { instanceId, filters, page: next, limit: BET_EXPORT_PAGE_SIZE } })
        if (result.error) throw result.error
        const batch = result.data?.worliBets?.items ?? []
        all.push(...batch)
        if (!batch.length || all.length >= (result.data?.worliBets?.total ?? 0)) break
      }
      if (!all.length) {
        toast({ message: 'No bets to export', tone: 'info', duration: 3000 })
        return
      }
      downloadCsv(worliBetsCsvName(instanceId), worliBetsCsv(all))
    } catch (error) {
      toast({ title: 'Export failed', message: actionErrorText(error), tone: 'error' })
    } finally {
      setExporting(false)
    }
  }

  const columns: DataTableColumn<WorliBet>[] = [
    {
      key: 'userId',
      header: 'User ID',
      cell: (bet) => (
        <Tooltip content={bet.userId}>
          {/* Focusable so the full id is reachable from the keyboard. */}
          <span className={styles.userId} tabIndex={0}>{shortUserId(bet.userId)}</span>
        </Tooltip>
      ),
    },
    { key: 'bidType', header: 'Bid Type', cell: (bet) => <StatusPill tone="info">{bet.bidType}</StatusPill> },
    { key: 'betNumbers', header: 'Selection', cell: (bet) => <span className={styles.selection}>{bet.betNumbers}</span> },
    {
      key: 'betAmount',
      header: 'Stake',
      align: 'right',
      cell: (bet) => <span className={styles.amount}>{money(Number(bet.betAmount))}</span>,
    },
    { key: 'payoutMultiplier', header: 'Rate', align: 'right', cell: (bet) => formatRate(bet.payoutMultiplier) },
    {
      key: 'potentialWin',
      header: 'Potential Win',
      align: 'right',
      cell: (bet) => <span className={styles.amount}>{money(Number(bet.potentialWin))}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (bet) => <StatusPill tone={betStatusTone(bet.status)}>{bet.status}</StatusPill>,
    },
    {
      key: 'createdAt',
      header: 'Time',
      emphasis: 'dim',
      cell: (bet) => (bet.createdAt ? formatTime(bet.createdAt, 'HH:mm:ss') : '-'),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      sticky: 'end',
      cell: (bet) => (
        <Button
          variant="danger"
          size="xs"
          icon={<IconBan size={13} stroke={strokeFor(13)} />}
          disabled={!canVoidBet(bet.status)}
          onClick={() => setModalFor(bet.id)}
        >
          Void
        </Button>
      ),
    },
  ]

  return (
    <Card
      title="Bets"
      body="table"
      tools={(
        <>
          <Button
            size="sm"
            icon={<IconDownload size={16} stroke={strokeFor(16)} />}
            loading={exporting}
            onClick={() => void exportCsv()}
          >
            Export CSV
          </Button>
          <Button
            size="sm"
            icon={<IconRefresh size={16} stroke={strokeFor(16)} />}
            onClick={() => void refetch()}
            loading={loading}
          >
            Refresh
          </Button>
        </>
      )}
    >
      <FilterBar
        label="Bet filters"
        activeCount={(searchQuery ? 1 : 0) + (bidType ? 1 : 0)}
        onClearAll={() => {
          setSearchQuery('')
          setBidType('')
        }}
        search={(
          <SearchField
            label="Search bets"
            placeholder="Search by user ID, selection, or type..."
            size="sm"
            value={searchQuery}
            onChange={setSearchQuery}
          />
        )}
        summary={(
          <>
            <span>Total Bets</span> <b>{formatStatisticValue(total)}</b>
          </>
        )}
      >
        <Select
          label="Filter by bid type"
          hideLabel
          size="sm"
          value={bidType}
          options={BET_TYPE_OPTIONS}
          onChange={setBidType}
        />
      </FilterBar>

      <DataTable
        label="Bets"
        columns={columns}
        rows={pageItems}
        rowKey={(bet) => bet.id}
        width="wide"
        state={loading ? 'loading' : 'ready'}
        empty={<EmptyState inset="none" title="No data" />}
        pagination={total > 0
          ? {
              current,
              pageSize,
              total,
              onChange: setPage,
              onPageSizeChange: (next) => {
                setPageSize(next)
                setPage(1)
              },
              itemName: 'bets',
              pageSizeOptions: BET_PAGE_SIZES,
              formatSummary: ({ total }) => `Total ${total} bets`,
              variant: 'embedded',
            }
          : false}
      />

      <ReasonModal
        open={modalFor !== null}
        title="Confirm VOID Bet"
        onCancel={() => setModalFor(null)}
        onOk={async (reason) => {
          if (modalFor) {
            // A refusal is a { success: false } answer, not a GraphQL error: it keeps the prompt open with the
            // server's reason. The page reports the answer itself, once (the notification link is skipped).
            const result = await voidBet({ variables: { id: modalFor, reason }, context: { skipNotification: true } })
            const answer = result.data?.voidMatkaBet
            if (!answer?.success) throw new Error(answer?.message || 'The bet could not be voided')
            toast({ message: answer.message, tone: 'ok', duration: 3000 })
          }
          setModalFor(null)
          void refetch()
          onRefetch?.()
        }}
      />
    </Card>
  )
}
