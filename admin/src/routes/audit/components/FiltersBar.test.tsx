import assert from 'node:assert/strict'
import { useState } from 'react'
import { beforeEach, test } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { useAuditStore, type AuditFilters } from '@/state/auditStore'
import { FiltersBar } from './FiltersBar'
const defaults: AuditFilters = { page: 4, limit: 50, sort: 'timestamp:desc' }
beforeEach(() => useAuditStore.setState({ savedPresets: [], recentSearches: ['recent actor'] }))
function page() {
  function Preview() { const [filters, setFilters] = useState(defaults); return <FiltersBar filters={filters} onFiltersChange={(next) => { useAuditStore.setState({ filters: { ...filters, ...next } }); setFilters((prior) => ({ ...prior, ...next })) }} onReset={() => setFilters(defaults)} /> }
  return render(<Preview />)
}
test('free-text debounce and suggestion selection retain recent searches and page reset', async () => {
  page(); fireEvent.change(screen.getByRole('combobox', { name: 'Search audit events' }), { target: { value: 'sport' } })
  await waitFor(() => assert.equal(useAuditStore.getState().filters.search, 'sport'))
  assert.equal(useAuditStore.getState().filters.page, 1)
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search audit events' }), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name: 'sports' })); assert.equal(useAuditStore.getState().filters.search, 'sports'); assert.equal(useAuditStore.getState().recentSearches[0], 'sports')
})
test('preset save, apply, rename, cancel and delete retain the full stored filter object', async () => {
  page(); fireEvent.change(screen.getByRole('textbox', { name: 'Actor ID' }), { target: { value: ' admin-1 ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Presets' })); fireEvent.click(await screen.findByRole('menuitem', { name: 'Save current filters' }))
  const dialog = await screen.findByRole('dialog', { name: 'Save filter preset' }); fireEvent.change(within(dialog).getByRole('textbox', { name: 'Preset name' }), { target: { value: '  Operator focus  ' } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => assert.equal(useAuditStore.getState().savedPresets.length, 1)); assert.deepEqual(useAuditStore.getState().savedPresets[0].filters, { ...defaults, page: 1, actorId: 'admin-1' })
  fireEvent.click(screen.getByRole('button', { name: 'Presets (1)' })); fireEvent.click(await screen.findByRole('menuitem', { name: 'Operator focus' })); assert.equal(useAuditStore.getState().filters.actorId, 'admin-1')
  fireEvent.click(screen.getByRole('button', { name: 'Presets (1)' })); fireEvent.click(await screen.findByRole('menuitem', { name: 'Manage presets' }))
  const manage = await screen.findByRole('dialog', { name: 'Manage presets' }); fireEvent.click(within(manage).getByRole('button', { name: 'Rename Operator focus' })); fireEvent.change(within(manage).getByRole('textbox', { name: 'Preset name' }), { target: { value: 'New name' } }); fireEvent.click(within(manage).getByRole('button', { name: 'Cancel' })); assert.equal(useAuditStore.getState().savedPresets[0].name, 'Operator focus')
  fireEvent.click(within(manage).getByRole('button', { name: 'Rename Operator focus' })); fireEvent.change(within(manage).getByRole('textbox', { name: 'Preset name' }), { target: { value: 'New name' } }); fireEvent.click(within(manage).getByRole('button', { name: 'Save' })); assert.equal(useAuditStore.getState().savedPresets[0].name, 'New name')
  fireEvent.click(within(manage).getByRole('button', { name: 'Delete New name' })); assert.equal(useAuditStore.getState().savedPresets.length, 0)
})
test('custom native dates apply IST day bounds only after both dates are supplied', () => {
  page(); fireEvent.change(screen.getByRole('combobox', { name: 'Time Range' }), { target: { value: 'custom' } })
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-02' } }); fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-10-09' } })
  assert.equal(useAuditStore.getState().filters.from, '2026-10-01T18:30:00.000Z'); assert.equal(useAuditStore.getState().filters.to, '2026-10-09T18:29:59.999Z')
})
