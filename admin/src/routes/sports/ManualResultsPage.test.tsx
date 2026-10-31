import assert from 'node:assert/strict'
import { beforeEach, describe, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import ManualResultsPage from './ManualResultsPage'

const state = vi.hoisted(() => ({
  allowed: true,
  roles: ['Admin'] as string[],
  directorMode: 'platform',
  queryCalls: [] as Array<Record<string, unknown>>,
  rows: [{ id: 'result-1' }] as Array<{ id: string }>,
  total: 37,
  loading: false,
  error: null as Error | null,
  refetch: vi.fn(),
  guardCalls: [] as Array<Array<{ domain: string; actions: string[] }>>,
}))

vi.mock('../../modules/sports/results', () => ({
  useSportsResults: (filters: Record<string, unknown>) => {
    state.queryCalls.push(filters)
    return {
      data: { sportsResults: { items: state.rows, total: state.total } },
      loading: state.loading,
      error: state.error,
      refetch: state.refetch,
    }
  },
}))

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (value: { roles: string[] }) => unknown) => selector({ roles: state.roles }),
}))

vi.mock('@/shared/core/uiStore', () => ({
  useUIStore: (selector: (value: { directorMode: string }) => unknown) => selector({ directorMode: state.directorMode }),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, children }: { required: Array<{ domain: string; actions: string[] }>; children: ReactNode }) => {
    state.guardCalls.push(required)
    return state.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/shell/PageEyebrowContext', () => ({ usePageEyebrow: () => 'Trading' }))

vi.mock('./manual-results/components/StatsCards', () => ({ StatsCards: () => <div>Statistics ready</div> }))

vi.mock('./manual-results/components/FiltersBar', () => ({
  FiltersBar: ({ filters, onChangeFilters, onClearAll }: {
    filters: Record<string, unknown>
    onChangeFilters: (next: Record<string, unknown>) => void
    onClearAll: () => void
  }) => (
    <div>
      <span>Search value: {String(filters.search ?? '')}</span>
      <button type="button" onClick={() => onChangeFilters({ ...filters, search: '  goal  ', page: 1 })}>Set search</button>
      <button type="button" onClick={onClearAll}>Clear all</button>
    </div>
  ),
}))

vi.mock('./manual-results/components/ResultsTable', () => ({
  ResultsTable: ({ results, fetching, error, onRefetch, footer }: {
    results: Array<{ id: string }>
    fetching: boolean
    error?: string
    onRefetch: () => void
    footer?: ReactNode
  }) => (
    <section aria-label="Results test double">
      <span>{fetching ? 'Loading rows' : `${results.length} rows`}</span>
      {error ? <span>{error}</span> : null}
      <button type="button" onClick={onRefetch}>Refresh rows</button>
      {footer}
    </section>
  ),
}))

vi.mock('./manual-results/components/DeclareResultDrawer', () => ({
  DeclareResultDrawer: ({ open, onClose }: { open: boolean; onClose: () => void }) => open ? (
    <div role="dialog" aria-label="Declare Sports Result"><button type="button" onClick={onClose}>Close declare</button></div>
  ) : null,
}))

vi.mock('./manual-results/components/AutoResultsSettingsDrawer', () => ({
  AutoResultsSettingsDrawer: ({ open, onClose }: { open: boolean; onClose: () => void }) => open ? (
    <div role="dialog" aria-label="Auto Results Settings"><button type="button" onClick={onClose}>Close settings</button></div>
  ) : null,
}))

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>
}

function renderPage(initial = '/sports/manual-results') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Location />
      <Routes>
        <Route path="/sports/manual-results" element={<ManualResultsPage />} />
        <Route path="/sports/events" element={<div>Events destination</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  state.allowed = true
  state.roles = ['Admin']
  state.directorMode = 'platform'
  state.queryCalls = []
  state.rows = [{ id: 'result-1' }]
  state.total = 37
  state.loading = false
  state.error = null
  state.refetch.mockReset().mockResolvedValue(undefined)
  state.guardCalls = []
})

describe('/sports/manual-results page orchestration', () => {
  test('renders the approved header, guard and initial list variables', () => {
    renderPage()
    assert.equal(screen.getByRole('heading', { level: 1, name: 'Sports Results' }).textContent, 'Sports Results')
    assert.ok(screen.queryByText('Manage results and auto result settings for sports markets') === null)
    assert.ok(screen.queryByText('Trading') === null)
    assert.deepEqual(state.guardCalls[0], [{ domain: 'sports.results', actions: ['view'] }])
    assert.deepEqual(state.queryCalls.at(-1), {
      sportId: undefined, leagueId: undefined, eventId: undefined, marketId: undefined,
      marketType: undefined, dateFrom: undefined, dateTo: undefined, search: undefined,
      rolledBack: undefined, page: 1, limit: 20, sort: 'createdAt:desc',
    })
  })

  test('does not start page work when the RBAC guard denies access', () => {
    state.allowed = false
    renderPage()
    assert.ok(screen.getByRole('alert'))
    assert.equal(state.queryCalls.length, 0)
  })

  test('opens and closes both page drawers', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Declare Result' }))
    assert.ok(screen.getByRole('dialog', { name: 'Declare Sports Result' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close declare' }))
    assert.equal(screen.queryByRole('dialog', { name: 'Declare Sports Result' }), null)
    fireEvent.click(screen.getByRole('button', { name: 'Auto Results Settings' }))
    assert.ok(screen.getByRole('dialog', { name: 'Auto Results Settings' }))
  })

  test('sends trimmed two-character search and Clear all restores the full defaults', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Set search' }))
    assert.equal(state.queryCalls.at(-1)?.search, 'goal')
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    const last = state.queryCalls.at(-1)
    assert.equal(last?.search, undefined)
    assert.equal(last?.limit, 20)
    assert.equal(last?.sort, 'createdAt:desc')
  })

  test('wires refresh and the embedded pager without losing page size', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh rows' }))
    assert.equal(state.refetch.mock.calls.length, 1)
    const pageSize = screen.getByLabelText(/Rows per page/)
    fireEvent.change(pageSize, { target: { value: '50' } })
    await waitFor(() => assert.equal(state.queryCalls.at(-1)?.limit, 50))
    assert.equal(state.queryCalls.at(-1)?.page, 1)
  })

  test('reports an empty list error to the table double', () => {
    state.rows = []
    state.error = new Error('server unavailable')
    renderPage()
    assert.ok(screen.getByText('Failed to load results: server unavailable'))
  })

  test('redirects Super Admin whitelabel mode to sports events before rendering queries', async () => {
    state.roles = ['Super Admin']
    state.directorMode = 'whitelabel'
    renderPage()
    await waitFor(() => assert.equal(screen.getByTestId('location').textContent, '/sports/events'))
    assert.ok(screen.getByText('Events destination'))
  })
})
