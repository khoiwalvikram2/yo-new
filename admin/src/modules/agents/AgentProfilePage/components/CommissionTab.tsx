import { useState, useEffect, useMemo } from 'react'
import clsx from 'clsx'
import { IconArrowDownLeft, IconArrowUpRight, IconCash, IconCoins } from '@tabler/icons-react'
import { useQuery, NetworkStatus } from '@apollo/client'
import { COMMISSION_SUMMARY_QUERY, DIRECT_PLAYER_COMMISSION_SUMMARIES_QUERY } from '@/lib/graphql/agents'
import { COMMISSION_PAYOUTS_PAGE_QUERY, SUB_AGENT_COMMISSION_SUMMARIES_QUERY } from '@/lib/graphql/settlements'
import { CommissionViewBetsModal, type CommissionViewBetsParams } from '@/routes/commission/components/CommissionViewBetsModal'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useBreakpoint } from '@/shared/hooks/useBreakpoint'
import { AccountListMetric } from '@/modules/account-lists/AccountList'
import dayjs from 'dayjs'
import { nowIST, startOfWeek, DEFAULT_ADMIN_TZ } from '@/shared/utils/date'
import { Card } from '@/ui/components/Card'
import { Button } from '@/ui/components/Button'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Pagination } from '@/ui/components/Pagination'
import { DateField } from '@/ui/components/DateField'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { Notice } from '@/ui/components/Notice'
import { Skeleton } from '@/ui/components/Skeleton'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
import { StatusPill } from '@/ui/components/StatusPill'
import { commissionSegments } from '@/routes/commission/commissionOverviewModel'
import { CommissionCarryLines } from '@/routes/commission/components/CommissionCarryLines'
import { CommissionAdjustmentsSection } from '@/routes/commission/components/CommissionAdjustmentsSection'
import styles from './AgentProfileComponents.module.css'

const IST = DEFAULT_ADMIN_TZ

type DatePreset = 'today' | 'currentWeek' | 'lastWeek' | 'custom'

/**
 * Ranges in IST, aligned with Commission Dashboard / backend Monday–Monday cycle.
 * Current week = this Monday 00:00 to next Monday 00:00 (full Sunday included).
 * Last week = last Monday 00:00 to this Monday 00:00.
 */
function getRangeForPreset(preset: DatePreset): [dayjs.Dayjs, dayjs.Dayjs] {
  const n = nowIST()
  const nDate = n.toDate()
  const thisMonday = dayjs.tz(startOfWeek(nDate, IST), IST)
  switch (preset) {
    case 'today':
      return [n.startOf('day'), n.endOf('day')]
    case 'currentWeek':
      return [thisMonday, thisMonday.clone().add(7, 'day')]
    case 'lastWeek': {
      const lastMonday = thisMonday.clone().subtract(7, 'day')
      return [lastMonday, thisMonday]
    }
    default:
      return [n.subtract(30, 'days').startOf('day'), n.endOf('day')]
  }
}

/** Interpret picker calendar dates as IST and return [from, to] in IST. Uses date strings so parsing is unambiguously in IST. */
function rangePickerToIST(dates: [dayjs.Dayjs, dayjs.Dayjs] | null): [dayjs.Dayjs, dayjs.Dayjs] | null {
  if (!dates || !dates[0] || !dates[1]) return null
  const y0 = dates[0].year()
  const m0 = String(dates[0].month() + 1).padStart(2, '0')
  const d0 = String(dates[0].date()).padStart(2, '0')
  const y1 = dates[1].year()
  const m1 = String(dates[1].month() + 1).padStart(2, '0')
  const d1 = String(dates[1].date()).padStart(2, '0')
  const from = dayjs.tz(`${y0}-${m0}-${d0}`, IST).startOf('day')
  const to = dayjs.tz(`${y1}-${m1}-${d1}`, IST).endOf('day')
  return [from, to]
}

interface SubAgentSummary {
  agentId: string
  username: string | null
  pendingCommission: number
  totalPaid: number
  lastPaidAt: string | null
  sportsGGR?: number
  casinoGGR?: number
  matkaGGR?: number
  sportsCommission?: number
  casinoCommission?: number
  matkaCommission?: number
  sportsCommissionRate?: number
  casinoCommissionRate?: number
  matkaCommissionRate?: number
  currency?: string
  tallyEnabled?: boolean
  tallyDomains?: ('sports' | 'casino' | 'matka')[]
  effectiveCalculatedTotal?: number
  effectiveSportsCommission?: number
  effectiveCasinoCommission?: number
  effectiveMatkaCommission?: number
}

