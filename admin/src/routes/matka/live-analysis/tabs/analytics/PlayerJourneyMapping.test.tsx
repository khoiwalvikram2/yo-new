import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { print, type DocumentNode } from 'graphql'
import { useAuthStore } from '@/shared/core/authStore'
import styles from '../../MatkaLiveUi.module.css'
import { PlayerJourneyMapping } from './PlayerJourneyMapping'

const hooks = vi.hoisted(() => ({ useQuery: vi.fn() }))
vi.mock('@apollo/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@apollo/client')>()), useQuery: hooks.useQuery }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ convertFromWhitelabelCurrency: (amount: number) => amount, formatAmount: (amount: number) => `INR ${amount.toFixed(2)}` }) }))
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatTime: (value: string) => value.slice(11, 19) }) }))

// What matkaBets answers since E003: each bet names its player (rakesh001 for player 746). A player the server cannot
// name (userName null) is the only one shown as "User #<id>".
const bet = (id: string, userId: number, userName: string | null, createdAt: string) => ({
  id, userId, userName, matkaId: 'm1', matkaName: 'Kalyan', matkaType: 'worli', marketName: 'KALYAN', bidType: 'SINGLE',
  betAmount: 100, potentialWin: 950, actualWin: null, status: 'active', createdAt,
})

beforeEach(() => {
  useAuthStore.setState({ agent: undefined, permissions: [{ domain: 'settlements.center', actions: ['view'] }] })
  hooks.useQuery.mockReset()
  hooks.useQuery.mockReturnValue({ data: { matkaBets: [
    bet('b1', 746, 'rakesh001', '2026-11-03T08:01:00.000Z'),
    bet('b2', 746, 'rakesh001', '2026-11-03T08:00:00.000Z'),
    bet('b3', 747, null, '2026-11-03T07:00:00.000Z'),
  ] } })
})

const playerButtons = () => screen.getAllByRole('listitem').map((item) => within(item).queryByRole('button')).filter((button): button is HTMLElement => !!button)

test("asks matkaBets for each bet's userName", () => {
  render(<PlayerJourneyMapping />)
  const [document] = hooks.useQuery.mock.calls[0] as [DocumentNode]
  assert.match(print(document), /matkaBets\(query: \$query\) \{[^}]*\buserName\b/)
})

test("lists each player by the name the server gives, and by 'User #<id>' only when there is none", () => {
  render(<PlayerJourneyMapping />)
  assert.deepEqual(playerButtons().map((button) => button.textContent), ['rakesh001', 'User #747'])
  // The name is what the search and the journey heading use too.
  fireEvent.change(screen.getByLabelText('Search player journeys'), { target: { value: 'rakesh' } })
  assert.deepEqual(playerButtons().map((button) => button.textContent), ['rakesh001'])
  fireEvent.click(screen.getByRole('button', { name: 'rakesh001' }))
  screen.getByRole('heading', { name: 'rakesh001' })
  assert.equal(screen.queryByText('User #746'), null)
})

// MAT-13, round F: GGR is the stake less what each bet actually paid, the rule PlayerPerformanceWidget, the dashboard and
// Top Matkas use. An open bet has paid nothing and a lost bet pays 0 (actualWin 0, or null on an older row); a potential
// win is exposure, never a payout. A void bet pays its stake back.
const journeyBets = () => [
  bet('b1', 746, 'rakesh001', '2026-11-03T08:01:00.000Z'),
  { ...bet('b2', 746, 'rakesh001', '2026-11-03T08:00:00.000Z'), betAmount: 300, potentialWin: 2850 },
  { ...bet('b3', 747, 'amit', '2026-11-03T07:03:00.000Z'), status: 'lost', actualWin: 0 },
  { ...bet('b4', 747, 'amit', '2026-11-03T07:02:00.000Z'), status: 'lost', actualWin: null },
  { ...bet('b5', 747, 'amit', '2026-11-03T07:01:00.000Z'), status: 'won', actualWin: 950 },
  { ...bet('b6', 747, 'amit', '2026-11-03T07:00:00.000Z'), status: 'void', actualWin: 100 },
]
const termsOf = (root: Element) => Object.fromEntries([...root.querySelectorAll('dl > div')].map((row) => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent]))
const playerGgr = () => Object.fromEntries(playerButtons().map((button) => [button.textContent, termsOf(button.closest('li')!).GGR]))
// Each bet in the selected player's journey: its status pill, the net figure beside it (null when none) and its terms.
const journeyRows = () => [...document.querySelectorAll('ol > li')].map((row) => ({
  status: row.querySelector('h5')?.nextElementSibling?.textContent,
  net: row.firstElementChild?.children[1]?.textContent ?? null,
  ...termsOf(row),
}))

