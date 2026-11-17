import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { useAuthStore } from '@/shared/core/authStore'
import { AlertsAndAnomaliesDashboard } from './AlertsAndAnomaliesDashboard'

vi.mock('@/shared/services/notification', () => ({ notify: { error: vi.fn() } }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ convertFromWhitelabelCurrency: (amount: number) => amount, formatAmount: (amount: number) => `INR ${amount.toFixed(2)}` }) }))

// 30,000 staked by the 2 players with open bets: 15,000 each, over the 10,000 the alert watches. Two even markets keep the
// concentration alert out, so this is the only alert.
const kpis = { rtp: 0, wagered: 30000, betsPerMin: 0, activePlayers: 2 }
const market = (matkaId: string) => ({ matkaId, matkaName: matkaId, wagered: 15000, payouts: 0, ggr: 15000, bets: 3 })
const breakdown = { byMatka: [market('A'), market('B')] }
const termsOf = (root: Element) => Object.fromEntries([...root.querySelectorAll('dl > div')].map((row) => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent]))
const alertItem = () => screen.getByRole('heading', { name: 'High Average Wagered Per Player' }).closest('li')!

beforeEach(() => useAuthStore.setState({ agent: undefined, permissions: [{ domain: 'settlements.center', actions: ['view'] }] }))

// H403 (owner, 2026-11-04): the alert printed the average wagered per player, the figure the Players tab's Avg Wagered/Player
// masks, and repeated it as its Value. A role without settlements.center view still gets the alert, not the amount.
test('without settlements.center view the alert is raised, but the average wagered per player is masked', () => {
  useAuthStore.setState({ permissions: [{ domain: 'matka', actions: ['read'] }] })
  render(<AlertsAndAnomaliesDashboard kpis={kpis} breakdown={breakdown} />)
  const item = alertItem()
  within(item).getByText('Average wagered per player is ••••')
  assert.deepEqual(termsOf(item), { Entity: 'Overall', Value: '••••', Threshold: '••••' })
  assert.equal(screen.queryByText(/INR|15000/), null, 'the average shows nowhere')
})

test('with settlements.center view (directly or through finance read) the average shows, as an amount', () => {
  for (const permissions of [[{ domain: 'settlements.center', actions: ['view'] }], [{ domain: 'finance', actions: ['read'] }]]) {
    useAuthStore.setState({ permissions })
    const page = render(<AlertsAndAnomaliesDashboard kpis={kpis} breakdown={breakdown} />)
    const item = alertItem()
    within(item).getByText('Average wagered per player is INR 15000.00')
    // An amount against an amount: it read 15000% against a 10000% threshold.
    assert.deepEqual(termsOf(item), { Entity: 'Overall', Value: 'INR 15000.00', Threshold: 'INR 10000.00' }, JSON.stringify(permissions))
    page.unmount()
  }
})
