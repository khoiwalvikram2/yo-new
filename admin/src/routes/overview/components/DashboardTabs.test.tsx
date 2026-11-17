/**
 * The rebuilt Players, Financial, Agents and Time tabs against stubbed replies: each draws its figures
 * from its own query (Financial from the period KPIs and dashboardTrends), compares periods as labelled,
 * links players and agents to their pages, draws every day of the period, and names its charts.
 */
import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ApolloClient, ApolloLink, ApolloProvider, InMemoryCache, Observable } from '@apollo/client'
import { useDashboardStore } from '@/state/dashboardStore'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import { DrilldownContext, type DrillRequest } from './drilldownContext'
import { PlayersTab } from './PlayersTab'
import { FinancialTab } from './FinancialTab'
import { AgentsTab } from './AgentsTab'
import { TimeTab } from './TimeTab'

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    convertFromWhitelabelCurrency: (amount: number) => amount,
    formatAmount: (amount: number) => `INR ${amount}`,
  }),
}))

afterEach(cleanup)

const period = (overrides: object = {}) => ({
  __typename: 'DashboardPlayerPeriod', newPlayers: 10, bettors: 40, bets: 400, turnover: 80000, depositors: 20, deposits: 50, depositAmount: 100000, ...overrides,
})

const PLAYERS = {
  __typename: 'DashboardPlayersTab',
  funnel: { __typename: 'DashboardPlayerFunnel', registered: 1000, depositors: 400, bettors30: 200, bettors7: 100, bettorsToday: 25 },
  byStatus: [{ __typename: 'DashboardKeyCount', key: 'active', players: 900 }, { __typename: 'DashboardKeyCount', key: 'suspended', players: 100 }],
  byType: [{ __typename: 'DashboardKeyCount', key: 'REGULAR', players: 1000 }],
  daily: [
    { __typename: 'DashboardPlayerDay', day: '2026-10-28', registrations: 3, firstDeposits: 1, firstDepositAmount: 500 },
    { __typename: 'DashboardPlayerDay', day: '2026-10-29', registrations: 0, firstDeposits: 0, firstDepositAmount: 0 },
  ],
  products: [{ __typename: 'DashboardProductPlay', product: 'casino', bettors: 30, bets: 300, stake: 60000, ggr: 1200 }],
  topStakers: [{ __typename: 'DashboardTopStaker', userId: 7, username: 'bigbet', agent: 'neha', bets: 90, staked: 40000, playerPl: -2500 }],
  topDepositors: [{ __typename: 'DashboardTopDepositor', userId: 8, username: 'payer', agent: null, deposits: 4, amount: 30000 }],
  current: period(),
  previous: period({ newPlayers: 8, bettors: 50 }),
}

const AGENTS = {
  __typename: 'DashboardAgentsTab',
  network: { __typename: 'DashboardAgentNetwork', total: 12, active: 11, suspended: 1, sharing: 2, commission: 9, credit: 1, topLevel: 5, levels: 3, newAgents: 2, playersUnderAgents: 300, directPlayers: 50 },
  commissionTotal: 4500,
  commissionByDomain: [{ __typename: 'DashboardDomainAmount', domain: 'casino', amount: 4500 }],
  settlementOwed: 0, settlementOwing: 0, agentsWithBalance: 0, settlementsPosted: 0, settlementsAmount: 0,
  leaderboard: [{ __typename: 'DashboardAgentRow', agentId: 'agent-1', username: 'neha', scheme: 'COMMISSION', status: 'ACTIVE', subAgents: 2, players: 51, activePlayers: 9, turnover: 70000, ggr: -300, commission: 900 }],
}

