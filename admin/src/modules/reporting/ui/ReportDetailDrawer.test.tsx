import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useReportingStore } from '@/state/reportingStore'
import { ReportDetailDrawer } from './ReportDetailDrawer'
import { parseContributorSearch } from './contributorDetailModel'

const hooks = vi.hoisted(() => ({
  breakdownCalls: [] as Array<{ hook: string; filter: unknown }>,
  breakdown: {} as Record<string, { data?: unknown; loading: boolean }>,
}))

vi.mock('@/modules/reporting/hooks', () => {
  const make = (hook: string) => (filter: unknown) => {
    hooks.breakdownCalls.push({ hook, filter })
    return hooks.breakdown[hook] ?? { data: undefined, loading: false }
  }
  return {
    useSportsPlayerBreakdown: make('sportsPlayers'),
    useSportsAgentBreakdown: make('sportsAgents'),
    useCasinoPlayerBreakdown: make('casinoPlayers'),
    useCasinoAgentBreakdown: make('casinoAgents'),
  }
})

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => `₹${value.toFixed(2)}`,
    convertFromWhitelabelCurrency: (value: number) => value * 2,
  }),
}))
vi.mock('@/shared/core/useFormatLocale', () => ({ useFormatLocale: () => 'en-US' }))

const SPORTS_FILTER = { sportId: 's1', leagueId: 'l1', dateFrom: '2026-09-01', dateTo: '2026-09-30' }
const CASINO_FILTER = { vendorId: 3, dateFrom: '2026-09-01', dateTo: '2026-09-30' }

const PLAYERS = [
  { playerId: 'p1', playerUsername: 'asha', directAgentName: 'Raj Agency', totalStakes: 100, grossGamingRevenue: 25, betCount: 1200, winRate: 0.4 },
  { playerId: 'p2', totalStakes: 50, grossGamingRevenue: -10, betCount: 3 },
]
const AGENTS = [
  { agentId: 'a1', agentName: 'Raj Agency', totalStakes: 150, grossGamingRevenue: -5, netGgr: 0, commission: 12, playerCount: 2, betCount: 1203 },
]

function mount(domain: string, filter: object) {
  return render(<MemoryRouter><ReportDetailDrawer domain={domain} filter={filter} /></MemoryRouter>)
}

/** A row link's page path and its read-back selection. */
function linkOf(row: HTMLElement) {
  const href = row.getAttribute('href') ?? ''
  const [path, search] = href.split('?')
  return { path, ...parseContributorSearch(new URLSearchParams(search)) }
}

beforeEach(() => {
  hooks.breakdownCalls.length = 0
  hooks.breakdown = {
    sportsPlayers: { data: { sportsPlayerBreakdown: PLAYERS }, loading: false },
    sportsAgents: { data: { sportsAgentBreakdown: AGENTS }, loading: false },
    casinoPlayers: { data: { casinoPlayerBreakdown: [PLAYERS[0]] }, loading: false },
    casinoAgents: { data: { casinoAgentBreakdown: [] }, loading: false },
  }
  useReportingStore.setState({ drillDownPath: [{ type: 'all', name: 'All Sports' }, { type: 'sport', id: 's1', name: 'Cricket' }, { type: 'league', id: 'l1', name: 'IPL' }] })
})

