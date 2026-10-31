import { Link } from 'react-router-dom'
import { useQuery } from '@apollo/client'
import { IconHierarchy2, IconReceipt2 } from '@tabler/icons-react'
import { DASHBOARD_AGENTS_TAB_QUERY } from '../graphql'
import { useDashboardStore } from '@/state/dashboardStore'
import { Card } from '@/ui/components/Card'
import { LoadingState } from '@/ui/components/LoadingState'
import { Meter } from '@/ui/components/Meter'
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
   referred) and those players' play in the period, and the credit agents' limits. Player-side money (the
   pending queues, top depositors) lives on the Overview and Players tabs, where it belongs. */

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
  creditAgents: Array<{ agentId: string; username: string | null; creditLimit: number; creditUsed: number; creditAvailable: number; usedShare: number }>
  creditLimit: number
  creditUsed: number
}

const DOMAIN: Record<string, string> = { casino: 'Casino', sports: 'Sports', matka: 'Matka' }

const agentName = (username: string | null, id: string) => username ?? id.slice(0, 8)

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
  const creditShare = d.creditLimit > 0 ? d.creditUsed / d.creditLimit : 0

  return (
    <div className={styles.tab}>
      <FigureSection title="Agent Network" sub="Now · new agents in the period" icon={IconHierarchy2} accent="violet" pending={pending} figures={[
        { label: 'Total Agents', value: count(n.total), note: `${count(n.active)} active · ${count(n.suspended)} suspended`, drill: { kind: 'agents', title: 'All agents' } },
        { label: 'Top-Level Agents', value: count(n.topLevel), note: `${plural(n.levels, 'level')} deep` },
        { label: 'New Agents', value: count(n.newAgents), note: period, accent: n.newAgents > 0 ? 'green' : undefined },
        { label: 'Players Under Agents', value: count(n.playersUnderAgents), note: `${count(n.directPlayers)} direct players`, drill: { kind: 'players', arg: 'agent:any' } },
      ]}>
        <div className={styles.padded}>
          <div className={styles.list}>
            <SplitBar title="Agents by scheme" format={count} segments={[
              { label: 'Commission', value: n.commission, accent: 'violet', drill: { kind: 'agents', arg: 'COMMISSION', title: 'Commission agents' } },
              { label: 'Sharing', value: n.sharing, accent: 'cyan', drill: { kind: 'agents', arg: 'SHARING', title: 'Sharing agents' } },
              { label: 'Credit', value: n.credit, accent: 'amber', drill: { kind: 'agents', arg: 'CREDIT', title: 'Credit agents' } },
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

      {d.creditAgents.length > 0 ? (
        <Card title="Credit Agents" sub={`Now · ${money(d.creditUsed)} used of ${money(d.creditLimit)} (${(creditShare * 100).toFixed(1)}%)`} body="table">
          <Table caption="Credit agents by limit used" width="wide">
            <THead>
              <TR>
                <TH>Agent</TH>
                <TH align="right">Limit</TH>
                <TH align="right">Used</TH>
                <TH align="right">Available</TH>
                <TH>Used of limit</TH>
              </TR>
            </THead>
            <TBody>
              {d.creditAgents.map((row) => {
                const pct = Math.round(row.usedShare * 100)
                return (
                  <TR key={row.agentId}>
                    <TD emphasis="key"><Link className={styles.link} to={`/agents/${row.agentId}`}>{agentName(row.username, row.agentId)}</Link></TD>
                    <TD align="right">{money(row.creditLimit)}</TD>
                    <TD align="right">{money(row.creditUsed)}</TD>
                    <TD align="right">{money(row.creditAvailable)}</TD>
                    <TD>
                      <span className={styles.meterCell}>
                        <Meter value={pct} tone={pct >= 95 ? 'neg' : pct >= 80 ? 'warn' : 'acc'} />
                        <span>{pct}%</span>
                      </span>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </Card>
      ) : null}
    </div>
  )
}
