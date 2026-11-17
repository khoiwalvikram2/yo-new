import { Link } from 'react-router-dom'
import { useQuery } from '@apollo/client'
import { IconHierarchy2, IconReceipt2 } from '@tabler/icons-react'
import { DASHBOARD_AGENTS_TAB_QUERY } from '../graphql'
import { useDashboardStore } from '@/state/dashboardStore'
import { CHIP_DOWNLINE_QUERY, CHIP_READ_OPTIONS, refPnlNote, signedChips, type ChipDownlineData, type ChipDownlineVariables } from '@/modules/chips'
import { Card } from '@/ui/components/Card'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { StatusPill } from '@/ui/components/StatusPill'
import { Table, TBody, TD, TH, THead, TR } from '@/ui/components/Table'
import { FigureSection } from './FigureSection'
import { count, periodLabel, plural, useWholeMoney } from './insightFormat'
import { SplitBar } from './TabCharts'
import { DrillButton } from './DrilldownDialog'
import styles from './DashboardTabs.module.css'

/* The Agents tab, rebuilt on Query.dashboardAgentsTab (the owner's redesign, 2026-10-29): the network and
   its scheme mix, commission and settlement, a leaderboard of agents on their own players (direct and
   referred) and those players' play in the period, and the root credit agents on chips. Player-side money
   (the pending queues, top depositors) lives on the Overview and Players tabs, where it belongs. */

/** The root credit agents the dashboard lists: the first page of the whitelabel's own chip downline. */
const CREDIT_AGENT_ROWS = 10

/**
 * The root CREDIT agents on chips (spec 2026-11-02 §2): each one's own chips, its downline's, its credit
 * reference and its Ref P/L (green: the whitelabel owes it; rose: it owes the whitelabel). A root agent's Ref
 * P/L covers its whole downline, so these rows are the whitelabel's position against its credit network.
 */
