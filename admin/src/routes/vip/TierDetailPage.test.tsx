import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import VIPTierDetailPage from './TierDetailPage'

const mocks = vi.hoisted(() => ({
  allowed: true, loading: false, missing: false, add: vi.fn(), update: vi.fn(), refetch: vi.fn(), membersQuery: vi.fn(), toast: vi.fn(),
  members: [{ id: 'member-1', userName: 'Ravi', userEmail: 'ravi@example.test', userId: 'user-1', currentPoints: 150, nextTierId: 'gold', nextTierName: 'Gold', pointsToNextTier: 50 }],
}))
vi.mock('@/modules/vip', () => ({
  useVIPTiers: () => ({ data: { vipTiers: mocks.missing ? [] : [{ id: 'silver', name: 'Silver', level: 2, minMonthlyDeposit: 1000, color: 'silver', status: 'active', benefits: ['Priority support'], perks: [{ name: 'Weekly offer', description: 'Extra rewards' }] }] }, loading: mocks.loading }),
  useVIPMembers: (filters: unknown) => { mocks.membersQuery(filters); return { data: { vipMembers: mocks.members }, refetch: mocks.refetch } },
  useAddVIPPoints: () => [mocks.add, { loading: false }],
  useUpdateVIPMember: () => [mocks.update, { loading: false }],
}))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => `INR ${value}`, convertFromWhitelabelCurrency: (value: number) => value * 2 }) }))
vi.mock('@/shared/core/RBACGuard', () => ({ RBACGuard: ({ children }: { children: ReactNode }) => mocks.allowed ? children : <div>Access denied</div> }))
vi.mock('@/ui/components/toast', () => ({ toast: mocks.toast }))
beforeEach(() => {
  vi.clearAllMocks(); mocks.allowed = true; mocks.loading = false; mocks.missing = false
  mocks.add.mockResolvedValue({}); mocks.update.mockResolvedValue({})
})
afterEach(cleanup)
function page() { return render(<MemoryRouter initialEntries={['/vip/tiers/silver']}><PageEyebrowProvider value="VIP">
  <Routes><Route path="/vip/tiers/:id" element={<VIPTierDetailPage />} /></Routes>
</PageEyebrowProvider></MemoryRouter>) }
describe('VIP tier detail', () => {
  test('preserves member scope, currency conversion, benefits/perks and edit destination', () => {
    page(); assert.deepEqual(mocks.membersQuery.mock.calls[0], [{ tierId: 'silver' }])
    assert.ok(screen.getByText('INR 2000')); assert.ok(screen.getByText('Priority support')); assert.ok(screen.getByText('Extra rewards'))
    assert.equal(screen.getByRole('link', { name: 'Edit' }).getAttribute('href'), '/vip/tiers/silver/edit')
  })
  test('points and upgrade mutations retain exact inputs and refetch on success', async () => {
    page(); fireEvent.click(screen.getByRole('button', { name: 'Add 100 points to Ravi' }))
    await waitFor(() => assert.equal(mocks.refetch.mock.calls.length, 1))
    assert.deepEqual(mocks.add.mock.calls[0][0], { variables: { input: { memberId: 'member-1', points: 100, description: 'Nudge' } } })
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade Ravi' }))
    await waitFor(() => assert.equal(mocks.refetch.mock.calls.length, 2))
    assert.deepEqual(mocks.update.mock.calls[0][0], { variables: { input: { memberId: 'member-1', tierId: 'gold' } } })
  })
  test('mutation failure stays on the page and reports the error without refetching', async () => {
    mocks.add.mockRejectedValue(new Error('Points refused')); page()
    fireEvent.click(screen.getByRole('button', { name: 'Add 100 points to Ravi' }))
    await waitFor(() => assert.equal(mocks.toast.mock.calls[0][0].message, 'Points refused'))
    assert.equal(mocks.refetch.mock.calls.length, 0)
  })
  test('guard, loading and missing-tier states remain accessible', () => {
    mocks.allowed = false; const a = page(); assert.ok(screen.getByText('Access denied')); assert.equal(mocks.membersQuery.mock.calls.length, 0); a.unmount()
    mocks.allowed = true; mocks.loading = true; const b = page(); assert.ok(screen.getByText('Loading VIP tier')); b.unmount()
    mocks.loading = false; mocks.missing = true; page(); assert.ok(screen.getByText('VIP Tier not found'))
  })
})
