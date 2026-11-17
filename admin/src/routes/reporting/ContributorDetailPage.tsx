import { useMemo, useState, useEffect, type ReactNode } from 'react'
import { useQuery, gql } from '@apollo/client'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { IconCash, IconChartLine, IconPercentage, IconReceipt, IconScale, IconTrophy, IconUser, IconUsers } from '@tabler/icons-react'
import clsx from 'clsx'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useFormatLocale } from '@/shared/core/useFormatLocale'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { FilterBar } from '@/ui/components/FilterBar'
import { LoadingState } from '@/ui/components/LoadingState'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { SearchField } from '@/ui/components/SearchField'
import { Select } from '@/ui/components/Select'
import { Stat, type StatHue } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import {
  useCasinoAgentBreakdown,
  useCasinoPlayerBreakdown,
  useSportsAgentBreakdown,
  useSportsPlayerBreakdown,
} from '@/modules/reporting/hooks'
import {
  betStatusTone,
  casinoBetPnl,
  contextLabel,
  hasCasinoContext,
  hasSportsContext,
  signedAmount,
  sportsBetPnl,
  type CasinoBet,
  type DetailFilter,
  type SportsBet,
} from '@/modules/reporting/ui/drillDownModel'
import {
  contributorDetailPath,
  contributorDomainOf,
  isContributorKind,
  parseContributorSearch,
  type ContributorAgent,
  type ContributorDomain,
  type ContributorPlayer,
} from '@/modules/reporting/ui/contributorDetailModel'
import { usePaymentWhitelabelScope } from '@/routes/payments/usePaymentWhitelabelScope'
import { SelectWhitelabelForBets } from '@/routes/bets/SelectWhitelabelForBets'
import styles from './ContributorDetailPage.module.css'

interface SportsBetRow extends SportsBet {
  eventName?: string | null
  leagueName?: string | null
  sportName?: string | null
  selectionId?: string | number | null
  createdAt?: string | null
}

interface CasinoBetRow extends CasinoBet {
  gameName?: string | null
  vendorName?: string | null
  createdAt?: string | null
}

const GLYPH = 18
const REPORT_NAME: Record<ContributorDomain, string> = { sports: 'Sports Report', casino: 'Casino Report' }

/**
 * A contributor of a drilled sports or casino report, on its own page (it was the Contributors card's
 * drawer, which grew too full): a player's figures and settled bets in the selection, or an agent's figures
 * and the players under them. The selection travels in the URL (contributorDetailModel).
 */
export default function ContributorDetailPage() {
  const { pathname } = useLocation()
  const domain = contributorDomainOf(pathname)
  return (
    <RBACGuard required={[{ domain: `reporting.${domain}`, actions: ['view'] }]} bypassForAgents>
      <ContributorDetailContent domain={domain} />
    </RBACGuard>
  )
}

function ContributorDetailContent({ domain }: { domain: ContributorDomain }) {
  const { kind, id = '' } = useParams<{ kind: string; id: string }>()
  const [searchParams] = useSearchParams()
  const { name, context, filter } = useMemo(() => parseContributorSearch(searchParams), [searchParams])
  const pageEyebrow = usePageEyebrow()
  const back = { to: `/reporting/${domain}`, label: `Back to ${REPORT_NAME[domain]}` }
  const inSelection = domain === 'casino' ? hasCasinoContext(domain, filter) : hasSportsContext(domain, filter)

  if (!isContributorKind(kind) || !id || !inSelection) {
    return (
      <Page maxWidth="wide">
        <PageHeader eyebrow={pageEyebrow} title="Contributor" back={back} />
        <EmptyState
          title="This page needs a report selection"
          description={`Open it from the Contributors list of the ${REPORT_NAME[domain]} after drilling into a ${domain === 'casino' ? 'vendor or game' : 'sport, league or event'}.`}
          icon={<IconTrophy size={20} stroke={strokeFor(20)} />}
        />
      </Page>
    )
  }
  const where = context || `${contextLabel(domain, filter)} selection`
  return kind === 'player'
    ? <PlayerDetail domain={domain} id={id} name={name} where={where} filter={filter} eyebrow={pageEyebrow} back={back} />
    : <AgentDetail domain={domain} id={id} name={name} where={where} filter={filter} eyebrow={pageEyebrow} back={back} context={context} />
}

