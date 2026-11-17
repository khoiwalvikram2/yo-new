import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { contributorDetailPath, parseContributorSearch } from '@/modules/reporting/ui/contributorDetailModel'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import ContributorDetailPage from './ContributorDetailPage'

interface QueryOptions { variables: { domain: string; filters: Record<string, any>; limit: number; offset: number }; skip?: boolean; fetchPolicy: string }

const hooks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  breakdownCalls: [] as Array<{ hook: string; filter: unknown }>,
  breakdown: {} as Record<string, { data?: unknown; loading: boolean }>,
  rbac: [] as unknown[],
}))

vi.mock('@apollo/client', async (importOriginal) => ({ ...await importOriginal<typeof import('@apollo/client')>(), useQuery: hooks.useQuery }))
vi.mock('@/modules/reporting/hooks', () => {
  const make = (hook: string) => (filter: unknown) => {
    hooks.breakdownCalls.push({ hook, filter })
    return filter ? (hooks.breakdown[hook] ?? { data: undefined, loading: false }) : { data: undefined, loading: false }
  }
  return {
    useSportsPlayerBreakdown: make('sportsPlayers'),
    useSportsAgentBreakdown: make('sportsAgents'),
    useCasinoPlayerBreakdown: make('casinoPlayers'),
    useCasinoAgentBreakdown: make('casinoAgents'),
  }
})
vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, children }: { required: unknown; children: ReactNode }) => { hooks.rbac.push(required); return <>{children}</> },
}))
vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({ formatAmount: (value: number) => `₹${value.toFixed(2)}`, convertFromWhitelabelCurrency: (value: number) => value * 2 }),
}))
vi.mock('@/shared/core/useFormatLocale', () => ({ useFormatLocale: () => 'en-US' }))
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDateTime: (value: string, pattern: string) => `${pattern}|${value}` }) }))

const SPORTS_FILTER = { sportId: 's1', leagueId: 'l1', dateFrom: '2026-09-01', dateTo: '2026-09-30' }
const CASINO_FILTER = { vendorId: 3, dateFrom: '2026-09-01', dateTo: '2026-09-30' }
const PLAYERS = [
  { playerId: 'p1', playerUsername: 'asha', directAgentId: 'a1', directAgentName: 'Raj Agency', totalStakes: 100, grossGamingRevenue: 25, betCount: 1200, avgStake: 5, winRate: 0.4 },
  { playerId: 'p2', directAgentId: 'a9', totalStakes: 50, grossGamingRevenue: -10, betCount: 3 },
]
const AGENTS = [{ agentId: 'a1', agentName: 'Raj Agency', totalStakes: 150, grossGamingRevenue: -5, netGgr: 0, commission: 12, playerCount: 2, betCount: 1203 }]
let calls: Array<{ document: unknown; options: QueryOptions }>
let sportsBets: { data?: unknown; loading: boolean }
let casinoBets: { data?: unknown; loading: boolean }

function lastOptions(domain: string): QueryOptions {
  const found = calls.filter((call) => call.options.variables.domain === domain).at(-1)
  assert.ok(found, 'the query was called')
  return found.options
}

function cellsOf(table: HTMLElement): string[][] {
  return within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent ?? ''))
}

function open(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/reporting/sports/contributors/:kind/:id" element={<ContributorDetailPage />} />
    <Route path="/reporting/casino/contributors/:kind/:id" element={<ContributorDetailPage />} />
    <Route path="/players/profile/:id" element={<p>Profile page</p>} />
  </Routes></MemoryRouter>)
}

