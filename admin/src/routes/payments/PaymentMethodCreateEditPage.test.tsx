import { gql } from '@apollo/client'
/**
 * /payments/methods/create and /payments/methods/edit/:type/:id against a mocked GraphQL server
 * (MockedProvider): the guard, the type choice, each wizard step and its rules, Enter as Next, the exact
 * upsert payload for every create/edit path, the refetch and return to the list, failures, the stored
 * record loading, and the QR image picker. The mocked server applies each upsert, as the backend would.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { GraphQLError } from 'graphql'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { UPSERT_WHITELABEL_PAYMENT_METHODS, WHITELABEL_PAYMENT_METHODS } from '@/lib/graphql/deposits'
import PaymentMethodCreateEditPage from './PaymentMethodCreateEditPage'
import type { StoredBank, StoredCrypto, StoredUpi } from './paymentMethodFormModel'

/** What an upsert sends. A bank or UPI save sends the four legacy keys; a wallet save only `cryptos`. */
interface UpsertVariables {
  input: {
    enabledMethods: string[]
    banks: Array<Record<string, unknown>>
    upis: Array<Record<string, unknown>>
    limits: { min: number; max: number }
    cryptos?: Array<Record<string, unknown>>
  }
}

const feedback = vi.hoisted(() => ({ toast: vi.fn(), compress: vi.fn() }))
const rbacCalls = vi.hoisted(() => [] as Array<{
  required: Array<{ domain: string; actions: string[] }>
  requireAny?: boolean
}>)
const rbacState = vi.hoisted(() => ({ allowed: true }))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number) => `INR ${amount.toFixed(2)}`,
    getCurrencySymbol: () => '₹',
  }),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({
    required,
    requireAny,
    children,
  }: {
    required: Array<{ domain: string; actions: string[] }>
    requireAny?: boolean
    children: ReactNode
  }) => {
    rbacCalls.push({ required, requireAny })
    return rbacState.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))
vi.mock('@/shared/utils/imageCompression', () => ({ compressImageToDataUrl: feedback.compress }))

const STORED_QR = 'data:image/png;base64,U1RPUkVE'
const NEW_QR = 'data:image/png;base64,TkVX'
const WALLET_QR = 'data:image/png;base64,V0FMTEVU'
const TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const EVM = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const TIER = '11111111-1111-4111-8111-111111111111'

interface ServerState {
  banks: StoredBank[]
  upis: StoredUpi[]
  cryptos: StoredCrypto[]
  cryptoRate: number | null
  queries: number
  upserts: UpsertVariables[]
  success: boolean
}

let server: ServerState

function initialBanks(): StoredBank[] {
  return [
    {
      id: 'b1', accountName: 'Vijay Kumar', accountNumber: '50100234567812', ifsc: 'HDFC0001204',
      bankName: 'HDFC Bank', branch: 'Andheri East', notes: 'IMPS only', minAmount: 100, maxAmount: 200000,
      weight: 3, enabled: true, vipTierIds: null,
    },
    {
      id: 'b2', accountName: 'Sunita Rathi', accountNumber: '000201004512', ifsc: 'ICIC0000412',
      bankName: 'ICICI Bank', branch: 'Koramangala', notes: null, minAmount: null, maxAmount: null,
      weight: 0, enabled: false, vipTierIds: null,
    },
  ]
}

function initialUpis(): StoredUpi[] {
  return [
    {
      id: 'u1', upiId: 'floxi@okaxis', displayName: 'Floxi Collections', qrKey: STORED_QR, qrUrl: STORED_QR,
      minAmount: 500, maxAmount: 100000, weight: 5, enabled: true, vipTierIds: null,
    },
  ]
}

function initialCryptos(): StoredCrypto[] {
  return [
    {
      id: 'c1', network: 'TRC20', walletAddress: TRON, displayName: 'Main Tron', qrKey: WALLET_QR, qrUrl: WALLET_QR,
      minAmount: 1000, maxAmount: null, weight: 4, enabled: true, vipTierIds: [TIER],
    },
  ]
}

function methodsPayload() {
  return {
    __typename: 'WhitelabelPaymentMethods',
    id: 'wpm-1',
    tenant: 'floxi',
    enabledMethods: ['BANK_TRANSFER', 'UPI'],
    banks: server.banks.map((bank) => ({
      __typename: 'BankDetails',
      id: bank.id,
      accountName: bank.accountName,
      accountNumber: bank.accountNumber,
      ifsc: bank.ifsc,
      bankName: bank.bankName,
      branch: bank.branch,
      notes: bank.notes ?? null,
      minAmount: bank.minAmount ?? null,
      maxAmount: bank.maxAmount ?? null,
      weight: bank.weight,
      enabled: bank.enabled ?? true,
      vipTierIds: bank.vipTierIds ?? null,
    })),
    upis: server.upis.map((upi) => ({
      __typename: 'UpiDetails',
      id: upi.id,
      upiId: upi.upiId,
      displayName: upi.displayName ?? null,
      qrKey: upi.qrKey ?? null,
      qrUrl: upi.qrUrl ?? null,
      minAmount: upi.minAmount ?? null,
      maxAmount: upi.maxAmount ?? null,
      weight: upi.weight,
      enabled: upi.enabled ?? true,
      vipTierIds: upi.vipTierIds ?? null,
    })),
    cryptos: server.cryptos.map((crypto) => ({
      __typename: 'CryptoDetails',
      id: crypto.id,
      network: crypto.network,
      walletAddress: crypto.walletAddress,
      displayName: crypto.displayName ?? null,
      qrKey: crypto.qrKey ?? null,
      qrUrl: crypto.qrUrl ?? null,
      minAmount: crypto.minAmount ?? null,
      maxAmount: crypto.maxAmount ?? null,
      weight: crypto.weight,
      enabled: crypto.enabled ?? true,
      vipTierIds: crypto.vipTierIds ?? null,
    })),
    cryptoRate: server.cryptoRate,
    cryptoBonusPercent: null,
    limits: { __typename: 'DepositLimits', min: 200, max: 250000 },
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  }
}

