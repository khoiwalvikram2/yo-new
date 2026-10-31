import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { DocumentNode } from 'graphql'
import { useAuthStore } from '@/shared/core/authStore'
import type { PlayerIntelligenceProfile } from './eventDetailModel'
import { PlayerProfileModal } from './PlayerProfileModal'

const harness = vi.hoisted(() => ({ profile: null as PlayerIntelligenceProfile | null, loading: false, error: undefined as Error | undefined, refetch: vi.fn(async () => ({})), calls: [] as { operation: string; variables: Record<string, string>; context: unknown }[], queryOptions: {} as Record<string, unknown>, next: undefined as (() => Promise<unknown>) | undefined }))
vi.mock('@apollo/client', async importOriginal => ({ ...await importOriginal<typeof import('@apollo/client')>(),
  useQuery: (_document: DocumentNode, options: Record<string, unknown>) => { harness.queryOptions = options; return { data: { sportsPlayerProfile: harness.profile }, loading: harness.loading, error: harness.error, refetch: harness.refetch } },
  useMutation: (document: DocumentNode) => {
    const operation = document.definitions.find(item => item.kind === 'OperationDefinition')
    const name = operation?.kind === 'OperationDefinition' ? operation.name?.value || '' : ''
    const key = name[0].toLowerCase() + name.slice(1)
    return [async (options: { variables: Record<string, string>; context: unknown }) => { harness.calls.push({ operation: name, ...options }); return harness.next ? harness.next() : { data: { [key]: { success: true } } } }]
  },
}))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => `₹${value.toFixed(2)}` }) }))
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDate: (value: string, pattern: string) => pattern === 'yyyy-MM-dd' ? value.slice(0, 10) : value, formatDateTime: (value: string) => value }) }))