describe('Contributors card', () => {
  test('without a drilled level it asks for one and loads nothing', () => {
    mount('sports', { dateFrom: '2026-09-01', dateTo: '2026-09-30' })
    const card = screen.getByRole('region', { name: 'Contributors' })
    assert.ok(within(card).getByText('No Selection'))
    assert.ok(within(card).getByText('Drill into a sport, league, or event to see contributing players and agents.'))
    assert.ok(hooks.breakdownCalls.every((call) => call.filter === undefined), 'every breakdown hook is skipped')
  })

  test('a casino context without a vendor or game shows the casino prompt', () => {
    mount('casino', {})
    assert.ok(screen.getByText('Drill into a vendor or select a game to see contributing players and agents.'))
  })

  test('a sports context lists its players with counts, agent, figures and the GGR sign in words', () => {
    mount('sports', SPORTS_FILTER)
    const sportsCalls = hooks.breakdownCalls.filter((call) => call.hook.startsWith('sports'))
    assert.ok(sportsCalls.every((call) => call.filter === SPORTS_FILTER))
    assert.ok(hooks.breakdownCalls.filter((call) => call.hook.startsWith('casino')).every((call) => call.filter === undefined))

    // the counts sit in the tabs; there is no separate count strip
    assert.equal(screen.queryByRole('group', { name: 'Contributor counts' }), null)
    assert.ok(screen.getByRole('tab', { name: 'Players (2)' }))
    assert.ok(screen.getByRole('tab', { name: 'Agents (1)' }))

    const rows = within(screen.getByRole('tabpanel')).getAllByRole('link')
    assert.deepEqual(
      rows.map((row) => row.textContent),
      [
        'ashaDirect agent: Raj Agency1,200 bets • 40% win₹200.00GGR gain₹50.00',
        'Player p23 bets₹100.00GGR loss₹20.00',
      ],
    )
    assert.ok(screen.getByText('Open a player for their bets, an agent for their players'))
    assert.equal(screen.queryByRole('dialog'), null, 'no drawer any more')
  })

  test('a player row opens the player page with the selection, the name and the drilled path', () => {
    mount('sports', SPORTS_FILTER)
    const [asha, p2] = within(screen.getByRole('tabpanel')).getAllByRole('link')
    assert.deepEqual(linkOf(asha), {
      path: '/reporting/sports/contributors/player/p1',
      name: 'asha',
      context: 'Cricket › IPL',
      filter: SPORTS_FILTER,
    })
    assert.equal(linkOf(p2).name, 'p2', 'an unnamed player is named by id')
  })

  test('a casino row and an agent row open their own pages', () => {
    const { unmount } = mount('casino', CASINO_FILTER)
    const casino = linkOf(within(screen.getByRole('tabpanel')).getByRole('link'))
    assert.equal(casino.path, '/reporting/casino/contributors/player/p1')
    assert.deepEqual(casino.filter, CASINO_FILTER)
    unmount()

    mount('sports', SPORTS_FILTER)
    fireEvent.click(screen.getByRole('tab', { name: 'Agents (1)' }))
    const agent = within(screen.getByRole('tabpanel')).getByRole('link')
    assert.equal(agent.textContent, 'Raj Agency2 players • 1,203 bets₹300.00GGR loss₹10.00GGR')
    assert.deepEqual(linkOf(agent), { path: '/reporting/sports/contributors/agent/a1', name: 'Raj Agency', context: 'Cricket › IPL', filter: SPORTS_FILTER })
  })

  test('the Players / Agents strip is one tab stop with arrow keys, wired to its panel', () => {
    mount('sports', SPORTS_FILTER)
    const tablist = screen.getByRole('tablist', { name: 'Contributors' })
    const [players, agents] = within(tablist).getAllByRole('tab')
    assert.equal(players.textContent, 'Players (2)')
    assert.equal(players.getAttribute('aria-selected'), 'true')
    assert.equal(agents.getAttribute('tabindex'), '-1')
    assert.equal(screen.getByRole('tabpanel').getAttribute('aria-labelledby'), players.id)

    players.focus()
    fireEvent.keyDown(players, { key: 'ArrowRight' })
    const agentsNow = screen.getByRole('tab', { name: 'Agents (1)' })
    assert.equal(agentsNow.getAttribute('aria-selected'), 'true')
    assert.equal(document.activeElement, agentsNow)
    assert.equal(screen.getByRole('tabpanel').id, agentsNow.getAttribute('aria-controls'))
  })

  test('loading contributors announces itself and hides the counts', () => {
    hooks.breakdown.sportsPlayers = { data: undefined, loading: true }
    mount('sports', SPORTS_FILTER)
    assert.equal(screen.getByRole('status').textContent, 'Loading contributors')
    assert.equal(screen.queryByRole('group', { name: 'Contributor counts' }), null)
    assert.equal(screen.getByRole('region', { name: 'Contributors' }).getAttribute('aria-busy'), 'true')
  })

  test('empty lists say so on each tab', () => {
    hooks.breakdown.sportsPlayers = { data: { sportsPlayerBreakdown: [] }, loading: false }
    hooks.breakdown.sportsAgents = { data: { sportsAgentBreakdown: [] }, loading: false }
    mount('sports', SPORTS_FILTER)
    assert.ok(screen.getByText('No players in this selection'))
    fireEvent.click(screen.getByRole('tab', { name: 'Agents (0)' }))
    assert.ok(screen.getByText('No agents in this selection'))
  })
})
