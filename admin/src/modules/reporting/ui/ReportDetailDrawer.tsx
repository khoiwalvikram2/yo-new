import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  IconArrowsLeftRight,
  IconTrendingDown,
  IconTrendingUp,
  IconTrophy,
  IconUser,
  IconUsers,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
import { Tabs } from '@/ui/components/Tabs'
import { strokeFor } from '@/ui/components/icons'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatLocale } from '@/shared/core/useFormatLocale'
import {
  useSportsPlayerBreakdown,
  useSportsAgentBreakdown,
  useCasinoPlayerBreakdown,
  useCasinoAgentBreakdown,
} from '@/modules/reporting/hooks'
import { useReportingStore } from '@/state/reportingStore'
import {
  hasCasinoContext as casinoContextOf,
  hasSportsContext as sportsContextOf,
  noSelectionMessage,
  type DetailFilter,
} from './drillDownModel'
import { contributorDetailPath, type ContributorAgent, type ContributorPlayer } from './contributorDetailModel'
import styles from './ReportDetailDrawer.module.css'

type ContributorsTab = 'players' | 'agents'

export interface ReportDetailDrawerProps {
  domain?: string
  filter?: DetailFilter
  /** Carried for parity with ReportDetailSidebar; unused there too. */
  selectedPlayerId?: string | null
  /** Carried for parity with ReportDetailSidebar; unused there too. */
  selectedAgentId?: string | null
  /** Carried for parity with ReportDetailSidebar; unused there too. */
  onClearSelection?: () => void
}

const TABS_ID = 'report-contributors'
const GLYPH = 16

/**
 * The drill-down reports' contributors panel: who played in the drilled sport, league, event,
 * vendor or game, as players and agents. Each row opens the contributor's own page (a player's bets in
 * this selection, an agent's figures and players: routes/reporting/ContributorDetailPage), which replaced
 * the detail drawer once it held too much. Same props and breakdown queries as
 * routes/reporting/components/ReportDetailSidebar.tsx.
 */
