import assert from 'node:assert/strict'
import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { test, vi } from 'vitest'
import type { AuditFilters } from '@/state/auditStore'
import { ColumnSettings } from './ColumnSettings'
import { AuditTableToolbar } from './AuditTableToolbar'
import { FilterChips } from './FilterChips'
import { AuditStatsCards } from './AuditStatsCards'
import type { AuditStatistics } from './auditStatsModel'

vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDate: (value: string) => value.slice(0, 10), formatDateTime: (value: string) => value.slice(0, 16) }) }))

test('column visibility, order, density and reset retain the existing callbacks', async () => {
  const close = vi.fn()
  const values: { columns?: string[]; order?: string[]; density?: string } = {}
  function Settings() {
    const [columns, setColumns] = useState(['id', 'actor'])
    const [order, setOrder] = useState(['id', 'actor'])
    const [density, setDensity] = useState<'small' | 'middle' | 'large'>('middle')
    return <ColumnSettings open onClose={close} visibleColumns={columns} columnOrder={order} tableDensity={density}
      onVisibleColumnsChange={(next) => { values.columns = next; setColumns(next) }} onColumnOrderChange={(next) => { values.order = next; setOrder(next) }} onTableDensityChange={(next) => { values.density = next; setDensity(next) }} />
  }
  render(<Settings />); await screen.findByRole('dialog', { name: 'Column Settings' })
  assert.equal((screen.getByRole('button', { name: 'Move ID up' }) as HTMLButtonElement).disabled, true)
  fireEvent.click(screen.getByRole('button', { name: 'Move Actor up' })); assert.deepEqual(values.order, ['actor', 'id'])
  fireEvent.click(screen.getByRole('checkbox', { name: 'Actor' })); assert.deepEqual(values.columns, ['id']); assert.deepEqual(values.order, ['id'])
  fireEvent.click(screen.getByRole('checkbox', { name: 'Action' })); assert.deepEqual(values.columns, ['id', 'action']); assert.deepEqual(values.order, ['id', 'action'])
  fireEvent.change(screen.getByRole('combobox', { name: 'Table Density' }), { target: { value: 'small' } }); assert.equal(values.density, 'small')
  fireEvent.click(screen.getByRole('button', { name: 'Reset to Defaults' })); assert.deepEqual(values.columns, ['expand', 'id', 'timestamp', 'actor', 'domain', 'action', 'resource', 'details']); assert.deepEqual(values.order, values.columns); assert.equal(values.density, 'middle')
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' })); assert.equal(close.mock.calls.length, 1)
})
test('each chip clears only its filter and resets pagination, including the last multi-value entry', () => {
  const change = vi.fn(); const clear = vi.fn()
  const filters: AuditFilters = { page: 3, limit: 100, sort: 'timestamp:desc', id: 'event-1', domain: ['sports', 'casino'], action: ['update'], actorId: 'actor-1', resourceType: ['player'], resourceId: 'player-1', from: '2026-10-01', to: '2026-10-09', search: 'hello' }
  const view = render(<FilterChips filters={filters} onFiltersChange={change} onClearAll={clear} />)
  const removals: [string, Partial<AuditFilters>][] = [
    ['ID: event-1', { id: undefined, page: 1 }], ['Domain: sports', { domain: ['casino'], page: 1 }], ['Action: update', { action: undefined, page: 1 }],
    ['Actor: actor-1', { actorId: undefined, page: 1 }], ['Resource: player', { resourceType: undefined, page: 1 }], ['Resource ID: player-1', { resourceId: undefined, page: 1 }],
    ['Date: 2026-10-01 - 2026-10-09', { from: undefined, to: undefined, page: 1 }], ['Search: hello', { search: undefined, page: 1 }],
  ]
  for (const [label, expected] of removals) {
    fireEvent.click(screen.getByRole('button', { name: `Remove ${label}` })); assert.deepEqual(change.mock.lastCall?.[0], expected)
  }
  fireEvent.click(screen.getByRole('button', { name: 'Clear All' })); assert.equal(clear.mock.calls.length, 1)
  view.rerender(<FilterChips filters={{ page: 1, limit: 100, sort: 'timestamp:desc' }} onFiltersChange={change} onClearAll={clear} />)
  assert.equal(screen.queryByRole('button'), null)
})
test('toolbar invokes only the selected action', () => {
  const column = vi.fn(); const print = vi.fn(); const refresh = vi.fn()
  render(<AuditTableToolbar eventsLength={2} total={81} onOpenColumnSettings={column} onPrint={print} onRefresh={refresh} />)
  screen.getByText('2 of 81 events')
  fireEvent.click(screen.getByRole('button', { name: 'Column Settings' })); fireEvent.click(screen.getByRole('button', { name: 'Print Table' })); fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  assert.equal(column.mock.calls.length, 1); assert.equal(print.mock.calls.length, 1); assert.equal(refresh.mock.calls.length, 1)
})
const statistics: AuditStatistics = { total: 1234, today: 12, uniqueActors: 8, byDomain: [{ domain: 'sports', count: 40 }, { domain: 'casino', count: 20 }], byAction: [{ action: 'update', count: 31 }], recentEvents: [{ id: '1', domain: 'sports', action: 'update', timestamp: '2026-10-09T12:00:00Z' }] }
test('statistics retain totals, distributions and the explicit sample-only chart scope', () => {
  render(<AuditStatsCards data={statistics} activeFilterCount={2} />)
  const figures = screen.getByRole('group', { name: 'Audit figures' }); within(figures).getByText('1,234'); within(figures).getByText('12'); within(figures).getByText('8'); within(figures).getByText('1')
  screen.getByText('Statistics reflect current filters (2 active).')
  within(screen.getByRole('list', { name: 'Domain event counts' })).getByText('sports: 40')
  within(screen.getByRole('list', { name: 'Action event counts' })).getByText('update: 31')
  screen.getByRole('heading', { name: 'Events Timeline (sample: 5 most recent)' }); screen.getByRole('heading', { name: 'Events by Hour (sample: 5 most recent)' })
})
test('loading, failure, empty distributions and stale-data warning remain distinct', () => {
  const view = render(<AuditStatsCards loading />); assert.equal(screen.getByRole('group', { name: 'Audit figures' }).getAttribute('aria-busy'), 'true')
  assert.deepEqual(screen.getAllByRole('status').map((status) => status.textContent), ['Loading domain chart', 'Loading action chart', 'Loading timeline chart', 'Loading hourly chart'])
  view.rerender(<AuditStatsCards error={{ message: 'offline' }} />); screen.getByText('Failed to load statistics: offline')
  view.rerender(<AuditStatsCards />); assert.equal(screen.getAllByText('No data').length, 2)
  view.rerender(<AuditStatsCards data={statistics} error={{ message: 'offline' }} />); screen.getByText(/Showing the last available figures/); screen.getByText('1,234')
})