function queryMock(): MockedResponse {
  return {
    request: { query: WHITELABEL_PAYMENT_METHODS },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => {
      server.queries += 1
      return { data: { whitelabelPaymentMethods: methodsPayload() } }
    },
  }
}

function upsertMock(): MockedResponse {
  return {
    request: { query: UPSERT_WHITELABEL_PAYMENT_METHODS },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Record<string, unknown>) => {
      const sent = variables as unknown as UpsertVariables
      server.upserts.push(sent)
      // As the server: a list the input omits is kept as stored.
      if (server.success) {
        if (sent.input.banks) server.banks = sent.input.banks as unknown as StoredBank[]
        if (sent.input.upis) {
          server.upis = (sent.input.upis as unknown as StoredUpi[]).map((upi) => ({ ...upi, qrUrl: upi.qrKey ?? null }))
        }
        if (sent.input.cryptos) {
          server.cryptos = (sent.input.cryptos as unknown as StoredCrypto[]).map((crypto) => ({ ...crypto, qrUrl: crypto.qrKey ?? null }))
        }
      }
      return {
        data: {
          upsertWhitelabelPaymentMethods: {
            __typename: 'WhitelabelPaymentMethodsPayload',
            success: server.success,
            message: server.success ? 'Payment methods saved' : 'Duplicate account',
            paymentMethods: null,
          },
        },
      }
    },
  }
}