interface PlayerCommissionSummary {
  playerId: string
  playerName: string
  subAgentId?: string | null
  subAgentUsername?: string | null
  subAgentSportsRate?: number | null
  subAgentCasinoRate?: number | null
  subAgentMatkaRate?: number | null
  sportsGGR?: number
  casinoGGR?: number
  matkaGGR?: number
  sportsCommission?: number
  casinoCommission?: number
  matkaCommission?: number
  totalGGR?: number
  totalCommission?: number
}

type CycleTabKey = 'lastWeek' | 'currentWeek'

function getCycleRange(tab: CycleTabKey) {
  const n = nowIST()
  const thisMonday = dayjs.tz(startOfWeek(n.toDate(), IST), IST)
  if (tab === 'lastWeek') {
    const lastMonday = thisMonday.clone().subtract(7, 'day')
    return { from: lastMonday.format('YYYY-MM-DD'), to: thisMonday.format('YYYY-MM-DD') }
  }
  return { from: thisMonday.format('YYYY-MM-DD'), to: thisMonday.clone().add(7, 'day').format('YYYY-MM-DD') }
}

interface CommissionTabProps {
  agentId: string
  agent: { id: string; username?: string; phone?: string; allowedDomains?: string[]; commissionRates?: Array<{ domain: string; rate?: number }>; tallyEnabled?: boolean; tallyDomains?: string[] } | null
}

