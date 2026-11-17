import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ApolloLink, InMemoryCache, Observable, type FetchResult } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { auditFixtureResponse, type AuditFixtureOptions } from '../../../test/auditEventsPreviewData'
import { useAuthStore } from '@/shared/core/authStore'
import { useAuditStore } from '@/state/auditStore'
import EventsPage from './EventsPage'
const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), loading: vi.fn(() => vi.fn()) }))
vi.mock('@/shared/services/notification', () => ({ notify: feedback }))
let options: AuditFixtureOptions
let calls: { name: string; kind: string; variables: Record<string, unknown> }[]
let live: ((result: FetchResult) => void) | undefined
/** The answer to AuditExportJobDownload (2026-11-04: the file itself, as a base64 data URI). */
let downloadAnswer: FetchResult
function Location() { return <output aria-label="Current route">{useLocation().pathname}{useLocation().search}</output> }
function page(route = '/audit/events') {
  const pageCalls = calls
  const fixtureOptions = options
  const link = new ApolloLink((operation) => new Observable((observer) => {
    const definition = operation.query.definitions.find((node) => node.kind === 'OperationDefinition')
    const kind = definition?.kind === 'OperationDefinition' ? definition.operation : ''
    pageCalls.push({ name: operation.operationName, kind, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown> })
    if (kind === 'subscription') { const next = observer.next.bind(observer); live = next; return () => { if (live === next) live = undefined } }
    if (operation.operationName === 'AuditExportJobDownload') { const answer = downloadAnswer; queueMicrotask(() => { observer.next(answer); observer.complete() }); return }
    queueMicrotask(() => { try { observer.next(auditFixtureResponse(operation, fixtureOptions)); observer.complete() } catch (error) { observer.error(error) } })
  }))
  return render(<MockedProvider cache={new InMemoryCache()} link={link}><MemoryRouter initialEntries={[route]}><Location /><Routes><Route path="/audit/events" element={<EventsPage />} /><Route path="*" element={<div>Destination page</div>} /></Routes></MemoryRouter></MockedProvider>)
}
beforeEach(() => {
  options = {}; calls = []; live = undefined; vi.clearAllMocks()
  downloadAnswer = { data: { auditExportJobDownload: `data:text/csv;base64,${btoa('id,action\nevent-1,update\n')}` } }
  useAuditStore.setState({ filters: { page: 1, limit: 100, sort: 'timestamp:desc' }, savedPresets: [], recentSearches: [], autoRefresh: false, visibleColumns: ['expand', 'id', 'timestamp', 'actor', 'domain', 'action', 'resource', 'details'], columnOrder: ['expand', 'id', 'timestamp', 'actor', 'domain', 'action', 'resource', 'details'], tableDensity: 'middle' })
  useAuthStore.setState({ permissions: [{ domain: 'audit.events', actions: ['view', 'export'] }], agent: undefined, agentPermissions: [], roles: [] })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() }); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