function failingUpsertMock(): MockedResponse {
  return {
    request: { query: UPSERT_WHITELABEL_PAYMENT_METHODS },
    variableMatcher: (variables) => {
      server.upserts.push(variables as unknown as UpsertVariables)
      return true
    },
    error: new Error('Upsert failed'),
  }
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function tierOptionsMock(): MockedResponse {
  return { request: { query: gql`query DepositVipTierOptions { vipTiers { id name level status } }` },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: { data: { vipTiers: [
      { __typename: 'VIPTier', id: '11111111-1111-4111-8111-111111111111', name: 'Bronze', level: 1, status: 'active' },
      { __typename: 'VIPTier', id: '22222222-2222-4222-8222-222222222222', name: 'Silver', level: 2, status: 'active' },
    ] } } }
}

function renderAt(path: string, mocks: MockedResponse[] = [queryMock(), upsertMock()]) {
  return render(
    <MockedProvider mocks={[...mocks, tierOptionsMock()]}>
      <MemoryRouter initialEntries={[path]}>
        <PageEyebrowProvider value="Payment operations">
          <Routes>
            <Route path="/payments/methods/create" element={<PaymentMethodCreateEditPage />} />
            <Route path="/payments/methods/edit/:type/:id" element={<PaymentMethodCreateEditPage />} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

test('a missing edited account shows a not-found state without an editable wizard', async () => {
  renderAt('/payments/methods/edit/bank/no-such-account')
  await screen.findByText('Payment method not found')
  assert.equal(screen.queryByRole('button', { name: 'Next' }), null)
  assert.equal(screen.queryByLabelText('UPI ID'), null)
  assert.equal(server.upserts.length, 0)
})

for (const path of ['/payments/methods/create?type=bank', '/payments/methods/edit/bank/b1']) test(`failed account reads block an incomplete save at ${path}`, async () => {
  renderAt(path, [{ request: { query: WHITELABEL_PAYMENT_METHODS }, error: new Error('Offline fixture') }])
  await screen.findByText('Unable to load payment methods')
  assert.ok(screen.getByRole('button', { name: 'Retry' }))
  assert.equal(screen.queryByRole('button', { name: 'Next' }), null)
  assert.equal(server.upserts.length, 0)
})

test('a selected create type waits for saved accounts before allowing edits', async () => {
  renderAt('/payments/methods/create?type=bank', [{ ...queryMock(), delay: 150 }, upsertMock()])
  await screen.findByText('Loading payment methods')
  assert.equal(screen.queryByRole('button', { name: 'Next' }), null)
  await screen.findByRole('button', { name: 'Next' })
  assert.equal(server.upserts.length, 0)
})

function textbox(name: RegExp) {
  return screen.getByRole('textbox', { name }) as HTMLInputElement
}

function type(name: RegExp, value: string) {
  fireEvent.change(textbox(name), { target: { value } })
}

function button(name: string | RegExp) {
  return screen.getByRole('button', { name })
}

function currentStep() {
  const steps = within(screen.getByRole('navigation', { name: 'Form steps' })).getAllByRole('listitem')
  return steps.find((step) => step.getAttribute('aria-current') === 'step')?.textContent ?? ''
}

function fillBankDetails() {
  type(/^Account Name/, '  Meena Patel ')
  type(/^Account Number/, '3221004567')
  type(/^IFSC Code/, 'SBIN0001234')
  type(/^Bank Name/, 'State Bank of India')
  type(/^Branch/, 'Navrangpura')
}

async function nextStep(expected: string) {
  fireEvent.click(button('Next'))
  await waitFor(() => assert.match(currentStep(), new RegExp(expected)))
}

test('a restricted receiving account saves selected VIP tiers and rejects an empty selection', async () => {
  renderAt('/payments/methods/create?type=bank')
  await screen.findByRole('button', { name: 'Next' })
  fillBankDetails()
  await nextStep('Limits')
  // A string name is matched exactly by role queries already (ByRole has no `exact` option).
  fireEvent.change(screen.getByRole('combobox', { name: 'VIP tier access' }), { target: { value: 'SELECTED' } })
  fireEvent.click(button('Next'))
  await screen.findByText('Choose at least one VIP tier')
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Silver (L2)' }))
  await nextStep('Review')
  fireEvent.click(button('Create Bank Account'))
  await screen.findByTestId('location')
  await waitFor(() => assert.equal(server.upserts.length, 1))
  const account = server.upserts[0].input.banks.at(-1)!
  assert.deepEqual(account.vipTierIds, ['22222222-2222-4222-8222-222222222222'])
})

async function listLoaded() {
  await waitFor(() => assert.equal(server.queries, 1))
}

function pickFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  assert.ok(input, 'the hidden file input is present')
  fireEvent.change(input, { target: { files: [file] } })
}

const IMAGE = new File(['png'], 'qr.png', { type: 'image/png' })

beforeEach(() => {
  server = {
    banks: initialBanks(),
    upis: initialUpis(),
    cryptos: initialCryptos(),
    cryptoRate: 92.5,
    queries: 0,
    upserts: [],
    success: true,
  }
  rbacCalls.length = 0
  rbacState.allowed = true
  feedback.toast.mockReset()
  feedback.compress.mockReset()
  feedback.compress.mockResolvedValue(NEW_QR)
})

describe('PaymentMethodCreateEditPage create', () => {
  test('asks for the type first, then shows the bank step with the legacy fields and copy', async () => {
    renderAt('/payments/methods/create')
    await screen.findByRole('heading', { name: 'Select Payment Method Type' })

    assert.deepStrictEqual(rbacCalls.at(-1), {
      required: [{ domain: 'payments.methods', actions: ['create', 'update'] }],
      requireAny: undefined,
    })
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Add Payment Method' }))
    assert.ok(screen.queryByText('Add a new bank account or UPI account for deposits') === null)
    assert.ok(screen.queryByText('Payment operations') === null)
    assert.ok(screen.queryByRole('link', { name: 'Back' }) === null)
    assert.equal(screen.getByRole('link', { name: 'Back to list' }).getAttribute('href'), '/payments/methods')
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Select Payment Method Type' }))
    assert.ok(screen.getByText('Choose the type of payment method you want to add'))
    assert.equal(screen.queryByRole('navigation', { name: 'Form steps' }), null)

    fireEvent.click(button(/Bank Account/))
    assert.match(currentStep(), /1Bank Details/)
    assert.ok(screen.getByRole('group', { name: 'Bank Details' }))
    assert.ok(screen.getByText('Step 1 of 3'))
    for (const [label, placeholder] of [
      [/^Account Name/, 'Account holder name'],
      [/^Account Number/, 'Account number'],
      [/^IFSC Code/, 'e.g. SBIN0001234'],
      [/^Bank Name/, 'Bank name'],
      [/^Branch/, 'Branch name'],
      [/^Notes \(Optional\)/, 'Additional instructions for users'],
    ] as const) {
      assert.equal(textbox(label).getAttribute('placeholder'), placeholder, String(label))
    }
    assert.equal(textbox(/^Account Name/).getAttribute('aria-required'), 'true')
    assert.equal(textbox(/^Notes/).getAttribute('aria-required'), null)
    assert.ok(button('Cancel'))
  })

  test('Next names the empty required fields and focuses the first; Enter moves on like Next', async () => {
    renderAt('/payments/methods/create?type=bank')
    await screen.findByRole('button', { name: 'Next' })
    assert.ok(screen.getByRole('group', { name: 'Bank Details' }), 'the link type skips the choice')

    fireEvent.click(button('Next'))
    await waitFor(() => assert.equal(screen.getAllByText('Required').length, 5))
    await waitFor(() => assert.ok(document.activeElement === textbox(/^Account Name/), 'first empty field focused'))
    assert.match(currentStep(), /Bank Details/)

    fillBankDetails()
    fireEvent.submit(button('Next').closest('form') as HTMLFormElement)
    await waitFor(() => assert.match(currentStep(), /Limits/))
    assert.ok(screen.getByRole('group', { name: 'Limits & Priority' }))
    assert.ok(screen.getByText('Set account amount limits, VIP access and display priority.'))
    assert.ok(screen.getByText('Step 2 of 3'))
    assert.equal(server.upserts.length, 0)
  })

  test('limits: the max-below-min rule, a whole weight, the status, then the review rows', async () => {
    renderAt('/payments/methods/create?type=bank')
    await screen.findByRole('button', { name: 'Next' })
    fillBankDetails()
    await nextStep('Limits')

    assert.equal(textbox(/^Min Amount \(₹\)/).getAttribute('placeholder'), 'No minimum')
    // NumberField states its range after the legacy help text ("Minimum: 0.").
    assert.ok(screen.getByText('Leave empty for no minimum Minimum: 0.'))
    assert.ok(screen.getByText('Leave empty for no extra account limit. Minimum: 0.'))
    assert.ok(screen.getByText('Higher = shown first in same tier Minimum: 0.'))
    assert.ok(screen.getByText('Toggle availability for deposits'))
    type(/^Min Amount/, '500')
    type(/^Max Amount/, '100')
    fireEvent.click(button('Next'))
    assert.ok(await screen.findByText('Must be > min'))

    type(/^Max Amount/, '200000')
    type(/^Priority Weight/, '2.5')
    fireEvent.click(button('Next'))
    assert.ok(await screen.findByText('Enter a whole number'))
    await waitFor(() => assert.ok(screen.queryByText('Must be > min') === null))

    type(/^Priority Weight/, '3')
    const active = screen.getByRole('switch', { name: 'Active' })
    assert.equal(active.getAttribute('aria-checked'), 'true')
    fireEvent.click(active)
    assert.ok(screen.getByText('Inactive'))
    await nextStep('Review')

    assert.ok(screen.getByRole('heading', { level: 2, name: 'Review & Save' }))
    assert.ok(screen.getByText('Confirm details before saving. Go back to edit anything.'))
    const details = screen.getByRole('heading', { level: 3, name: 'Bank Details' }).closest('section') as HTMLElement
    for (const [term, value] of [
      ['Account Name', '  Meena Patel '], ['Account No.', '3221004567'], ['IFSC', 'SBIN0001234'],
      ['Bank', 'State Bank of India'], ['Branch', 'Navrangpura'],
    ]) {
      assert.ok(within(details).getByText(term), term)
      assert.ok(within(details).getByText((_, element) => element?.tagName === 'DD' && element.textContent === value), value)
    }
    assert.equal(within(details).queryByText('Notes'), null)
    const limits = screen.getByRole('heading', { level: 3, name: 'Limits & Priority' }).closest('section') as HTMLElement
    for (const value of ['INR 500.00', 'INR 200000.00', '3', 'Inactive']) {
      assert.ok(within(limits).getByText(value), value)
    }
    assert.ok(screen.getByText('Ensure required fields are complete', { exact: false }))
    assert.ok(button('Create Bank Account'))

    fireEvent.click(button('Previous'))
    await waitFor(() => assert.match(currentStep(), /Limits/))
    assert.equal(textbox(/^Priority Weight/).value, '3', 'values survive the step change')
  })

  test('creating a bank appends it to the stored list, refetches it and returns to the list', async () => {
    renderAt('/payments/methods/create?type=bank')
    await screen.findByRole('button', { name: 'Next' })
    await listLoaded()
    fillBankDetails()
    await nextStep('Limits')
    type(/^Max Amount/, '50000')
    const previousNext = button('Next')
    await nextStep('Review')
    assert.equal(previousNext.isConnected, false, 'Next must not morph into submit during activation')
    assert.equal(server.upserts.length, 0)
    fireEvent.click(button('Create Bank Account'))

    assert.equal((await screen.findByTestId('location')).textContent, '/payments/methods')
    assert.equal(server.upserts.length, 1)
    const { input } = server.upserts[0] as UpsertVariables
    assert.deepStrictEqual(Object.keys(input), ['enabledMethods', 'banks', 'upis', 'limits'])
    assert.deepStrictEqual(input.enabledMethods, ['BANK_TRANSFER', 'UPI'])
    assert.deepStrictEqual(input.limits, { min: 200, max: 250000 })
    assert.deepStrictEqual(input.banks.map((bank) => bank.id).slice(0, 2), ['b1', 'b2'])
    const created = input.banks[2] as Record<string, unknown>
    assert.match(String(created.id), /^bank-\d+$/)
    assert.deepStrictEqual({ ...created, id: 'new' }, {
      id: 'new', accountName: 'Meena Patel', accountNumber: '3221004567', ifsc: 'SBIN0001234',
      bankName: 'State Bank of India', branch: 'Navrangpura', notes: null, minAmount: null, maxAmount: 50000,
      weight: 0, enabled: true, vipTierIds: null,
    })
    assert.ok(input.banks.every((bank) => !('__typename' in bank)))
    assert.deepStrictEqual(input.upis, [{
      id: 'u1', upiId: 'floxi@okaxis', displayName: 'Floxi Collections', qrKey: STORED_QR, minAmount: 500,
      maxAmount: 100000, weight: 5, enabled: true, vipTierIds: null,
    }])
    assert.equal(server.queries, 2, 'the list was refetched before returning')
    assert.equal(feedback.toast.mock.calls.length, 0)
  })

  test('a thrown save stays on the form with its message; a refused save stays without one', async () => {
    renderAt('/payments/methods/create?type=upi', [queryMock(), failingUpsertMock()])
    await screen.findByRole('button', { name: 'Next' })
    await listLoaded()
    type(/^UPI ID/, 'desk@ybl')
    await nextStep('Limits')
    await nextStep('Review')
    fireEvent.click(button('Create UPI Account'))

    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], { message: 'Upsert failed', tone: 'error' })
    assert.ok(button('Create UPI Account'))
    assert.equal(screen.queryByTestId('location'), null)
  })

  test('a save the server refuses keeps the form open', async () => {
    server.success = false
    renderAt('/payments/methods/create?type=upi')
    await screen.findByRole('button', { name: 'Next' })
    await listLoaded()
    type(/^UPI ID/, 'desk@ybl')
    await nextStep('Limits')
    await nextStep('Review')
    fireEvent.click(button('Create UPI Account'))

    await waitFor(() => assert.equal(server.upserts.length, 1))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    assert.equal(screen.queryByTestId('location'), null)
    assert.ok(button('Create UPI Account'))
  })

  test('creating a UPI sends its picked QR image as the stored key', async () => {
    renderAt('/payments/methods/create?type=upi')
    await screen.findByRole('button', { name: 'Next' })
    await listLoaded()
    assert.ok(screen.getByRole('group', { name: 'UPI Details' }))
    assert.equal(textbox(/^UPI ID/).getAttribute('placeholder'), 'e.g. merchant@paytm')
    assert.equal(textbox(/^Display Name \(Optional\)/).getAttribute('placeholder'), 'Display name for UPI')
    assert.ok(screen.getByRole('group', { name: 'QR Code Image' }))
    assert.ok(screen.getByText('Ready to save'))

    fireEvent.click(button('Next'))
    assert.ok(await screen.findByText('Required'))

    type(/^UPI ID/, 'desk@ybl')
    pickFile(IMAGE)
    await waitFor(() => assert.ok(screen.getByText('Preview — ready to save')))
    assert.deepStrictEqual(feedback.compress.mock.calls[0], [IMAGE, 'qr'])
    assert.equal((screen.getByAltText('UPI QR Code') as HTMLImageElement).getAttribute('src'), NEW_QR)
    assert.ok(button('Change QR Code'))
    await nextStep('Limits')
    await nextStep('Review')
    const details = screen.getByRole('heading', { level: 3, name: 'UPI Details' }).closest('section') as HTMLElement
    assert.ok(within(details).getByText('Attached'))
    fireEvent.click(button('Create UPI Account'))

    assert.equal((await screen.findByTestId('location')).textContent, '/payments/methods')
    const created = (server.upserts[0] as UpsertVariables).input.upis[1] as Record<string, unknown>
    assert.match(String(created.id), /^upi-\d+$/)
    assert.deepStrictEqual({ ...created, id: 'new' }, {
      id: 'new', upiId: 'desk@ybl', displayName: null, qrKey: NEW_QR, minAmount: null, maxAmount: null, weight: 0,
      enabled: true, vipTierIds: null,
    })
  })

  test('refuses a non-image file and reports an image that cannot be processed', async () => {
    renderAt('/payments/methods/create?type=upi')
    await screen.findByRole('button', { name: 'Next' })
    pickFile(new File(['%PDF'], 'qr.pdf', { type: 'application/pdf' }))
    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], { message: 'You can only upload image files!', tone: 'error' })
    assert.equal(feedback.compress.mock.calls.length, 0)

    feedback.compress.mockRejectedValueOnce(new Error('Image is too large'))
    pickFile(IMAGE)
    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 2))
    assert.deepStrictEqual(feedback.toast.mock.calls[1]?.[0], { message: 'Image is too large', tone: 'error' })
    assert.equal(screen.queryByAltText('UPI QR Code'), null)
    assert.ok(button('Select QR Code'))
  })

  test('a tier link pre-fills the max amount and names the tier', async () => {
    renderAt('/payments/methods/create?type=bank&maxAmount=50000')
    await screen.findByRole('button', { name: 'Next' })
    fillBankDetails()
    await nextStep('Limits')
    assert.equal(textbox(/^Max Amount/).value, '50,000')
    assert.ok(screen.getByText('Adding to tier:'))
    assert.ok(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === 'Adding to tier: Max amount INR 50000.00'))
  })

  test('Cancel returns to the list', async () => {
    renderAt('/payments/methods/create?type=bank')
    await screen.findByRole('button', { name: 'Next' })
    fireEvent.click(button('Cancel'))
    assert.equal((await screen.findByTestId('location')).textContent, '/payments/methods')
  })

  test('the guard stops the page before any query', async () => {
    rbacState.allowed = false
    renderAt('/payments/methods/create?type=bank')
    assert.match(screen.getByRole('alert').textContent ?? '', /Access denied/)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    assert.equal(server.queries, 0)
    assert.equal(screen.queryByRole('heading', { level: 1 }), null)
  })
})

