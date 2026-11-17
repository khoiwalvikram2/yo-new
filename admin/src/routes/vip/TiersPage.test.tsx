import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import type { VIPTier } from '@/modules/vip/types'
import type { TableExportColumn } from '@/shared/utils/tableExport'
import type { ConfirmOptions } from '@/ui/components/confirm'
import { useAuthStore } from '@/shared/core/authStore'
import VIPTiersPage from './TiersPage'

const mocks = vi.hoisted(() => ({
  allowed: true, loading: false, empty: false, query: vi.fn(), near: vi.fn(), export: vi.fn(), refetch: vi.fn(),
  issue: false, epochDates: false, error: undefined as Error | undefined, exportOptions: undefined as unknown,
  setStatus: vi.fn(), remove: vi.fn(), refetchValidate: vi.fn(), confirm: vi.fn(), toast: vi.fn(),
}))
vi.mock('@/modules/vip', () => ({
  useVIPTiers: () => { mocks.query(); return { data: { vipTiers: mocks.empty ? [] : [
    { id: 'gold', name: 'Gold', level: 3, minMonthlyDeposit: 1000, color: 'gold', benefits: ['Bonus'], perks: [], status: 'draft', createdAt: mocks.epochDates ? String(Date.parse('2026-01-02T00:00:00Z')) : '2026-01-02' },
    { id: 'silver', name: 'Silver', level: 2, minMonthlyDeposit: 100, color: 'silver', benefits: ['Support'], perks: [], status: 'active', createdAt: mocks.epochDates ? String(Date.parse('2026-01-01T00:00:00Z')) : '2026-01-01' },
  ] }, loading: mocks.loading, error: mocks.error, refetch: mocks.refetch } },
  useVIPStats: () => ({ data: { vipStats: { totalMembers: 12, activeMembers: 10, totalPointsAwarded: 1000,
    tierDistribution: [{ tierId: 'silver', memberCount: 5, percentage: 41.667 }] } } }),
  useVIPNearNext: (threshold: number, limit: number) => { mocks.near(threshold, limit); return { data: {} } },
  useVIPValidate: () => ({ data: { vipTierValidate: mocks.issue ? [{ code: 'LEVEL', message: 'Duplicate level' }] : [] }, refetch: mocks.refetchValidate, loading: false }),
  useSetVIPTierStatus: () => [mocks.setStatus],
  useDeleteVIPTier: () => [mocks.remove],
}))
vi.mock('@/ui/components/confirm', () => ({ confirm: mocks.confirm }))
vi.mock('@/ui/components/toast', () => ({ toast: mocks.toast }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({
  formatAmount: (value: number, currency: string) => `${currency} ${value}`, convertFromWhitelabelCurrency: (value: number) => value * 2, getWhitelabelBaseCurrencyCode: () => 'INR',
}) }))
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDate: (value: string | Date) => `date:${value instanceof Date ? value.toISOString() : value}`, formatTime: () => '10:00' }) }))
vi.mock('@/shared/core/RBACGuard', () => ({ RBACGuard: ({ children }: { children: ReactNode }) => mocks.allowed ? children : <div>Access denied</div> }))
vi.mock('@/shared/hooks/useTableExport', () => ({ useTableExport: (options: unknown) => {
  mocks.exportOptions = options; return { exporting: false, handleExport: mocks.export }
} }))
beforeEach(() => {
  vi.clearAllMocks(); mocks.allowed = true; mocks.loading = false; mocks.empty = false; mocks.issue = false; mocks.epochDates = false; mocks.error = undefined
  mocks.setStatus.mockReset(); mocks.remove.mockReset()
  useAuthStore.setState({ permissions: [] })
})
const lastConfirm = () => mocks.confirm.mock.calls.at(-1)?.[0] as ConfirmOptions
const TIER_ADMIN = [{ domain: 'vip.tiers', actions: ['view', 'update', 'delete'] }]
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
  test('Re-run reads the validation again instead of reloading the page', () => {
    page(); fireEvent.click(screen.getByRole('button', { name: 'Re-run' }))
    assert.equal(mocks.refetchValidate.mock.calls.length, 1)
  })
  test('each tier name opens its detail page (MAR-13)', () => {
    page()
    assert.equal(screen.getByRole('link', { name: 'Silver' }).getAttribute('href'), '/vip/tiers/silver')
    assert.equal(screen.getByRole('link', { name: 'Gold' }).getAttribute('href'), '/vip/tiers/gold')
  })
  test('offers no status change or delete to a role that cannot make them', () => {
    useAuthStore.setState({ permissions: [{ domain: 'vip.tiers', actions: ['view'] }] }); page()
    assert.equal(screen.queryByRole('button', { name: /^(Deactivate|Activate|Delete) / }), null)
  })
  test('deactivates an active tier and activates another behind a confirmation, said once (MAR-11)', async () => {
    useAuthStore.setState({ permissions: TIER_ADMIN })
    mocks.setStatus.mockResolvedValue({ data: { setVIPTierStatus: { success: true, message: 'VIP tier status set to inactive' } } })
    page()
    assert.ok(screen.getByRole('button', { name: 'Activate Gold' }), 'a draft tier offers Activate')
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Silver' }))
    const options = lastConfirm()
    assert.equal(options.title, 'Deactivate Silver?')
    assert.match(String(options.description), /Its members move to the tier their monthly deposits earn/)
    assert.equal(options.confirmLabel, 'Deactivate')
    assert.equal(mocks.setStatus.mock.calls.length, 0, 'nothing is sent before the confirmation')
    await options.onConfirm?.()
    assert.deepEqual(mocks.setStatus.mock.calls[0][0], { variables: { id: 'silver', status: 'inactive' }, context: { skipNotification: true } })
    assert.deepEqual(mocks.toast.mock.calls.map((call) => call[0]), [{ message: 'Silver deactivated', tone: 'ok' }])
    assert.equal(mocks.refetchValidate.mock.calls.length, 1)

    fireEvent.click(screen.getByRole('button', { name: 'Activate Gold' }))
    await lastConfirm().onConfirm?.()
    assert.deepEqual(mocks.setStatus.mock.calls[1][0].variables, { id: 'gold', status: 'active' })
  })
  test('a refused change keeps the confirmation open with the server reason and toasts nothing', async () => {
    useAuthStore.setState({ permissions: TIER_ADMIN })
    const reason = 'At least one VIP tier must stay active, because deposits use it. Activate another tier first.'
    mocks.setStatus.mockResolvedValue({ data: { setVIPTierStatus: { success: false, message: reason, tier: null } } })
    page(); fireEvent.click(screen.getByRole('button', { name: 'Deactivate Silver' }))
    await assert.rejects(Promise.resolve(lastConfirm().onConfirm?.()), (error: Error) => error.message === reason)
    assert.equal(mocks.toast.mock.calls.length, 0)
  })
  test('deletes behind a danger confirmation that warns a used tier must be deactivated instead', async () => {
    useAuthStore.setState({ permissions: TIER_ADMIN })
    mocks.remove.mockResolvedValue({ data: { deleteVIPTier: { success: true, message: 'VIP tier deleted successfully' } } })
    page(); fireEvent.click(screen.getByRole('button', { name: 'Delete Gold' }))
    const options = lastConfirm()
    assert.deepEqual([options.title, options.tone, options.confirmLabel], ['Delete Gold?', 'danger', 'Delete'])
    assert.match(String(options.description), /cannot be deleted: deactivate it instead/)
    await options.onConfirm?.()
    assert.deepEqual(mocks.remove.mock.calls[0][0], { variables: { id: 'gold' }, context: { skipNotification: true } })
    assert.deepEqual(mocks.toast.mock.calls.map((call) => call[0]), [{ message: 'Gold deleted', tone: 'ok' }])
  })
})