export function CommissionTab({ agentId, agent }: CommissionTabProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const { formatDate, formatDateTime } = useFormatDate()
  const [activePreset, setActivePreset] = useState<DatePreset>('currentWeek')
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>(() =>
    getRangeForPreset('currentWeek')
  )

  const [payoutPage, setPayoutPage] = useState(1)
  const [payoutPageSize, setPayoutPageSize] = useState(20)

  const periodFrom = dayjs.tz(dateRange[0].toDate(), IST).format('YYYY-MM-DD')
  const periodTo = dayjs.tz(dateRange[1].toDate(), IST).format('YYYY-MM-DD')

  const { data: commissionData, loading: commissionLoading, error: commissionError, refetch: refetchCommission, networkStatus: commissionNetStatus } = useQuery(
    COMMISSION_SUMMARY_QUERY,
    {
      variables: { agentId, periodFrom, periodTo },
      fetchPolicy: 'cache-and-network',
      notifyOnNetworkStatusChange: true,
      errorPolicy: 'all',
      skip: !agentId,
    }
  )

  useEffect(() => { setPayoutPage(1) }, [agentId, periodFrom, periodTo])

  const { data: payoutsData, loading: payoutsLoading, error: payoutsError, refetch: refetchPayouts, networkStatus: payoutsNetStatus } = useQuery(
    COMMISSION_PAYOUTS_PAGE_QUERY,
    {
      variables: { agentId, fromDate: periodFrom, toDate: periodTo, limit: payoutPageSize, offset: (payoutPage - 1) * payoutPageSize },
      fetchPolicy: 'cache-and-network',
      notifyOnNetworkStatusChange: true,
      errorPolicy: 'all',
      skip: !agentId,
    }
  )

  const isCommissionRefetching = commissionLoading || commissionNetStatus === NetworkStatus.refetch
  const isPayoutsRefetching = payoutsLoading || payoutsNetStatus === NetworkStatus.refetch

  const commission = commissionData?.agents?.commissionSummary
  // Until the first answer for a period the summary keeps its layout with placeholders.
  const commissionPending = isCommissionRefetching && !commission
  const payouts = payoutsData?.commissionPayoutsPage?.items || []

  // Sub-Agent Commission section state
  const [subAgentCycleTab, setSubAgentCycleTab] = useState<CycleTabKey>('currentWeek')
  const subAgentCycle = getCycleRange(subAgentCycleTab)
  const { data: subAgentData, loading: subAgentLoading, refetch: refetchSubAgent, networkStatus: subAgentNetStatus } = useQuery(
    SUB_AGENT_COMMISSION_SUMMARIES_QUERY,
    {
      variables: { agentId, periodFrom: subAgentCycle.from, periodTo: subAgentCycle.to },
      fetchPolicy: 'cache-and-network',
      notifyOnNetworkStatusChange: true,
      errorPolicy: 'all',
      skip: !agentId,
    }
  )
  const isSubAgentRefetching = subAgentLoading || subAgentNetStatus === NetworkStatus.refetch
  const subAgentSummaries = useMemo<SubAgentSummary[]>(() => subAgentData?.subAgentCommissionSummaries ?? [], [subAgentData])
  // The direct sub-agents over the SUMMARY period: their effective* (each child's gross) is this agent's Payable.
  const { data: summarySubAgentData, loading: summarySubAgentLoading } = useQuery(
    SUB_AGENT_COMMISSION_SUMMARIES_QUERY,
    {
      variables: { agentId, periodFrom, periodTo },
      fetchPolicy: 'cache-and-network',
      errorPolicy: 'all',
      skip: !agentId,
    }
  )
  const summarySubAgents = useMemo<SubAgentSummary[]>(() => summarySubAgentData?.subAgentCommissionSummaries ?? [], [summarySubAgentData])

  // Player Commission section state
  const [playerCycleTab, setPlayerCycleTab] = useState<CycleTabKey>('currentWeek')
  const playerCycle = getCycleRange(playerCycleTab)
  const { data: playerData, loading: playerLoading, refetch: refetchPlayer, networkStatus: playerNetStatus } = useQuery(
    DIRECT_PLAYER_COMMISSION_SUMMARIES_QUERY,
    {
      variables: { agentId, periodFrom: playerCycle.from, periodTo: playerCycle.to },
      fetchPolicy: 'cache-and-network',
      notifyOnNetworkStatusChange: true,
      errorPolicy: 'all',
      skip: !agentId,
    }
  )
  const isPlayerRefetching = playerLoading || playerNetStatus === NetworkStatus.refetch
  const playerSummaries = useMemo<PlayerCommissionSummary[]>(() => playerData?.agents?.directPlayerCommissionSummaries ?? [], [playerData])

  const subAgentCommissionTotals = useMemo(() => {
    let sports = 0, casino = 0, matka = 0
    for (const s of subAgentSummaries) {
      sports += Number(s.sportsCommission ?? 0)
      casino += Number(s.casinoCommission ?? 0)
      matka += Number(s.matkaCommission ?? 0)
    }
    return { sports, casino, matka }
  }, [subAgentSummaries])

  const playerCommissionTotals = useMemo(() => {
    let sports = 0, casino = 0, matka = 0
    for (const p of playerSummaries) {
      sports += Number(p.sportsCommission ?? 0)
      casino += Number(p.casinoCommission ?? 0)
      matka += Number(p.matkaCommission ?? 0)
    }
    return { sports, casino, matka }
  }, [playerSummaries])

  // View Bets modal state
  const [viewBetsOpen, setViewBetsOpen] = useState(false)
  const [viewBetsParams, setViewBetsParams] = useState<CommissionViewBetsParams | null>(null)

  useEffect(() => {
    refetchCommission()
    refetchPayouts()
  }, [periodFrom, periodTo, refetchCommission, refetchPayouts])

  // On a phone the domain table keeps the three commission columns; GGR and the rate go under the domain.
  const { isMobile } = useBreakpoint()
  const [subPage, setSubPage] = useState(1), [subPageSize, setSubPageSize] = useState(10)
  const [playerPage, setPlayerPage] = useState(1), [playerPageSize, setPlayerPageSize] = useState(10)
  if (!agent || !agentId) return <Notice>Agent data not available</Notice>
  const fmt = (amount: number) => formatAmount(convertFromWhitelabelCurrency(Number(amount || 0)))
  const domainConfigs = [
    { key: 'sports', label: 'Sports', ggr: 'sportsGGR', commission: 'sportsCommission', rate: 'sportsCommissionRate', net: 'netSportsCommission' },
    { key: 'casino', label: 'Casino', ggr: 'casinoGGR', commission: 'casinoCommission', rate: 'casinoCommissionRate', net: 'netCasinoCommission' },
    { key: 'matka', label: 'Matka', ggr: 'matkaGGR', commission: 'matkaCommission', rate: 'matkaCommissionRate', net: 'netMatkaCommission' },
  ] as const
  // Receivable = the backend GROSS after tally, cycle by cycle (not GGR x one rate); Payable = the direct
  // sub-agents' effective* over the same period (each child's gross, what it is paid); My Share = the backend net.
  const segments = commissionSegments(commission, summarySubAgents)
  const gross = domainConfigs.map(domain => segments.receivable[domain.key].commission)
  const net = domainConfigs.map(domain => segments.myShare[domain.key].commission)
  const payable = domainConfigs.map(domain => segments.payable[domain.key].commission)
  const totalGross = segments.receivable.totalCommission, totalNet = segments.myShare.totalCommission, totalPayable = segments.payable.totalCommission
  const payablePending = summarySubAgentLoading && !summarySubAgentData
  type Payout = { id?: string; createdAt?: string; periodFrom?: string; periodTo?: string; turnover?: number; amount?: number; notes?: string }
  const payoutColumns: DataTableColumn<Payout>[] = [
    { key: 'date', header: 'Date', cell: row => row.createdAt ? formatDateTime(row.createdAt, 'MMM d, yyyy HH:mm') : '—' },
    { key: 'period', header: 'Period', cell: row => <div className={styles.rowDetails}><span>{row.periodFrom ? formatDate(row.periodFrom, 'MMM d, yyyy') : '—'}</span><span className={styles.muted}>to {row.periodTo ? formatDate(row.periodTo, 'MMM d, yyyy') : '—'}</span></div> },
    { key: 'turnover', header: 'Turnover', align: 'right', cell: row => fmt(row.turnover || 0) },
    { key: 'amount', header: 'Amount Paid', align: 'right', cell: row => <strong className={styles.positive}>{fmt(row.amount || 0)}</strong> },
    { key: 'notes', header: 'Notes', cell: row => row.notes || '—' },
  ]
  const domainCell = (row: SubAgentSummary | PlayerCommissionSummary, domain: typeof domainConfigs[number]) => {
    const value = Number(row[domain.commission] ?? 0)
    return <div className={styles.rowDetails}><span className={styles.muted}>GGR {fmt(Number(row[domain.ggr] ?? 0))}</span><span className={value > 0 ? styles.positive : value < 0 ? styles.negative : styles.muted}>Comm {fmt(value)}</span>{'agentId' in row && <span className={styles.muted}>{(Number(row[domain.rate] ?? 0) * 100).toFixed(2)}%</span>}</div>
  }
  const subColumns: DataTableColumn<SubAgentSummary>[] = [
    { key: 'agent', header: 'Sub-Agent', cell: row => row.username || '—' },
    { key: 'tally', header: 'Tally', cell: row => <StatusPill tone={row.tallyEnabled && row.tallyDomains?.length ? 'info' : 'muted'}>{row.tallyEnabled && row.tallyDomains?.length ? `Tally ON: ${row.tallyDomains.map(domain => domain[0].toUpperCase() + domain.slice(1)).join(', ')}` : 'Tally OFF'}</StatusPill> },
    { key: 'pending', header: 'Total Pending', align: 'right', cell: row => fmt(Number(row.pendingCommission || 0)) },
    ...domainConfigs.map(domain => ({ key: domain.key, header: domain.label, align: 'right' as const, cell: (row: SubAgentSummary) => domainCell(row, domain) })),
    { key: 'paid', header: 'Total Paid', align: 'right', cell: row => fmt(Number(row.totalPaid || 0)) },
    { key: 'lastPaid', header: 'Last Paid', cell: row => row.lastPaidAt ? dayjs(row.lastPaidAt).format('DD MMM YYYY') : '—' },
    { key: 'actions', header: 'Actions', cell: row => <Button size="sm" onClick={() => { setViewBetsParams({ agentId: row.agentId, username: row.username, cycleFrom: subAgentCycle.from, cycleTo: subAgentCycle.to }); setViewBetsOpen(true) }}>View Bets</Button> },
  ]
  const playerColumns: DataTableColumn<PlayerCommissionSummary>[] = [
    { key: 'player', header: 'Player', cell: row => row.playerName || '—' },
    { key: 'subAgent', header: 'Sub-Agent', cell: row => {
      if (!row.subAgentUsername) return '—'
      const rate = (value: number) => (value * 100) % 1 === 0 ? `${value * 100}` : (value * 100).toFixed(1)
      return <div className={styles.rowDetails}><span>{row.subAgentUsername}</span><span className={styles.muted}>{[['S', row.subAgentSportsRate], ['C', row.subAgentCasinoRate], ['M', row.subAgentMatkaRate]].filter(([, value]) => value != null).map(([label, value]) => `${label}: ${rate(Number(value))}%`).join(' · ')}</span></div>
    } },
    ...domainConfigs.map(domain => ({ key: domain.key, header: domain.label, align: 'right' as const, cell: (row: PlayerCommissionSummary) => domainCell(row, domain) })),
    { key: 'total', header: 'Total Commission', align: 'right', cell: row => { const value = Number(row.totalCommission ?? 0); return <strong className={value > 0 ? styles.positive : value < 0 ? styles.negative : styles.muted}>{value > 0 ? '+' : ''}{fmt(value)}</strong> } },
    { key: 'actions', header: 'Actions', cell: row => <Button size="sm" onClick={() => { setViewBetsParams({ agentId: row.subAgentId || agentId, username: row.playerName, cycleFrom: playerCycle.from, cycleTo: playerCycle.to, playerId: row.playerId }); setViewBetsOpen(true) }}>View Bets</Button> },
  ]
  const cycleOptions = (['lastWeek', 'currentWeek'] as const).map(value => ({ value, label: `${value === 'lastWeek' ? 'Last Week' : 'Current Week'} (${dayjs(getCycleRange(value).from).format('DD MMM')} - ${dayjs(getCycleRange(value).to).subtract(1, 'day').format('DD MMM')})` }))
  const summaryDates = (from: string, to: string) => {
    const range = rangePickerToIST(from && to ? [dayjs(from), dayjs(to)] : null)
    setDateRange(range || [nowIST().subtract(30, 'days').startOf('day'), nowIST().endOf('day')])
  }
  const currentSubPage = Math.min(subPage, Math.max(1, Math.ceil(subAgentSummaries.length / subPageSize)))
  const currentPlayerPage = Math.min(playerPage, Math.max(1, Math.ceil(playerSummaries.length / playerPageSize)))

  // 2026-10-29 layout: the period and four headline figures, then every domain in one aligned table (it
  // replaces the GGR notice and the three side-by-side lists), then where the commission comes from (players,
  // sub-agents) and its records (payouts, adjustments).
  const PERIODS = [{ value: 'today', label: 'Today' }, { value: 'currentWeek', label: 'This week' }, { value: 'lastWeek', label: 'Last week' }, { value: 'custom', label: 'Custom' }] as const
  const choosePeriod = (value: string) => { const preset = value as DatePreset; setActivePreset(preset); if (preset !== 'custom') setDateRange(getRangeForPreset(preset)) }
  // A week runs Monday 00:00 to the next Monday 00:00: its last day is the Sunday before the end.
  const lastDay = activePreset === 'currentWeek' || activePreset === 'lastWeek' ? dateRange[1].clone().subtract(1, 'day') : dateRange[1]
  const rangeText = dateRange[0].isSame(lastDay, 'day') ? dateRange[0].format('DD MMM YYYY') : `${dateRange[0].format('DD MMM')} – ${lastDay.format('DD MMM YYYY')}`
  const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '-' : ''}${fmt(Math.abs(value))}`
  const later = (value: string) => payablePending ? <Skeleton width={72} height={10} /> : value
  const rateText = (value: unknown) => { const rate = Number(value ?? 0); return `${(rate <= 1 ? rate * 100 : rate).toFixed(2)}%` }
  type DomainRow = { key: string; label: string; allowed: boolean; ggr: number; rate: string; receivable: number; myShare: number; payable: number }
  // A domain the agent does not have shows as Off, with no rate: its zero rate is not a setting.
  const domainRows: DomainRow[] = domainConfigs.map((domain, index) => ({
    key: domain.key, label: domain.label, allowed: !agent.allowedDomains || agent.allowedDomains.includes(domain.key),
    ggr: Number(commission?.[domain.ggr] ?? 0), rate: !agent.allowedDomains || agent.allowedDomains.includes(domain.key) ? rateText(commission?.[domain.rate]) : '—',
    receivable: gross[index], myShare: net[index], payable: payable[index],
  }))
  const totalGgr = domainRows.reduce((sum, row) => sum + row.ggr, 0)
  const summaryFailed = Boolean(commissionError) && !commissionPending
  const hasSummary = Boolean(commission) || commissionPending
  const cycleTotals = (totals: { sports: number; casino: number; matka: number }) => `This cycle: Sports ${fmt(totals.sports)} · Casino ${fmt(totals.casino)} · Matka ${fmt(totals.matka)}`

  return <div className={clsx(styles.stack, styles.tabPanel)}>
    <Card title="Commission Summary" sub={`${rangeText} · ${commission?.currency || 'INR'}`} aria-busy={commissionPending || undefined} tools={<Button loading={isCommissionRefetching} onClick={() => { void refetchCommission(); void refetchPayouts() }}>Refresh</Button>}>
      <div className={styles.stack}>
        <div className={styles.period}>
          <SegmentedControl label="Commission period" size="sm" value={activePreset} options={PERIODS} onChange={choosePeriod} />
          {activePreset === 'custom' && <><DateField label="Commission From" size="sm" value={dateRange[0].format('YYYY-MM-DD')} onChange={from => summaryDates(from, dateRange[1].format('YYYY-MM-DD'))} /><DateField label="Commission To" size="sm" value={dateRange[1].format('YYYY-MM-DD')} onChange={to => summaryDates(dateRange[0].format('YYYY-MM-DD'), to)} /></>}
        </div>
        {summaryFailed ? <Notice tone="error" action={<Button onClick={() => { void refetchCommission(); void refetchPayouts() }}>Retry</Button>}>{commissionError?.message || 'Failed to load commission data'}</Notice>
          : hasSummary ? <div className={styles.tabKpis} role="group" aria-label="Commission figures">
            <AccountListMetric label="Receivable" value={fmt(totalGross)} note="Earned before sub-agents are paid" icon={<IconArrowDownLeft size={18} />} hue="grn" loading={commissionPending} />
            <AccountListMetric label="My Share" value={`${totalNet >= 0 ? '+' : ''}${fmt(totalNet)}`} note="Kept after the sub-agents' share" icon={<IconCoins size={18} />} hue="amb" loading={commissionPending} />
            <AccountListMetric label="Payable" value={fmt(totalPayable)} note="Owed to direct sub-agents" icon={<IconArrowUpRight size={18} />} hue="blu" loading={commissionPending || payablePending} />
            <AccountListMetric label="Total Earned" value={fmt(commission?.totalEarned || 0)} note={`Paid ${fmt(commission?.paid || 0)} · pending ${fmt(commission?.pending || 0)}`} icon={<IconCash size={18} />} hue="vio" loading={commissionPending} />
          </div>
          : <EmptyState title="No commission data available" />}
      </div>
    </Card>
    {!summaryFailed && hasSummary && <Card title="Commission by domain" sub="GGR, rate and each side of the commission" body="table">
      {commissionPending ? <LoadingState height={200} label="Loading commission by domain" /> : <>
        <DataTable<DomainRow> label="Commission by domain" rows={domainRows} rowKey={row => row.key} pagination={false} density={isMobile ? 'compact' : undefined} width={isMobile ? 'fill' : undefined} columns={[
          { key: 'domain', header: 'Domain', cell: row => isMobile ? <span className={styles.rowDetails}><span className={styles.inlineValue}><strong>{row.label}</strong>{row.allowed ? null : <StatusPill tone="muted">Off</StatusPill>}</span><span className={styles.muted}>{row.rate} · GGR {signed(row.ggr)}</span></span> : <span className={styles.inlineValue}><strong>{row.label}</strong>{row.allowed ? null : <StatusPill tone="muted">Off</StatusPill>}</span>, footer: <strong>Total</strong> },
          { key: 'ggr', header: 'GGR', align: 'right', hidden: isMobile, cell: row => signed(row.ggr), footer: signed(totalGgr) },
          { key: 'rate', header: 'Rate', align: 'right', hidden: isMobile, cell: row => row.rate },
          { key: 'receivable', header: 'Receivable', align: 'right', cell: row => fmt(row.receivable), footer: fmt(totalGross) },
          { key: 'myShare', header: 'My share', align: 'right', cell: row => fmt(row.myShare), footer: signed(totalNet) },
          { key: 'payable', header: 'Payable', align: 'right', cell: row => later(fmt(row.payable)), footer: later(fmt(totalPayable)) },
        ]} />
        <div className={styles.carry}><CommissionCarryLines figures={commission} format={fmt} multiWeek={activePreset === 'custom'} /></div>
      </>}
    </Card>}
    <Card title="Player Commission" sub={playerSummaries.length > 0 ? cycleTotals(playerCommissionTotals) : 'Per-player GGR and commission for every player in the downline'} body="table" tools={<Button size="sm" loading={isPlayerRefetching} onClick={() => void refetchPlayer()}>Refresh</Button>}>
      <div className={styles.tableTools}><div className={styles.tabs}><SegmentedControl label="Player cycle" value={playerCycleTab} options={cycleOptions} onChange={value => { setPlayerCycleTab(value); setPlayerPage(1) }} size="sm" /></div></div>
      <DataTable label="Player commission" columns={playerColumns} rows={playerSummaries.slice((currentPlayerPage - 1) * playerPageSize, currentPlayerPage * playerPageSize)} rowKey={row => row.playerId} state={isPlayerRefetching ? 'loading' : 'ready'} empty={<EmptyState title="No players with bets in this period" />} pagination={false} />
      <Pagination current={currentPlayerPage} pageSize={playerPageSize} total={playerSummaries.length} onChange={setPlayerPage} onPageSizeChange={size => { setPlayerPageSize(size); setPlayerPage(1) }} pageSizeOptions={[5, 10, 20, 50]} formatSummary={() => `Total ${playerSummaries.length} players`} />
    </Card>
    <Card title="Sub-Agent Commission" sub={subAgentSummaries.length > 0 ? cycleTotals(subAgentCommissionTotals) : 'Commission breakdown by sub-agent'} body="table" tools={<Button size="sm" loading={isSubAgentRefetching} onClick={() => void refetchSubAgent()}>Refresh</Button>}>
      <div className={styles.tableTools}><div className={styles.tabs}><SegmentedControl label="Sub-Agent cycle" value={subAgentCycleTab} options={cycleOptions} onChange={value => { setSubAgentCycleTab(value); setSubPage(1) }} size="sm" /></div></div>
      <DataTable label="Sub-agent commission" columns={subColumns} rows={subAgentSummaries.slice((currentSubPage - 1) * subPageSize, currentSubPage * subPageSize)} rowKey={row => row.agentId} state={isSubAgentRefetching ? 'loading' : 'ready'} empty={<EmptyState title="No sub-agents found" />} pagination={false} />
      <Pagination current={currentSubPage} pageSize={subPageSize} total={subAgentSummaries.length} onChange={setSubPage} onPageSizeChange={size => { setSubPageSize(size); setSubPage(1) }} pageSizeOptions={[5, 10, 20, 50]} formatSummary={() => `Total ${subAgentSummaries.length} sub-agents`} />
    </Card>
    <Card title="Commission Payout History" sub="Paid commissions" body="table" tools={<Button size="sm" loading={isPayoutsRefetching} onClick={() => void refetchPayouts()}>Refresh</Button>}><DataTable label="Commission payout history" columns={payoutColumns} rows={payouts} rowKey={row => String(row.id)} state={isPayoutsRefetching ? 'loading' : payoutsError ? 'error' : 'ready'} error={payoutsError?.message || 'Failed to load payouts'} onRetry={() => void refetchPayouts()} empty={<EmptyState title="No payout history" />} pagination={{ current: payoutPage, pageSize: payoutPageSize, total: payoutsData?.commissionPayoutsPage?.total ?? 0, onChange: setPayoutPage, onPageSizeChange: size => { setPayoutPageSize(size); setPayoutPage(1) } }} /></Card>
    <CommissionAdjustmentsSection agentId={agentId} username={agent.username} />
    <CommissionViewBetsModal open={viewBetsOpen} onClose={() => { setViewBetsOpen(false); setViewBetsParams(null) }} params={viewBetsParams} />
  </div>
}