/* The root credit agents on chips (spec 2026-11-02 §7: the admin's own chipDownline, agents only). */
const CREDIT_AGENT = { __typename: 'ChipAccount', accountType: 'AGENT', id: 'agent-2', username: 'cagent', name: null, status: 'ACTIVE', parentAgentId: null, playerType: null, currency: 'INR', creditReference: 100000, balance: 95000, exposure: 200, available: 95000, downlineBalance: 3000, refPnl: -2000, downlineCount: 4 }
const CHIP_DOWNLINE = {
  __typename: 'AgentsQuery',
  chipDownline: {
    __typename: 'ChipDownline', parent: null, pool: null, items: [CREDIT_AGENT], total: 1,
    totals: { __typename: 'ChipTotals', creditReference: 100000, balance: 95000, exposure: 200, available: 95000, downlineBalance: 3000, refPnl: -2000 },
  },
}
let chipDownlineAsks: Array<Record<string, unknown>> = []

const TIME = {
  __typename: 'DashboardTimeTab',
  windowFrom: '2026-09-29T00:00:00.000Z', windowTo: '2026-10-29T00:00:00.000Z', windowDays: 30, widened: true,
  heatmap: [{ __typename: 'DashboardHeatCell', weekday: 7, hour: 17, bets: 10, stake: 5800 }],
  hourly: Array.from({ length: 24 }, (_, hour) => ({ __typename: 'DashboardHourRow', hour, bets: hour === 17 ? 10 : hour === 3 ? 0 : 1, stake: hour === 17 ? 5800 : 100, ggr: hour === 20 ? 700 : 0, players: 1 })),
  weekdays: Array.from({ length: 7 }, (_, i) => ({ __typename: 'DashboardWeekdayRow', weekday: i + 1, bets: i === 6 ? 11 : 1, stake: 100, ggr: 0, players: 1 })),
  month: { __typename: 'DashboardMonthRun', month: '2026-10', daysElapsed: 10, daysInMonth: 31, ggr: 1000, turnover: 5000, bets: 20, previousGgr: 500, previousTurnover: 0, previousBets: 40 },
}

const TRENDS = [
  { __typename: 'DashboardTrendPoint', date: '2026-10-27', turnover: 0, ggr: -100900, ngr: 0, deposits: 0, withdrawals: 0, netDeposits: 0, sportsGGR: 0, casinoGGR: 0, matkaGGR: 0, activePlayers: 0, betCount: 0 },
]

function mount(children: ReactNode) {
  const link = new ApolloLink((operation) => new Observable((observer) => {
    const replies: Record<string, object> = {
      DashboardPlayersTab: { dashboardPlayersTab: PLAYERS },
      DashboardAgentsTab: { dashboardAgentsTab: AGENTS },
      ChipDownline: { agents: CHIP_DOWNLINE },
      DashboardTimeTab: { dashboardTimeTab: TIME },
      DashboardTrends: { dashboardTrends: TRENDS },
      DashboardPlayerRetention: { dashboardPlayerRetention: {
        __typename: 'DashboardPlayerRetention', dailyActive: 1, weeklyActive: 2, monthlyActive: 3, activeInPeriod: 2, activePrevious: 4,
        returning: 1, newPlayers: 10, newDepositors: 5, repeatDepositors: 1, depositors: 2, lapsing: 0,
      } },
    }
    if (operation.operationName === 'ChipDownline') chipDownlineAsks.push(JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown>)
    const timer = setTimeout(() => { observer.next({ data: replies[operation.operationName] ?? {} }); observer.complete() }, 1)
    return () => clearTimeout(timer)
  }))
  return render(
    <MemoryRouter>
      <ApolloProvider client={new ApolloClient({ link, cache: new InMemoryCache() })}>{children}</ApolloProvider>
    </MemoryRouter>,
  )
}

function figure(section: string, label: string): HTMLElement {
  const value = within(screen.getByRole('region', { name: section })).getByText(label).parentElement?.querySelector('dd')
  assert.ok(value, `${section} › ${label} has a value`)
  return value as HTMLElement
}