beforeEach(() => {
  calls = []
  hooks.breakdownCalls.length = 0
  hooks.rbac.length = 0
  hooks.breakdown = {
    sportsPlayers: { data: { sportsPlayerBreakdown: PLAYERS }, loading: false },
    sportsAgents: { data: { sportsAgentBreakdown: AGENTS }, loading: false },
    casinoPlayers: { data: { casinoPlayerBreakdown: [PLAYERS[0]] }, loading: false },
    casinoAgents: { data: { casinoAgentBreakdown: [] }, loading: false },
  }
  sportsBets = { data: { sportsBets: [
    { id: 'b1', eventName: 'MI v CSK', leagueName: 'IPL', sportName: 'Cricket', selectionId: 'MI', side: 'back', price: 2.5, stake: 100, status: 'won', createdAt: '2026-09-22T10:00:00Z' },
    { id: 'b2', eventName: null, leagueName: 'IPL', sportName: 'Cricket', selectionId: null, side: 'lay', price: null, stake: 20, liability: 30, status: 'settled', createdAt: null },
  ] }, loading: false }
  casinoBets = { data: { casinoBets: [{ id: 'c1', gameName: 'Teen Patti', vendorName: 'Evo', stake: '40', payout: 0, winAmount: 10, status: 'lost', createdAt: '2026-09-22T11:00:00Z' }] }, loading: false }
  hooks.useQuery.mockImplementation((document: unknown, options: QueryOptions) => {
    calls.push({ document, options })
    if (options.skip) return { data: undefined, loading: false }
    const source = options.variables.domain === 'SPORTS' ? sportsBets : casinoBets
    const rows = ((source.data as any)?.sportsBets ?? (source.data as any)?.casinoBets ?? []).filter((r:any) => (!options.variables.filters.status || options.variables.filters.status.includes(r.status)) && (!options.variables.filters.search || String(r.eventName ?? r.gameName).toLowerCase().includes(options.variables.filters.search.toLowerCase())))
    return { data: { betsPage: { total: rows.length, items: rows.slice(options.variables.offset,options.variables.offset+options.variables.limit).map((r:any) => ({...r,sportsStatus:r.status,casinoStatus:r.status,netAmount:r.payout != null ? r.payout+(r.winAmount??0)-Number(r.stake) : undefined})) } }, loading: source.loading }
  })
})

