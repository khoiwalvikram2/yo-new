import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { useAuthStore } from '@/shared/core/authStore'
import VIPCreateTierPage from './CreateTierPage'
import VIPEditTierPage from './EditTierPage'

const mocks = vi.hoisted(() => ({
  allowed: true, loading: false, missing: false, create: vi.fn(), update: vi.fn(), navigate: vi.fn(), query: vi.fn(),
}))
vi.mock('@/modules/vip', () => ({
  useCreateVIPTier: () => [mocks.create, { loading: false }],
  useUpdateVIPTier: () => [mocks.update, { loading: false }],
  useVIPTiers: () => { mocks.query(); return { data: { vipTiers: mocks.missing ? [] : [{ id: 'silver', name: 'Silver', level: 2, minMonthlyDeposit: 100, color: '#dddddd', benefits: ['Support'], perks: [{ name: 'Bonus', description: 'Weekly', icon: 'gift' }] }] }, loading: mocks.loading } },
}))
vi.mock('react-router-dom', async (importOriginal) => ({ ...await importOriginal<typeof import('react-router-dom')>(), useNavigate: () => mocks.navigate }))
vi.mock('@/shared/core/RBACGuard', () => ({ RBACGuard: ({ children }: { children: ReactNode }) => mocks.allowed ? children : <div>Access denied</div> }))
// The accounts picker reads payment methods over Apollo; here it hands back a fixed load.
vi.mock('@/modules/vip/components/VipTierAccountsPicker', () => ({
  VipTierAccountsPicker: ({ value, onChange, onAccounts }: { value: string[] | null; onChange: (ids: string[]) => void; onAccounts?: (a: unknown[]) => void }) => <div>
    <button type="button" onClick={() => { onAccounts?.([{ id: 'bank-1', label: 'Bank · Fixture ••0001', enabled: true, vipTierIds: null }]); onChange(['bank-1']) }}>Load accounts</button>
    <button type="button" onClick={() => onChange([])}>Clear accounts</button>
    <span>accounts:{value == null ? 'unloaded' : value.join(',') || 'none'}</span>
  </div>,
}))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({
  getWhitelabelBaseCurrencyCode: () => 'INR', getCurrencySymbol: () => '₹', formatAmount: (value: number) => `INR ${value}`, convertFromWhitelabelCurrency: (value: number) => value * 2,
}) }))
beforeEach(() => {
  vi.clearAllMocks(); mocks.allowed = true; mocks.loading = false; mocks.missing = false
  useAuthStore.setState({ permissions: [] })
  document.documentElement.style.setProperty('--vip-tier-default', '#6B7280')
  mocks.create.mockResolvedValue({ data: { createVIPTier: { success: true } } })
  mocks.update.mockResolvedValue({ data: { updateVIPTier: { success: true } } })
})
afterEach(() => { cleanup(); document.documentElement.style.removeProperty('--vip-tier-default') })
function page(edit = false) {
  return render(<MemoryRouter initialEntries={[edit ? '/vip/tiers/silver/edit' : '/vip/tiers/create']}><PageEyebrowProvider value="VIP">
    <Routes><Route path="/vip/tiers/create" element={<VIPCreateTierPage />} /><Route path="/vip/tiers/:id/edit" element={<VIPEditTierPage />} /></Routes>
  </PageEyebrowProvider></MemoryRouter>)
}
async function next(title: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  await waitFor(() => assert.ok(screen.getByRole('heading', { name: title })))
}
const DEPOSIT_POLICY = { enabled: true, methods: ['BANK_TRANSFER', 'UPI', 'GATEWAY'], min: null, max: null, daily: null, monthly: null }