describe('Dashboard tabs', () => {
  test('Players: funnel rates, period comparison, links to the players', async () => {
    mount(<PlayersTab />)
    const funnel = await screen.findByRole('region', { name: 'Player Funnel' })
    assert.ok(within(funnel).getByText('40.0% of all · 40.0% of the step above'))
    assert.ok(within(funnel).getByText('25'))
    assert.equal(figure('This Period vs the One Before', 'New Players').textContent, '10')
    assert.ok(screen.getByText('▲ 25.0% vs 8'))
    assert.ok(screen.getByText('▼ 20.0% vs 50'))
    assert.equal(screen.getByRole('link', { name: 'bigbet' }).getAttribute('href'), '/players/profile/7')
    assert.ok(screen.getByRole('img', { name: /^Daily registrations and first deposits: 28 Oct to 29 Oct/ }))
  })

  test('Players: in core mode the top players are named without profile links core mode cannot open (PLA-05)', async () => {
    const ui = useUIStore.getState(); const roles = useAuthStore.getState().roles
    useAuthStore.setState({ roles: ['Super Admin'] }); useUIStore.setState({ directorMode: 'core', selectedWhitelabelId: null })
    try {
      mount(<PlayersTab />)
      const top = await screen.findByRole('region', { name: 'Top Players' })
      assert.ok(within(top).getByText('bigbet'))
      assert.ok(within(top).getByText('payer'))
      assert.equal(within(top).queryAllByRole('link').length, 0)
    } finally {
      useAuthStore.setState({ roles }); useUIStore.setState({ directorMode: ui.directorMode, selectedWhitelabelId: ui.selectedWhitelabelId })
    }
  })

  test('Financial: the statement from the KPIs, and every day of the period in the daily charts', async () => {
    useDashboardStore.setState({ getDateRangeForQuery: () => ({ dateFrom: '2026-10-22T18:30:00.000Z', dateTo: '2026-10-29T18:29:59.999Z' }) } as never)
    mount(<FinancialTab kpis={{ totalDeposits: 82000, totalWithdrawals: 5000, netDeposits: 77000, turnover: 1100, ggr: -100900, ngr: -100900, matkaGGR: -100900, matkaTurnover: 1100, matkaBets: 11 }} />)
    const flow = screen.getByRole('region', { name: 'Money Flow' })
    assert.ok(within(flow).getByText('INR 82000'))
    assert.ok(within(flow).getByText('− INR 5000'))
    assert.ok(within(flow).getByText('INR 77000'))
    const chart = await screen.findByRole('img', { name: /^Daily GGR: 23 Oct to 29 Oct/ })
    assert.ok(chart)
    // Seven IST days, the quiet ones drawn as zero rather than dropped.
    assert.equal(screen.getByText('Per IST day · 7 days') !== null, true)
  })

  test('Financial: commission, bonus paid and NGR open the lists that add up to them (DAS-KPI-DRILL-GGR)', () => {
    useDashboardStore.setState({ getDateRangeForQuery: () => ({ dateFrom: '2026-10-22T18:30:00.000Z', dateTo: '2026-10-29T18:29:59.999Z' }) } as never)
    const opened: DrillRequest[] = []
    mount(
      <DrilldownContext.Provider value={(request) => { opened.push(request) }}>
        <FinancialTab kpis={{ ggr: 2000, agentCommission: 3000, bonusPayouts: 500, ngr: -1500 }} />
      </DrilldownContext.Provider>,
    )
    const flow = screen.getByRole('region', { name: 'Money Flow' })
    for (const label of ['Agent commission', 'Bonus paid', 'NGR']) fireEvent.click(within(flow).getByRole('button', { name: label }))
    assert.deepEqual(opened, [
      { title: 'Agent commission', kind: 'agent_commission' },
      { title: 'Bonus paid', kind: 'bonus_paid' },
      { title: 'NGR', kind: 'net_ggr' },
    ])
  })

  test('Agents: network, commission by domain, leaderboard and the root credit agents on chips', async () => {
    chipDownlineAsks = []
    mount(<AgentsTab />)
    await screen.findByRole('region', { name: 'Agent Network' })
    assert.equal(figure('Agent Network', 'Total Agents').textContent, '12')
    assert.ok(screen.getByText('Casino INR 4500 · agent ledgers'))
    const board = screen.getByRole('table', { name: "Agents by their players' stakes" })
    assert.equal(within(board).getByRole('link', { name: 'neha' }).getAttribute('href'), '/agents/agent-1')
    // Credit agents are on chips: their own and their downline's chips, the reference and Ref P/L; no "% used".
    const credit = await screen.findByRole('table', { name: 'Root credit agents on chips' })
    const row = within(within(credit).getByRole('link', { name: 'cagent' }).closest('tr') as HTMLElement)
    assert.equal(row.getByRole('link', { name: 'cagent' }).getAttribute('href'), '/agents/agent-2')
    for (const text of ['INR 95000', 'INR 3000', 'INR 200', 'INR 100000', '−INR 2000']) assert.ok(row.getByText(text), text)
    assert.ok(screen.getByText('Now · 1 root agent · Ref P/L −INR 2000 (owes upline)'))
    assert.equal(screen.queryByText('5%'), null)
    assert.deepEqual(chipDownlineAsks, [{ parentAgentId: null, query: null, accountType: 'AGENT', offset: 0, limit: 10 }])
  })
  test('Agents: the status note names inactive agents apart from suspended ones (DAS-AGENTS-TAB-SCHEME)', async () => {
    const original = AGENTS.network
    // 12 agents: 9 active, 1 suspended (SUSPENDED/BLOCKED), so 2 are INACTIVE (read-only), not suspended.
    AGENTS.network = { ...original, active: 9, suspended: 1 }
    try {
      mount(<AgentsTab />)
      await screen.findByRole('region', { name: 'Agent Network' })
      assert.ok(screen.getByText('9 active · 1 suspended · 2 inactive'))
    } finally { AGENTS.network = original }
    mount(<AgentsTab />)
    assert.ok(await screen.findByText('11 active · 1 suspended'), 'no inactive part when every non-active agent is suspended')
  })
  test('Agents: each scheme count opens every agent of that scheme, whatever its status (DAS-AGENTS-TAB-SCHEME)', async () => {
    // The counts include suspended and inactive agents; the bare scheme arg lists active agents only (Operations).
    const opened: DrillRequest[] = []
    mount(<DrilldownContext.Provider value={(request) => { opened.push(request) }}><AgentsTab /></DrilldownContext.Provider>)
    await screen.findByRole('region', { name: 'Agent Network' })
    for (const scheme of ['commission', 'sharing', 'credit']) fireEvent.click(screen.getByTitle(`Show the ${scheme} agents in detail`))
    assert.deepEqual(opened, [
      { kind: 'agents', arg: 'COMMISSION:all', title: 'Commission agents' },
      { kind: 'agents', arg: 'SHARING:all', title: 'Sharing agents' },
      { kind: 'agents', arg: 'CREDIT:all', title: 'Credit agents' },
    ])
  })
  test('Agents: no credit agents, no chips read', async () => {
    chipDownlineAsks = []
    const network = { ...AGENTS.network, credit: 0 }
    const original = AGENTS.network
    AGENTS.network = network
    try {
      mount(<AgentsTab />)
      await screen.findByRole('region', { name: 'Agent Network' })
      assert.equal(screen.queryByRole('region', { name: 'Credit Agents' }), null)
      assert.equal(chipDownlineAsks.length, 0)
    } finally { AGENTS.network = original }
  })

  test('Time: the widened window is named, peaks found, and the month projected', async () => {
    mount(<TimeTab />)
    await screen.findByRole('region', { name: 'Peak Times' })
    assert.ok(screen.getAllByText(/Last 30 days \(the period is under a week\)/).length > 0)
    assert.equal(figure('Peak Times', 'Busiest Hour').textContent, '17:00')
    assert.equal(figure('Peak Times', 'Quietest Hour').textContent, '03:00')
    assert.equal(figure('Peak Times', 'Best GGR Hour').textContent, '20:00')
    assert.ok(screen.getByRole('img', { name: /busiest Sun 17:00 with 10 bets/ }))
    // 1,000 over 10 days, times 31.
    assert.equal(figure("This Month's Run Rate", 'GGR at This Pace').textContent, 'INR 3100')
    assert.ok(screen.getByText('▲ 100.0% vs INR 500 last month'))
  })
})