function CreditAgentsChipsCard() {
  const money = useWholeMoney()
  const { data, loading, error } = useQuery<ChipDownlineData, ChipDownlineVariables>(CHIP_DOWNLINE_QUERY, {
    ...CHIP_READ_OPTIONS,
    variables: { parentAgentId: null, query: null, accountType: 'AGENT', offset: 0, limit: CREDIT_AGENT_ROWS },
    pollInterval: 120000,
  })
  const downline = data?.agents?.chipDownline ?? null
  const rows = downline?.items ?? []
  const totalRefPnl = downline?.totals.refPnl ?? 0
  const sub = downline
    ? `Now · ${plural(downline.total, 'root agent')} · Ref P/L ${signedChips(totalRefPnl, money)} (${refPnlNote(totalRefPnl).toLowerCase()})`
    : 'Now · root agents and their downline'
  return (
    <Card title="Credit Agents" sub={sub} body="table">
      {loading && !downline ? <LoadingState height={200} label="Loading credit agents" />
        : error && !downline ? <p className={styles.empty}>Credit agents could not be loaded: {error.message}</p>
        : rows.length === 0 ? <p className={styles.empty}>No root credit agents yet.</p> : (
        <Table caption="Root credit agents on chips" width="wide">
          <THead>
            <TR>
              <TH>Agent</TH>
              <TH align="right">Balance</TH>
              <TH align="right">Downline</TH>
              <TH align="right">Exposure</TH>
              <TH align="right">Credit Ref</TH>
              <TH align="right">Ref P/L</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.id}>
                <TD emphasis="key">
                  <Link className={styles.link} to={`/agents/${row.id}`}>{row.username}</Link>
                  {row.status && row.status !== 'ACTIVE' ? <> <StatusPill status={row.status}>{row.status.toLowerCase()}</StatusPill></> : null}
                </TD>
                <TD align="right">{money(row.balance)}</TD>
                <TD align="right">{money(row.downlineBalance)}</TD>
                <TD align="right">{money(row.exposure)}</TD>
                <TD align="right">{money(row.creditReference)}</TD>
                <TD align="right" tone={row.refPnl > 0 ? 'pos' : row.refPnl < 0 ? 'neg' : undefined}>{signedChips(row.refPnl, money)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  )
}

interface AgentsTabData {
  network: {
    total: number
    active: number
    suspended: number
    sharing: number
    commission: number
    credit: number
    topLevel: number
    levels: number
    newAgents: number
    playersUnderAgents: number
    directPlayers: number
  }
  commissionTotal: number
  commissionByDomain: Array<{ domain: string; amount: number }>
  settlementOwed: number
  settlementOwing: number
  agentsWithBalance: number
  settlementsPosted: number
  settlementsAmount: number
  leaderboard: Array<{
    agentId: string
    username: string | null
    scheme: string
    status: string
    subAgents: number
    players: number
    activePlayers: number
    turnover: number
    ggr: number
    commission: number
  }>
}

const DOMAIN: Record<string, string> = { casino: 'Casino', sports: 'Sports', matka: 'Matka' }

const agentName = (username: string | null, id: string) => username ?? id.slice(0, 8)

/** "128 active · 1 suspended · 2 inactive": suspended is SUSPENDED or BLOCKED; the rest of the
 *  non-active agents are INACTIVE (read-only), which the note used to count as suspended. */
function agentStatusNote(n: { total: number; active: number; suspended: number }): string {
  const inactive = Math.max(0, n.total - n.active - n.suspended)
  return [`${count(n.active)} active`, `${count(n.suspended)} suspended`, ...(inactive > 0 ? [`${count(inactive)} inactive`] : [])].join(' · ')
}

export function AgentsTab() {
  const { getDateRangeForQuery, filters } = useDashboardStore()
  const period = periodLabel(filters?.dateRange?.preset)
  const money = useWholeMoney()
  const { data, loading, error } = useQuery(DASHBOARD_AGENTS_TAB_QUERY, {
    variables: { dateRange: getDateRangeForQuery() },
    pollInterval: 120000,
    errorPolicy: 'all',
  })
  if (error && !data) return <Notice tone="error" title="Agent analytics unavailable">{error.message}</Notice>
  const d: AgentsTabData | undefined = data?.dashboardAgentsTab
  const pending = loading && !data
  if (!d) return <LoadingState height={520} label="Loading agent analytics" />
  const n = d.network
  const domains = d.commissionByDomain.map((row) => `${DOMAIN[row.domain] ?? row.domain} ${money(row.amount)}`).join(' · ')

  return (
    <div className={styles.tab}>
      <FigureSection title="Agent Network" sub="Now · new agents in the period" icon={IconHierarchy2} accent="violet" pending={pending} figures={[
        { label: 'Total Agents', value: count(n.total), note: agentStatusNote(n), drill: { kind: 'agents', title: 'All agents' } },
        { label: 'Top-Level Agents', value: count(n.topLevel), note: `${plural(n.levels, 'level')} deep` },
        { label: 'New Agents', value: count(n.newAgents), note: period, accent: n.newAgents > 0 ? 'green' : undefined },
        { label: 'Players Under Agents', value: count(n.playersUnderAgents), note: `${count(n.directPlayers)} direct players`, drill: { kind: 'players', arg: 'agent:any' } },
      ]}>
        <div className={styles.padded}>
          <div className={styles.list}>
            {/* The counts are every agent of the scheme, so each opens every status (":all"); the bare
                scheme arg lists ACTIVE agents only, for the Operations "· Active" figures. */}
            <SplitBar title="Agents by scheme" format={count} segments={[
              { label: 'Commission', value: n.commission, accent: 'violet', drill: { kind: 'agents', arg: 'COMMISSION:all', title: 'Commission agents' } },
              { label: 'Sharing', value: n.sharing, accent: 'cyan', drill: { kind: 'agents', arg: 'SHARING:all', title: 'Sharing agents' } },
              { label: 'Credit', value: n.credit, accent: 'amber', drill: { kind: 'agents', arg: 'CREDIT:all', title: 'Credit agents' } },
            ]} />
          </div>
        </div>
      </FigureSection>

      <FigureSection title="Commission & Settlement" sub={`${period} · balances now`} icon={IconReceipt2} accent="green" pending={pending} figures={[
        { label: 'Commission Posted', value: money(d.commissionTotal), note: domains ? `${domains} · agent ledgers` : 'Nothing posted to agent ledgers in this period', accent: d.commissionTotal > 0 ? 'violet' : undefined },
        { label: 'Settlements Posted', value: count(d.settlementsPosted), note: money(d.settlementsAmount) },
        { label: 'Settlement Balance (+)', value: money(d.settlementOwed), note: 'Agents with a positive balance' },
        { label: 'Settlement Balance (−)', value: money(Math.abs(d.settlementOwing)), note: `${plural(d.agentsWithBalance, 'agent')} carry a balance` },
      ]} />

      <Card title="Agent Leaderboard" sub={`${period} · own players (direct and referred), most staked first`} body="table">
        {d.leaderboard.length === 0 ? <p className={styles.empty}>No agents yet.</p> : (
          <Table caption="Agents by their players' stakes" width="wide">
            <THead>
              <TR>
                <TH>Agent</TH>
                <TH>Scheme</TH>
                <TH align="right">Sub-agents</TH>
                <TH align="right">Players</TH>
                <TH align="right">Active</TH>
                <TH align="right">Staked</TH>
                <TH align="right">GGR</TH>
                <TH align="right">Commission</TH>
              </TR>
            </THead>
            <TBody>
              {d.leaderboard.map((row) => (
                <TR key={row.agentId}>
                  <TD emphasis="key">
                    <Link className={styles.link} to={`/agents/${row.agentId}`}>{agentName(row.username, row.agentId)}</Link>
                    {row.status !== 'ACTIVE' ? <> <StatusPill status={row.status}>{row.status.toLowerCase()}</StatusPill></> : null}
                  </TD>
                  <TD><span className={styles.scheme}>{row.scheme.toLowerCase()}</span></TD>
                  <TD align="right">{count(row.subAgents)}</TD>
                  <TD align="right">
                    <DrillButton drill={{ kind: 'agent_players', arg: row.agentId, title: `Players of ${agentName(row.username, row.agentId)}` }}>{count(row.players)}</DrillButton>
                  </TD>
                  <TD align="right">{count(row.activePlayers)}</TD>
                  <TD align="right">{money(row.turnover)}</TD>
                  <TD align="right" tone={row.ggr < 0 ? 'neg' : row.ggr > 0 ? 'pos' : undefined}>{money(row.ggr)}</TD>
                  <TD align="right">{money(row.commission)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {/* Only where credit agents exist: the chips reads are asked for nothing otherwise. */}
      {n.credit > 0 ? <CreditAgentsChipsCard /> : null}
    </div>
  )
}
