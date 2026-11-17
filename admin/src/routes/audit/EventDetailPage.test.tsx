import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import type { DocumentNode } from 'graphql'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { AUDIT_EVENTS_QUERY, AUDIT_ANNOTATIONS_QUERY } from '@/modules/audit/graphql/queries'
import EventDetailPage from './EventDetailPage'

const mocks = vi.hoisted(() => ({
  allowed: true, loading: false, error: undefined as Error | undefined, missing: false,
  query: vi.fn(), mutation: vi.fn(), refetch: vi.fn(), copy: vi.fn(), toast: vi.fn(), failNote: false,
  event: { id: 'event-1', actorId: 'actor-1', tenant: 'tenant-1', domain: 'players', action: 'update',
    resourceType: 'player', resourceId: '501', timestamp: '2026-10-01T10:00:00Z',
    before: { status: 'INACTIVE' }, after: { status: 'ACTIVE' },
    actor: { id: 'actor-1', name: 'Agent', type: 'agent', email: 'agent@example.test', role: 'AGENT' } },
  notes: [{ id: 'note-1', auditEventId: 'event-1', note: 'Investigated this change', createdAt: '2026-10-01T10:00:00Z', updatedAt: '' }],
}))
vi.mock('@apollo/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@apollo/client')>(),
  useQuery: (document: DocumentNode, options: unknown) => {
    mocks.query(document, options)
    return { data: mocks.loading || mocks.error ? undefined : document === AUDIT_EVENTS_QUERY ?
      { auditEvents: { items: mocks.missing ? [] : [mocks.event] } } : { auditAnnotations: mocks.notes },
      loading: mocks.loading, error: mocks.error, refetch: mocks.refetch }
  },
  useMutation: (document: DocumentNode, callbacks: { onCompleted?: () => void; onError?: (error: Error) => void }) => [
    async (options: unknown) => {
      mocks.mutation(document, options)
      if (mocks.failNote) { const error = new Error('Note save refused'); callbacks.onError?.(error); throw error }
      callbacks.onCompleted?.()
      return { data: {} }
    }, { loading: false },
  ],
}))
vi.mock('@/shared/core/RBACGuard', () => ({ RBACGuard: ({ children }: { children: ReactNode }) => mocks.allowed ? children : <div>Access denied</div> }))
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDateTime: (date: string) => date }) }))
vi.mock('@/shared/utils/clipboard', () => ({ copyToClipboard: mocks.copy }))
vi.mock('@/ui/components/toast', () => ({ toast: mocks.toast }))

beforeEach(() => { vi.clearAllMocks(); mocks.allowed = true; mocks.loading = false; mocks.error = undefined; mocks.missing = false; mocks.failNote = false })
afterEach(cleanup)
function Location() { return <output aria-label="Current route">{useLocation().pathname}</output> }
function page(path = '/audit/events/event-1') {
  return render(<MemoryRouter initialEntries={[path]}><PageEyebrowProvider value="Audit">
    <Routes><Route path="/audit/events/:id?" element={<EventDetailPage />} /><Route path="*" element={<div>Destination</div>} /></Routes><Location />
  </PageEyebrowProvider></MemoryRouter>)
}

