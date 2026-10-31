import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Card } from '@/ui/components/Card'
import { Stat } from '@/ui/components/Stat'
import { Button } from '@/ui/components/Button'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { DateRangeField } from '@/ui/components/DateRangeField'
import { FilterBar } from '@/ui/components/FilterBar'
import { Select } from '@/ui/components/Select'
import { Tabs } from '@/ui/components/Tabs'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { Notice } from '@/ui/components/Notice'
import { Skeleton } from '@/ui/components/Skeleton'
import { EmptyState } from '@/ui/components/EmptyState'
import { StatusPill } from '@/ui/components/StatusPill'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { commissionCycleWeeks, commissionRateLabel, commissionSegments, type CommissionSegment } from './commissionOverviewModel'
import styles from './CommissionDashboard.module.css'
import { useQuery } from '@apollo/client'
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/shared/core/authStore'
import { COMMISSION_SUMMARY_QUERY, DIRECT_PLAYER_COMMISSION_SUMMARIES_QUERY } from '@/lib/graphql/agents'
import {
  SUB_AGENT_COMMISSION_SUMMARIES_QUERY,
  CURRENT_COMMISSION_CYCLE_QUERY,
} from '@/lib/graphql/settlements'
import { CommissionViewBetsModal, type CommissionViewBetsParams } from '@/routes/commission/components/CommissionViewBetsModal'
import { CommissionCyclePayDialog } from '@/routes/commission/components/CommissionCyclePayDialog'
import { CommissionCarryLines } from '@/routes/commission/components/CommissionCarryLines'
import { useCurrency } from '@/shared/core/CurrencyContext'
import dayjs from 'dayjs'
import { nowIST } from '@/shared/utils/date'

const IST = 'Asia/Kolkata'

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

type SubAgentCycleTabKey = 'lastWeek' | 'currentWeek'
type PlayerCycleTabKey = 'lastWeek' | 'currentWeek'
type TopStatsPeriodTab = 'lastWeek' | 'currentWeek' | 'allTime' | 'custom'

type SegmentTotals = CommissionSegment