test("a player's GGR is the stake less what the bets paid; a potential win is never counted as paid", () => {
  hooks.useQuery.mockReturnValue({ data: { matkaBets: journeyBets() } })
  render(<PlayerJourneyMapping />)
  // rakesh001: 400 staked on open bets, nothing paid yet. Less the potential wins it read -3400, the exposure negated.
  // amit: 400 staked; 950 won and 100 returned by the void bet. Counting the lost bets' potential wins it read -2550.
  assert.deepEqual(playerGgr(), { rakesh001: 'INR 400.00', amit: 'INR -650.00' })
  fireEvent.click(screen.getByRole('button', { name: 'amit' }))
  const head = screen.getByRole('heading', { name: 'amit' }).closest('section')!.querySelector(':scope > dl')!
  assert.deepEqual(termsOf(head), { Bets: '4', Matkas: '1', Wagered: 'INR 400.00', GGR: 'INR -650.00' })
})

test("the bet journey shows what a settled bet paid, and an open bet's potential win only as potential", () => {
  hooks.useQuery.mockReturnValue({ data: { matkaBets: journeyBets() } })
  render(<PlayerJourneyMapping />)
  fireEvent.click(screen.getByRole('button', { name: 'amit' }))
  // A lost bet won nothing (it read '+INR 850.00' and 'Win INR 950.00'); a void bet's stake came back, which is no win.
  assert.deepEqual(journeyRows(), [
    { status: 'LOST', net: 'INR -100.00', Bet: 'INR 100.00', Win: 'INR 0.00', Time: '07:03:00' },
    { status: 'LOST', net: 'INR -100.00', Bet: 'INR 100.00', Win: 'INR 0.00', Time: '07:02:00' },
    { status: 'WON', net: '+INR 850.00', Bet: 'INR 100.00', Win: 'INR 950.00', Time: '07:01:00' },
    { status: 'VOID', net: 'INR 0.00', Bet: 'INR 100.00', Refund: 'INR 100.00', Time: '07:00:00' },
  ])
  fireEvent.click(screen.getByRole('button', { name: 'rakesh001' }))
  // No result yet: no net figure and no 'Win'; the potential win is labelled as potential.
  assert.deepEqual(journeyRows(), [
    { status: 'ACTIVE', net: null, Bet: 'INR 100.00', 'Potential win': 'INR 950.00', Time: '08:01:00' },
    { status: 'ACTIVE', net: null, Bet: 'INR 300.00', 'Potential win': 'INR 2850.00', Time: '08:00:00' },
  ])
})

// H403 (owner, 2026-11-04): each player's Wagered and GGR, and each bet's amounts, were shown to every role. As on the
// Players tab and in Player Analytics, a role without settlements.center view sees the players, counts, statuses and times.
test('a role without settlements.center view sees every journey and its bets, but no amount and no sign', () => {
  useAuthStore.setState({ permissions: [{ domain: 'matka', actions: ['read'] }] })
  hooks.useQuery.mockReturnValue({ data: { matkaBets: journeyBets() } })
  render(<PlayerJourneyMapping />)
  assert.deepEqual(playerButtons().map((button) => termsOf(button.closest('li')!)), [{ Wagered: '••••', GGR: '••••' }, { Wagered: '••••', GGR: '••••' }])
  screen.getByText('2 bets · 1 matkas · 1m'); screen.getByText('4 bets · 1 matkas · 3m')
  fireEvent.click(screen.getByRole('button', { name: 'amit' }))
  const head = screen.getByRole('heading', { name: 'amit' }).closest('section')!.querySelector(':scope > dl')!
  assert.deepEqual(termsOf(head), { Bets: '4', Matkas: '1', Wagered: '••••', GGR: '••••' })
  // Each bet keeps its status and time; its stake, its payout and its net figure (no '+' either) are masked.
  assert.deepEqual(journeyRows(), [
    { status: 'LOST', net: '••••', Bet: '••••', Win: '••••', Time: '07:03:00' },
    { status: 'LOST', net: '••••', Bet: '••••', Win: '••••', Time: '07:02:00' },
    { status: 'WON', net: '••••', Bet: '••••', Win: '••••', Time: '07:01:00' },
    { status: 'VOID', net: '••••', Bet: '••••', Refund: '••••', Time: '07:00:00' },
  ])
  fireEvent.click(screen.getByRole('button', { name: 'rakesh001' }))
  assert.deepEqual(journeyRows().map((row) => row['Potential win']), ['••••', '••••'])
  // No figure is coloured by its sign, and no amount shows anywhere.
  assert.equal(document.getElementsByClassName(styles.positive).length + document.getElementsByClassName(styles.negative).length, 0)
  assert.equal(screen.queryByText(/INR/), null)
})

test('a role with settlements.center view (directly or through finance read) sees the amounts', () => {
  for (const permissions of [[{ domain: 'settlements.center', actions: ['view'] }], [{ domain: 'finance', actions: ['read'] }]]) {
    useAuthStore.setState({ permissions })
    hooks.useQuery.mockReturnValue({ data: { matkaBets: journeyBets() } })
    const page = render(<PlayerJourneyMapping />)
    assert.deepEqual(playerGgr(), { rakesh001: 'INR 400.00', amit: 'INR -650.00' }, JSON.stringify(permissions))
    assert.equal(screen.queryByText('••••'), null, JSON.stringify(permissions))
    page.unmount()
  }
})
