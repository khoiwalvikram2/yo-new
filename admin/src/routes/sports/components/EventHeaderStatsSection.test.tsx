import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { DocumentNode } from 'graphql'
import { EventHeaderStatsSection } from './EventHeaderStatsSection'

interface FixtureBet { id: string; userId?: string; createdAt?: string; eventId: string; marketId: string; side: string; stake: number; price: number; liability: number; oddsSize?: number; status: string }
const harness = vi.hoisted(() => ({ bets: [] as FixtureBet[], data: {} as { sportsBets: FixtureBet[] }, subscription: {} as { sportsPlayerEvents?: { eventId: string } }, queryOptions: {} as Record<string, unknown>, subscriptionOptions: {} as Record<string, unknown>, refetch: vi.fn(async () => ({ data: { sportsBets: [] as FixtureBet[] } })) }))
vi.mock('@apollo/client', async importOriginal => ({ ...await importOriginal<typeof import('@apollo/client')>(),
  useQuery: (_document: DocumentNode, options: Record<string, unknown>) => { harness.queryOptions = options; return { data: harness.data, refetch: harness.refetch } },
  useSubscription: (_document: DocumentNode, options: Record<string, unknown>) => { harness.subscriptionOptions = options; return { data: harness.subscription } },
}))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => `$${value.toFixed(2)}`, convertFromWhitelabelCurrency: (value: number) => value * 2 }) }))
vi.mock('@/shared/core/useWhitelabels', () => ({ useCurrentWhitelabel: () => ({ whitelabel: { id: 'tenant-1' } }) }))
beforeEach(() => {
  harness.bets = [
    { id: 'back', eventId: 'event-1', marketId: 'exchange', side: 'back', stake: 50, price: 2.5, liability: 125, status: 'matched' },
    { id: 'lay', eventId: 'event-1', marketId: 'exchange', side: 'lay', stake: 50, price: 3, liability: 100, status: 'unmatched' },
    { id: 'fancy-back', eventId: 'event-1', marketId: 'fancy', side: 'back', stake: 100, price: 99, liability: 100, oddsSize: 75, status: 'matched' },
    { id: 'fancy-lay', eventId: 'event-1', marketId: 'fancy', side: 'lay', stake: 50, price: 99, liability: 75, status: 'unmatched' },
    { id: 'settled', eventId: 'event-1', marketId: 'exchange', side: 'back', stake: 999, price: 999, liability: 999, status: 'won' },
  ]
  harness.data = { sportsBets: harness.bets }; harness.subscription = {}; harness.refetch.mockClear()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('event KPI panel contracts', () => {
  test('preserves event-limited network query, subscription tenant scope and matched/unmatched payout rules', () => {
    render(<EventHeaderStatsSection event={{ id: 'event-1', status: 'active' }} marketsMap={{ exchange: { id: 'exchange', kind: 'exchange' }, fancy: { id: 'fancy', kind: 'fancy' } }} />)
    assert.deepEqual(harness.queryOptions, { variables: { query: { eventId: 'event-1', limit: 5000 } }, skip: false, errorPolicy: 'all', fetchPolicy: 'network-only' })
    assert.deepEqual(harness.subscriptionOptions, { variables: { scope: { tenant: 'tenant-1', whitelabelId: 'tenant-1' } }, skip: false, errorPolicy: 'all' })
    assert.ok(screen.getByText('4'))
    assert.ok(screen.getByText('$800.00')) // original total wagered uses liabilities: 125+100+100+75
    assert.ok(screen.getByText('$550.00')) // exchange back75/lay50 and fancy back75/lay75, then display conversion
    assert.match(screen.getByText('$100.00').className, /loss/) // open back 225 minus open lay 175, converted
    assert.equal(screen.queryByText(/^Matched /), null); assert.ok(screen.getByText('Open bets'))
  })
  test('keeps liability fallback without a market map and zero query totals instead of old event amounts', () => {
    const { rerender } = render(<EventHeaderStatsSection event={{ id: 'event-1', totalStake: 9999, totalLiability: 9999, betsCount: 999 }} />)
    assert.equal(screen.getAllByText('$800.00').length, 2)
    harness.data = { sportsBets: [] }
    rerender(<EventHeaderStatsSection event={{ id: 'event-1', totalStake: 9999, totalLiability: 9999, betsCount: 999 }} />)
    assert.equal(screen.getAllByText('0').length, 2) // no open bets, so no players either
    assert.equal(screen.getAllByText('$0.00').length, 3)
  })
  test('reads a lay-heavy book as no house loss and shows matched volume under Wagered when the event has it', () => {
    harness.data = { sportsBets: [harness.bets[1]] }
    render(<EventHeaderStatsSection event={{ id: 'event-1', matchedVolume: 150 }} />)
    assert.doesNotMatch(screen.getByText('$-200.00').className, /loss/)
    assert.ok(screen.getByText('Matched $300.00'))
  })
  test('counts the players behind open bets and the open bets placed in the last minute', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T07:00:00Z'))
    harness.data = { sportsBets: [
      { ...harness.bets[0], userId: 'u1', createdAt: '2026-10-10T06:59:30Z' },
      { ...harness.bets[1], userId: 'u1', createdAt: '2026-10-10T06:59:50Z' },
      { ...harness.bets[2], userId: 'u2', createdAt: '2026-10-10T06:50:00Z' },
      { ...harness.bets[4], userId: 'u3', createdAt: '2026-10-10T06:59:55Z' }, // settled: neither a player nor a recent bet
    ] }
    render(<EventHeaderStatsSection event={{ id: 'event-1' }} />)
    const players = screen.getByText('Players').closest('[class*="stat"]')!
    assert.ok(players.textContent?.includes('2'))
    assert.ok(screen.getByText('in the last minute'))
    const bets = screen.getByText('Bets').closest('[class*="stat"]')!
    assert.ok(bets.textContent?.includes('3')); assert.ok(bets.textContent?.includes('2'))
  })
  test('skips absent events safely, retaining hook order when event data later arrives', () => {
    const { rerender } = render(<EventHeaderStatsSection event={undefined} />)
    assert.equal(harness.queryOptions.skip, true)
    assert.equal(harness.subscriptionOptions.skip, true)
    assert.equal(Boolean(screen.queryByText('Bets')), false)
    rerender(<EventHeaderStatsSection event={{ id: 'event-1', inPlay: true }} />)
    assert.ok(screen.getByText('Bets'))
  })
  test('keeps delayed subscription refetch limited to the current event', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T07:00:00Z'))
    const event = { id: 'event-1', status: 'active' }
    const { rerender } = render(<EventHeaderStatsSection event={event} />)
    harness.subscription = { sportsPlayerEvents: { eventId: 'other-event' } }
    rerender(<EventHeaderStatsSection event={event} />)
    await act(async () => vi.advanceTimersByTime(1500))
    assert.equal(harness.refetch.mock.calls.length, 0)
    harness.subscription = { sportsPlayerEvents: { eventId: 'event-1' } }
    rerender(<EventHeaderStatsSection event={event} />)
    assert.equal(harness.refetch.mock.calls.length, 0)
    await act(async () => vi.advanceTimersByTime(1499)); assert.equal(harness.refetch.mock.calls.length, 0)
    await act(async () => vi.advanceTimersByTime(1)); assert.equal(harness.refetch.mock.calls.length, 1)
  })
})