describe('VIP create/edit wizard', () => {
  test('edits real deposit methods and limits and includes them in the save', async () => {
    page(true)
    fireEvent.change(screen.getByLabelText('Daily deposit limit'), { target: { value: '25000' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'UPI', exact: true }))
    await next('Tier Benefits'); await next('Exclusive Perks'); await next('Review')
    // Limits are entered in the whitelabel currency and shown converted, like the monthly deposit.
    assert.ok(screen.getByText('INR 50000')); assert.ok(screen.getByText('INR 200'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => assert.equal(mocks.update.mock.calls.length, 1))
    assert.deepEqual(mocks.update.mock.calls[0][0].variables.input.depositPolicy, {
      ...DEPOSIT_POLICY, methods: ['BANK_TRANSFER', 'GATEWAY'], daily: 25000,
    })
  })
  test('create validates required details, preserves array fields across steps and exact payloads', async () => {
    page(); fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => assert.ok(screen.getByText('Please enter tier name')))
    assert.equal(mocks.create.mock.calls.length, 0)
    fireEvent.change(screen.getByRole('textbox', { name: 'Tier Name' }), { target: { value: 'Gold' } })
    fireEvent.change(screen.getByLabelText(/^Tier Level/), { target: { value: '2.6' } })
    fireEvent.change(screen.getByLabelText(/^Minimum Monthly Deposit/), { target: { value: '150.4' } })
    await next('Tier Benefits'); fireEvent.click(screen.getByRole('button', { name: '+ Add Benefit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Benefit 1' }), { target: { value: ' VIP support ' } })
    await next('Exclusive Perks'); fireEvent.click(screen.getByRole('button', { name: '+ Add Perk' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Perk 1 Name' }), { target: { value: ' Bonus ' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Perk 1 Description' }), { target: { value: ' Weekly ' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Perk 1 Icon' }), { target: { value: 'gift' } })
    const previousNext = screen.getByRole('button', { name: 'Next' })
    await next('Review')
    assert.equal(previousNext.isConnected, false, 'Next must not become a submit button during its click')
    assert.equal(mocks.create.mock.calls.length, 0)
    fireEvent.click(screen.getByRole('button', { name: 'Create Tier' }))
    await waitFor(() => assert.equal(mocks.create.mock.calls.length, 1))
    assert.deepEqual(mocks.create.mock.calls[0][0], { variables: { input: {
      depositPolicy: DEPOSIT_POLICY, name: 'Gold', level: 3, minMonthlyDeposit: 150, color: '#6B7280', benefits: ['VIP support'], perks: [{ name: 'Bonus', description: 'Weekly', icon: 'gift' }],
    } } })
    assert.deepEqual(mocks.navigate.mock.calls[0], ['/vip/tiers'])
  })
  test('edit hydrates existing fields, keeps id separately and retains data on a refused mutation', async () => {
    page(true)
    assert.equal((screen.getByRole('textbox', { name: 'Tier Name' }) as HTMLInputElement).value, 'Silver')
    await next('Tier Benefits'); assert.equal((screen.getByRole('textbox', { name: 'Benefit 1' }) as HTMLInputElement).value, 'Support')
    await next('Exclusive Perks'); assert.equal((screen.getByRole('textbox', { name: 'Perk 1 Name' }) as HTMLInputElement).value, 'Bonus')
    await next('Review')
    mocks.update.mockResolvedValue({ data: { updateVIPTier: { success: false, message: 'Save refused' } } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => assert.ok(screen.getByText('Save refused')))
    assert.deepEqual(mocks.update.mock.calls[0][0], { variables: { id: 'silver', input: {
      depositPolicy: DEPOSIT_POLICY, name: 'Silver', level: 2, minMonthlyDeposit: 100, color: '#dddddd', benefits: ['Support'], perks: [{ name: 'Bonus', description: 'Weekly', icon: 'gift' }],
    } } })
    assert.equal(mocks.navigate.mock.calls.length, 0)
  })
  test('receiving accounts chosen in the tier form are saved with it, only with payment-method rights', async () => {
    const first = page(true)
    assert.equal(screen.queryByText('Load accounts'), null, 'no picker without payments.methods update')
    first.unmount()

    useAuthStore.setState({ permissions: [{ domain: 'payments.methods', actions: ['view', 'update'] }] })
    page(true)
    assert.ok(screen.getByText('accounts:unloaded'))
    fireEvent.click(screen.getByRole('button', { name: 'Load accounts' }))
    await next('Tier Benefits'); await next('Exclusive Perks'); await next('Review')
    assert.ok(screen.getByText('Bank · Fixture ••0001'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => assert.equal(mocks.update.mock.calls.length, 1))
    assert.deepEqual(mocks.update.mock.calls[0][0].variables.input.receivingAccountIds, ['bank-1'])
  })
  test('an account list that never loaded is left unchanged, not sent as empty', async () => {
    useAuthStore.setState({ permissions: [{ domain: 'payments.methods', actions: ['view', 'update'] }] })
    page(true)
    await next('Tier Benefits'); await next('Exclusive Perks'); await next('Review')
    assert.ok(screen.getByText('Unchanged (set in Payment Methods)'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => assert.equal(mocks.update.mock.calls.length, 1))
    assert.equal('receivingAccountIds' in mocks.update.mock.calls[0][0].variables.input, false)
  })
  test('denied edit starts no queries, with explicit loading and missing-tier states', () => {
    mocks.allowed = false; const first = page(true); assert.ok(screen.getByText('Access denied')); assert.equal(mocks.query.mock.calls.length, 0); first.unmount()
    mocks.allowed = true; mocks.loading = true; const second = page(true); assert.ok(screen.getByText('Loading VIP tier')); second.unmount()
    mocks.loading = false; mocks.missing = true; page(true); assert.ok(screen.getByText('Tier not found'))
  })
})
