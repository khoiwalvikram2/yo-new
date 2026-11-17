import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { useAuthStore } from '@/shared/core/authStore'
import styles from '../../MatkaLiveUi.module.css'
import { PlayerPerformanceWidget } from './PlayerPerformanceWidget'

type BetsQuery = { status?: string; statuses?: string[] }

const hooks = vi.hoisted(() => ({ useQuery: vi.fn() }))
vi.mock('@apollo/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@apollo/client')>()), useQuery: hooks.useQuery }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ convertFromWhitelabelCurrency: (amount: number) => amount, formatAmount: (amount: number) => `INR ${amount.toFixed(2)}` }) }))

// Every open matka bet is 'active' until it settles; asking for 'pending' alone found none (Player Segments 0/0/0).
const activeBet = { userId: 746, userName: 'rakesh001', betAmount: 100, actualWin: null, potentialWin: 950, status: 'active', createdAt: '2026-11-03T08:00:00.000Z', matkaId: 'm1', matkaName: 'Kalyan' }
const BETS = [activeBet, { ...activeBet, betAmount: 300, potentialWin: 2850, createdAt: '2026-11-03T08:05:00.000Z' }]

// The server's filter (matkaBetsRepo): `statuses` wins over `status`, so a 'pending' ask never sees an active bet.
const serverBets = ({ status, statuses }: BetsQuery = {}) =>
  BETS.filter((bet) => (statuses?.length ? statuses.includes(bet.status) : !status || bet.status === status))

const stat = (label: string) => within(screen.getByText(label).parentElement!)

beforeEach(() => {
  useAuthStore.setState({ agent: undefined, permissions: [{ domain: 'settlements.center', actions: ['view'] }] })
  hooks.useQuery.mockReset()
  hooks.useQuery.mockImplementation((_document: unknown, options?: { variables?: { query?: BetsQuery } }) =>
    ({ data: { matkaBets: serverBets(options?.variables?.query) }, loading: false }))
})

test('asks for the open bets (pending and active), not pending alone', () => {
  render(<PlayerPerformanceWidget />)
  const options = hooks.useQuery.mock.calls[0][1]
  assert.deepEqual(options.variables.query.statuses, ['pending', 'active'])
  assert.equal(options.variables.query.status, undefined)
})

test('an active bet reaches the player segments and the top contributors list', () => {
  render(<PlayerPerformanceWidget />)
  // One player at the average stake is Regular; the 'pending' ask read 0 / 0 / 0.
  stat('High Rollers').getByText('0')
  stat('Regular').getByText('1')
  stat('Low Stakes').getByText('0')
  screen.getByText('Top GGR Contributors')
  screen.getByText('rakesh001')
})

test("an open bet's GGR is its stake less what it has paid, as the dashboard and Top Matkas count it", () => {
  render(<PlayerPerformanceWidget />)
  // Stakes 100 + 300 with nothing paid yet: GGR 400. Less the potential wins it read -3400, the exposure with its sign turned.
  screen.getByText('INR 400.00')
  assert.equal(screen.queryByText('INR -3400.00'), null)
})

// H403 (owner, 2026-11-04): Top GGR Contributors showed each player's GGR and average bet to every role. As on the Players
// tab and in Player Analytics, a role without settlements.center view sees the players, their ranking, bets and segments only.
const contributor = (name: string) => screen.getByText(name).closest('li')!
const termsOf = (root: Element) => Object.fromEntries([...root.querySelectorAll('dl > div')].map((row) => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent]))

test('a role without settlements.center view sees the contributors, their bets and the segments, but no amounts', () => {
  useAuthStore.setState({ permissions: [{ domain: 'matka', actions: ['read'] }] })
  render(<PlayerPerformanceWidget />)
  const row = contributor('rakesh001')
  assert.deepEqual(termsOf(row), { Bets: '2', RTP: 'Pending settlement', Avg: '••••' })
  // The GGR is masked, and its colour does not give away whether the player is up or down.
  const ggr = within(row.firstElementChild as HTMLElement).getByText('••••')
  assert.equal(ggr.classList.contains(styles.positive) || ggr.classList.contains(styles.negative), false)
  assert.equal(screen.queryByText(/INR/), null, 'no amount shown')
  stat('Regular').getByText('1')
})

test('a role with settlements.center view (directly or through finance read) sees the GGR and average bet', () => {
  for (const permissions of [[{ domain: 'settlements.center', actions: ['view'] }], [{ domain: 'finance', actions: ['read'] }]]) {
    useAuthStore.setState({ permissions })
    const page = render(<PlayerPerformanceWidget />)
    const row = contributor('rakesh001')
    assert.deepEqual(termsOf(row), { Bets: '2', RTP: 'Pending settlement', Avg: 'INR 200.00' }, JSON.stringify(permissions))
    assert.ok(within(row.firstElementChild as HTMLElement).getByText('INR 400.00').classList.contains(styles.positive))
    assert.equal(screen.queryByText('••••'), null, JSON.stringify(permissions))
    page.unmount()
  }
})
