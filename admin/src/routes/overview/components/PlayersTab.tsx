import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@apollo/client'
import dayjs from 'dayjs'
import { IconArrowsDiff, IconCards, IconChartDots, IconDice5, IconTrophy } from '@tabler/icons-react'
import { DASHBOARD_PLAYERS_TAB_QUERY } from '../graphql'
import { useDashboardStore } from '@/state/dashboardStore'
import { ROUTES } from '@/shared/core/constants'
import type { Accent } from '@/ui/components/accent'
import { Card } from '@/ui/components/Card'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { FigureSection, type Figure } from './FigureSection'
import { count, periodLabel, plural, useWholeMoney } from './insightFormat'
import { RetentionSections } from './RetentionSections'
import { ColumnChart, Funnel, SplitBar } from './TabCharts'
import styles from './DashboardTabs.module.css'

/* The Players tab, rebuilt on Query.dashboardPlayersTab (the owner's redesign, 2026-10-29). Top to
   bottom: the player base as a funnel beside its status and type mix; the period against the one before;
   daily sign-ups and first deposits; retention (RetentionSections); where players play and how they bet;
   and the biggest stakers and depositors. "Staked" counts every bet placed, open ones included, so it can
   run ahead of the KPI turnover, which counts settled bets. */

interface Period {
  newPlayers: number
  bettors: number
  bets: number
  turnover: number
  depositors: number
  deposits: number
  depositAmount: number
}

interface PlayersTabData {
  funnel: { registered: number; depositors: number; bettors30: number; bettors7: number; bettorsToday: number }
  byStatus: Array<{ key: string; players: number }>
  byType: Array<{ key: string; players: number }>
  daily: Array<{ day: string; registrations: number; firstDeposits: number; firstDepositAmount: number }>
  products: Array<{ product: string; bettors: number; bets: number; stake: number; ggr: number }>
  topStakers: Array<{ userId: number; username: string; agent: string | null; bets: number; staked: number; playerPl: number }>
  topDepositors: Array<{ userId: number; username: string; agent: string | null; deposits: number; amount: number }>
  current: Period
  previous: Period
}

const STATUS: Record<string, { label: string; accent: Accent }> = {
  active: { label: 'Active', accent: 'green' },
  inactive: { label: 'Inactive', accent: 'amber' },
  suspended: { label: 'Suspended', accent: 'rose' },
}

const TYPE: Record<string, { label: string; accent: Accent }> = {
  REGULAR: { label: 'Direct players', accent: 'blue' },
  COMMISSION_AGENT_PLAYER: { label: 'Commission agent players', accent: 'violet' },
  SHARING_AGENT_PLAYER: { label: 'Sharing agent players', accent: 'cyan' },
  WHITELABEL_CREDIT: { label: 'Whitelabel credit players', accent: 'amber' },
  AGENT_CREDIT: { label: 'Agent credit players', accent: 'rose' },
}

const PRODUCT: Record<string, { label: string; accent: Accent; icon: ReactNode }> = {
  sports: { label: 'Sports', accent: 'blue', icon: <IconTrophy size={15} stroke={1.8} /> },
  casino: { label: 'Casino', accent: 'violet', icon: <IconCards size={15} stroke={1.8} /> },
  matka: { label: 'Matka', accent: 'amber', icon: <IconDice5 size={15} stroke={1.8} /> },
}

const profile = (userId: number) => ROUTES.PLAYERS_PROFILE.replace(':playerId', String(userId))

/** The period against the one before: "▲ 12.5% vs 40", in green up and rose down. */
function change(current: number, previous: number, show: (value: number) => string): Pick<Figure, 'note' | 'accent'> {
  if (previous === 0) return { note: current > 0 ? 'New this period (none before)' : 'None in either period' }
  const pct = ((current - previous) / Math.abs(previous)) * 100
  if (Math.abs(pct) < 0.05) return { note: `No change vs ${show(previous)}` }
  return { note: `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}% vs ${show(previous)}`, accent: pct > 0 ? 'green' : 'rose' }
}

const per = (part: number, whole: number) => (whole > 0 ? part / whole : 0)