describe('audit detail and annotations contracts', () => {
  test('retains event and annotations query variables/policies and all detail facts', () => {
    page()
    assert.ok(mocks.query.mock.calls.some(([document, options]) => document === AUDIT_EVENTS_QUERY &&
      JSON.stringify(options) === JSON.stringify({ variables: { filters: { id: 'event-1', limit: 1 } }, errorPolicy: 'all', skip: false })))
    assert.ok(mocks.query.mock.calls.some(([document, options]) => document === AUDIT_ANNOTATIONS_QUERY &&
      options.variables.auditEventId === 'event-1' && options.fetchPolicy === 'cache-and-network'))
    assert.ok(screen.getByText('agent@example.test'))
    assert.ok(screen.getByText('tenant-1'))
    assert.ok(screen.getByRole('heading', { name: 'Change Data' }))
    assert.ok(screen.getByRole('heading', { name: 'Raw JSON' }))
  })
  test('denied users start no event or annotation queries', () => {
    mocks.allowed = false; page(); assert.ok(screen.getByText('Access denied')); assert.equal(mocks.query.mock.calls.length, 0)
  })
  test('copy actions preserve exact values and feedback copy', () => {
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Copy Audit ID' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy Before' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy After' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy All' }))
    assert.deepEqual(mocks.copy.mock.calls, [
      ['event-1', 'Event ID copied!'], [JSON.stringify(mocks.event.before, null, 2), 'Before data copied!'],
      [JSON.stringify(mocks.event.after, null, 2), 'After data copied!'], [JSON.stringify(mocks.event, null, 2), 'JSON copied!'],
    ])
  })
  test('resource and actor actions keep their navigation destinations', () => {
    const first = page(); fireEvent.click(screen.getByRole('button', { name: 'View Resource' }))
    assert.equal(screen.getByLabelText('Current route').textContent, '/players/profile/501')
    first.unmount(); page(); fireEvent.click(screen.getByRole('button', { name: 'View Profile' }))
    assert.equal(screen.getByLabelText('Current route').textContent, '/agents/actor-1')
  })
  test('an admin sign-in names an admin account: View Resource opens Support Admins (SYS-14)', () => {
    const original = mocks.event
    mocks.event = { ...original, domain: 'users.security', action: 'login', resourceType: 'user', resourceId: '2' }
    try {
      page(); fireEvent.click(screen.getByRole('button', { name: 'View Resource' }))
      assert.equal(screen.getByLabelText('Current route').textContent, '/security/support-admins')
    } finally { mocks.event = original }
  })
  test('a revoked bonus names its award, not a campaign: View Resource opens the player (B008)', () => {
    const original = mocks.event
    mocks.event = { ...original, domain: 'players', action: 'revoke_bonus', resourceType: 'bonus', resourceId: '31',
      before: null as never, after: { awardId: 31, userId: 746, amount: '50.00' } as never }
    try {
      const first = page(); fireEvent.click(screen.getByRole('button', { name: 'View Resource' }))
      assert.equal(screen.getByLabelText('Current route').textContent, '/players/profile/746')
      first.unmount()
      mocks.event = { ...mocks.event, after: { awardId: 31 } as never }
      page()
      assert.equal(screen.queryByRole('button', { name: 'View Resource' }), null, 'no player recorded, no link')
    } finally { mocks.event = original }
  })
  test('note create/update/delete trim inputs and refetch with original mutation shapes', async () => {
    page()
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: ' Follow up ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Note' }))
    await waitFor(() => assert.equal(mocks.mutation.mock.calls.length, 1))
    assert.deepEqual(mocks.mutation.mock.calls[0][1], { variables: { input: { auditEventId: 'event-1', note: 'Follow up' } } })
    await waitFor(() => assert.equal((screen.getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement).value, ''))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit note' }), { target: { value: ' Resolved ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => assert.equal(mocks.mutation.mock.calls.length, 2))
    assert.deepEqual(mocks.mutation.mock.calls[1][1], { variables: { input: { id: 'note-1', note: 'Resolved' } } })
    await waitFor(() => assert.equal(screen.queryByRole('textbox', { name: 'Edit note' }), null))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete' })))
    assert.deepEqual(mocks.mutation.mock.calls[2][1], { variables: { id: 'note-1' } })
    assert.equal(mocks.refetch.mock.calls.length, 3)
  })
  test('empty-note validation suppresses mutation; failed note save retains the typed value', async () => {
    page(); fireEvent.click(screen.getByRole('button', { name: 'Add Note' }))
    await waitFor(() => assert.ok(screen.getByText('Note is required')))
    assert.equal(mocks.mutation.mock.calls.length, 0)
    mocks.failNote = true
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'Retain me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Note' }))
    await waitFor(() => assert.ok(screen.getByText('Note save refused')))
    assert.equal((screen.getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement).value, 'Retain me')
    assert.equal(mocks.refetch.mock.calls.length, 0)
  })
  test('loading/error/not-found states and missing-id query skip are explicit', () => {
    mocks.loading = true; const first = page(); assert.equal(screen.getByText('Loading audit event').closest('[role="status"]')?.getAttribute('role'), 'status'); first.unmount()
    mocks.loading = false; mocks.error = new Error('Service down'); const second = page(); assert.ok(screen.getByText('Failed to load audit event: Service down')); second.unmount()
    mocks.error = undefined; mocks.missing = true; const third = page(); assert.ok(screen.getByText('Audit event not found')); third.unmount()
    page('/audit/events'); assert.ok(mocks.query.mock.calls.some(([document, options]) => document === AUDIT_EVENTS_QUERY && options.skip === true))
  })
})
