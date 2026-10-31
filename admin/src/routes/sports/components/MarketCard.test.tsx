import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DocumentNode } from 'graphql'
import type { Dispatch, SetStateAction } from 'react'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import type { BookViewContext } from '../utils/bookCalculator'
import type { EventMarket, EventMarketBet } from './eventMarketTypes'
import { MarketCard } from './MarketCard'

const harness = vi.hoisted(() => ({
  queries: [] as { name: string; options: Record<string, unknown> }[],
  result: {} as { agents?: { agentTree?: { id: string }[]; agentRootAgents?: { id: string; username: string | null; schemeType: string; rate: number | null }[] } },
  standard: undefined as Record<string, unknown> | undefined,
  match: undefined as Record<string, unknown> | undefined,
  book: undefined as { isExpanded: boolean; onToggle: () => void; viewContext?: BookViewContext | null } | undefined,
  clientQuery: vi.fn(async ({ variables }: { variables: { agentId: string } }) => ({ data: { agents: { agentDescendantIds: [variables.agentId, `${variables.agentId}-descendant`] } } })),
}))
vi.mock('@apollo/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  const client = { query: harness.clientQuery }
  return { ...actual,
  useQuery: (document: DocumentNode, options: Record<string, unknown>) => { const operation = document.definitions.find(item => item.kind === 'OperationDefinition'); harness.queries.push({ name: operation?.kind === 'OperationDefinition' ? operation.name?.value || '' : '', options }); return { data: harness.result } },
  useApolloClient: () => client,
  }
})
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => `₹${value}`, convertFromWhitelabelCurrency: (value: number) => value }) }))
vi.mock('./StandardMarketLayout', () => ({ StandardMarketLayout: (props: Record<string, unknown>) => { harness.standard = props; return <div data-testid="standard-layout">Standard market layout</div> } }))
vi.mock('./MatchOddsLayout', () => ({ MatchOddsLayout: (props: Record<string, unknown>) => { harness.match = props; return <div data-testid="match-layout">Match odds layout</div> } }))
vi.mock('./MarketBookTable', () => ({ MarketBookTable: (props: { isExpanded: boolean; onToggle: () => void; viewContext?: BookViewContext | null }) => { harness.book = props; return <button onClick={props.onToggle} data-testid="market-book">Toggle market book</button> } }))
beforeEach(() => { harness.queries = []; harness.result = {}; harness.standard = undefined; harness.match = undefined; harness.book = undefined; harness.clientQuery.mockClear(); useAuthStore.setState({ agent: undefined, user: undefined, roles: [], permissions: [] }); useUIStore.setState({ directorMode: 'core' }) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('market card composition and shared book scope', () => {
  test('preserves explicit shared null/context and skips per-card hierarchy traffic', () => {
    const shared: BookViewContext = { directChildAgentIds: ['child'], getDescendantsOf: () => ['child'] }
    const { rerender } = render(<MarketCard market={{ id: 'm1', kind: 'exchange', name: 'Match Odds' }} event={{ id: 'event-1' }} isExpanded onToggle={() => {}} bets={[{}]} sharedBookViewContext={null} />)
    assert.ok(screen.getByTestId('match-layout'))
    assert.equal(new Set(harness.queries.map(query => query.name)).size, 2)
    assert.ok(harness.queries.every(query => query.options.skip === true))
    assert.equal(harness.book?.viewContext, null)
    assert.equal(harness.clientQuery.mock.calls.length, 0)
    rerender(<MarketCard market={{ id: 'm1', kind: 'exchange', name: 'Match Odds' }} event={{ id: 'event-1' }} isExpanded onToggle={() => {}} bets={[{}]} sharedBookViewContext={shared} />)
    assert.equal(harness.book?.viewContext, shared)
    assert.equal(harness.match?.viewContext, shared)
  })
  test('keeps fancy/standard layout selection and per-runner expanded/modal state reset by market ID', () => {
    const { rerender } = render(<MarketCard market={{ id: 'f1', kind: 'fancy', name: 'Runner lines' }} event={{ id: 'event-1' }} isExpanded onToggle={() => {}} sharedBookViewContext={null} />)
    assert.ok(screen.getByText('Fancy', { exact: true }))
    assert.ok(screen.getByTestId('standard-layout'))
    assert.equal(Boolean(screen.queryByTestId('match-layout')), false)
    assert.equal(Boolean(screen.queryByTestId('market-book')), false)
    const setExpanded = harness.standard?.setFancyBookExpandedMap as Dispatch<SetStateAction<Map<string, boolean>>>
    act(() => setExpanded(new Map([['runner-1', true]])))
    assert.equal((harness.standard?.fancyBookExpandedMap as Map<string, boolean>).get('runner-1'), true)
    rerender(<MarketCard market={{ id: 'f2', kind: 'fancy' }} event={{ id: 'event-1' }} isExpanded onToggle={() => {}} sharedBookViewContext={null} />)
    assert.equal((harness.standard?.fancyBookExpandedMap as Map<string, boolean>).size, 0)
    rerender(<MarketCard market={{ id: 'b1', kind: 'bookmaker' }} event={{ id: 'event-1' }} isExpanded onToggle={() => {}} bets={[{}]} sharedBookViewContext={null} />)
    assert.ok(screen.getByTestId('standard-layout'))
    assert.ok(screen.getByTestId('market-book'))
    fireEvent.click(screen.getByTestId('market-book'))
    assert.equal(harness.book?.isExpanded, true)
  })
  test('retains ordinary whitelabel hierarchy queries, descendant scope and explicit zero rates', async () => {
    useAuthStore.setState({ roles: ['Whitelabel Admin'] })
    harness.result = { agents: { agentRootAgents: [{ id: 'child-1', username: 'Child One', schemeType: 'SHARING', rate: 0 }] } }
    render(<MarketCard market={{ id: 'm1', kind: 'exchange' }} event={{ id: 'event-1' }} isExpanded onToggle={() => {}} bets={[{}]} />)
    await waitFor(() => assert.equal(Boolean(harness.book?.viewContext), true))
    assert.equal(harness.clientQuery.mock.calls.length, 1)
    assert.deepEqual(harness.clientQuery.mock.calls[0][0].variables, { agentId: 'child-1' })
    assert.deepEqual(harness.book?.viewContext?.directChildAgentIds, ['child-1'])
    assert.deepEqual(harness.book?.viewContext?.getDescendantsOf('child-1'), ['child-1', 'child-1-descendant'])
    assert.deepEqual(harness.book?.viewContext?.getAgentInfo?.('child-1'), { username: 'Child One', schemeType: 'SHARING', rate: 0 })
    assert.ok(harness.queries.some(query => query.options.skip === false && query.options.fetchPolicy === 'cache-first'))
  })
  test('keeps collapsed contents absent and existing cheap odds-signature memo contract', () => {
    const props = { market: { id: 'm1', kind: 'exchange', name: 'Match Odds' }, event: { id: 'event-1' }, isExpanded: false, onToggle: vi.fn(), oddsSignature: 'signature-1', sharedBookViewContext: null }
    const { rerender } = render(<MarketCard {...props} />)
    assert.equal(Boolean(screen.queryByTestId('match-layout')), false)
    const originalQueries = harness.queries.length
    rerender(<MarketCard {...props} />)
    assert.equal(harness.queries.length, originalQueries)
    fireEvent.click(screen.getByRole('button', { name: /Match Odds/ }))
    assert.equal(props.onToggle.mock.calls.length, 1)
  })
  test('renders equal-count immutable bet replacements despite an unchanged price signature', () => {
    const market: EventMarket = { id: 'm1', kind: 'exchange', name: 'Match Odds' }
    const event = { id: 'event-1' }
    const originalBets: EventMarketBet[] = [{ id: 'bet-1', marketId: 'm1', userId: 'u1', stake: 100, price: 2, side: 'back', status: 'matched' }]
    const props = { market, event, isExpanded: true, onToggle: vi.fn(), betCount: 1, oddsSignature: 'india,2,2.1', sharedBookViewContext: null }
    const { rerender } = render(<MarketCard {...props} bets={originalBets} />)
    assert.equal(harness.match?.bets, originalBets)
    const before = harness.queries.length
    const replacement = [{ ...originalBets[0], stake: 250, status: 'won' }]
    rerender(<MarketCard {...props} bets={replacement} />)
    assert.equal(replacement.length, originalBets.length)
    assert.ok(harness.queries.length > before)
    assert.equal(harness.match?.bets, replacement)
    assert.equal((harness.match?.bets as EventMarketBet[])[0].stake, 250)
    assert.equal((harness.match?.bets as EventMarketBet[])[0].status, 'won')
  })
  test('renders same-price changed depth, status, name and liquidity from a new market object', () => {
    const original: EventMarket = { id: 'm1', kind: 'exchange', name: 'Match Odds', state: 'open', liquidity: 100,
      runners: [{ id: 'india', name: 'India', back: 2, lay: 2.1, ex: { availableToBack: [{ price: 2, size: 10 }], availableToLay: [{ price: 2.1, size: 20 }] } }],
    }
    const props = { event: { id: 'event-1' }, isExpanded: true, onToggle: vi.fn(), oddsSignature: 'india,2,2.1', sharedBookViewContext: null }
    const { rerender } = render(<MarketCard {...props} market={original} />)
    const replacement: EventMarket = { ...original, name: 'Updated Match Odds', state: 'suspended', liquidity: 300,
      runners: [{ ...original.runners![0], ex: { availableToBack: [{ price: 2, size: 150 }], availableToLay: [{ price: 2.1, size: 250 }] } }],
    }
    rerender(<MarketCard {...props} market={replacement} />)
    assert.equal(harness.match?.market, replacement)
    assert.equal(replacement.runners![0].back, original.runners![0].back)
    assert.equal(replacement.runners![0].lay, original.runners![0].lay)
    assert.ok(screen.getByRole('button', { name: /Updated Match Odds/ }))
    assert.ok(screen.getByText('SUSPENDED', { exact: true }))
    assert.ok(screen.getByText('₹300', { exact: true }))
    assert.equal((harness.match?.market as EventMarket).runners![0].ex?.availableToBack?.[0].size, 150)
  })
  test('passes immutable event changes through while stable market, event and bets references still memoize', () => {
    const market: EventMarket = { id: 'm1', kind: 'exchange', name: 'Match Odds' }
    const bets: EventMarketBet[] = [{ id: 'bet-1', stake: 100 }]
    const event = { id: 'event-1', name: 'Old event' }
    const props = { market, bets, event, isExpanded: true, onToggle: vi.fn(), oddsSignature: 'same', sharedBookViewContext: null }
    const { rerender } = render(<MarketCard {...props} />)
    const before = harness.queries.length
    rerender(<MarketCard {...props} />)
    assert.equal(harness.queries.length, before)
    const nextEvent = { ...event, name: 'Updated event' }
    rerender(<MarketCard {...props} event={nextEvent} />)
    assert.ok(harness.queries.length > before)
    assert.equal(harness.match?.event, nextEvent)
  })
})
