import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, test, vi } from 'vitest'
import type { DocumentNode } from 'graphql'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import type { BookViewContext } from '../utils/bookCalculator'
import { EventSidebar } from './EventSidebar'

const harness = vi.hoisted(() => ({ calls: [] as Array<{ name: string; options: Record<string, unknown> }>, data: {} as Record<string, unknown>, queries: [] as Array<Record<string, unknown>> }))
vi.mock('@apollo/client', async importOriginal => ({ ...await importOriginal<typeof import('@apollo/client')>(),
  useQuery: (document: DocumentNode, options: Record<string, unknown> = {}) => {
    const definition = document.definitions.find(item => item.kind === 'OperationDefinition')
    const name = definition?.kind === 'OperationDefinition' ? definition.name?.value || '' : ''
    harness.calls.push({ name, options })
    return { data: options.skip ? undefined : harness.data[name], loading: false }
  },
  useApolloClient: () => ({ query: async (options: Record<string, unknown>) => { harness.queries.push(options); return { data: { agents: { agentDescendantIds: ['a1', 'a2'] } } } } }),
}))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => `₹${value.toFixed(2)}`, convertFromWhitelabelCurrency: (value: number) => value, getCurrencySymbol: () => '₹' }) }))
vi.mock('./PlayerProfileModal', () => ({ PlayerProfileModal: ({ open, userId, onClose }: { open: boolean; userId: string; onClose: () => void }) => open ? <div role="dialog" aria-label="Selected player"><span>{userId}</span><button onClick={onClose}>Close player</button></div> : null }))

