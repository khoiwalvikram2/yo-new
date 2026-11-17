import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@apollo/client'
import { IconCards, IconDice5, IconTrophy } from '@tabler/icons-react'
import { DASHBOARD_INSIGHTS_QUERY } from '../graphql'
import { useDashboardStore } from '@/state/dashboardStore'
import { ROUTES } from '@/shared/core/constants'
import { useFormatDate } from '@/shared/core/useFormatDate'
import type { Accent } from '@/ui/components/accent'
import { Card } from '@/ui/components/Card'
import { Skeleton } from '@/ui/components/Skeleton'
import { StatusPill } from '@/ui/components/StatusPill'
import { formatShare, periodLabel, plural, useWholeMoney } from './insightFormat'
import { DrillButton } from './DrilldownDialog'
import { DashboardPlayerName } from './DashboardPlayerName'
import styles from './InsightCards.module.css'

/* The Overview's insight cards (the owner's ask, 2026-10-29), both from Query.dashboardInsights, which
   Apollo asks once for the two of them:
   - Top Risk Events: the open book by event and draw, largest first (beside Exposure by market, and like
     it only with reporting.exposure:view);
   - Big Bets & Winners: the period's largest single bets and the players who won most.
   The third card, Agents Near Credit Limit, went with the credit limits: the CREDIT scheme is on chips since
   2026-11-02 (Deposit / Withdraw), so there is no limit to be near.
   While the first answer is on its way each card holds its rows' height with placeholders. */

type Product = 'sports' | 'casino' | 'matka'

interface RiskEvent {
  key: string
  product: 'sports' | 'matka'
  label: string
  detail: string | null
  exposure: number
  bets: number
  players: number
}

interface BigBet {
  id: string
  product: Product
  userId: number
  username: string
  agent: string | null
  label: string | null
  amount: number
  outcome: string
  placedAt: string
}

interface TopWinner {
  userId: number
  username: string
  agent: string | null
  profit: number
  staked: number
  bets: number
}

interface Insights {
  openExposure: number
  riskEvents: RiskEvent[]
  bigBets: BigBet[]
  topWinners: TopWinner[]
}

const PRODUCT: Record<Product, { label: string; accent: Accent; icon: ReactNode }> = {
  sports: { label: 'Sports', accent: 'blue', icon: <IconTrophy size={15} stroke={1.8} /> },
  casino: { label: 'Casino', accent: 'violet', icon: <IconCards size={15} stroke={1.8} /> },
  matka: { label: 'Matka', accent: 'amber', icon: <IconDice5 size={15} stroke={1.8} /> },
}

const OUTCOME: Record<string, string> = { open: 'Open', won: 'Won', lost: 'Lost', settled: 'Settled', void: 'Void' }

function useInsights() {
  const { getDateRangeForQuery, filters } = useDashboardStore()
  const { data, loading, error } = useQuery(DASHBOARD_INSIGHTS_QUERY, {
    variables: { dateRange: getDateRangeForQuery() },
    pollInterval: 60000,
    errorPolicy: 'all',
  })
  const insights: Insights | undefined = data?.dashboardInsights
  return { insights, pending: loading && !data, error: error && !data ? error : undefined, period: periodLabel(filters?.dateRange?.preset) }
}

/** Placeholder rows that hold a list's height until its first answer. */
function PendingRows({ rows }: { rows: number }) {
  return (
    <ul className={styles.list} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className={styles.row}>
          <span className={styles.tile} />
          <span className={styles.body}><Skeleton width={140} height={13} /><Skeleton width={90} height={10} /></span>
          <span className={styles.end}><Skeleton width={70} height={13} /></span>
        </li>
      ))}
    </ul>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>
}

