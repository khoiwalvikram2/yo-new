import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { DocumentNode } from 'graphql'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import { MarketBookTable } from './MarketBookTable'
import styles from './MarketBook.module.css'
import type { EventMarket, EventMarketBet } from './eventMarketTypes'

const harness = vi.hoisted(() => ({ data: {} as { myAgentSharing?: { sharingRates: { domain: string; rate: number }[] }; myWhitelabelSharing?: { sharingRates: { domain: string; rate: number }[] } }, calls: [] as { name: string; options: Record<string, unknown> }[] }))
vi.mock('@apollo/client', async importOriginal => ({ ...await importOriginal<typeof import('@apollo/client')>(),
  useQuery: (document: DocumentNode, options: Record<string, unknown>) => { const operation = document.definitions.find(item => item.kind === 'OperationDefinition'); harness.calls.push({ name: operation?.kind === 'OperationDefinition' ? operation.name?.value || '' : '', options }); return { data: harness.data } },
}))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => `₹${value.toFixed(2)}`, convertFromWhitelabelCurrency: (value: number) => value }) }))
beforeEach(() => { harness.data = {}; harness.calls = []; useAuthStore.setState({ agent: undefined, user: undefined, roles: ['Super Admin'], permissions: [] }); useUIStore.setState({ directorMode: 'core' }) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const market: EventMarket = { id: 'market-1', kind: 'exchange', runners: [{ id: 'uuid-a', selectionCode: 'runner-a', name: 'Alpha' }, { id: 'uuid-b', selectionCode: 'runner-b', name: 'Beta' }] }
const bets: EventMarketBet[] = [
  { id: 'a', userId: 'alice', userName: 'Alice', userFlags: { manual: ['REVIEW'], pattern: ['AUTOMATIC'] }, marketId: 'market-1', selectionId: 'runner-a', side: 'back', price: 3, stake: 100, liability: 200, status: 'matched' },
  { id: 'b', userId: 'bob', userName: 'Bob', marketId: 'market-1', selectionId: 'runner-b', side: 'back', price: 2, stake: 50, liability: 50, status: 'matched', agentInfo: { agentId: 'agent-1', agentName: 'Agent One', schemeType: 'SHARING', rate: 20 } },
  { id: 'pending', userId: 'pending', userName: 'Pending', marketId: 'market-1', selectionId: 'runner-a', side: 'back', price: 10, stake: 9999, status: 'unmatched' },
]
function mount() { return render(<MarketBookTable market={market} bets={bets} isExpanded onToggle={() => {}} />) }
function row(name: string) { const table = screen.getByRole('table', { name: 'Market book selections' }); return within(table).getAllByRole('row').find(element => element.textContent?.includes(name))! }
function amounts(element: HTMLElement) { return Array.from(element.querySelectorAll('td')).slice(1).map(cell => Array.from(cell.querySelectorAll('span')).map(value => value.textContent).filter(value => value?.startsWith('₹'))) }
/** Each cell shows one figure; read Gross, then Net, and pair them per selection as [gross, net]. */
function pairs(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Gross' })); const gross = amounts(row(name))
  fireEvent.click(screen.getByRole('button', { name: 'Net' })); const net = amounts(row(name))
  return gross.map((cell, index) => [...cell, ...net[index]])
}
function cell(name: string, index: number) { return row(name).querySelectorAll('td')[index + 1] }

describe('market book financial and hierarchy contracts', () => {
  test('retains selection-code matching, platform inverse, player/agent rollups, flags and per-selection totals', () => {
    mount()
    assert.deepEqual(pairs('Alice'), [['₹-200.00', '₹-200.00'], ['₹100.00', '₹100.00']])
    assert.deepEqual(pairs('Agent One'), [['₹50.00', '₹50.00'], ['₹-50.00', '₹-50.00']])
    assert.deepEqual(pairs('Total'), [['₹-150.00', '₹-150.00'], ['₹50.00', '₹50.00']])
    assert.equal(Boolean(screen.queryByText('Pending', { exact: true })), false)
    assert.ok(screen.getByLabelText('Active Flags: REVIEW, AUTOMATIC'))
    assert.equal(screen.getAllByText('1P').length, 2); assert.ok(screen.getByText('1A'))
    assert.ok(harness.calls.every(call => call.options.skip === true && call.options.errorPolicy === 'all' && call.options.fetchPolicy === 'cache-first'))
  })
  test('keeps whitelabel effective sharing rates and full-book totals while searching', () => {
    useAuthStore.setState({ roles: ['Whitelabel Admin'] })
    harness.data = { myWhitelabelSharing: { sharingRates: [{ domain: 'sports', rate: 60 }] } }
    mount()
    assert.deepEqual(pairs('Alice'), [['₹200.00', '₹120.00'], ['₹-100.00', '₹-60.00']])
    assert.deepEqual(pairs('Agent One'), [['₹-50.00', '₹-20.00'], ['₹50.00', '₹20.00']])
    assert.deepEqual(pairs('Total'), [['₹150.00', '₹100.00'], ['₹-50.00', '₹-40.00']])
    fireEvent.change(screen.getByLabelText('Search players or agents'), { target: { value: 'Alice' } })
    assert.equal(Boolean(screen.queryByText('Agent One', { exact: true })), false)
    assert.deepEqual(pairs('Total'), [['₹150.00', '₹100.00'], ['₹-50.00', '₹-40.00']])
    assert.ok(harness.calls.some(call => call.options.skip === false))
  })
  test('keeps the logged-in agent players separate and applies original sharing percentages', () => {
    useAuthStore.setState({ roles: [], agent: { id: 'agent-1', tenantId: 'tenant-1', username: 'agent', phone: null, schemeType: 'SHARING', allowedDomains: ['sports'], status: 'ACTIVE', parentAgentId: null, levelIndex: 1, tallyEnabled: false, tallyDomains: [], createdAt: '2026-10-09' } })
    harness.data = { myAgentSharing: { sharingRates: [{ domain: 'sports', rate: 20 }] } }
    mount()
    assert.deepEqual(pairs('Alice'), [['₹200.00', '₹40.00'], ['₹-100.00', '₹-20.00']])
    assert.deepEqual(pairs('Bob'), [['₹-50.00', '₹-10.00'], ['₹50.00', '₹10.00']])
    assert.equal(Boolean(screen.queryByText('Agent One', { exact: true })), false)
    assert.ok(screen.getByText('2P'))
  })
  test('keeps rolled-up direct-child metadata, explicit zero rate and corresponding effective rate', () => {
    useAuthStore.setState({ roles: ['Whitelabel Admin'] })
    harness.data = { myWhitelabelSharing: { sharingRates: [{ domain: 'sports', rate: 60 }] } }
    render(<MarketBookTable market={market} bets={bets} isExpanded onToggle={() => {}} viewContext={{ directChildAgentIds: ['root-agent'], getDescendantsOf: () => ['root-agent', 'agent-1'], getAgentInfo: () => ({ username: 'Root Agent', schemeType: 'SHARING', rate: 0 }) }} />)
    assert.ok(screen.getByText('Share 0%'))
    assert.deepEqual(pairs('Root Agent'), [['₹-50.00', '₹-30.00'], ['₹50.00', '₹30.00']])
  })
  test('keeps collapsed and empty books absent and forwards expansion', () => {
    const toggle = vi.fn()
    const { rerender } = render(<MarketBookTable market={market} bets={bets} isExpanded={false} onToggle={toggle} />)
    assert.equal(Boolean(screen.queryByRole('table')), false)
    const bar = screen.getByRole('button', { name: /^Market book/ })
    assert.equal(bar.getAttribute('aria-expanded'), 'false')
    fireEvent.click(bar); assert.equal(toggle.mock.calls.length, 1)
    rerender(<MarketBookTable market={market} bets={[]} isExpanded onToggle={toggle} />)
    assert.equal(Boolean(screen.queryByText('Market book')), false)
  })
})

describe('market book kit controls', () => {
  test('names the worst total for the house in each sign convention', () => {
    // Super Admin in core mode: house-side figures, the house loses ₹150.00 if Alpha wins
    const { unmount } = mount()
    assert.ok(screen.getByRole('button', { name: 'Market book 1P 1A Worst case ₹-150.00 if Alpha win' }))
    unmount()
    // whitelabel: player-side figures, the players win ₹150.00 gross (₹100.00 net) if Alpha wins
    useAuthStore.setState({ roles: ['Whitelabel Admin'] })
    harness.data = { myWhitelabelSharing: { sharingRates: [{ domain: 'sports', rate: 60 }] } }
    mount()
    assert.ok(screen.getByRole('button', { name: /Worst case ₹150\.00 if Alpha win$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Net' }))
    assert.ok(screen.getByRole('button', { name: /Worst case ₹100\.00 if Alpha win$/ }))
  })
  test('tints the costliest figure of each row, not the totals', () => {
    useAuthStore.setState({ roles: ['Whitelabel Admin'] })
    harness.data = { myWhitelabelSharing: { sharingRates: [{ domain: 'sports', rate: 60 }] } }
    mount()
    const worst = (name: string, index: number) => cell(name, index).querySelector('span')!.classList.contains(styles.worst)
    assert.deepEqual([worst('Alice', 0), worst('Alice', 1)], [true, false])
    assert.deepEqual([worst('Agent One', 0), worst('Agent One', 1)], [false, true])
    assert.deepEqual([worst('Total', 0), worst('Total', 1)], [false, false])
  })
  test('filters rows to players or agents while the totals keep the whole book', () => {
    mount()
    const total = () => amounts(row('Total'))
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }))
    assert.equal(Boolean(screen.queryByText('Alice', { exact: true })), false)
    assert.ok(screen.getByText('Agent One', { exact: true }))
    assert.deepEqual(total(), [['₹-150.00'], ['₹50.00']])
    fireEvent.click(screen.getByRole('button', { name: 'Players' }))
    assert.ok(screen.getByText('Alice', { exact: true }))
    assert.equal(Boolean(screen.queryByText('Agent One', { exact: true })), false)
    assert.deepEqual(total(), [['₹-150.00'], ['₹50.00']])
    fireEvent.change(screen.getByLabelText('Search players or agents'), { target: { value: 'nobody' } })
    assert.ok(screen.getByText('No rows match. The totals below still cover the whole book.'))
    assert.deepEqual(total(), [['₹-150.00'], ['₹50.00']])
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    fireEvent.change(screen.getByLabelText('Search players or agents'), { target: { value: '' } })
    assert.ok(screen.getByText('Alice', { exact: true })); assert.ok(screen.getByText('Agent One', { exact: true }))
    assert.ok(screen.getByText('Totals include all loaded book rows, not only search results.'))
  })
})