export function PlayersTab() {
  const { getDateRangeForQuery, filters } = useDashboardStore()
  const period = periodLabel(filters?.dateRange?.preset)
  const money = useWholeMoney()
  const { data, loading, error } = useQuery(DASHBOARD_PLAYERS_TAB_QUERY, {
    variables: { dateRange: getDateRangeForQuery() },
    pollInterval: 120000,
    errorPolicy: 'all',
  })
  if (error && !data) return <Notice tone="error" title="Player analytics unavailable">{error.message}</Notice>
  const d: PlayersTabData | undefined = data?.dashboardPlayersTab
  const pending = loading && !data
  if (!d) return <LoadingState height={520} label="Loading player analytics" />

  const { current: c, previous: p } = d
  const totalFirst = d.daily.reduce((sum, day) => sum + day.firstDeposits, 0)
  const totalFirstAmount = d.daily.reduce((sum, day) => sum + day.firstDepositAmount, 0)
  const staked = d.products.reduce((sum, row) => sum + row.stake, 0)

  return (
    <div className={styles.tab}>
      <div className={`${styles.pair} ${styles.wideFirst}`}>
        <Card title="Player Funnel" sub="Now · from sign-up to betting today" accent="violet">
          <div className={styles.padded}>
            <Funnel format={count} steps={[
              { label: 'Registered', value: d.funnel.registered, note: 'Every player account', accent: 'blue', drill: { kind: 'players' } },
              { label: 'Deposited', value: d.funnel.depositors, note: 'An approved deposit, ever', accent: 'green', drill: { kind: 'depositors' } },
              { label: 'Bet in the last 30 days', value: d.funnel.bettors30, note: 'Placed a bet', accent: 'violet', drill: { kind: 'bettors', arg: 'mins:43200' } },
              { label: 'Bet in the last 7 days', value: d.funnel.bettors7, note: 'Placed a bet', accent: 'cyan', drill: { kind: 'bettors', arg: 'mins:10080' } },
              { label: 'Bet today', value: d.funnel.bettorsToday, note: 'Since midnight IST', accent: 'amber', drill: { kind: 'bettors', arg: 'today' } },
            ]} />
          </div>
        </Card>
        <Card title="Player Mix" sub="Now · every player account">
          <div className={`${styles.stack} ${styles.padded}`}>
            <SplitBar title="By status" format={count} segments={d.byStatus.map((row) => ({
              label: STATUS[row.key]?.label ?? row.key, value: row.players, accent: STATUS[row.key]?.accent ?? 'cyan',
              drill: { kind: 'players', arg: `status:${row.key}` },
            }))} />
            <SplitBar title="By type" format={count} segments={d.byType.map((row) => ({
              label: TYPE[row.key]?.label ?? row.key, value: row.players, accent: TYPE[row.key]?.accent ?? 'cyan',
              drill: { kind: 'players', arg: `type:${row.key}` },
            }))} />
          </div>
        </Card>
      </div>

      <FigureSection title="This Period vs the One Before" sub={`${period} against the same length just before it`} icon={IconArrowsDiff} accent="blue" pending={pending} figures={[
        { label: 'New Players', value: count(c.newPlayers), ...change(c.newPlayers, p.newPlayers, count), drill: { kind: 'players', arg: 'registered:period' } },
        { label: 'Active Bettors', value: count(c.bettors), ...change(c.bettors, p.bettors, count), drill: { kind: 'bettors' } },
        { label: 'Bets Placed', value: count(c.bets), ...change(c.bets, p.bets, count), drill: { kind: 'bets' } },
        { label: 'Staked', value: money(c.turnover), ...change(c.turnover, p.turnover, money), drill: { kind: 'bettors' } },
        { label: 'Depositors', value: count(c.depositors), ...change(c.depositors, p.depositors, count), drill: { kind: 'depositors', arg: 'period' } },
        { label: 'Deposited', value: money(c.depositAmount), ...change(c.depositAmount, p.depositAmount, money), drill: { kind: 'depositors', arg: 'period' } },
      ]} />

      <Card title="Sign-ups & First Deposits" sub={`Per IST day · ${plural(totalFirst, 'first deposit')} worth ${money(totalFirstAmount)}`} accent="green">
        <ColumnChart
          label="Daily registrations and first deposits"
          categories={d.daily.map((day) => dayjs(day.day).format('D MMM'))}
          series={[
            { name: 'Registrations', accent: 'violet', values: d.daily.map((day) => day.registrations) },
            { name: 'First deposits', accent: 'green', values: d.daily.map((day) => day.firstDeposits) },
          ]}
          format={count}
          axis={(value) => count(value)}
          height={200}
        />
      </Card>

      <RetentionSections />

      <div className={styles.pair}>
        <Card title="Where Players Play" sub={`${period} · staked includes open bets`} body="flush">
          <div className={styles.list}>
            <div className={styles.padded}>
              <SplitBar title="Staked by product" format={money} segments={d.products.map((row) => ({
                label: PRODUCT[row.product]?.label ?? row.product, value: row.stake, accent: PRODUCT[row.product]?.accent ?? 'cyan',
              }))} />
            </div>
          </div>
          <ul className={styles.list}>
            {d.products.map((row) => {
              const product = PRODUCT[row.product]
              return (
                <li key={row.product} className={styles.row}>
                  <span className={styles.tile} data-accent={product?.accent} aria-hidden="true">{product?.icon}</span>
                  <span className={styles.body}>
                    <span className={styles.name}>{product?.label ?? row.product}</span>
                    <span className={styles.sub}>{`${plural(row.bettors, 'player')} · ${plural(row.bets, 'bet')} · ${staked > 0 ? ((row.stake / staked) * 100).toFixed(1) : '0.0'}% of stakes`}</span>
                  </span>
                  <span className={styles.end}>
                    <span className={styles.amount}>{money(row.stake)}</span>
                    <span className={`${styles.sub} ${row.ggr < 0 ? styles.loss : row.ggr > 0 ? styles.gain : ''}`}>{`GGR ${money(row.ggr)}`}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>
        <FigureSection title="How Players Bet & Deposit" sub={period} icon={IconChartDots} accent="cyan" pending={pending} figures={[
          { label: 'Bets per Active Player', value: per(c.bets, c.bettors).toFixed(1), note: `${plural(c.bets, 'bet')} by ${plural(c.bettors, 'player')}` },
          { label: 'Average Stake', value: money(per(c.turnover, c.bets)), note: 'Per bet placed' },
          { label: 'Average Deposit', value: money(per(c.depositAmount, c.deposits)), note: `Over ${plural(c.deposits, 'approved deposit')}` },
          { label: 'Deposits per Depositor', value: per(c.deposits, c.depositors).toFixed(1), note: `${plural(c.depositors, 'depositor')}` },
        ]} />
      </div>

      <Card title="Top Players" sub={`${period} · by stake and by deposits`} body="flush">
        <div className={styles.cols}>
          <div>
            <h3 className={styles.colLabel}>Biggest stakers</h3>
            {d.topStakers.length === 0 ? <p className={styles.empty}>No bets in this period.</p> : (
              <ul className={styles.list}>
                {d.topStakers.map((row, index) => (
                  <li key={row.userId} className={styles.row}>
                    <span className={styles.rank} aria-hidden="true">{index + 1}</span>
                    <span className={styles.body}>
                      <span className={styles.name}><Link className={styles.link} to={profile(row.userId)}>{row.username}</Link>{row.agent ? <span className={styles.sub}>{` · ${row.agent}`}</span> : null}</span>
                      <span className={styles.sub}>{plural(row.bets, 'bet')}</span>
                    </span>
                    <span className={styles.end}>
                      <span className={styles.amount}>{money(row.staked)}</span>
                      <span className={`${styles.sub} ${row.playerPl > 0 ? styles.loss : row.playerPl < 0 ? styles.gain : ''}`}>{`Player P/L ${row.playerPl > 0 ? '+' : ''}${money(row.playerPl)}`}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className={styles.colLabel}>Biggest depositors</h3>
            {d.topDepositors.length === 0 ? <p className={styles.empty}>No approved deposits in this period.</p> : (
              <ul className={styles.list}>
                {d.topDepositors.map((row, index) => (
                  <li key={row.userId} className={styles.row}>
                    <span className={styles.rank} aria-hidden="true">{index + 1}</span>
                    <span className={styles.body}>
                      <span className={styles.name}><Link className={styles.link} to={profile(row.userId)}>{row.username}</Link>{row.agent ? <span className={styles.sub}>{` · ${row.agent}`}</span> : null}</span>
                      <span className={styles.sub}>{plural(row.deposits, 'deposit')}</span>
                    </span>
                    <span className={styles.end}>
                      <span className={`${styles.amount} ${styles.gain}`}>{money(row.amount)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}
