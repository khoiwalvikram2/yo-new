import { useQuery } from '@apollo/client'
import {
  IconActivity,
  IconArrowsExchange,
  IconBuildingBank,
  IconCoins,
  IconHourglassHigh,
  IconHourglassOff,
  IconUserPlus,
  IconUsersGroup,
  IconWallet,
} from '@tabler/icons-react'
import { DASHBOARD_OPERATIONS_QUERY } from '../graphql'
import { useDashboardStore } from '@/state/dashboardStore'
import type { Accent } from '@/ui/components/accent'
import { Notice } from '@/ui/components/Notice'
import { FigureSection as Section, type Figure } from './FigureSection'
import { count, periodLabel, plural, useWholeMoney } from './insightFormat'

/* The Overview's operations sections, the owner's list (2026-10-29), in place of Advanced Analytics.
   A B2C (cash) whitelabel gets Deposits & Withdrawals, Pending Actions, Player Activity, Registrations &
   Status and Balances & Agents; a credit (chips) whitelabel gets Chip Movements, Credit Pool & Settlement,
   Player Activity, Registrations & Status and Players & Agents. One with both kinds of players gets both,
   with the shared two once. Figures come from Query.dashboardOperations; the period totals the KPI query
   already has (deposits, withdrawals, first deposits, bets, players) are read from it, not asked twice.

   Colour (the owner's colour pass, same day, then toned down at the owner's ask): each section's accent
   tints a glyph chip by its title, with no coloured borders. Only the headline figures take colour, on
   their colour's tint (money in green, money out rose, a waiting queue amber, the rest blue); every other
   figure stays in the ink. */

interface OverviewTotals {
  totalDeposits?: number
  totalWithdrawals?: number
  netDeposits?: number
  ftd?: number
  ftdCount?: number
  totalBets?: number
  totalPlayers?: number
}

type Operations = Record<string, number | boolean | null>

/** Money in, money out: a signed figure takes the colour of the way it went. */
const signed = (value: number): Accent => (value < 0 ? 'rose' : 'green')

