import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import type { VIPTier } from '@/modules/vip/types'
import type { TableExportColumn } from '@/shared/utils/tableExport'
import VIPTiersPage from './TiersPage'

const mocks = vi.hoisted(() => ({
  allowed: true, loading: false, empty: false, query: vi.fn(), near: vi.fn(), export: vi.fn(), refetch: vi.fn(),
  issue: false, epochDates: false, error: undefined as Error | undefined, exportOptions: undefined as unknown,
}))
vi.mock('@/modules/vip', () => ({
  useVIPTiers: () => { mocks.query(); return { data: { vipTiers: mocks.empty ? [] : [
    { id: 'gold', name: 'Gold', level: 3, minMonthlyDeposit: 1000, color: 'gold', benefits: ['Bonus'], perks: [], status: 'draft', createdAt: mocks.epochDates ? String(Date.parse('2026-01-02T00:00:00Z')) : '2026-01-02' },
    { id: 'silver', name: 'Silver', level: 2, minMonthlyDeposit: 100, color: 'silver', benefits: ['Support'], perks: [], status: 'active', createdAt: mocks.epochDates ? String(Date.parse('2026-01-01T00:00:00Z')) : '2026-01-01' },
  ] }, loading: mocks.loading, error: mocks.error, refetch: mocks.refetch } },
  useVIPStats: () => ({ data: { vipStats: { totalMembers: 12, activeMembers: 10, totalPointsAwarded: 1000,
    tierDistribution: [{ tierId: 'silver', memberCount: 5, percentage: 41.667 }] } } }),
  useVIPNearNext: (threshold: number, limit: number) => { mocks.near(threshold, limit); return { data: {} } },
  useVIPValidate: () => ({ data: { vipTierValidate: mocks.issue ? [{ code: 'LEVEL', message: 'Duplicate level' }] : [] } }),
}))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({
  formatAmount: (value: number, currency: string) => `${currency} ${value}`, convertFromWhitelabelCurrency: (value: number) => value * 2, getWhitelabelBaseCurrencyCode: () => 'INR',
}) }))
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDate: (value: string | Date) => `date:${value instanceof Date ? value.toISOString() : value}`, formatTime: () => '10:00' }) }))
vi.mock('@/shared/core/RBACGuard', () => ({ RBACGuard: ({ children }: { children: ReactNode }) => mocks.allowed ? children : <div>Access denied</div> }))
vi.mock('@/shared/hooks/useTableExport', () => ({ useTableExport: (options: unknown) => {
  mocks.exportOptions = options; return { exporting: false, handleExport: mocks.export }
} }))
beforeEach(() => { vi.clearAllMocks(); mocks.allowed = true; mocks.loading = false; mocks.empty = false; mocks.issue = false; mocks.epochDates = false; mocks.error = undefined })
afterEach(cleanup)
function page() { return render(<MemoryRouter><PageEyebrowProvider value="VIP"><VIPTiersPage /></PageEyebrowProvider></MemoryRouter>) }
describe('VIP tiers overview', () => {
  test.each([false, true])('renders and exports real dates for ISO and GraphQL epoch timestamps (epoch=%s)', (epoch) => {
    mocks.epochDates = epoch
    page()
    assert.ok(screen.getByText('date:2026-01-01T00:00:00.000Z'))
    assert.ok(screen.getByText('date:2026-01-02T00:00:00.000Z'))
    const options = mocks.exportOptions as { data: VIPTier[]; columns: TableExportColumn<VIPTier>[] }
    const created = options.columns.find(column => column.key === 'createdAt')!
    assert.equal(created.getter?.(options.data[0]), 'date:2026-01-01T00:00:00.000Z')
  })
  test('sorts by level, shows live member distribution and retains all navigation destinations', () => {
    page()
    assert.deepEqual(mocks.near.mock.calls[0], [0.2, 8])
    const links = screen.getAllByRole('link').filter((link) => link.textContent === 'Edit')
    assert.deepEqual(links.map((link) => link.getAttribute('href')), ['/vip/tiers/silver/edit', '/vip/tiers/gold/edit'])
    assert.equal(screen.getByRole('link', { name: 'Add Tier' }).getAttribute('href'), '/vip/tiers/create')
    assert.ok(screen.getByText('INR 200')); assert.ok(screen.getByText('41.7%'))
    assert.ok(screen.getByText('All good. No validation issues.'))
  })
  test('export preserves sorted records, workbook metadata and raw deposit values', () => {
    page()
    const options = mocks.exportOptions as { data: VIPTier[]; columns: TableExportColumn<VIPTier>[]; filename: string; sheetName: string }
    assert.deepEqual(options.data.map((tier) => tier.id), ['silver', 'gold'])
    assert.equal(options.filename, 'VIP-Tiers'); assert.equal(options.sheetName, 'VIP Tiers')
    assert.equal(options.columns.find((column) => column.key === 'minMonthlyDeposit')?.getter?.(options.data[0]), 100)
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' })); assert.equal(mocks.export.mock.calls.length, 1)
  })
  test('denied access skips all query hooks and empty/loading states disable export', () => {
    mocks.allowed = false; const first = page(); assert.ok(screen.getByText('Access denied')); assert.equal(mocks.query.mock.calls.length, 0); first.unmount()
    mocks.allowed = true; mocks.empty = true; const second = page(); assert.ok(screen.getByText('No VIP Tiers Configured'))
    assert.equal(screen.getByRole('button', { name: 'Export Excel' }).getAttribute('aria-disabled'), 'true'); second.unmount()
    mocks.loading = true; page(); assert.equal(screen.getByRole('button', { name: 'Export Excel' }).getAttribute('aria-disabled'), 'true')
  })
  test('shows validation issues and stale-data query errors without hiding the records', () => {
    mocks.issue = true; mocks.error = new Error('Tier refresh unavailable'); page()
    assert.ok(screen.getByText('Duplicate level', { exact: false })); assert.ok(screen.getByText('Tier refresh unavailable'))
    assert.ok(screen.getByRole('link', { name: 'Edit Silver' }))
  })
})