/** The open book by event and draw: the five largest, each with its share of everything open. */
export function TopRiskEventsCard() {
  const { insights, pending, error } = useInsights()
  const money = useWholeMoney()
  const events = insights?.riskEvents ?? []
  const total = insights?.openExposure ?? 0
  return (
    <Card
      title="Top Risk Events"
      sub="Open now · largest liability first"
      body="flush"
      tools={<Link className={styles.more} to={ROUTES.REPORTING_EXPOSURE} aria-label="View all exposure by event">View all<span aria-hidden="true"> ›</span></Link>}
    >
      <div aria-busy={pending || undefined}>
        {pending ? <PendingRows rows={5} /> : error ? <Empty>Risk events could not be loaded: {error.message}</Empty> : events.length === 0 ? (
          <Empty>No open exposure right now.</Empty>
        ) : (
          <ul className={styles.list}>
            {events.map((event) => {
              const product = PRODUCT[event.product]
              return (
                <li key={event.key} className={styles.row}>
                  <span className={styles.tile} data-accent={product.accent} aria-hidden="true">{product.icon}</span>
                  <span className={styles.body}>
                    <span className={styles.name} title={event.label}>
                      <DrillButton drill={{
                        kind: 'bets',
                        arg: event.key.startsWith('sports:') ? `event:${event.key.slice('sports:'.length)}` : `draw:${event.key.slice('matka:'.length)}`,
                        title: `Open bets · ${event.label}`,
                      }}>{event.label}</DrillButton>
                    </span>
                    <span className={styles.sub}>
                      {[event.detail ?? product.label, plural(event.bets, 'bet'), plural(event.players, 'player')].join(' · ')}
                    </span>
                  </span>
                  <span className={styles.end}>
                    <span className={styles.amount}>{money(event.exposure)}</span>
                    <span className={styles.sub}>{formatShare(total > 0 ? event.exposure / total : null)} of open</span>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Card>
  )
}

/** The period's five largest single bets beside the five players who won most. */
export function BigBetsCard() {
  const { insights, pending, error, period } = useInsights()
  const money = useWholeMoney()
  const { formatDateTime } = useFormatDate()
  const bets = insights?.bigBets ?? []
  const winners = insights?.topWinners ?? []
  return (
    <Card title="Big Bets & Winners" sub={`${period} · every product`} body="flush">
      {error ? <Empty>Big bets could not be loaded: {error.message}</Empty> : (
        <div className={styles.colsWrap}>
        <div className={styles.cols} aria-busy={pending || undefined}>
          <div>
            <h3 className={styles.colLabel}>Biggest bets</h3>
            {pending ? <PendingRows rows={5} /> : bets.length === 0 ? <Empty>No bets in this period.</Empty> : (
              <ul className={styles.list}>
                {bets.map((bet) => {
                  const product = PRODUCT[bet.product] ?? PRODUCT.sports
                  return (
                    <li key={bet.id} className={styles.row}>
                      <span className={styles.tile} data-accent={product.accent} aria-hidden="true">{product.icon}</span>
                      <span className={styles.body}>
                        <span className={styles.name}>
                          <DashboardPlayerName userId={bet.userId} username={bet.username} linkClassName={styles.player} />
                          {bet.agent ? <span className={styles.agent}> · {bet.agent}</span> : null}
                        </span>
                        <span className={styles.sub} title={bet.label ?? undefined}>
                          {[bet.label ?? product.label, formatDateTime(bet.placedAt)].join(' · ')}
                        </span>
                      </span>
                      <span className={styles.end}>
                        <span className={styles.amount}>{money(bet.amount)}</span>
                        <StatusPill status={bet.outcome}>{OUTCOME[bet.outcome] ?? bet.outcome}</StatusPill>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <div>
            <h3 className={styles.colLabel}>Top winners</h3>
            {pending ? <PendingRows rows={5} /> : winners.length === 0 ? <Empty>No player is up in this period.</Empty> : (
              <ul className={styles.list}>
                {winners.map((winner, index) => (
                  <li key={winner.userId} className={styles.row}>
                    <span className={styles.rank} aria-hidden="true">{index + 1}</span>
                    <span className={styles.body}>
                      <span className={styles.name}>
                        <DashboardPlayerName userId={winner.userId} username={winner.username} linkClassName={styles.player} />
                        {winner.agent ? <span className={styles.agent}> · {winner.agent}</span> : null}
                      </span>
                      <span className={styles.sub}>{`${plural(winner.bets, 'bet')} · ${money(winner.staked)} staked`}</span>
                    </span>
                    <span className={styles.end}>
                      <span className={`${styles.amount} ${styles.win}`}>+{money(winner.profit)}</span>
                      <span className={styles.sub}>player profit</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        </div>
      )}
    </Card>
  )
}