function fixture(): PlayerIntelligenceProfile {
  return {
    user: { id: 'player-1', name: 'Player One', username: 'one', email: 'one@example.test', phone: '12345', status: 'ACTIVE' },
    statistics: { totalBets: 24, winRate: 62.5, netProfit: 987.65, roi: 9.5 },
    patterns: { peakBettingHours: [0, 18], averageSessionDuration: 0, typicalStakeRange: { min: 0, max: 100 }, bettingSidePreference: 'back', streakBehavior: { chasingLosses: false, stopAfterWin: true, averageStreakLength: 0 }, marketPreferences: [{ marketType: 'Match Odds', percentage: 0, totalBets: 0 }] },
    riskProfile: { riskLevel: 'HIGH', suspiciousActivityCount: 2, manualFlags: ['REVIEW'], patternFlags: ['AUTOMATIC'], patterns: [], notes: 'Existing read-only risk note', lastReviewedAt: '2026-10-09T12:00:00Z' },
    devices: [{ ipAddress: '127.0.0.1', userAgent: 'Local fixture', location: 'Delhi', country: 'IN', firstUsed: '2026-10-09', lastUsed: '2026-10-10', betCount: 0 }],
    relatedPlayers: [{ userId: 'linked', userName: 'Linked Player', relationshipType: 'SHARED_IP', confidence: 0 }],
    agentChain: [{ agentId: 'agent-1', agentName: 'Agent One', commissionRate: 5, creditLimit: 1250, creditUsed: 0 }],
    recentBets: Array.from({ length: 24 }, (_, index) => ({ id: `bet-${index + 1}`, marketId: index % 2 ? 'tennis-market' : 'cricket-market', selectionId: `selection-${index + 1}`, stake: 50, liability: 125, price: 2.5, status: index % 2 ? 'lost' : 'won', side: index % 2 ? 'lay' : 'back', currency: 'INR', createdAt: '2026-10-09T10:00:00Z' })),
  }
}
beforeEach(() => { harness.profile = fixture(); harness.loading = false; harness.error = undefined; harness.next = undefined; harness.calls = []; harness.refetch.mockClear(); useAuthStore.setState({ agent: undefined, user: undefined, permissions: [], roles: [] }) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function mount() { return render(<PlayerProfileModal open userId="player-1" onClose={() => {}} />) }
function tab(name: string | RegExp) { fireEvent.click(screen.getByRole('tab', { name })) }

describe('event player intelligence dialog', () => {
  test('preserves query skip/scope/error policy and dynamic tabs, masks protected stats and agent credit', () => {
    const { rerender } = mount()
    assert.deepEqual(harness.queryOptions, { variables: { userId: 'player-1' }, skip: false, errorPolicy: 'all' })
    assert.equal(screen.getAllByRole('tab').length, 6)
    assert.ok(screen.getByText('••••'))
    assert.equal(Boolean(screen.queryByText('₹987.65')), false)
    tab(/Agent Hierarchy/)
    assert.ok(screen.getByText('Limit: ••••'))
    assert.ok(screen.getByText('Used: ••••'))
    rerender(<PlayerProfileModal open={false} userId="player-1" onClose={() => {}} />)
    assert.equal(harness.queryOptions.skip, true)
  })
  test('preserves statistics/patterns, zero metrics, read-only notes, device details and relationships', () => {
    mount()
    tab('Statistics & Patterns')
    assert.ok(screen.getByText('0.0 minutes'))
    assert.ok(screen.getByText('0, 18'))
    assert.ok(screen.getByText('₹0.00 – ₹100.00'))
    assert.ok(screen.getByText('0.0%'))
    tab(/Risk Profile/)
    assert.equal((screen.getByLabelText('Player risk notes') as HTMLTextAreaElement).readOnly, true)
    assert.ok(screen.getByText('No patterns detected'))
    tab(/Devices & Locations/)
    assert.ok(screen.getByRole('table', { name: 'Player devices and locations' }))
    assert.ok(screen.getByText('Delhi'))
    assert.ok(screen.getByText('Confidence: 0%'))
  })
  test('keeps rejected flag drafts and exact mutation variables, then closes only on success', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Flag Player' }))
    const form = screen.getByRole('dialog', { name: 'Flag Player' })
    fireEvent.change(within(form).getByLabelText(/Flag Name/), { target: { value: 'CUSTOM_FLAG' } })
    fireEvent.change(within(form).getByLabelText(/Reason/), { target: { value: 'Operator review' } })
    harness.next = async () => ({ data: { flagPlayer: { success: false, message: 'Permission rejected' } } })
    await act(async () => fireEvent.submit(form.querySelector('form')!))
    assert.ok(screen.getByText('Permission rejected'))
    assert.equal((within(form).getByLabelText(/Flag Name/) as HTMLInputElement).value, 'CUSTOM_FLAG')
    assert.deepEqual(harness.calls[0], { operation: 'FlagPlayer', variables: { userId: 'player-1', flag: 'CUSTOM_FLAG', reason: 'Operator review' }, context: { uiToast: 'notification' } })
    harness.next = undefined
    await act(async () => fireEvent.submit(form.querySelector('form')!))
    assert.equal(Boolean(screen.queryByRole('dialog', { name: 'Flag Player' })), false)
    assert.equal(harness.refetch.mock.calls.length, 1)
  })
  test('suspends through existing status-only API and retains a failed reason draft', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }))
    const form = screen.getByRole('dialog', { name: 'Suspend Player' })
    fireEvent.change(within(form).getByLabelText(/Reason/), { target: { value: 'Requested review' } })
    harness.next = async () => { throw new Error('Service unavailable') }
    await act(async () => fireEvent.submit(form.querySelector('form')!))
    assert.equal((within(form).getByLabelText(/Reason/) as HTMLTextAreaElement).value, 'Requested review')
    harness.next = undefined
    await act(async () => fireEvent.submit(form.querySelector('form')!))
    assert.deepEqual(harness.calls[1].variables, { id: 'player-1', status: 'SUSPENDED' })
    assert.ok(screen.getByText('Player suspended. Reason: Requested review'))
  })
  test('confirms a manual flag removal while auto-derived flags stay read-only', async () => {
    mount()
    assert.equal(Boolean(screen.queryByRole('button', { name: /Remove AUTOMATIC/ })), false)
    fireEvent.click(screen.getByRole('button', { name: 'Remove REVIEW flag' }))
    const confirmation = screen.getByRole('dialog', { name: 'Remove Flag' })
    assert.equal(harness.calls.length, 0)
    await act(async () => fireEvent.click(within(confirmation).getByRole('button', { name: 'Yes, Remove' })))
    assert.deepEqual(harness.calls[0].variables, { userId: 'player-1', flag: 'REVIEW' })
  })
  test('requires explicit void confirmation, retains the exact reason and prevents duplicate pending submissions', async () => {
    mount(); tab(/Betting History/)
    fireEvent.click(screen.getAllByRole('button', { name: 'Void' })[0])
    const confirmation = screen.getByRole('dialog', { name: 'Void bet bet-1' })
    assert.equal(harness.calls.length, 0)
    let resolve!: (value: unknown) => void
    harness.next = () => new Promise(result => { resolve = result })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm void' }))
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm void' }))
    assert.equal(harness.calls.length, 1)
    assert.deepEqual(harness.calls[0].variables, { betId: 'bet-1', reason: 'Manual void from player profile' })
    await act(async () => resolve({ data: { voidBet: { success: true } } }))
    await waitFor(() => assert.equal(Boolean(screen.queryByRole('dialog', { name: 'Void bet bet-1' })), false))
  })
  test('filters and paginates only loaded recent bets, exporting the filtered snapshot without another query', () => {
    mount(); tab(/Betting History/)
    const table = screen.getByRole('table', { name: 'Recent player bets' })
    assert.equal(within(table).getAllByRole('row').length, 21)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    assert.equal(within(table).getAllByRole('row').length, 5)
    fireEvent.change(screen.getByLabelText('Search recent bets'), { target: { value: 'cricket' } })
    assert.equal(within(table).getAllByRole('row').length, 13)
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'lost' } })
    assert.ok(screen.getByText('No data'))
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'won' } })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-09' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-09' } })
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    assert.equal(create.mock.calls.length, 1)
    assert.equal(revoke.mock.calls[0][0], 'blob:test')
    assert.equal(harness.refetch.mock.calls.length, 0)
    assert.equal(harness.calls.length, 0)
  })
  test('shows genuine loading/errors and offers retry without a fabricated empty profile', async () => {
    harness.loading = true
    const { rerender } = mount()
    assert.ok(screen.getByRole('status'))
    harness.loading = false; harness.profile = null; harness.error = new Error('Query refused')
    rerender(<PlayerProfileModal open userId="player-1" onClose={() => {}} />)
    assert.ok(screen.getByText('Query refused'))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })))
    assert.equal(harness.refetch.mock.calls.length, 1)
    assert.equal(screen.queryAllByRole('tab').length, 0)
  })
})