describe('PaymentMethodCreateEditPage edit', () => {
  test('waits for the stored record, then edits the bank in place', async () => {
    renderAt('/payments/methods/edit/bank/b1')
    assert.ok(screen.getByText('Loading payment method'))
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Edit Payment Method' }))
    assert.ok(await screen.findByRole('heading', { level: 1, name: 'Edit Bank Account' }))
    assert.ok(screen.queryByText('Update bank account details') === null)
    assert.equal(textbox(/^Account Name/).value, 'Vijay Kumar')
    assert.equal(textbox(/^Notes/).value, 'IMPS only')

    type(/^Branch/, 'Powai')
    await nextStep('Limits')
    assert.ok(screen.getByText('Update account amount limits, VIP access and display priority.'))
    assert.equal(textbox(/^Min Amount/).value, '100')
    assert.equal(textbox(/^Priority Weight/).value, '3')
    assert.ok(screen.queryByText('Adding to tier:') === null)
    await nextStep('Review')
    const details = screen.getByRole('heading', { level: 3, name: 'Bank Details' }).closest('section') as HTMLElement
    assert.ok(within(details).getByText('Notes'))
    fireEvent.click(button('Update Bank Account'))

    assert.equal((await screen.findByTestId('location')).textContent, '/payments/methods')
    const { input } = server.upserts[0] as UpsertVariables
    assert.deepStrictEqual(input.banks, [
      {
        id: 'b1', accountName: 'Vijay Kumar', accountNumber: '50100234567812', ifsc: 'HDFC0001204',
        bankName: 'HDFC Bank', branch: 'Powai', notes: 'IMPS only', minAmount: 100, maxAmount: 200000, weight: 3,
        enabled: true, vipTierIds: null,
      },
      {
        id: 'b2', accountName: 'Sunita Rathi', accountNumber: '000201004512', ifsc: 'ICIC0000412',
        bankName: 'ICICI Bank', branch: 'Koramangala', notes: null, minAmount: null, maxAmount: null, weight: 0,
        enabled: false, vipTierIds: null,
      },
    ])
  })

  test('a UPI shows its stored QR; Remove after picking a new one keeps the stored key', async () => {
    renderAt('/payments/methods/edit/upi/u1')
    assert.ok(await screen.findByRole('heading', { level: 1, name: 'Edit UPI Account' }))
    assert.ok(screen.queryByText('Update UPI account details') === null)
    assert.equal(textbox(/^UPI ID/).value, 'floxi@okaxis')
    assert.equal((screen.getByAltText('UPI QR Code') as HTMLImageElement).getAttribute('src'), STORED_QR)
    assert.ok(screen.getByText('Saved'))
    assert.ok(screen.getByText('Current QR code'))
    assert.ok(button('Change QR Code'))

    pickFile(IMAGE)
    await waitFor(() => assert.ok(screen.getByText('Preview — ready to save')))
    assert.ok(screen.queryByText('Saved') === null)
    fireEvent.click(button('Remove'))
    await waitFor(() => assert.ok(screen.getByText('Current QR code')))
    assert.equal((screen.getByAltText('UPI QR Code') as HTMLImageElement).getAttribute('src'), STORED_QR)

    await nextStep('Limits')
    await nextStep('Review')
    fireEvent.click(button('Update UPI Account'))
    assert.equal((await screen.findByTestId('location')).textContent, '/payments/methods')
    assert.deepStrictEqual((server.upserts[0] as UpsertVariables).input.upis, [{
      id: 'u1', upiId: 'floxi@okaxis', displayName: 'Floxi Collections', qrKey: STORED_QR, minAmount: 500,
      maxAmount: 100000, weight: 5, enabled: true, vipTierIds: null,
    }])
  })

  test('a stored QR that cannot be shown (legacy value or failed load) is a placeholder naming it, with how to replace it (SYS-18)', async () => {
    // A legacy value the server can no longer serve: qrUrl comes back null while qrKey is still stored.
    server.upis = [{ ...initialUpis()[0], qrKey: 'qr/u1.png', qrUrl: null }]
    const view = renderAt('/payments/methods/edit/upi/u1')
    assert.ok(await screen.findByRole('heading', { level: 1, name: 'Edit UPI Account' }))
    assert.equal(screen.queryByAltText('UPI QR Code'), null)
    assert.ok(screen.getByRole('img', { name: 'UPI QR Code' }).hasAttribute('data-image-placeholder'))
    assert.ok(screen.getByText('Cannot be shown. Choose the QR code again to replace it.'))
    assert.equal(screen.queryByText(/Generating URL/), null)
    assert.ok(button('Change QR Code'))
    view.unmount()

    // A stored QR whose image will not load turns into the same placeholder and note.
    server.upis = initialUpis()
    renderAt('/payments/methods/edit/upi/u1')
    assert.ok(await screen.findByRole('heading', { level: 1, name: 'Edit UPI Account' }))
    fireEvent.error(screen.getByAltText('UPI QR Code'))
    assert.equal(screen.queryByAltText('UPI QR Code'), null)
    assert.ok(screen.getByRole('img', { name: 'UPI QR Code' }))
    assert.ok(screen.getByText('Cannot be shown. Choose the QR code again to replace it.'))
    assert.equal(screen.queryByText('Failed to load'), null)
  })

  test('a UPI saved with a newly picked image sends the new key', async () => {
    renderAt('/payments/methods/edit/upi/u1')
    assert.ok(await screen.findByRole('heading', { level: 1, name: 'Edit UPI Account' }))
    pickFile(IMAGE)
    await waitFor(() => assert.ok(screen.getByText('Preview — ready to save')))
    await nextStep('Limits')
    await nextStep('Review')
    fireEvent.click(button('Update UPI Account'))
    assert.equal((await screen.findByTestId('location')).textContent, '/payments/methods')
    assert.equal((server.upserts[0] as UpsertVariables).input.upis[0]?.qrKey, NEW_QR)
  })
})