test('denial starts no queries or subscriptions and view-only cannot export by keyboard', async () => {
  useAuthStore.setState({ permissions: [] }); const view = page(); screen.getByText('Access denied'); assert.equal(calls.length, 0); view.unmount()
  useAuthStore.setState({ permissions: [{ domain: 'audit.events', actions: ['view'] }] }); page(); await screen.findByRole('table', { name: 'Audit events' })
  assert.equal(screen.queryByRole('button', { name: 'Export CSV' }), null); fireEvent.keyDown(window, { key: 'e', ctrlKey: true }); assert.equal(calls.some((call) => call.name === 'AuditExportCSV'), false)
})
test('initial URL filters are used by the first queries and paging/sorting preserve their scope', async () => {
  page('/audit/events?domain=players&actorId=admin-1&from=2026-10-01T18%3A30%3A00.000Z&to=2026-10-09T18%3A29%3A59.999Z&page=2&limit=50')
  await screen.findByRole('table', { name: 'Audit events' })
  const first = calls.find((call) => call.name === 'AuditEvents' && call.kind === 'query')!
  assert.deepEqual(first.variables.filters, { page: 2, limit: 50, sort: 'timestamp:desc', actorId: 'admin-1', from: '2026-10-01T18:30:00.000Z', to: '2026-10-09T18:29:59.999Z', domain: ['players'] })
  assert.ok(calls.filter((call) => call.name === 'AuditEvents' && call.kind === 'query').every((call) => (call.variables.filters as { actorId: string }).actorId === 'admin-1'))
  fireEvent.click(within(screen.getByRole('table', { name: 'Audit events' })).getByRole('button', { name: 'Actor' })); await waitFor(() => assert.equal(useAuditStore.getState().filters.sort, 'actorId:desc')); assert.equal(useAuditStore.getState().filters.page, 1)
})
test('CSV keeps filters and raises only its cap; JSON exports only the current page', async () => {
  page('/audit/events?domain=players&page=2&limit=50'); await screen.findByRole('table', { name: 'Audit events' })
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' })); await waitFor(() => assert.equal(feedback.success.mock.calls.length, 1))
  const csv = calls.find((call) => call.name === 'AuditExportCSV')!; assert.deepEqual(csv.variables.filters, { page: 2, limit: 10000, sort: 'timestamp:desc', domain: ['players'] })
  assert.equal((URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls.length, 1)
  fireEvent.click(screen.getByRole('button', { name: 'Export current page (JSON)' })); assert.equal((URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls.length, 2)
  assert.equal((HTMLAnchorElement.prototype.click as ReturnType<typeof vi.fn>).mock.calls.length, 2)
})
test('server permission refusal displays the explicit denial', async () => {
  options.failEvents = true; page(); await screen.findByText('Access Denied'); assert.equal(screen.queryByRole('table'), null)
})
test('a live event refetches both lists and duplicate delivery is ignored', async () => {
  page(); await screen.findByRole('table', { name: 'Audit events' }); await waitFor(() => assert.ok(live))
  const count = () => calls.filter((call) => call.kind === 'query' && ['AuditEvents', 'AuditStats'].includes(call.name)).length
  const before = count()
  const payload = { data: { auditEvents: { __typename: 'AuditEvent', id: 'live-1', domain: 'players', action: 'update', actorId: 'admin-1', actor: { __typename: 'AuditActor', id: 'admin-1', name: 'Preview operator', email: null, type: 'admin', role: null }, tenant: null, resourceType: 'player', resourceId: 'player-1', before: null, after: null, timestamp: '2026-10-09T10:00:00Z' } } }
  await act(async () => { live?.(payload) }); await waitFor(() => assert.equal(count(), before + 2))
  await act(async () => { live?.(payload) }); assert.equal(count(), before + 2)
})
test('expansion, drawer diff/raw/related/notes and explicit event navigation remain available', async () => {
  page(); const table = await screen.findByRole('table', { name: 'Audit events' }); fireEvent.click(within(table).getByRole('button', { name: 'Expand event-1' })); screen.getByRole('button', { name: 'Copy before state' }); screen.getByRole('button', { name: 'Copy after state' })
  fireEvent.click(within(table).getByRole('button', { name: 'Actions for event-1' })); fireEvent.click(await screen.findByRole('menuitem', { name: 'View Details' })); const drawer = await screen.findByRole('dialog', { name: 'Audit Event Details' }); within(drawer).getByText('0 added, 0 removed, 2 modified')
  fireEvent.click(within(drawer).getByRole('tab', { name: 'Before' })); within(drawer).getByRole('button', { name: 'Copy' }); within(drawer).getByText(/"limit": 100/)
  fireEvent.click(within(drawer).getByRole('tab', { name: /Related by Resource/ })); await within(drawer).findByRole('button', { name: 'View' }); assert.ok(calls.some((call) => JSON.stringify(call.variables.filters) === JSON.stringify({ resourceId: 'player-1', limit: 10 })))
  fireEvent.click(within(drawer).getByRole('tab', { name: /Related by Actor/ })); await within(drawer).findByRole('button', { name: 'View' }); assert.ok(calls.some((call) => JSON.stringify(call.variables.filters) === JSON.stringify({ actorId: 'admin-1', limit: 10 })))
  fireEvent.click(within(drawer).getByRole('tab', { name: 'Notes' })); await within(drawer).findByText('No annotations yet'); assert.ok(calls.some((call) => call.name === 'AuditAnnotations' && call.variables.auditEventId === 'event-1'))
  fireEvent.click(within(drawer).getByRole('tab', { name: 'Raw JSON' })); within(drawer).getByRole('button', { name: 'Copy All' }); fireEvent.click(within(drawer).getByRole('button', { name: 'Close dialog' })); await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
  fireEvent.click(within(table).getByRole('button', { name: 'Open audit event event-1' })); await screen.findByText('Destination page'); assert.ok(screen.getByLabelText('Current route').textContent?.startsWith('/audit/events/event-1'))
})
test('export jobs use the exact current filters and a refused create retains the selected format', async () => {
  page('/audit/events?domain=players'); await screen.findByRole('table', { name: 'Audit events' }); fireEvent.click(screen.getByRole('button', { name: 'Export Jobs' })); const jobs = await screen.findByRole('dialog', { name: 'Export Jobs' }); await within(jobs).findByRole('button', { name: 'Download' })
  fireEvent.click(within(jobs).getByRole('button', { name: 'New export job' })); const create = await screen.findByRole('dialog', { name: 'Create export job' }); fireEvent.click(within(create).getByRole('button', { name: 'Create job' })); within(create).getByText('Please select a format'); assert.equal(calls.some((call) => call.name === 'CreateAuditExportJob'), false)
  options.refuseJob = true; fireEvent.change(within(create).getByRole('combobox', { name: 'Format' }), { target: { value: 'JSON' } }); await act(async () => { fireEvent.click(within(create).getByRole('button', { name: 'Create job' })) }); await waitFor(() => assert.equal(feedback.error.mock.calls.length, 1)); assert.ok(create.textContent?.includes('Export queue unavailable')); assert.equal((within(create).getByRole('combobox', { name: 'Format' }) as HTMLSelectElement).value, 'JSON')
  options.refuseJob = false; await act(async () => { fireEvent.click(within(create).getByRole('button', { name: 'Create job' })) }); await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Create export job' }), null))
  assert.deepEqual(calls.find((call) => call.name === 'CreateAuditExportJob')?.variables.input, { filtersJson: { page: 1, limit: 100, sort: 'timestamp:desc', domain: ['players'] }, exportFormat: 'JSON' })
})
test('Download asks auditExportJobDownload for the file and saves its data URI as a Blob; the job list link is never opened', async () => {
  const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
  const saved: string[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) { saved.push(this.download) })
  page(); await screen.findByRole('table', { name: 'Audit events' }); fireEvent.click(screen.getByRole('button', { name: 'Export Jobs' }))
  const jobs = await screen.findByRole('dialog', { name: 'Export Jobs' })
  await act(async () => { fireEvent.click(await within(jobs).findByRole('button', { name: 'Download' })) })
  await waitFor(() => assert.equal(feedback.success.mock.calls.length, 1))
  assert.deepEqual(calls.filter((call) => call.name === 'AuditExportJobDownload').map((call) => call.variables), [{ id: 'job-ready' }])
  const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Blob
  assert.equal(blob.type, 'text/csv'); assert.equal(blob.size, 'id,action\nevent-1,update\n'.length)
  assert.deepEqual(saved, ['Audit Trail-2026-10-09-job-read.csv'])
  assert.deepEqual(feedback.success.mock.calls[0], ['Your file download has started.', 'Download Started'])
  assert.equal(opened.mock.calls.length, 0, 'the stored file name was opened as a link')
})
test("a refused audit download shows the server's words and saves nothing", async () => {
  downloadAnswer = { data: { auditExportJobDownload: null }, errors: [{ message: 'This export was made before files moved into the database; run it again' }] as never }
  page(); await screen.findByRole('table', { name: 'Audit events' }); fireEvent.click(screen.getByRole('button', { name: 'Export Jobs' }))
  const jobs = await screen.findByRole('dialog', { name: 'Export Jobs' })
  await act(async () => { fireEvent.click(await within(jobs).findByRole('button', { name: 'Download' })) })
  await waitFor(() => assert.equal(feedback.error.mock.calls.length, 1))
  assert.deepEqual(feedback.error.mock.calls[0], ['This export was made before files moved into the database; run it again', 'Download Failed'])
  assert.equal((URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls.length, 0)
  assert.equal(feedback.success.mock.calls.length, 0)
})
