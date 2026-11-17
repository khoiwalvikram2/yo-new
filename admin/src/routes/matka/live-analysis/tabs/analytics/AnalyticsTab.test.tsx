import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useAuthStore } from '@/shared/core/authStore'
import type { MatkaBreakdown } from '../../liveUiModel'
import styles from '../../MatkaLiveUi.module.css'
import { AnalyticsTab } from './AnalyticsTab'

const hooks = vi.hoisted(() => ({ useQuery: vi.fn() }))
vi.mock('@apollo/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@apollo/client')>()), useQuery: hooks.useQuery }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ convertFromWhitelabelCurrency: (amount: number) => amount, formatAmount: (amount: number) => `INR ${amount.toFixed(2)}` }) }))

beforeEach(() => {
  hooks.useQuery.mockReset()
  hooks.useQuery.mockReturnValue({ data: undefined, loading: false })
  useAuthStore.setState({ permissions: [{ domain: 'settlements.center', actions: ['view'] }] })
})

const breakdown: MatkaBreakdown = {
  byMatka: [{ matkaId: 'm1', matkaName: 'Kalyan', wagered: 100, payouts: 0, ggr: 100, bets: 1, potentialPayouts: 900 }],
  byType: [],
  byMarket: [],
  byBidType: [{ bidType: 'SINGLE', wagered: 100, payouts: 0, ggr: 100, bets: 1 }],
  byDigit: ['2', '3', '5'].map((digit) => ({ digit, wagered: 100, payouts: 0, exposure: 800, bets: 1 })),
  bySession: [],
  bySelection: [],
}
const rowOf = (card: string) => screen.getByRole('region', { name: card }).parentElement!

// Live, the frequency list of 8 open digits ran 2,339 px and the heatmap card stretched to match: its ten cells filled
// the top 364 px and the other 1,975 px were empty card.
test('the Digit Heatmap sits beside Digit Frequency Analysis at its own height; the other rows keep theirs', () => {
  render(<AnalyticsTab dashboard={{ breakdown }} didAnimate={false} />)
  const heatRow = rowOf('Digit Heatmap')
  assert.ok(heatRow === rowOf('Digit Frequency Analysis'), 'the two cards share one grid row')
  assert.ok(heatRow.classList.contains(styles.grid2), 'the row is still the two-column grid')
  assert.ok(heatRow.classList.contains(styles.alignStart), 'the row aligns its cards to the start instead of stretching them')
  // Bid Type / Matka and Hot / Cold keep the plain grid, so their cards still share a height.
  for (const card of ['Bid Type Analytics', 'Hot Digits']) {
    assert.ok(rowOf(card).classList.contains(styles.grid2), `${card} is in a two-column grid`)
    assert.equal(rowOf(card).classList.contains(styles.alignStart), false, `${card}'s row keeps its layout`)
  }
})

test('the start alignment is a rule of its own; the shared two-column grid keeps stretching its cards', () => {
  // Comments out, so a rule's selector cannot run on from a comment that names .grid2.
  const css = readFileSync(resolve('src/routes/matka/live-analysis/MatkaLiveUi.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(css, /\.alignStart\s*\{[^}]*align-items:\s*start\b[^}]*\}/)
  const grid2Rules = [...css.matchAll(/\.grid2\b[^{]*\{[^}]*\}/g)].map((rule) => rule[0])
  assert.ok(grid2Rules.length >= 1, 'found the .grid2 rules')
  for (const rule of grid2Rules) assert.doesNotMatch(rule, /align-items/)
})