describe('Contributor page', () => {
  test('a player: the header, the figures and their settled bets in the selection, with the exact query', () => {
    open(contributorDetailPath('sports', 'player', 'p1', { name: 'asha', context: 'Cricket › IPL', filter: SPORTS_FILTER }))
    assert.deepEqual(hooks.rbac[0], [{ domain: 'reporting.sports', actions: ['view'] }])
    assert.ok(screen.getByRole('heading', { level: 1, name: 'asha' }))
    assert.ok(screen.getByText('Cricket › IPL'))
    assert.ok(screen.getByText('Agent Raj Agency'))
    assert.equal(screen.getByRole('link', { name: 'Back to Sports Report' }).getAttribute('href'), '/reporting/sports')

    const figures = screen.getByRole('group', { name: 'Figures in this selection' })
    assert.ok(within(figures).getByText('₹200.00'))
    assert.ok(within(figures).getByText('1,200'))
    assert.ok(within(figures).getByText('40%'))
    assert.ok(within(figures).getByText('Avg stake ₹10.00'))

    const sent = lastOptions('SPORTS').variables
    assert.equal(sent.domain,'SPORTS'); assert.equal(sent.limit,20); assert.equal(sent.offset,0)
    assert.equal(sent.filters.userId,'p1'); assert.equal(sent.filters.sportId,'s1'); assert.equal(sent.filters.leagueId,'l1')
    assert.deepEqual(sent.filters.status,['won','lost','settled'])
    const table = screen.getByRole('table', { name: 'Bets in this selection' })
    assert.deepEqual(within(table).getAllByRole('columnheader').map((th) => th.textContent), ['Event', 'Selection', 'Stake', 'Odds', 'P/L', 'Status', 'Placed'])
    assert.deepEqual(cellsOf(table), [
      ['MI v CSKIPL • Cricket', 'BACKMI', '₹200.00', '2.50', '+₹300.00', 'WON', 'dd MMM yyyy, HH:mm|2026-09-22T10:00:00Z'],
      ['-IPL • Cricket', 'LAY-', '₹40.00', '-', '-', 'SETTLED', '-'],
    ])
  })

  test('the bets filter by result and by search, and the profile button opens the player', () => {
    open(contributorDetailPath('sports', 'player', 'p1', { name: 'asha', filter: SPORTS_FILTER }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Result' }), { target: { value: 'won' } })
    assert.equal(cellsOf(screen.getByRole('table', { name: 'Bets in this selection' })).length, 1)
    assert.ok(screen.getByText('1 of 1 settled bets'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Result' }), { target: { value: 'all' } })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search bets' }), { target: { value: 'csk' } })
    assert.equal(cellsOf(screen.getByRole('table', { name: 'Bets in this selection' })).length, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Player profile' }))
    assert.ok(screen.getByText('Profile page'))
  })

  test('a Super Admin with no whitelabel selected is asked to pick one instead of shown no bets; the list is not queried', () => {
    // Core mode read the platform's own tenant, which holds no bets: "0 of 0 settled bets" beside the player's figures.
    const ui = useUIStore.getState(); const roles = useAuthStore.getState().roles
    useAuthStore.setState({ roles: ['Super Admin'] }); useUIStore.setState({ directorMode: 'core', selectedWhitelabelId: null })
    try {
      const core = open(contributorDetailPath('sports', 'player', 'p1', { name: 'asha', filter: SPORTS_FILTER }))
      const bets = screen.getByRole('region', { name: 'Bets' })
      assert.ok(within(bets).getByText('Select a whitelabel'))
      assert.equal(screen.queryByRole('table', { name: 'Bets in this selection' }), null)
      assert.ok(calls.length > 0 && calls.every((call) => call.options.skip === true), 'the bets query is skipped')
      // The player's figures are not bets of a tenant and still show.
      assert.ok(within(screen.getByRole('group', { name: 'Figures in this selection' })).getByText('₹200.00'))
      core.unmount(); calls = []
      // With a site selected the bets load as before.
      useUIStore.setState({ directorMode: 'whitelabel', selectedWhitelabelId: 'grandwinn-com' })
      open(contributorDetailPath('sports', 'player', 'p1', { name: 'asha', filter: SPORTS_FILTER }))
      assert.equal(lastOptions('SPORTS').skip, false)
      assert.ok(screen.getByRole('table', { name: 'Bets in this selection' }))
    } finally {
      useAuthStore.setState({ roles }); useUIStore.setState({ directorMode: ui.directorMode, selectedWhitelabelId: ui.selectedWhitelabelId })
    }
  })

  test('a casino player gets the casino query and columns', () => {
    open(contributorDetailPath('casino', 'player', 'p1', { name: 'asha', filter: CASINO_FILTER }))
    assert.deepEqual(hooks.rbac[0], [{ domain: 'reporting.casino', actions: ['view'] }])
    const sent = lastOptions('CASINO').variables
    assert.equal(sent.filters.userId,'p1'); assert.equal(sent.filters.vendorId,'3')
    assert.equal(sent.limit,20); assert.equal(sent.offset,0); assert.deepEqual(sent.filters.status,['won','lost'])
    assert.ok(screen.getByText('Vendor selection'), 'without a drilled path the header names the level')
    assert.deepEqual(cellsOf(screen.getByRole('table', { name: 'Bets in this selection' })), [
      ['Teen PattiEvo', '₹80.00', '₹0.00', '₹-60.00', 'LOST', 'dd MMM yyyy, HH:mm|2026-09-22T11:00:00Z'],
    ])
  })

  test('an agent: figures with commission, and the players directly under them, each a link to its page', () => {
    open(contributorDetailPath('sports', 'agent', 'a1', { name: 'Raj Agency', context: 'Cricket › IPL', filter: SPORTS_FILTER }))
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Raj Agency' }))
    const figures = screen.getByRole('group', { name: 'Figures in this selection' })
    assert.ok(within(figures).getByText('₹300.00'))
    assert.ok(within(figures).getByText('Commission'))
    assert.ok(within(figures).getByText('₹24.00'))
    assert.equal(calls.length, 0, 'an agent loads no bets')
    const table = screen.getByRole('table', { name: 'Players under this agent in this selection' })
    assert.deepEqual(cellsOf(table), [['asha', '1,200', '₹200.00', 'GGR gain ₹50.00', '40%']])
    const link = within(table).getByRole('link', { name: 'asha' })
    const [path, search] = (link.getAttribute('href') ?? '').split('?')
    assert.equal(path, '/reporting/sports/contributors/player/p1')
    assert.deepEqual(parseContributorSearch(new URLSearchParams(search)), { name: 'asha', context: 'Cricket › IPL', filter: SPORTS_FILTER })
  })

  test('no selection or an unknown kind says how to open the page', () => {
    const { unmount } = open('/reporting/sports/contributors/player/p1?name=asha')
    assert.ok(screen.getByText('This page needs a report selection'))
    unmount()
    open(contributorDetailPath('sports', 'player', 'p1', { name: 'x', filter: SPORTS_FILTER }).replace('/player/', '/vendor/'))
    assert.ok(screen.getByText('This page needs a report selection'))
  })
})