export function OperationsSections({ kpis }: { kpis?: OverviewTotals }) {
  const { getDateRangeForQuery, filters } = useDashboardStore()
  const money = useWholeMoney()
  const dateRange = getDateRangeForQuery()
  const period = periodLabel(filters?.dateRange?.preset)

  const { data, loading, error } = useQuery(DASHBOARD_OPERATIONS_QUERY, {
    variables: { dateRange },
    pollInterval: 60000,
    errorPolicy: 'all',
  })
  const ops: Operations = data?.dashboardOperations ?? {}
  // Until the first answer the sections hold their height with placeholders; a refetch keeps the last figures.
  const pending = loading && !data
  const n = (key: string) => Number(ops[key] ?? 0)
  // A queue with something in it is amber; an empty one stays in the ink.
  const waiting = (value: number): Accent | undefined => (value > 0 ? 'amber' : undefined)

  if (error && !data) {
    return <Notice tone="error" title="Operations figures unavailable">{error.message}</Notice>
  }

  // While loading, the B2C layout holds the space; a credit-only whitelabel swaps it once its figures land.
  const showB2C = pending ? true : Boolean(ops.showB2C)
  const showCredit = pending ? false : Boolean(ops.showCredit)

  const depositsTotal = Number(kpis?.totalDeposits ?? n('directDeposits') + n('manualDeposits'))
  const withdrawalsTotal = Number(kpis?.totalWithdrawals ?? n('directWithdrawals') + n('manualWithdrawals'))
  const netDeposits = Number(kpis?.netDeposits ?? depositsTotal - withdrawalsTotal)
  const chipsIn = n('chipsDepositedByWhitelabel') + n('chipsDepositedByAgents')
  const chipsOut = n('chipsWithdrawnByWhitelabel') + n('chipsWithdrawnByAgents')

  const playerActivity: Figure[] = [
    { label: 'Online Now', value: count(n('onlineNow')), note: `Last ${n('onlineWindowMins') || 10} min`, accent: 'green' , drill: { kind: 'online_now' } },
    { label: 'Logged-in Players', value: count(n('loggedInPlayers')), note: period , drill: { kind: 'logged_in' } },
    { label: 'Players Who Bet', value: count(n('playersWhoBet')), note: period , drill: { kind: 'bettors' } },
    { label: 'Players with Open Bet', value: count(n('playersWithOpenBet')), note: 'Now' , drill: { kind: 'open_bet_players' } },
    { label: 'Bets Placed', value: count(n('betsPlaced')), note: `${period} · open bets included`, drill: { kind: 'bets' } },
  ]
  const registrations: Figure[] = [
    { label: 'Registered Today', value: count(n('registeredToday')), note: 'Since midnight IST', accent: 'green' , drill: { kind: 'players', arg: 'registered:today' } },
    { label: 'Total Registered', value: count(Number(kpis?.totalPlayers ?? 0)), note: 'All time' , drill: { kind: 'players' } },
    { label: 'Inactive Players', value: count(n('inactivePlayers')) , drill: { kind: 'players', arg: 'status:inactive' } },
    { label: 'Suspended Players', value: count(n('suspendedPlayers')) , drill: { kind: 'players', arg: 'status:suspended' } },
  ]

  return (
    <>
      {showB2C ? (
        <>
          <Section title="Deposits & Withdrawals" sub={period} icon={IconArrowsExchange} accent="green" pending={pending} figures={[
            { label: 'Manual Deposit', value: money(n('manualDeposits')), note: 'Added by an admin' , drill: { kind: 'deposits', arg: 'manual' } },
            { label: 'Direct Deposit', value: money(n('directDeposits')), note: 'Approved requests' , drill: { kind: 'deposits', arg: 'direct' } },
            { label: 'Total Deposit', value: money(depositsTotal), accent: 'green' , drill: { kind: 'deposits' } },
            { label: 'Net Deposit', value: money(netDeposits), note: 'Deposits minus withdrawals', accent: signed(netDeposits) , drill: { kind: 'net_deposits' } },
            { label: 'Manual Withdrawal', value: money(n('manualWithdrawals')), note: 'Taken by an admin' , drill: { kind: 'withdrawals', arg: 'manual' } },
            { label: 'Direct Withdrawal', value: money(n('directWithdrawals')), note: 'Completed requests' , drill: { kind: 'withdrawals', arg: 'direct' } },
            { label: 'Total Withdrawal', value: money(withdrawalsTotal), accent: 'rose' , drill: { kind: 'withdrawals' } },
            { label: 'First-Time Depositors', value: count(Number(kpis?.ftdCount ?? 0)), note: `${money(Number(kpis?.ftd ?? 0))} deposited` , drill: { kind: 'first_depositors' } },
          ]} />
          <Section title="Pending Actions" sub="Live" icon={IconHourglassHigh} accent="amber" pending={pending} figures={[
            { label: 'Pending Deposit Requests', value: count(n('pendingDepositRequests')), note: money(n('pendingDepositAmount')), accent: waiting(n('pendingDepositRequests')) , drill: { kind: 'pending_deposits' } },
            { label: 'Pending Withdrawal Requests', value: count(n('pendingWithdrawalRequests')), note: money(n('pendingWithdrawalAmount')), accent: waiting(n('pendingWithdrawalRequests')) , drill: { kind: 'pending_withdrawals' } },
            { label: 'Pending Bank/UPI Approvals', value: count(n('pendingPayoutAccounts')), note: 'Payout accounts', accent: waiting(n('pendingPayoutAccounts')) , drill: { kind: 'pending_payout_accounts' } },
          ]} />
        </>
      ) : null}
      {showCredit ? (
        <>
          <Section title="Chip Movements" sub={period} icon={IconCoins} accent="cyan" pending={pending} figures={[
            { label: 'Chips Deposited by Whitelabel', value: money(n('chipsDepositedByWhitelabel')) , drill: { kind: 'chip_moves', arg: 'wl_in' } },
            { label: 'Chips Deposited by Agents', value: money(n('chipsDepositedByAgents')) , drill: { kind: 'chip_moves', arg: 'agent_in' } },
            { label: 'Total Chips Deposited', value: money(chipsIn), accent: 'green' , drill: { kind: 'chip_moves', arg: 'in' } },
            { label: 'Net Chips', value: money(chipsIn - chipsOut), note: 'Deposited minus withdrawn', accent: signed(chipsIn - chipsOut) , drill: { kind: 'chip_moves' } },
            { label: 'Chips Withdrawn by Whitelabel', value: money(n('chipsWithdrawnByWhitelabel')) , drill: { kind: 'chip_moves', arg: 'wl_out' } },
            { label: 'Chips Withdrawn by Agents', value: money(n('chipsWithdrawnByAgents')) , drill: { kind: 'chip_moves', arg: 'agent_out' } },
            { label: 'Total Chips Withdrawn', value: money(chipsOut), accent: 'rose' , drill: { kind: 'chip_moves', arg: 'out' } },
            { label: 'Chips Given to Agents', value: money(n('chipsGivenToAgents')) , drill: { kind: 'chip_moves', arg: 'to_agents' } },
          ]} />
          <Section title="Credit Pool & Settlement" sub="Now; settled in the period" icon={IconBuildingBank} accent="blue" pending={pending} figures={[
            { label: 'Credit Limit', value: money(n('creditLimit')), accent: 'blue' },
            { label: 'Credit Used', value: money(n('creditUsed')), note: n('creditLimit') > 0 ? `${((n('creditUsed') / n('creditLimit')) * 100).toFixed(1)}% of the limit` : undefined },
            { label: 'Credit Available', value: money(n('creditAvailable')) },
            { label: 'Settlement Due', value: money(n('settlementDue')), accent: 'rose' },
            { label: 'Settled Amount', value: money(n('settledAmount')), note: period , drill: { kind: 'settlements' } },
            { label: 'Chips with Players', value: money(n('chipsWithPlayers')), note: 'Available to credit players' , drill: { kind: 'credit_players' } },
          ]} />
        </>
      ) : null}
      <Section title="Awaiting Settlement" sub="Live · should have settled by now" icon={IconHourglassOff} accent="amber" pending={pending} figures={[
        { label: `Sports Bets Open > ${n('staleSportsHours') || 24}h`, value: count(n('staleSportsBets')), note: plural(n('staleSportsEvents'), 'event'), accent: waiting(n('staleSportsBets')) , drill: { kind: 'bets', arg: 'stale' } },
        { label: 'Stuck Casino Rounds', value: count(n('stuckCasinoRounds')), note: `Open > ${n('casinoStuckMinutes') || 30} min`, accent: waiting(n('stuckCasinoRounds')) , drill: { kind: 'bets', arg: 'stuck' } },
        { label: 'Overdue Matka Bets', value: count(n('overdueMatkaBets')), note: `${plural(n('overdueMatkaMarkets'), 'market')} past their draw`, accent: waiting(n('overdueMatkaBets')) , drill: { kind: 'bets', arg: 'overdue' } },
      ]} />
      <Section title="Player Activity" sub={`${period} · online and open bets are live`} icon={IconActivity} accent="violet" pending={pending} figures={playerActivity} />
      <Section title="Registrations & Status" sub="Now" icon={IconUserPlus} accent="blue" pending={pending} figures={registrations} />
      {showB2C ? (
        <Section title="Balances & Agents" sub="Now; bonus in the period" icon={IconWallet} accent="cyan" pending={pending} figures={[
          { label: 'Players Wallet Balance', value: money(n('walletBalance')), accent: 'blue' , drill: { kind: 'wallet_balances' } },
          { label: 'Bonus Given', value: money(n('bonusGiven')), note: period , drill: { kind: 'bonus_awards' } },
          { label: 'Sharing Agents', value: count(n('sharingAgentsActive')), note: 'Active' , drill: { kind: 'agents', arg: 'SHARING' } },
          { label: 'Commission Agents', value: count(n('commissionAgentsActive')), note: 'Active' , drill: { kind: 'agents', arg: 'COMMISSION' } },
        ]} />
      ) : null}
      {showCredit ? (
        <Section title="Players & Agents" sub="Now" icon={IconUsersGroup} accent="violet" pending={pending} figures={[
          { label: 'Direct Players', value: count(n('directPlayers')), note: 'No agent' , drill: { kind: 'players', arg: 'agent:none' } },
          { label: 'Agent Players', value: count(n('agentPlayers')), note: 'Under an agent' , drill: { kind: 'players', arg: 'agent:any' } },
          { label: 'Credit Agents', value: count(n('creditAgentsActive')), note: 'Active' , drill: { kind: 'agents', arg: 'CREDIT' } },
        ]} />
      ) : null}
    </>
  )
}