interface DetailProps {
  domain: ContributorDomain
  id: string
  name: string | null
  /** the drilled path in words, for the header */
  where: string
  filter: DetailFilter
  eyebrow: ReactNode
  back: { to: string; label: string }
}

function useMoney() {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  return (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
}

/** GGR is the house's: a gain reads green with the word in hidden text, a loss red. */
function GgrFigure({ value, money }: { value: number; money: (value: number) => string }) {
  return (
    <span className={value >= 0 ? styles.gain : styles.loss}>
      <span className={styles.visuallyHidden}>{value >= 0 ? 'GGR gain ' : 'GGR loss '}</span>
      {money(value)}
    </span>
  )
}

function StatRow({ children }: { children: ReactNode }) {
  return <div className={styles.stats} role="group" aria-label="Figures in this selection">{children}</div>
}

function figure(label: string, value: ReactNode, icon: ReactNode, hue: StatHue, note?: ReactNode, loading = false) {
  return <Stat key={label} label={label} value={value} icon={icon} hue={hue} note={note} loading={loading} size="compact" />
}

// ---------------------------------------------------------------- player

type StatusFilter = 'all' | 'won' | 'lost' | 'settled'

const CONTRIBUTOR_BETS_PAGE = gql`
  query ContributorBetsPage($domain: BetDomain!, $filters: BetsPageFilters, $limit: Int, $offset: Int) {
    betsPage(domain: $domain, filters: $filters, limit: $limit, offset: $offset) {
      total items {
        ... on SportsBet { id eventName leagueName sportName selectionId side stake price pl sportsStatus: status createdAt }
        ... on CasinoBet { id gameName vendorName stake payout netAmount casinoStatus: status createdAt }
      }
    }
  }
`

function PlayerDetail({ domain, id, name, where, filter, eyebrow, back }: DetailProps) {
  const money = useMoney()
  const navigate = useNavigate()
  const formatLocale = useFormatLocale()
  const { formatDateTime } = useFormatDate()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')

  const sportsPlayers = useSportsPlayerBreakdown(domain === 'sports' ? filter : undefined)
  const casinoPlayers = useCasinoPlayerBreakdown(domain === 'casino' ? filter : undefined)
  const rows: ContributorPlayer[] = domain === 'casino'
    ? (casinoPlayers.data?.casinoPlayerBreakdown ?? [])
    : (sportsPlayers.data?.sportsPlayerBreakdown ?? [])
  const figuresLoading = domain === 'casino' ? casinoPlayers.loading : sportsPlayers.loading
  const player = rows.find((row) => String(row.playerId) === id)

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const scopeKey = JSON.stringify(filter)
  useEffect(() => { setPage(1) }, [domain, id, query, status, scopeKey])
  // Bets belong to one whitelabel: with none selected (a Super Admin in core mode) the list is not queried.
  const { selectionRequired } = usePaymentWhitelabelScope()
  const { data: betsData, loading: betsLoading, error: betsError, refetch: refetchBets } = useQuery(CONTRIBUTOR_BETS_PAGE, {
    skip: selectionRequired,
    variables: { domain: domain.toUpperCase(), limit: pageSize, offset: (page-1)*pageSize, filters: {
      userId: id, sportId: filter.sportId, leagueId: filter.leagueId, eventId: filter.eventId,
      vendorId: filter.vendorId == null ? undefined : String(filter.vendorId), gameId: filter.gameId == null ? undefined : String(filter.gameId),
      dateFrom: filter.dateFrom, dateTo: filter.dateTo, search: query.trim() || undefined,
      status: status === 'all' ? (domain === 'sports' ? ['won','lost','settled'] : ['won','lost']) : [status],
    } }, fetchPolicy: 'network-only', notifyOnNetworkStatusChange: true,
  })
  const bets = (betsData?.betsPage?.items ?? []).map((row: any) => ({ ...row, status: row.sportsStatus ?? row.casinoStatus })) as Array<SportsBetRow | CasinoBetRow>
  const totalBets = betsData?.betsPage?.total ?? 0
  const needle = query.trim().toLowerCase()
  const shown = bets
  const pagination = { current: page, pageSize, total: totalBets, onChange: setPage,
    onPageSizeChange: (size: number) => { setPageSize(size); setPage(1) }, pageSizeOptions: [10,20,50,100], itemName: 'bets' }

  const statusCell = (value: string | null | undefined) =>
    value ? <StatusPill tone={betStatusTone(domain, value)}>{value.toUpperCase()}</StatusPill> : null
  const timeCell = (value: string | null | undefined) => <span className={styles.dim}>{value ? formatDateTime(value, 'dd MMM yyyy, HH:mm') : '-'}</span>
  const pnlCell = (pl: number | null) => pl === null ? <span className={styles.dim}>-</span>
    : <span className={pl >= 0 ? styles.gain : styles.loss}>{signedAmount(pl, money)}</span>

  const sportsColumns: DataTableColumn<SportsBetRow>[] = [
    { key: 'event', header: 'Event', cell: (bet) => <span className={styles.cellStack}><span className={styles.cellMain}>{bet.eventName || '-'}</span><span className={styles.cellSub}>{bet.leagueName} • {bet.sportName}</span></span> },
    { key: 'selection', header: 'Selection', cell: (bet) => <span className={styles.selection}>{bet.side ? <span className={clsx(styles.side, bet.side === 'back' ? styles.back : styles.lay)}>{bet.side.toUpperCase()}</span> : null}<span>{bet.selectionId || '-'}</span></span> },
    { key: 'stake', header: 'Stake', align: 'right', cell: (bet) => money(Number(bet.stake ?? 0)) },
    // a missing price prints a dash, a zero price prints 0.00
    { key: 'odds', header: 'Odds', align: 'right', cell: (bet) => (bet.price != null ? Number(bet.price).toFixed(2) : '-') },
    { key: 'pl', header: 'P/L', align: 'right', cell: (bet) => pnlCell(sportsBetPnl(bet)) },
    { key: 'status', header: 'Status', align: 'center', cell: (bet) => statusCell(bet.status) },
    { key: 'time', header: 'Placed', cell: (bet) => timeCell(bet.createdAt) },
  ]
  const casinoColumns: DataTableColumn<CasinoBetRow>[] = [
    { key: 'game', header: 'Game', cell: (bet) => <span className={styles.cellStack}><span className={styles.cellMain}>{bet.gameName || '-'}</span><span className={styles.cellSub}>{bet.vendorName || '-'}</span></span> },
    { key: 'stake', header: 'Stake', align: 'right', cell: (bet) => money(Number(bet.stake) || 0) },
    { key: 'payout', header: 'Payout', align: 'right', cell: (bet) => money(Number(bet.payout) || 0) },
    { key: 'pl', header: 'P/L', align: 'right', cell: (bet) => pnlCell(casinoBetPnl(bet)) },
    { key: 'status', header: 'Status', align: 'center', cell: (bet) => statusCell(bet.status) },
    { key: 'time', header: 'Placed', cell: (bet) => timeCell(bet.createdAt) },
  ]

  const title = player?.playerUsername ?? name ?? `Player ${id}`
  const statusOptions = [
    { value: 'all', label: 'All results' },
    { value: 'won', label: 'Won' },
    { value: 'lost', label: 'Lost' },
    ...(domain === 'sports' ? [{ value: 'settled', label: 'Settled' }] : []),
  ]
  const activeCount = (needle ? 1 : 0) + (status !== 'all' ? 1 : 0)

  return (
    <Page maxWidth="wide">
      <PageHeader eyebrow={eyebrow} title={title} back={back}
        meta={<span className={styles.where}><span className={styles.kind}>Player</span><span>{where}</span>{player?.directAgentName ? <span>Agent {player.directAgentName}</span> : null}</span>}
        actions={<Button icon={<IconUser size={16} stroke={strokeFor(16)} />} onClick={() => navigate(`/players/profile/${encodeURIComponent(id)}`)}>Player profile</Button>} />
      <div className={styles.stack}>
        <StatRow>
          {figure('Total stakes', player ? money(player.totalStakes ?? 0) : '—', <IconCash size={GLYPH} stroke={strokeFor(GLYPH)} />, 'grn', 'In this selection', figuresLoading && !player)}
          {figure('GGR', player ? <GgrFigure value={player.grossGamingRevenue ?? 0} money={money} /> : '—', <IconChartLine size={GLYPH} stroke={strokeFor(GLYPH)} />, 'blu', 'House result', figuresLoading && !player)}
          {figure('Bets', player ? Number(player.betCount ?? 0).toLocaleString(formatLocale) : '—', <IconReceipt size={GLYPH} stroke={strokeFor(GLYPH)} />, 'amb', player?.avgStake != null ? `Avg stake ${money(player.avgStake)}` : 'Settled bets', figuresLoading && !player)}
          {figure('Win rate', player?.winRate != null ? `${(player.winRate * 100).toFixed(0)}%` : '—', <IconPercentage size={GLYPH} stroke={strokeFor(GLYPH)} />, 'vio', 'Bets won', figuresLoading && !player)}
        </StatRow>

        {selectionRequired ? <Card title="Bets"><SelectWhitelabelForBets /></Card> :
        <Card title="Bets" sub={betsLoading ? 'Loading…' : `${shown.length.toLocaleString(formatLocale)} of ${totalBets.toLocaleString(formatLocale)} settled bets`} body="flush">
          <div className={styles.filters}>
            <FilterBar label="Bet filters" activeCount={activeCount} onClearAll={() => { setQuery(''); setStatus('all') }}
              search={<SearchField label="Search bets" placeholder={domain === 'casino' ? 'Game or vendor' : 'Event, league or selection'} size="sm" value={query} onChange={setQuery} />}>
              <Select label="Result" hideLabel size="sm" value={status} options={statusOptions} onChange={(value) => setStatus(value as StatusFilter)} />
            </FilterBar>
          </div>
          {betsLoading ? <LoadingState label="Loading bets..." minHeight={256} />
            : domain === 'casino'
              ? <DataTable<CasinoBetRow> columns={casinoColumns} rows={shown as CasinoBetRow[]} rowKey={(row) => String(row.id)} label="Bets in this selection" pagination={pagination} state={betsError ? 'error' : 'ready'} error={betsError?.message} onRetry={() => void refetchBets()}
                empty={<EmptyState title={bets.length ? 'No bets match these filters' : 'No bets in this selection'} inset="none" />} />
              : <DataTable<SportsBetRow> columns={sportsColumns} rows={shown as SportsBetRow[]} rowKey={(row) => String(row.id)} label="Bets in this selection" pagination={pagination} state={betsError ? 'error' : 'ready'} error={betsError?.message} onRetry={() => void refetchBets()}
                empty={<EmptyState title={bets.length ? 'No bets match these filters' : 'No bets in this selection'} inset="none" />} />}
        </Card>}
      </div>
    </Page>
  )
}

// ---------------------------------------------------------------- agent

function AgentDetail({ domain, id, name, where, filter, eyebrow, back, context }: DetailProps & { context: string | null }) {
  const money = useMoney()
  const formatLocale = useFormatLocale()
  const sportsAgents = useSportsAgentBreakdown(domain === 'sports' ? filter : undefined)
  const casinoAgents = useCasinoAgentBreakdown(domain === 'casino' ? filter : undefined)
  const sportsPlayers = useSportsPlayerBreakdown(domain === 'sports' ? filter : undefined)
  const casinoPlayers = useCasinoPlayerBreakdown(domain === 'casino' ? filter : undefined)
  const agents: ContributorAgent[] = domain === 'casino' ? (casinoAgents.data?.casinoAgentBreakdown ?? []) : (sportsAgents.data?.sportsAgentBreakdown ?? [])
  const players: ContributorPlayer[] = domain === 'casino' ? (casinoPlayers.data?.casinoPlayerBreakdown ?? []) : (sportsPlayers.data?.sportsPlayerBreakdown ?? [])
  const loading = domain === 'casino' ? casinoAgents.loading : sportsAgents.loading
  const playersLoading = domain === 'casino' ? casinoPlayers.loading : sportsPlayers.loading
  const agent = agents.find((row) => String(row.agentId) === id)
  const underAgent = players.filter((row) => String(row.directAgentId ?? '') === id)
  const title = agent?.agentName ?? name ?? `Agent ${id}`

  const columns: DataTableColumn<ContributorPlayer>[] = [
    { key: 'player', header: 'Player', cell: (row) => <Link className={styles.rowLink}
      to={contributorDetailPath(domain, 'player', String(row.playerId), { name: row.playerUsername ?? String(row.playerId), context: context ?? undefined, filter })}>
      {row.playerUsername ?? `Player ${row.playerId}`}</Link> },
    { key: 'bets', header: 'Bets', align: 'right', cell: (row) => Number(row.betCount ?? 0).toLocaleString(formatLocale) },
    { key: 'stakes', header: 'Total stakes', align: 'right', cell: (row) => money(row.totalStakes ?? 0) },
    { key: 'ggr', header: 'GGR', align: 'right', cell: (row) => <GgrFigure value={row.grossGamingRevenue ?? 0} money={money} /> },
    { key: 'win', header: 'Win rate', align: 'right', cell: (row) => (row.winRate != null ? `${(row.winRate * 100).toFixed(0)}%` : '-') },
  ]

  if (!loading && !agent) {
    return (
      <Page maxWidth="wide">
        <PageHeader eyebrow={eyebrow} title={title} back={back} meta={<span className={styles.where}><span className={styles.kind}>Agent</span><span>{where}</span></span>} />
        <EmptyState title="Agent not found in this selection" description="The agent has no bets in the drilled selection any more." />
      </Page>
    )
  }
  return (
    <Page maxWidth="wide">
      <PageHeader eyebrow={eyebrow} title={title} back={back} meta={<span className={styles.where}><span className={styles.kind}>Agent</span><span>{where}</span></span>} />
      <div className={styles.stack}>
        <StatRow>
          {figure('Total stakes', agent ? money(agent.totalStakes ?? 0) : '—', <IconCash size={GLYPH} stroke={strokeFor(GLYPH)} />, 'grn', 'In this selection', loading)}
          {figure('GGR', agent ? <GgrFigure value={agent.grossGamingRevenue ?? 0} money={money} /> : '—', <IconChartLine size={GLYPH} stroke={strokeFor(GLYPH)} />, 'blu', agent?.netGgr != null ? `Net ${money(agent.netGgr)}` : 'House result', loading)}
          {figure('Players', agent ? Number(agent.playerCount ?? 0).toLocaleString(formatLocale) : '—', <IconUsers size={GLYPH} stroke={strokeFor(GLYPH)} />, 'vio', 'With bets here', loading)}
          {figure('Bets', agent ? Number(agent.betCount ?? 0).toLocaleString(formatLocale) : '—', <IconReceipt size={GLYPH} stroke={strokeFor(GLYPH)} />, 'amb', 'Settled bets', loading)}
          {agent && agent.commission != null && agent.commission > 0
            ? figure('Commission', money(agent.commission), <IconScale size={GLYPH} stroke={strokeFor(GLYPH)} />, 'ind', 'Earned here', loading)
            : null}
        </StatRow>
        <Card title="Players" sub={playersLoading ? 'Loading…' : `${underAgent.length.toLocaleString(formatLocale)} directly under this agent`} body="flush">
          {playersLoading ? <LoadingState label="Loading players..." minHeight={192} />
            : <DataTable<ContributorPlayer> columns={columns} rows={underAgent} rowKey={(row) => String(row.playerId)} label="Players under this agent in this selection" pagination="client"
              empty={<EmptyState title="No direct players in this selection" inset="none" />} />}
        </Card>
      </div>
    </Page>
  )
}