const book: BookViewContext = { directChildAgentIds: ['a1'], getDescendantsOf: () => ['a1', 'a2'], getAgentInfo: () => ({ username: 'root-agent', schemeType: 'COMMISSION', rate: 5 }) }
const patterns = new Map([['u1', [{ id: 'p1', userId: 'u1', patternType: 'RAPID_BETTING' as const, severity: 'HIGH' as const, metrics: { betsPerMinute: 7 } }, { id: 'p2', userId: 'u1', patternType: 'ODD_TIMING' as const, severity: 'LOW' as const }]]])
const agent = { id: 'a1', tenantId: 'tenant-1', username: 'root-agent', phone: null, schemeType: 'COMMISSION', allowedDomains: ['sports'], status: 'ACTIVE', parentAgentId: null, levelIndex: 1, tallyEnabled: false, tallyDomains: [], createdAt: '2026-01-01' }
beforeEach(() => {
  harness.calls = []; harness.queries = []
  harness.data = {
    UsersPage: { usersPage: { items: [
      { id: 'u1', name: 'Asha', username: 'Asha', agentId: 'a1', flags: ['REVIEW'], wallet: { balance: 100, exposure: 10 } },
      { id: 'u2', name: 'Ravi', username: 'Ravi', agentId: 'a2', wallet: { balance: 200, exposure: 30 } },
      { id: 'u3', username: 'Other event player', agentId: 'a3', wallet: { balance: 300, exposure: 50 } },
      { id: 'u4', username: 'No bets in subtree', agentId: 'a2', riskType: 'LOW', wallet: { balance: 0, exposure: 0 } },
    ], total: 4 } },
    AgentsPage: { agents: { agentsPage: { items: [{ id: 'a1', username: 'root-agent', schemeType: 'COMMISSION' }, { id: 'a2', username: 'nested-agent', schemeType: 'SHARING' }, { id: 'a3', username: 'other-agent', schemeType: 'CREDIT' }] } } },
    EventBets: { sportsBets: [
      { id: 'b1', userId: 'u1', eventId: 'event-1', stake: 100, liability: 150, price: 2, side: 'back', status: 'matched', agentInfo: { agentId: 'a1' } },
      { id: 'b2', userId: 'u2', eventId: 'event-1', stake: 50, liability: 0, price: 3, side: 'lay', status: 'void', agentInfo: { agentId: 'a2' } },
      { id: 'wrong-event', userId: 'u3', eventId: 'event-other', stake: 5000, liability: 5000, price: 10, side: 'back', agentInfo: { agentId: 'a3' } },
    ] },
    EventRiskConfig: { eventRiskConfig: { alerts: { enabled: false } } },
  }
  useAuthStore.setState({ token: undefined, user: undefined, agent: undefined, roles: ['Whitelabel Admin'], permissions: [{ domain: 'players.wallet', actions: ['view'] }] })
  useUIStore.setState({ directorMode: 'whitelabel' })
})
function Location() { return <output aria-label="Current path">{useLocation().pathname}</output> }
function mount(props: Partial<React.ComponentProps<typeof EventSidebar>> = {}) {
  return render(<MemoryRouter initialEntries={['/sports/event/event-1']}><EventSidebar event={{ id: 'event-1' }} bookViewContextFromParent={book} patternsByUserId={patterns} {...props} /><Location /></MemoryRouter>)
}
describe('event people sidebar', () => {
  test('preserves exact event/list scopes and parent-owned hierarchy/pattern query skips', () => {
    mount()
    const eventCall = harness.calls.find(call => call.name === 'EventBets')!
    assert.deepEqual(eventCall.options, { variables: { query: { eventId: 'event-1', limit: 2000 } }, skip: false, errorPolicy: 'all', fetchPolicy: 'network-only' })
    assert.equal(harness.calls.find(call => call.name === 'BettingPatterns')?.options.skip, true)
    assert.equal(harness.calls.find(call => call.name === 'AgentTreeForView')?.options.skip, true)
    assert.equal(harness.calls.find(call => call.name === 'AgentRootAgents')?.options.skip, true)
    assert.equal(harness.queries.length, 0)
    assert.deepEqual(harness.calls.find(call => call.name === 'UsersPage')?.options.variables, { query: undefined, offset: 0, limit: 50 })
    assert.equal(Boolean(screen.queryByRole('article', { name: 'Player Other event player' })), false)
    assert.equal(Boolean(screen.queryByRole('article', { name: 'Player No bets in subtree' })), false)
  })
  test('retains wallet exposure precedence, flags and first-pattern plus remainder, with searchable player selection', () => {
    mount()
    const asha = screen.getByRole('article', { name: 'Player Asha' })
    assert.equal(within(asha).getByLabelText('Player exposure').textContent, '−₹10.00')
    assert.equal(within(asha).getByLabelText('Player wallet balance').textContent, '₹100.00')
    assert.ok(within(asha).getByLabelText('Active Flags: REVIEW'))
    assert.ok(within(asha).getByLabelText('RAPID BETTING (HIGH)'))
    assert.ok(within(asha).getByText('+1'))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search event players' }), { target: { value: ' Ravi ' } })
    assert.equal(screen.getAllByRole('article').length, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Ravi' }))
    assert.ok(within(screen.getByRole('dialog', { name: 'Selected player' })).getByText('u2'))
  })
  test('keeps protected player wallet/exposure masked without leaking titles', () => {
    useAuthStore.setState({ permissions: [] })
    mount()
    const asha = screen.getByRole('article', { name: 'Player Asha' })
    assert.equal(within(asha).getByLabelText('Player exposure').textContent, '−••••')
    assert.equal(within(asha).getByLabelText('Player exposure').getAttribute('title'), null)
    assert.equal(within(asha).getByLabelText('Player wallet balance').textContent, '••••')
    assert.equal(Boolean(within(asha).queryByText('₹100.00')), false)
  })
  test('rolls descendants including settled/void bets, retains liability-or-stake volume and wallet book exposure', () => {
    mount()
    fireEvent.click(screen.getByRole('tab', { name: 'Agents, 1' }))
    const root = screen.getByRole('article', { name: 'Agent root-agent' })
    assert.ok(within(root).getByText('2 bets'))
    assert.ok(within(root).getByText('Vol ₹200.00'))
    assert.equal(within(root).getByLabelText('Agent exposure').textContent, '−₹40.00')
    assert.equal(Boolean(screen.queryByRole('article', { name: 'Agent nested-agent' })), false)
    fireEvent.click(within(root).getByRole('button', { name: 'root-agent' }))
    assert.equal(screen.getByLabelText('Current path').textContent, '/agents/a1')
  })
  test('agent login retains no-bet subtree players and skips forbidden risk-config reads', () => {
    useAuthStore.setState({ roles: [], permissions: [], agent })
    mount({ agentSubtreeIdsFromParent: ['a1', 'a2'] })
    assert.ok(screen.getByRole('article', { name: 'Player No bets in subtree' }))
    assert.equal(harness.calls.find(call => call.name === 'EventRiskConfig')?.options.skip, true)
    assert.equal(harness.queries.length, 0)
    assert.deepEqual(harness.calls.find(call => call.name === 'AgentsPage')?.options.variables, { query: undefined, offset: 0, limit: 50, parentAgentId: 'a1' })
  })
  test('refreshes rolled metrics when parent hierarchy changes instead of showing the previous tree', () => {
    const { rerender } = mount()
    fireEvent.click(screen.getByRole('tab', { name: 'Agents, 1' }))
    assert.ok(screen.getByText('2 bets'))
    const newBook: BookViewContext = { ...book, getDescendantsOf: () => ['a1'] }
    rerender(<MemoryRouter><EventSidebar event={{ id: 'event-1' }} bookViewContextFromParent={newBook} patternsByUserId={patterns} /></MemoryRouter>)
    assert.ok(screen.getByText('1 bets'))
    assert.ok(screen.getByText('Vol ₹150.00'))
  })
  test('preserves configured risk thresholds and exposes risk alert drawer', async () => {
    harness.data.EventRiskConfig = { eventRiskConfig: { riskLevelThresholds: { high: 1, medium: 0, low: 0 }, alerts: { enabled: true, triggerLevels: ['HIGH'], notificationEnabled: false, sidebarIndicatorEnabled: true } } }
    mount()
    const alerts = screen.getByRole('button', { name: '3 HIGH risk alerts' })
    fireEvent.click(alerts)
    await waitFor(() => assert.ok(screen.getByRole('dialog', { name: /Risk Alert/ })))
  })
})