export function ReportDetailDrawer({ domain, filter }: ReportDetailDrawerProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const formatLocale = useFormatLocale()
  const [contributorsTab, setContributorsTab] = useState<ContributorsTab>('players')
  // the drilled path in words ("Cricket › Indian Premier League › …"), for the contributor page's header
  const drillDownPath = useReportingStore((state) => state.drillDownPath)
  const context = drillDownPath.filter((level) => level.type !== 'all').map((level) => level.name).join(' › ')
  const linkDomain = domain === 'casino' ? 'casino' : 'sports'

  const hasSportsContext = sportsContextOf(domain, filter)
  const hasCasinoContext = casinoContextOf(domain, filter)

  const { data: sportsPlayersData, loading: sportsPlayersLoading } = useSportsPlayerBreakdown(hasSportsContext ? filter : undefined)
  const { data: sportsAgentsData, loading: sportsAgentsLoading } = useSportsAgentBreakdown(hasSportsContext ? filter : undefined)
  const { data: casinoPlayersData, loading: casinoPlayersLoading } = useCasinoPlayerBreakdown(hasCasinoContext ? filter : undefined)
  const { data: casinoAgentsData, loading: casinoAgentsLoading } = useCasinoAgentBreakdown(hasCasinoContext ? filter : undefined)

  const hasContext = hasSportsContext || hasCasinoContext

  const players: ContributorPlayer[] = domain === 'casino' ? (casinoPlayersData?.casinoPlayerBreakdown ?? []) : (sportsPlayersData?.sportsPlayerBreakdown ?? [])
  const agents: ContributorAgent[] = domain === 'casino' ? (casinoAgentsData?.casinoAgentBreakdown ?? []) : (sportsAgentsData?.sportsAgentBreakdown ?? [])

  const isLoading = domain === 'casino' ? (casinoPlayersLoading || casinoAgentsLoading) : (sportsPlayersLoading || sportsAgentsLoading)

  const totalPlayers = players.length
  const totalAgents = agents.length

  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))

  const ggr = (value: number) => (
    <span className={clsx(styles.ggr, value >= 0 ? styles.gain : styles.loss)}>
      {value >= 0 ? (
        <IconTrendingUp size={13} stroke={strokeFor(13)} aria-hidden="true" />
      ) : (
        <IconTrendingDown size={13} stroke={strokeFor(13)} aria-hidden="true" />
      )}
      <span className={styles.visuallyHidden}>{value >= 0 ? 'GGR gain' : 'GGR loss'}</span>
      {money(Math.abs(value))}
    </span>
  )

  const renderPlayer = (p: ContributorPlayer) => (
    <li key={p.playerId}>
      <Link
        className={styles.entity}
        to={contributorDetailPath(linkDomain, 'player', String(p.playerId), { name: p.playerUsername ?? String(p.playerId), context, filter })}
      >
        <span className={clsx(styles.tile, styles.player)} aria-hidden="true">
          <IconUser size={GLYPH} stroke={strokeFor(GLYPH)} />
        </span>
        <span className={styles.main}>
          <span className={styles.name}>{p.playerUsername ?? `Player ${p.playerId}`}</span>
          {p.directAgentName ? (
            <span className={styles.via}>
              <span className={styles.visuallyHidden}>Direct agent: </span>
              {p.directAgentName}
            </span>
          ) : null}
          <span className={styles.meta}>
            {Number(p.betCount ?? 0).toLocaleString(formatLocale)} bets
            {p.winRate != null ? ` • ${(p.winRate * 100).toFixed(0)}% win` : null}
          </span>
        </span>
        <span className={styles.figures}>
          <span className={styles.amount}>{money(p.totalStakes ?? 0)}</span>
          {ggr(p.grossGamingRevenue ?? 0)}
        </span>
      </Link>
    </li>
  )

  const renderAgent = (a: ContributorAgent) => (
    <li key={a.agentId}>
      <Link
        className={styles.entity}
        to={contributorDetailPath(linkDomain, 'agent', String(a.agentId), { name: a.agentName ?? String(a.agentId), context, filter })}
      >
        <span className={clsx(styles.tile, styles.agent)} aria-hidden="true">
          <IconUsers size={GLYPH} stroke={strokeFor(GLYPH)} />
        </span>
        <span className={styles.main}>
          <span className={styles.name}>{a.agentName ?? `Agent ${a.agentId}`}</span>
          <span className={styles.meta}>
            {Number(a.playerCount ?? 0)} players • {Number(a.betCount ?? 0).toLocaleString(formatLocale)} bets
          </span>
        </span>
        <span className={styles.figures}>
          <span className={styles.amount}>{money(a.totalStakes ?? 0)}</span>
          <span className={clsx(styles.ggr, Number(a.grossGamingRevenue ?? 0) >= 0 ? styles.gain : styles.loss)}>
            <span className={styles.visuallyHidden}>
              {Number(a.grossGamingRevenue ?? 0) >= 0 ? 'GGR gain' : 'GGR loss'}
            </span>
            {money(Math.abs(Number(a.grossGamingRevenue ?? 0)))}
            <span className={styles.ggrLabel} aria-hidden="true">GGR</span>
          </span>
        </span>
      </Link>
    </li>
  )

  if (!hasContext) {
    return (
      <Card title="Contributors">
        <EmptyState
          title="No Selection"
          description={noSelectionMessage(domain)}
          icon={<IconTrophy size={20} stroke={strokeFor(20)} />}
          inset="none"
        />
      </Card>
    )
  }

  const panelId = tabPanelId(TABS_ID, contributorsTab)

  return (
    <Card title="Contributors" sub="Players & agents in this selection" body="flush" aria-busy={isLoading || undefined}>
      <div className={styles.panel}>
        {/* The tabs carry the counts (Players (n) / Agents (n)), so there is no separate count strip. */}
        <div className={styles.tabs}>
          <Tabs
            value={contributorsTab}
            onChange={setContributorsTab}
            label="Contributors"
            idPrefix={TABS_ID}
            size="sm"
            className={styles.tabStrip}
            items={[
              { value: 'players', label: `Players (${totalPlayers})`, icon: <IconUser size={14} stroke={strokeFor(14)} /> },
              { value: 'agents', label: `Agents (${totalAgents})`, icon: <IconUsers size={14} stroke={strokeFor(14)} /> },
            ]}
          />
        </div>

        <div
          className={styles.content}
          role="tabpanel"
          id={panelId}
          aria-labelledby={tabId(TABS_ID, contributorsTab)}
        >
          {isLoading ? (
            <LoadingState label="Loading contributors" minHeight={192} />
          ) : contributorsTab === 'players' ? (
            players.length === 0 ? (
              <EmptyState title="No players in this selection" inset="none" />
            ) : (
              <ul className={styles.list}>{players.map(renderPlayer)}</ul>
            )
          ) : agents.length === 0 ? (
            <EmptyState title="No agents in this selection" inset="none" />
          ) : (
            <ul className={styles.list}>{agents.map(renderAgent)}</ul>
          )}
        </div>

        <p className={styles.hint}>
          <IconArrowsLeftRight size={13} stroke={strokeFor(13)} aria-hidden="true" />
          <span>Open a player for their bets, an agent for their players</span>
        </p>
      </div>

    </Card>
  )
}