export default function CommissionDashboard() {
  const navigate = useNavigate()
  const agent = useAuthStore(s => s.agent)
  const eyebrow = usePageEyebrow()
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const [topStatsPeriod, setTopStatsPeriod] = useState<TopStatsPeriodTab>('currentWeek')
  const [customStatsRange, setCustomStatsRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null)
  const allTimeTo = nowIST().add(1, 'day').format('YYYY-MM-DD')

  const { data: currentCycleData } = useQuery(CURRENT_COMMISSION_CYCLE_QUERY, {
    skip: !agent?.id || agent?.schemeType !== 'COMMISSION',
    fetchPolicy: 'cache-and-network',
  })

  const currentCycle = currentCycleData?.currentCommissionCycle
  const currentCycleKey = currentCycle?.from ?? null
  // The open and the last closed IST weeks come from the backend (fromDate/toDate, previousFromDate/previousToDate).
  const cycleWeeks = commissionCycleWeeks(currentCycle)
  const cycleFromIST = cycleWeeks.currentFrom ? dayjs.tz(cycleWeeks.currentFrom, IST) : null
  const cycleToIST = cycleWeeks.currentTo ? dayjs.tz(cycleWeeks.currentTo, IST) : null
  const currentCycleFrom = cycleWeeks.currentFrom
  const currentCycleTo = cycleWeeks.currentTo
  const lastWeekFrom = cycleWeeks.lastFrom
  const lastWeekTo = cycleWeeks.lastTo
  const lastWeekCycleKey = lastWeekFrom ? dayjs.tz(lastWeekFrom, IST).toISOString() : null
  // Display as Monday–Sunday (cycle is Monday–next Monday; show end as Sunday for clarity)
  const lastWeekDisplayEnd = lastWeekTo ? dayjs.tz(lastWeekTo, IST).subtract(1, 'day') : null
  const currentWeekDisplayEnd = currentCycleTo ? dayjs.tz(currentCycleTo, IST).subtract(1, 'day') : null
  const lastWeekTooltip =
    lastWeekFrom && lastWeekDisplayEnd
      ? `${dayjs.tz(lastWeekFrom, IST).startOf('day').format('DD MMM YYYY, HH:mm:ss')} – ${dayjs.tz(lastWeekDisplayEnd.format('YYYY-MM-DD'), IST).endOf('day').format('DD MMM YYYY, HH:mm:ss')} (IST)`
      : null
  const currentWeekTooltip =
    currentCycleFrom && currentWeekDisplayEnd
      ? `${dayjs.tz(currentCycleFrom, IST).startOf('day').format('DD MMM YYYY, HH:mm:ss')} – ${dayjs.tz(currentWeekDisplayEnd.format('YYYY-MM-DD'), IST).endOf('day').format('DD MMM YYYY, HH:mm:ss')} (IST)`
      : null

  const topStatsPeriodDates = useMemo(() => {
    if (topStatsPeriod === 'lastWeek') return { from: lastWeekFrom, to: lastWeekTo }
    if (topStatsPeriod === 'currentWeek') return { from: currentCycleFrom, to: currentCycleTo }
    if (topStatsPeriod === 'custom' && customStatsRange) {
      return {
        from: dayjs.tz(customStatsRange[0].toDate(), IST).format('YYYY-MM-DD'),
        to: dayjs.tz(customStatsRange[1].toDate(), IST).format('YYYY-MM-DD'),
      }
    }
    return { from: '2000-01-01', to: allTimeTo }
  }, [topStatsPeriod, lastWeekFrom, lastWeekTo, currentCycleFrom, currentCycleTo, allTimeTo, customStatsRange])

  const { data: topStatsSummaryData, loading: topStatsSummaryLoading, error: commissionSummaryError, refetch: refetchTopStatsSummary } = useQuery(
    COMMISSION_SUMMARY_QUERY,
    {
      variables: {
        agentId: agent?.id,
        periodFrom: topStatsPeriodDates.from ?? undefined,
        periodTo: topStatsPeriodDates.to ?? undefined,
      },
      skip:
        !agent?.id ||
        agent?.schemeType !== 'COMMISSION' ||
        !topStatsPeriodDates.from ||
        !topStatsPeriodDates.to,
      errorPolicy: 'all',
      fetchPolicy: 'cache-and-network',
    }
  )
  const topStatsOwnSummary = topStatsSummaryData?.agents?.commissionSummary

  const { data: lastWeekSubAgentData } = useQuery(SUB_AGENT_COMMISSION_SUMMARIES_QUERY, {
    variables: {
      periodFrom: lastWeekFrom ?? undefined,
      periodTo: lastWeekTo ?? undefined,
      lastPaidBefore: lastWeekFrom ?? undefined,
    },
    skip: !agent?.id || agent?.schemeType !== 'COMMISSION' || !lastWeekFrom || !lastWeekTo,
    fetchPolicy: 'cache-and-network',
  })

  const { data: currentWeekSubAgentData } = useQuery(SUB_AGENT_COMMISSION_SUMMARIES_QUERY, {
    variables: {
      periodFrom: currentCycleFrom ?? undefined,
      periodTo: currentCycleTo ?? undefined,
    },
    skip: !agent?.id || agent?.schemeType !== 'COMMISSION' || !currentCycleFrom || !currentCycleTo,
    fetchPolicy: 'cache-and-network',
  })

  const { data: allTimeSubAgentData, loading: allTimeSubAgentLoading, refetch: refetchAllTimeSubAgents } = useQuery(
    SUB_AGENT_COMMISSION_SUMMARIES_QUERY,
    {
      variables: {
        periodFrom: '2000-01-01',
        periodTo: allTimeTo,
      },
      skip: !agent?.id || agent?.schemeType !== 'COMMISSION' || topStatsPeriod !== 'allTime',
      fetchPolicy: 'cache-and-network',
    }
  )

  const customPeriodFrom = customStatsRange ? dayjs.tz(customStatsRange[0].toDate(), IST).format('YYYY-MM-DD') : null
  const customPeriodTo = customStatsRange ? dayjs.tz(customStatsRange[1].toDate(), IST).format('YYYY-MM-DD') : null
  const { data: customSubAgentData, loading: customSubAgentLoading } = useQuery(
    SUB_AGENT_COMMISSION_SUMMARIES_QUERY,
    {
      variables: {
        periodFrom: customPeriodFrom ?? undefined,
        periodTo: customPeriodTo ?? undefined,
      },
      skip: !agent?.id || agent?.schemeType !== 'COMMISSION' || topStatsPeriod !== 'custom' || !customPeriodFrom || !customPeriodTo,
      fetchPolicy: 'cache-and-network',
    }
  )

  const [playerCycleTab, setPlayerCycleTab] = useState<PlayerCycleTabKey>('currentWeek')

  const playerPeriodFrom = playerCycleTab === 'lastWeek' ? lastWeekFrom : currentCycleFrom
  const playerPeriodTo = playerCycleTab === 'lastWeek' ? lastWeekTo : currentCycleTo

  const { data: playerCommissionData, loading: playerCommissionLoading } = useQuery(
    DIRECT_PLAYER_COMMISSION_SUMMARIES_QUERY,
    {
      variables: {
        periodFrom: playerPeriodFrom ?? undefined,
        periodTo: playerPeriodTo ?? undefined,
      },
      skip: !agent?.id || agent?.schemeType !== 'COMMISSION' || !playerPeriodFrom || !playerPeriodTo,
      fetchPolicy: 'cache-and-network',
    }
  )

  const playerSummaries = useMemo<PlayerCommissionSummary[]>(() => playerCommissionData?.agents?.directPlayerCommissionSummaries ?? [], [playerCommissionData])

  const playerCommissionTotals = useMemo(() => {
    let sports = 0
    let casino = 0
    let matka = 0
    for (const p of playerSummaries) {
      sports += Number(p.sportsCommission ?? 0)
      casino += Number(p.casinoCommission ?? 0)
      matka += Number(p.matkaCommission ?? 0)
    }
    return { sports, casino, matka }
  }, [playerSummaries])

  const [subAgentCycleTab, setSubAgentCycleTab] = useState<SubAgentCycleTabKey>('currentWeek')
  // Pay opens a picker of the sub-agent's closed, unpaid weeks (CommissionCyclePayDialog).
  const [subAgentPayTarget, setSubAgentPayTarget] = useState<{ agentId: string; username: string | null } | null>(null)
  const [subPage, setSubPage] = useState(1)
  const [subSize, setSubSize] = useState(10)
  const [playerPage, setPlayerPage] = useState(1)
  const [playerSize, setPlayerSize] = useState(10)
  const [viewBetsOpen, setViewBetsOpen] = useState(false)
  const [viewBetsParams, setViewBetsParams] = useState<CommissionViewBetsParams | null>(null)
  const payRefetchQueries = [
    { query: SUB_AGENT_COMMISSION_SUMMARIES_QUERY, variables: { periodFrom: lastWeekFrom ?? undefined, periodTo: lastWeekTo ?? undefined, lastPaidBefore: lastWeekFrom ?? undefined } },
    { query: SUB_AGENT_COMMISSION_SUMMARIES_QUERY, variables: { periodFrom: currentCycleFrom ?? undefined, periodTo: currentCycleTo ?? undefined } },
  ]

  const activeSubAgentCycleKey = subAgentCycleTab === 'lastWeek' ? lastWeekCycleKey : currentCycleKey
  const subAgentSummaries = useMemo<SubAgentSummary[]>(() =>
    subAgentCycleTab === 'lastWeek'
      ? (lastWeekSubAgentData?.subAgentCommissionSummaries ?? [])
      : (currentWeekSubAgentData?.subAgentCommissionSummaries ?? []), [subAgentCycleTab, lastWeekSubAgentData, currentWeekSubAgentData])
  const subAgentCommissionTotals = useMemo(() => {
    let sports = 0
    let casino = 0
    let matka = 0
    for (const s of subAgentSummaries) {
      sports += Number(s.sportsCommission ?? 0)
      casino += Number(s.casinoCommission ?? 0)
      matka += Number(s.matkaCommission ?? 0)
    }
    return { sports, casino, matka }
  }, [subAgentSummaries])

  const subAgentSummariesSorted = useMemo(() => {
    const totalComm = (s: SubAgentSummary) =>
      Number(s.sportsCommission ?? 0) + Number(s.casinoCommission ?? 0) + Number(s.matkaCommission ?? 0)
    return [...subAgentSummaries].sort((a, b) => {
      const ta = totalComm(a)
      const tb = totalComm(b)
      const aPos = ta > 0
      const bPos = tb > 0
      const aNeg = ta < 0
      const bNeg = tb < 0
      const aZero = ta === 0
      const bZero = tb === 0
      if (aPos && !bPos) return -1
      if (!aPos && bPos) return 1
      if (aPos && bPos) return tb - ta
      if (aNeg && bZero) return -1
      if (aZero && bNeg) return 1
      if (aNeg && bNeg) return ta - tb
      return 0
    })
  }, [subAgentSummaries])
  const fmt = (amount: number) => formatAmount(convertFromWhitelabelCurrency(Number(amount || 0)))


  const topStatsSegments = useMemo((): {
    lena: SegmentTotals
    dena: SegmentTotals
    apna: SegmentTotals
    currency: string
    lenaRates: { sports: number; casino: number; matka: number } | null
  } => {
    const own = topStatsOwnSummary
    const downlineList =
      topStatsPeriod === 'lastWeek'
        ? (lastWeekSubAgentData?.subAgentCommissionSummaries ?? []) as SubAgentSummary[]
        : topStatsPeriod === 'currentWeek'
          ? (currentWeekSubAgentData?.subAgentCommissionSummaries ?? []) as SubAgentSummary[]
          : topStatsPeriod === 'custom'
            ? (customSubAgentData?.subAgentCommissionSummaries ?? []) as SubAgentSummary[]
            : (allTimeSubAgentData?.subAgentCommissionSummaries ?? []) as SubAgentSummary[]

    // Receivable = the backend GROSS after tally, cycle by cycle (not GGR x one rate, wrong across weeks);
    // Payable = the sub-agents' effective* (each child's gross, what it is paid); My Share = the backend net.
    const { receivable: lena, payable: dena, myShare: apna } = commissionSegments(own, downlineList)

    const lenaRates =
      own && (
        own.sportsCommissionRate != null ||
        own.casinoCommissionRate != null ||
        own.matkaCommissionRate != null
      )
        ? {
            sports: Number(own.sportsCommissionRate ?? 0),
            casino: Number(own.casinoCommissionRate ?? 0),
            matka: Number(own.matkaCommissionRate ?? 0),
          }
        : null
    return {
      lena,
      dena,
      apna,
      currency: own?.currency ?? 'INR',
      lenaRates,
    }
  }, [
    topStatsPeriod,
    topStatsOwnSummary,
    lastWeekSubAgentData?.subAgentCommissionSummaries,
    currentWeekSubAgentData?.subAgentCommissionSummaries,
    customSubAgentData?.subAgentCommissionSummaries,
    allTimeSubAgentData?.subAgentCommissionSummaries,
  ])

  // Until the period's first answers the summary cards hold their layout with placeholders.
  const topStatsPending =
    (topStatsSummaryLoading && !topStatsSummaryData) ||
    (topStatsPeriod === 'allTime' && allTimeSubAgentLoading && !allTimeSubAgentData) ||
    (topStatsPeriod === 'custom' && customSubAgentLoading && !customSubAgentData)

  const domains = ['sports', 'casino', 'matka'] as const
  const cycleItems = [
    { value: 'lastWeek' as const, label: `Last Week${lastWeekFrom && lastWeekDisplayEnd ? ` (${dayjs(lastWeekFrom).format('DD MMM')} - ${lastWeekDisplayEnd.format('DD MMM')})` : ''}` },
    { value: 'currentWeek' as const, label: `Current Week${currentCycleFrom && currentWeekDisplayEnd ? ` (${dayjs(currentCycleFrom).format('DD MMM')} - ${currentWeekDisplayEnd.format('DD MMM')})` : ''}` },
  ]
  const money = (value: number) => <span className={value > 0 ? styles.positive : value < 0 ? styles.negative : styles.secondary}>{fmt(value)}</span>
  const breakdown = (record: SubAgentSummary | PlayerCommissionSummary, domain: typeof domains[number], rate = false) =>
    <div className={styles.breakdown}><span className={styles.secondary}>GGR {fmt(Number(record[`${domain}GGR`] ?? 0))}</span>
      <span>Comm {money(Number(record[`${domain}Commission`] ?? 0))}</span>
      {rate && <span className={styles.secondary}>{commissionRateLabel(Number((record as SubAgentSummary)[`${domain}CommissionRate`] ?? 0))}</span>}</div>
  const subColumns: DataTableColumn<SubAgentSummary>[] = [
    { key: 'agent', header: 'Sub-Agent', emphasis: 'key', cell: (record) => record.username || '—' },
    { key: 'tally', header: 'Tally', cell: (record) => <StatusPill tone={record.tallyEnabled && record.tallyDomains?.length ? 'info' : 'muted'}>
      {record.tallyEnabled && record.tallyDomains?.length ? `Tally ON: ${record.tallyDomains.map((domain) => domain[0].toUpperCase() + domain.slice(1)).join(', ')}` : 'Tally OFF'}</StatusPill> },
    { key: 'pending', header: 'Total Pending', align: 'right', cell: (record) => <strong>{fmt(Number(record.pendingCommission || 0))}</strong> },
    ...domains.map((domain): DataTableColumn<SubAgentSummary> => ({ key: domain, header: domain[0].toUpperCase() + domain.slice(1), align: 'right', cell: (record) => breakdown(record, domain, true) })),
    { key: 'paid', header: 'Total Paid', align: 'right', cell: (record) => fmt(Number(record.totalPaid || 0)) },
    { key: 'lastPaid', header: 'Last Paid', cell: (record) => record.lastPaidAt ? dayjs(record.lastPaidAt).format('DD MMM YYYY') : '—' },
    { key: 'actions', header: 'Actions', sticky: 'end', cell: (record) => <div className={styles.actions}>
      <Button size="sm" onClick={() => {
        setViewBetsParams({ agentId: record.agentId, username: record.username, activeCycleKey: activeSubAgentCycleKey ?? undefined,
          cycleFrom: subAgentCycleTab === 'lastWeek' ? lastWeekFrom ?? undefined : currentCycleFrom ?? undefined,
          cycleTo: subAgentCycleTab === 'lastWeek' ? lastWeekTo ?? undefined : currentCycleTo ?? undefined }); setViewBetsOpen(true)
      }}>View Bets</Button>
      <Button size="sm" onClick={() => navigate(`/commission/history?tab=subAgent&subAgentId=${encodeURIComponent(record.agentId)}`)}>History</Button>
      {/* Any closed, unpaid week can be paid from either tab: the dialog lists them (never the open week). */}
      <Button size="sm" variant="primary" onClick={() => setSubAgentPayTarget({ agentId: record.agentId, username: record.username })}>Pay</Button>
    </div> },
  ]
  const playerColumns: DataTableColumn<PlayerCommissionSummary>[] = [
    { key: 'player', header: 'Player', emphasis: 'key', cell: (record) => record.playerName || '—' },
    { key: 'agent', header: 'Sub-Agent', cell: (record) => !record.subAgentUsername ? '—' : <div className={styles.breakdown}>
      <strong>{record.subAgentUsername}</strong><span className={styles.secondary}>{domains.filter((domain) => record[`subAgent${domain[0].toUpperCase() + domain.slice(1)}Rate` as 'subAgentSportsRate'] != null)
        .map((domain) => `${domain[0].toUpperCase()}: ${commissionRateLabel(Number(record[`subAgent${domain[0].toUpperCase() + domain.slice(1)}Rate` as 'subAgentSportsRate']), 1)}`).join(' · ')}</span></div> },
    ...domains.map((domain): DataTableColumn<PlayerCommissionSummary> => ({ key: domain, header: domain[0].toUpperCase() + domain.slice(1), align: 'right', cell: (record) => breakdown(record, domain) })),
    { key: 'total', header: 'Total Commission', align: 'right', cell: (record) => <strong>{Number(record.totalCommission ?? 0) > 0 ? '+' : ''}{money(Number(record.totalCommission ?? 0))}</strong> },
    { key: 'actions', header: 'Actions', sticky: 'end', cell: (record) => <Button size="sm" onClick={() => {
      setViewBetsParams({ agentId: record.subAgentId || agent?.id || '', username: record.playerName,
        cycleFrom: playerPeriodFrom ?? undefined, cycleTo: playerPeriodTo ?? undefined, playerId: record.playerId }); setViewBetsOpen(true)
    }}>View Bets</Button> },
  ]
  const actualSubPage = Math.min(subPage, Math.max(1, Math.ceil(subAgentSummariesSorted.length / subSize)))
  const actualPlayerPage = Math.min(playerPage, Math.max(1, Math.ceil(playerSummaries.length / playerSize)))
  const header = <PageHeader title="Commission Dashboard" eyebrow={eyebrow} sub="View and manage commission earnings" />
  if (!agent?.id || agent.schemeType !== 'COMMISSION') return <Page>{header}<EmptyState title="Commission agent account required" /></Page>
  return <Page maxWidth="wide">{header}<div className={styles.workspace}>
    {currentCycle && <Notice tone="info">Settlement cycle: <strong>Monday–Monday IST</strong>. Current week (data): {currentCycleFrom ? dayjs.tz(currentCycleFrom, IST).format('DD MMM YYYY') : ''} – {currentWeekDisplayEnd?.format('DD MMM YYYY') ?? ''} (IST). Numbers for the current week are provisional.</Notice>}
    {commissionSummaryError && <Notice tone="error" title="Error Loading Commission Data">{commissionSummaryError.message}</Notice>}
    <FilterBar label="Commission period filters" activeCount={topStatsPeriod !== 'currentWeek' || customStatsRange ? 1 : 0}
      onClearAll={() => { setTopStatsPeriod('currentWeek'); setCustomStatsRange(null) }}>
      <Select label="Commission period" size="sm" value={topStatsPeriod} onChange={(value) => {
        setTopStatsPeriod(value as TopStatsPeriodTab)
        if (value === 'custom' && !customStatsRange && cycleFromIST && cycleToIST) setCustomStatsRange([cycleFromIST, cycleToIST])
      }} options={[{ label: 'All Time', value: 'allTime' }, { label: cycleItems[1].label, value: 'currentWeek' }, { label: cycleItems[0].label, value: 'lastWeek' }, { label: 'Custom range', value: 'custom' }]} />
      {topStatsPeriod === 'custom' && <DateRangeField label="Custom commission range" presets={[]}
        appliedPreset="custom" appliedFrom={customStatsRange?.[0].format('YYYY-MM-DD') ?? ''} appliedTo={customStatsRange?.[1].subtract(1, 'day').format('YYYY-MM-DD') ?? ''}
        onApply={(range) => { if (range.kind === 'custom') setCustomStatsRange([dayjs.tz(range.from, IST).startOf('day'), dayjs.tz(range.to, IST).add(1, 'day').startOf('day')]) }}
        onReset={() => setCustomStatsRange(cycleFromIST && cycleToIST ? [cycleFromIST, cycleToIST] : null)} />}
    </FilterBar>
    <Card title="GGR (Total & domain-wise)" sub={topStatsPending ? <Skeleton width={32} height={10} /> : topStatsSegments.currency} aria-busy={topStatsPending || undefined}><div className={styles.metrics}>
      <Stat variant="bare" size="compact" label="Total" value={fmt(topStatsSegments.lena.totalGgr)} loading={topStatsPending} />
      {domains.map((domain) => <Stat key={domain} variant="bare" size="compact" label={domain[0].toUpperCase() + domain.slice(1)} value={fmt(topStatsSegments.lena[domain].ggr)} loading={topStatsPending} />)}
    </div></Card>
    <div className={styles.summaries}>
      {([{ key: 'lena', title: 'Receivable' }, { key: 'apna', title: 'My Share' }, { key: 'dena', title: 'Payable' }] as const).map(({ key, title }) =>
        <Card key={key} title={title} sub={topStatsPending ? <Skeleton width={32} height={10} /> : topStatsSegments.currency} aria-busy={topStatsPending || undefined}><div className={styles.stack}>
          <Stat variant="bare" size="compact" label="Total commission" value={<>{key === 'apna' && topStatsSegments[key].totalCommission >= 0 ? '+' : ''}{money(topStatsSegments[key].totalCommission)}</>} loading={topStatsPending} />
          <dl className={styles.domainList}>{domains.map((domain) => <div key={domain}><dt>{domain[0].toUpperCase() + domain.slice(1)}
            {key === 'lena' && topStatsSegments.lenaRates && <span className={styles.secondary}> ({commissionRateLabel(topStatsSegments.lenaRates[domain], 2, true)})</span>}</dt>
            <dd>{topStatsPending ? <Skeleton width={72} height={10} /> : fmt(topStatsSegments[key][domain].commission)}</dd></div>)}</dl>{key === 'lena' && !topStatsPending && <CommissionCarryLines figures={topStatsOwnSummary} format={fmt} multiWeek={topStatsPeriod === 'allTime' || topStatsPeriod === 'custom'} />}
        </div></Card>)}
    </div>
    <Card title="Sub-Agent Commission" sub="Settle commission and view bet-level breakdown by cycle" body="table">
      <div className={styles.tableControls} title={subAgentCycleTab === 'lastWeek' ? lastWeekTooltip ?? undefined : currentWeekTooltip ?? undefined}>
        <Tabs label="Sub-agent cycle" idPrefix="sub-cycle" value={subAgentCycleTab} items={cycleItems} onChange={(value) => { setSubAgentCycleTab(value); setSubPage(1) }} size="sm" />
        <div className={styles.totalStrip}><strong>Total commission (filter):</strong>{domains.map((domain) => <span key={domain}>{domain[0].toUpperCase() + domain.slice(1)} {money(subAgentCommissionTotals[domain])}</span>)}</div>
      </div>
      <div role="tabpanel" id={tabPanelId('sub-cycle', subAgentCycleTab)} aria-labelledby={tabId('sub-cycle', subAgentCycleTab)}>
        <DataTable columns={subColumns} rows={subAgentSummariesSorted.slice((actualSubPage - 1) * subSize, actualSubPage * subSize)} rowKey={(record) => record.agentId} label="Sub-agent commissions" width="wide"
          pagination={{ current: actualSubPage, pageSize: subSize, total: subAgentSummariesSorted.length, onChange: setSubPage, pageSizeOptions: [5, 10, 20, 50], onPageSizeChange: (size) => { setSubSize(size); setSubPage(1) }, itemName: 'sub-agents' }} />
      </div>
    </Card>
    <Card title="Player Commission" sub="Per-player GGR and commission breakdown for all players in your downline" body="table">
      <div className={styles.tableControls} title={playerCycleTab === 'lastWeek' ? lastWeekTooltip ?? undefined : currentWeekTooltip ?? undefined}>
        <Tabs label="Player cycle" idPrefix="player-cycle" value={playerCycleTab} items={cycleItems} onChange={(value) => { setPlayerCycleTab(value); setPlayerPage(1) }} size="sm" />
        {playerSummaries.length > 0 && <div className={styles.totalStrip}><strong>Total commission (filter):</strong>{domains.map((domain) => <span key={domain}>{domain[0].toUpperCase() + domain.slice(1)} {money(playerCommissionTotals[domain])}</span>)}</div>}
      </div>
      <div role="tabpanel" id={tabPanelId('player-cycle', playerCycleTab)} aria-labelledby={tabId('player-cycle', playerCycleTab)}>
        <DataTable columns={playerColumns} rows={playerSummaries.slice((actualPlayerPage - 1) * playerSize, actualPlayerPage * playerSize)} rowKey={(record) => record.playerId} label="Player commissions" width="wide" state={playerCommissionLoading ? 'loading' : 'ready'}
          empty={<EmptyState title="No players with bets in this period" />} pagination={{ current: actualPlayerPage, pageSize: playerSize, total: playerSummaries.length, onChange: setPlayerPage, pageSizeOptions: [5, 10, 20, 50], onPageSizeChange: (size) => { setPlayerSize(size); setPlayerPage(1) }, itemName: 'players' }} />
      </div>
    </Card>
    <CommissionViewBetsModal open={viewBetsOpen} onClose={() => { setViewBetsOpen(false); setViewBetsParams(null) }} params={viewBetsParams} />
    <CommissionCyclePayDialog open={subAgentPayTarget != null} agentId={subAgentPayTarget?.agentId} username={subAgentPayTarget?.username ?? null}
      onClose={() => setSubAgentPayTarget(null)} refetchQueries={payRefetchQueries}
      onPaid={() => { void refetchAllTimeSubAgents(); void refetchTopStatsSummary() }}
      onViewBets={(cycle) => { if (subAgentPayTarget) { setViewBetsParams({ agentId: subAgentPayTarget.agentId, username: subAgentPayTarget.username, activeCycleKey: cycle.from, cycleFrom: cycle.periodFrom, cycleTo: cycle.periodTo }); setViewBetsOpen(true) } }} />
  </div></Page>
}
