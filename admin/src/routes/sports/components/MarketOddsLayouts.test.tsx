import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import type { DocumentNode } from 'graphql'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import { StandardMarketLayout } from './StandardMarketLayout'
import { MatchOddsLayout } from './MatchOddsLayout'
import type { EventMarket, EventMarketBet } from './eventMarketTypes'

const sharing = vi.hoisted(() => ({ calls: [] as Array<{ name: string; options: Record<string, unknown> }> }))
vi.mock('@apollo/client', async importOriginal => ({ ...await importOriginal<typeof import('@apollo/client')>(), useQuery: (document: DocumentNode, options: Record<string, unknown>) => {
  const definition = document.definitions.find(item => item.kind === 'OperationDefinition')
  const name = definition?.kind === 'OperationDefinition' ? definition.name?.value || '' : ''
  sharing.calls.push({ name, options })
  return { data: { myAgentSharing: { sharingRates: [{ domain: 'sports', rate: 50 }] }, myWhitelabelSharing: { sharingRates: [{ domain: 'sports', rate: 70 }] } } }
} }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => `₹${value.toFixed(2)}`, convertFromWhitelabelCurrency: (value: number) => value }) }))
const market: EventMarket = { id: 'm1', type: 'bookmaker', runners: [{ id: 'uuid', selectionCode: 'selection-one', name: 'India', back: 2, lay: 2.1, backSize: 1250, laySize: 1800 }] }
const bets: EventMarketBet[] = [{ id: 'b1', marketId: 'm1', userId: 'u1', userName: 'Player', selectionId: 'selection-one', side: 'back', stake: 100, price: 2, status: 'matched', agentInfo: { agentId: 'a1', agentName: 'Agent', schemeType: 'COMMISSION', rate: 10 } }]
const fancyMarket: EventMarket = { id: 'merged', kind: 'fancy', _dbMarketIds: ['db-1', 'db-2'], runners: [{ id: 'no-bet', name: 'Other selection', back: 20, lay: 19 }, { id: 'f1', name: 'First Innings Runs', selectionCode: 'code', back: 51.6, lay: 49.6, fancyData: { bs1: 120, ls1: 110, minBet: 50 } }] }
const fancyBets: EventMarketBet[] = [{ id: 'fbet', userId: 'u1', userName: 'Player', marketId: 'db-2', selectionId: 'f1', selection: 'First Innings Runs', price: 50, oddsSize: 100, stake: 100, liability: 100, side: 'back', status: 'matched' }]
beforeEach(() => { sharing.calls = []; useAuthStore.setState({ token: undefined, agent: undefined, user: undefined, roles: ['Whitelabel Admin'], permissions: [] }); useUIStore.setState({ directorMode: 'whitelabel' }) })
afterEach(() => vi.useRealTimers())
describe('complete read-only market odds layouts', () => {
  test('standard prices are read-only and preserve selection-code book P&L/cut and K volumes', () => {
    render(<StandardMarketLayout market={market} bets={bets} />)
    const selection = screen.getByRole('article', { name: 'Selection India' })
    assert.ok(within(selection).getByLabelText('P&L Without Cut 100, With Cut 60'))
    assert.ok(within(selection).getByLabelText('Back price 2.00'))
    assert.ok(within(selection).getByText('1K'))
    assert.ok(within(selection).getByText('2K'))
    assert.equal(within(selection).queryAllByRole('button').length, 0)
    assert.equal(sharing.calls[0].options.skip, true)
    assert.equal(sharing.calls[1].options.skip, false)
    assert.equal(sharing.calls[1].options.fetchPolicy, 'cache-first')
  })
  test('fancy selections with matched bets sort first and retain both merged-market analytics actions', () => {
    render(<StandardMarketLayout market={fancyMarket} bets={fancyBets} />)
    assert.equal(screen.getAllByRole('article')[0].getAttribute('aria-label'), 'Selection First Innings Runs')
    const selection = screen.getByRole('article', { name: 'Selection First Innings Runs' })
    assert.ok(within(selection).getByText('Min: 50'))
    assert.ok(within(selection).getByLabelText('Lay price 50'))
    assert.ok(within(selection).getByLabelText('Back price 52'))
    assert.ok(within(selection).getByText('110'))
    assert.equal(within(selection).getByRole('button', { name: 'Position book' }).getAttribute('aria-expanded'), 'false')
    fireEvent.click(within(selection).getByRole('button', { name: 'Position book' }))
    assert.ok(screen.getByRole('table', { name: 'Fancy book player positions' }))
    assert.equal(within(selection).getByRole('button', { name: 'Hide book' }).getAttribute('aria-expanded'), 'true')
    fireEvent.click(within(selection).getByRole('button', { name: 'Hide book' }))
    assert.equal(Boolean(screen.queryByRole('table', { name: 'Fancy book player positions' })), false)
    fireEvent.click(within(selection).getByRole('button', { name: 'detailed analytics' }))
    const dialog = screen.getByRole('dialog', { name: 'Fancy Book Analysis' })
    assert.ok(within(dialog).getByRole('table', { name: 'Fancy book positions' }))
    assert.equal(within(dialog).getByText('Total Bets').parentElement?.textContent, 'Total Bets1')
  })
  test('fancy suspension/ball-running precedence and missing prices remain honest states', () => {
    const { rerender } = render(<StandardMarketLayout market={{ kind: 'fancy', runners: [{ name: 'Runs', fancyData: { status1: 'SUSPENDED' } }] }} />)
    assert.ok(screen.getByText('Suspended'))
    assert.equal(Boolean(screen.queryByText('No odds available')), false)
    rerender(<StandardMarketLayout market={{ kind: 'fancy', runners: [{ name: 'Runs', back: 20, fancyData: { status1: 'Ball Running' } }] }} />)
    assert.ok(screen.getByText('Ball Running'))
    rerender(<StandardMarketLayout market={{ kind: 'bookmaker', runners: [{ name: 'Runs' }] }} />)
    assert.ok(screen.getByText('No odds available'))
  })
  test('exchange depth caps three runners and preserves all six levels without invented buttons', () => {
    render(<MatchOddsLayout event={{}} market={{ id: 'ex', kind: 'exchange', runners: Array.from({ length: 4 }, (_, index) => ({ id: index, name: `Runner ${index}`, ex: { availableToBack: [{ price: 1.8 }, { price: 2 }, { price: 2.2 }], availableToLay: [{ price: 2.4 }, { price: 2.6 }, { price: 2.8 }] } })) }} />)
    assert.equal(screen.getAllByRole('article').length, 3)
    const first = screen.getByRole('article', { name: 'Runner Runner 0' })
    assert.equal(within(first).getByRole('group', { name: 'Back prices' }).children.length, 3)
    assert.equal(within(first).getByRole('group', { name: 'Lay prices' }).children.length, 3)
    assert.deepEqual(Array.from(within(first).getByRole('group', { name: 'Back prices' }).children, tile => tile.getAttribute('aria-label')), ['Back price 1.80', 'Back price 2.00', 'Back price 2.20'])
    assert.deepEqual(Array.from(within(first).getByRole('group', { name: 'Lay prices' }).children, tile => tile.getAttribute('aria-label')), ['Lay price 2.40', 'Lay price 2.60', 'Lay price 2.80'])
    assert.ok(within(first).getByLabelText('Back price 2.20'))
    assert.equal(within(first).queryAllByRole('button').length, 0)
  })
  test('exchange loading changes to no-odds at the existing ten-second threshold and clears on price arrival', async () => {
    vi.useFakeTimers()
    const { rerender } = render(<MatchOddsLayout event={{}} market={{ id: 'ex', kind: 'exchange', runners: [{ id: 'r', name: 'India' }] }} />)
    assert.equal(screen.getAllByLabelText('Back price loading').length, 3)
    await act(async () => vi.advanceTimersByTime(9500))
    assert.equal(Boolean(screen.queryByText('Waiting for feed prices')), false)
    await act(async () => vi.advanceTimersByTime(500))
    assert.ok(screen.getByText('Waiting for feed prices'))
    assert.equal(screen.queryAllByLabelText('Back price loading').length, 0)
    rerender(<MatchOddsLayout event={{}} market={{ id: 'ex', kind: 'exchange', runners: [{ id: 'r', name: 'India', back: 2, lay: 2.1 }] }} />)
    await act(async () => vi.advanceTimersByTime(500))
    assert.equal(Boolean(screen.queryByText('Waiting for feed prices')), false)
    assert.ok(screen.getByLabelText('Back price 2.00'))
  })
  test('core platform and whitelabel book cut branches retain their distinct signs in both layouts', () => {
    useAuthStore.setState({ roles: ['Super Admin'] }); useUIStore.setState({ directorMode: 'core' })
    render(<><StandardMarketLayout market={market} bets={bets} /><MatchOddsLayout market={market} event={{}} bets={bets} /></>)
    assert.equal(screen.getAllByLabelText('P&L Without Cut 100, With Cut -100').length, 2)
    assert.ok(sharing.calls.every(call => call.options.skip === true))
  })
})