function networkSelect() {
  return screen.getByRole('combobox', { name: /^USDT Network/ }) as HTMLSelectElement
}

describe('PaymentMethodCreateEditPage crypto wallets', () => {
  test('the type choice offers a crypto wallet, which opens the wallet step', async () => {
    renderAt('/payments/methods/create')
    await screen.findByRole('heading', { name: 'Select Payment Method Type' })
    assert.ok(screen.getByText('Add USDT wallet for deposits'))
    fireEvent.click(button(/Crypto Wallet/))

    assert.match(currentStep(), /1Wallet Details/)
    assert.ok(screen.getByRole('group', { name: 'Wallet Details' }))
    assert.equal(networkSelect().value, 'TRC20', 'a new wallet starts on Tron')
    assert.deepStrictEqual([...networkSelect().options].map((option) => [option.value, option.text]), [
      ['TRC20', 'TRC20 (Tron)'],
      ['BEP20', 'BEP20 (BNB Smart Chain)'],
      ['ERC20', 'ERC20 (Ethereum)'],
      ['POLYGON', 'Polygon'],
      ['SOLANA', 'Solana'],
      ['TON', 'TON'],
    ])
    assert.equal(textbox(/^Display Name \(Optional\)/).getAttribute('placeholder'), 'USDT (TRC20)')
    assert.equal(textbox(/^Wallet Address/).getAttribute('placeholder'), 'Paste the wallet address')
    assert.equal(textbox(/^Wallet Address/).getAttribute('aria-required'), 'true')
    assert.ok(screen.getByRole('group', { name: 'QR Code Image' }))
  })

  test('checks the address against the network as it is entered and when the network changes', async () => {
    renderAt('/payments/methods/create?type=crypto')
    await screen.findByRole('button', { name: 'Next' })

    fireEvent.click(button('Next'))
    assert.ok(await screen.findByText('Required'))
    assert.match(currentStep(), /Wallet Details/)

    const address = textbox(/^Wallet Address/)
    const network = networkSelect()
    fireEvent.change(address, { target: { value: EVM } })
    fireEvent.blur(address)
    assert.ok(await screen.findByText('A TRC20 address must start with T and be 34 characters long'))
    assert.equal(address.getAttribute('aria-invalid'), 'true')

    fireEvent.change(network, { target: { value: 'BEP20' } })
    // Compared as a boolean: a failed assert.equal on an element inspects the whole jsdom tree for its
    // message, and waitFor retries it until the async check clears the error (once took 15s and crashed).
    await waitFor(() => assert.ok(screen.queryByText(/^A TRC20 address/) === null, 'the TRC20 error clears'))
    assert.equal(textbox(/^Display Name \(Optional\)/).getAttribute('placeholder'), 'USDT (BEP20)')

    fireEvent.change(network, { target: { value: 'SOLANA' } })
    assert.ok(await screen.findByText('A SOLANA address must be 32 to 44 base58 characters'))
    fireEvent.click(button('Next'))
    await waitFor(() => assert.ok(document.activeElement === address, 'the flagged field is focused'))
    assert.match(currentStep(), /Wallet Details/)
    assert.equal(server.upserts.length, 0)
  })

  test('creating a wallet sends only the wallet list, with the new wallet appended', async () => {
    renderAt('/payments/methods/create?type=crypto')
    await screen.findByRole('button', { name: 'Next' })
    await listLoaded()
    fireEvent.change(networkSelect(), { target: { value: 'ERC20' } })
    type(/^Wallet Address/, `  ${EVM} `)
    type(/^Display Name/, ' Ethereum desk ')
    pickFile(IMAGE)
    await waitFor(() => assert.ok(screen.getByText('Preview — ready to save')))
    assert.equal((screen.getByAltText('Wallet QR Code') as HTMLImageElement).getAttribute('src'), NEW_QR)
    await nextStep('Limits')

    assert.ok(screen.getByText(
      'Set account amount limits, VIP access and display priority. Limits are in the deposit currency (₹), not in USDT.',
    ))
    type(/^Min Amount/, '500')
    await nextStep('Review')

    const details = screen.getByRole('heading', { level: 3, name: 'Wallet Details' }).closest('section') as HTMLElement
    for (const [term, value] of [
      ['Coin', 'USDT'], ['Network', 'ERC20 (Ethereum)'], ['Wallet Address', EVM], ['Display Name', 'Ethereum desk'],
      ['QR Code', 'Attached'], ['USDT Rate', '1 USDT = INR 92.50'],
    ]) {
      assert.ok(within(details).getByText(term), term)
      assert.ok(within(details).getByText((_, element) => element?.tagName === 'DD' && element.textContent === value), value)
    }
    assert.equal(screen.queryByText(/^No USDT rate is saved yet/), null)
    fireEvent.click(button('Create Crypto Wallet'))

    assert.equal((await screen.findByTestId('location')).textContent, '/payments/methods')
    const { input } = server.upserts[0] as UpsertVariables
    assert.deepStrictEqual(Object.keys(input), ['cryptos'], 'banks, UPIs, limits and the rate are left to the server')
    assert.deepStrictEqual(input.cryptos?.[0], {
      id: 'c1', network: 'TRC20', walletAddress: TRON, displayName: 'Main Tron', qrKey: WALLET_QR, minAmount: 1000,
      maxAmount: null, weight: 4, enabled: true, vipTierIds: [TIER],
    })
    const created = input.cryptos?.[1] as Record<string, unknown>
    assert.match(String(created.id), /^crypto-\d+$/)
    assert.deepStrictEqual({ ...created, id: 'new' }, {
      id: 'new', network: 'ERC20', walletAddress: EVM, displayName: 'Ethereum desk', qrKey: NEW_QR, minAmount: 500,
      maxAmount: null, weight: 0, enabled: true, vipTierIds: null,
    })
    assert.equal(server.banks.length, 2)
    assert.equal(server.queries, 2, 'the list was refetched before returning')
  })

  test('the review warns when no USDT rate is saved yet', async () => {
    server.cryptoRate = null
    renderAt('/payments/methods/create?type=crypto')
    await screen.findByRole('button', { name: 'Next' })
    type(/^Wallet Address/, TRON)
    await nextStep('Limits')
    await nextStep('Review')
    const details = screen.getByRole('heading', { level: 3, name: 'Wallet Details' }).closest('section') as HTMLElement
    assert.ok(within(details).getByText('Not set'))
    assert.ok(screen.getByText(
      'No USDT rate is saved yet. Set it on the Crypto Wallets tab of Payment Methods — players will not see this wallet until then.',
    ))
  })

  test('a wallet the server refuses stays on the form with the server\'s reason', async () => {
    const reason = 'Invalid input: A TRC20 address must start with T and be 34 characters long'
    renderAt('/payments/methods/create?type=crypto', [queryMock(), {
      request: { query: UPSERT_WHITELABEL_PAYMENT_METHODS },
      variableMatcher: () => true,
      result: { errors: [new GraphQLError(reason)] },
    }])
    await screen.findByRole('button', { name: 'Next' })
    await listLoaded()
    type(/^Wallet Address/, TRON)
    await nextStep('Limits')
    await nextStep('Review')
    fireEvent.click(button('Create Crypto Wallet'))

    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], { message: reason, tone: 'error' })
    assert.ok(button('Create Crypto Wallet'))
    assert.equal(screen.queryByTestId('location'), null)
  })

  test('edits a stored wallet in place, keeping its QR and VIP tiers', async () => {
    renderAt('/payments/methods/edit/crypto/c1')
    assert.ok(await screen.findByRole('heading', { level: 1, name: 'Edit Crypto Wallet' }))
    assert.equal(networkSelect().value, 'TRC20')
    assert.equal(textbox(/^Wallet Address/).value, TRON)
    assert.equal(textbox(/^Display Name/).value, 'Main Tron')
    assert.equal((screen.getByAltText('Wallet QR Code') as HTMLImageElement).getAttribute('src'), WALLET_QR)
    assert.ok(screen.getByText('Current QR code'))

    type(/^Display Name/, 'Tron desk')
    await nextStep('Limits')
    assert.equal(textbox(/^Min Amount/).value, '1,000')
    await nextStep('Review')
    fireEvent.click(button('Update Crypto Wallet'))

    assert.equal((await screen.findByTestId('location')).textContent, '/payments/methods')
    assert.deepStrictEqual((server.upserts[0] as UpsertVariables).input, {
      cryptos: [{
        id: 'c1', network: 'TRC20', walletAddress: TRON, displayName: 'Tron desk', qrKey: WALLET_QR, minAmount: 1000,
        maxAmount: null, weight: 4, enabled: true, vipTierIds: [TIER],
      }],
    })
  })
})
