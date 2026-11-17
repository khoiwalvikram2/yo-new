/**
 * /payments/methods against a mocked GraphQL server (MockedProvider): the exact list query and upsert
 * payloads, the guard, both tabs and their client-side paging, the status switch, delete confirmation,
 * edit navigation, copy actions and the QR code dialog in each of its states. The mocked server applies
 * every upsert, so a refetch shows what the backend would return.
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
import PaymentMethodsListPage from './PaymentMethodsListPage'
import type { BankDetail, CryptoDetail, UpiDetail } from './paymentMethodsListModel'

interface ConfirmOptions {
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: string
  onConfirm?: () => void | Promise<void>
}

/** What an upsert sends. A bank or UPI save sends the four legacy keys; a crypto save only its own key. */
interface UpsertVariables {
  input: {
    enabledMethods: string[]
    banks: Array<Record<string, unknown>>
    upis: Array<Record<string, unknown>>
    limits: { min: number; max: number }
    cryptos?: Array<Record<string, unknown>>
    cryptoRate?: number
    cryptoBonusPercent?: number
  }
}

const feedback = vi.hoisted(() => ({ confirm: vi.fn(), toast: vi.fn() }))
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

vi.mock('@/ui/components/confirm', () => ({ confirm: feedback.confirm }))
vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))

/** A QR as it is stored and served since 2026-11-04: its base64 data URI (qrKey and qrUrl alike). */
const QR_URL = 'data:image/png;base64,UVJfVTE='
const WALLET_QR = 'data:image/png;base64,V0FMTEVU'
const TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const EVM = '0xdAC17F958D2ee523a2206206994597C13D831ec7'

interface ServerState {
  enabledMethods: string[]
  banks: BankDetail[]
  upis: UpiDetail[]
  cryptos: CryptoDetail[]
  cryptoRate: number | null
  cryptoBonusPercent: number | null
  queries: number
  upserts: UpsertVariables[]
}

let server: ServerState

function initialBanks(): BankDetail[] {
  return [
    {
      id: 'b1',
      accountName: 'Vijay Kumar',
      accountNumber: '50100234567812',
      ifsc: 'HDFC0001204',
      bankName: 'HDFC Bank',
      branch: 'Andheri East',
      notes: 'Use IMPS for amounts above 2,00,000',
      minAmount: 100,
      maxAmount: 200000,
      weight: 3,
      enabled: true,
    },
    {
      id: 'b2',
      accountName: 'Sunita Rathi',
      accountNumber: '000201004512',
      ifsc: 'ICIC0000412',
      bankName: 'ICICI Bank',
      branch: '',
      notes: null,
      minAmount: null,
      maxAmount: null,
      weight: 0,
      enabled: false,
    },
  ]
}

function initialUpis(): UpiDetail[] {
  return [
    {
      id: 'u1',
      upiId: 'floxi@okaxis',
      displayName: 'Floxi Collections',
      qrKey: QR_URL,
      qrUrl: QR_URL,
      minAmount: 500,
      maxAmount: 100000,
      weight: 5,
      enabled: true,
    },
    {
      id: 'u2',
      upiId: 'payout.desk@ybl',
      displayName: null,
      qrKey: 'qr/u2.png',
      qrUrl: null,
      minAmount: null,
      maxAmount: 50000,
      weight: 1,
      enabled: true,
    },
    {
      id: 'u3',
      upiId: 'ops@paytm',
      displayName: null,
      qrKey: null,
      qrUrl: null,
      minAmount: null,
      maxAmount: null,
      weight: 0,
      enabled: false,
    },
  ]
}

function initialCryptos(): CryptoDetail[] {
  return [
    {
      id: 'c1',
      network: 'TRC20',
      walletAddress: TRON,
      displayName: 'Main Tron',
      qrKey: WALLET_QR,
      qrUrl: WALLET_QR,
      minAmount: 1000,
      maxAmount: 500000,
      weight: 4,
      enabled: true,
      vipTierIds: ['11111111-1111-4111-8111-111111111111'],
    },
    {
      id: 'c2',
      network: 'BEP20',
      walletAddress: EVM,
      displayName: null,
      qrKey: null,
      qrUrl: null,
      minAmount: null,
      maxAmount: null,
      weight: 0,
      enabled: false,
      vipTierIds: null,
    },
  ]
}

/** The query's reply, built from the server state with the typenames Apollo's cache expects. */
function methodsPayload() {
  return {
    __typename: 'WhitelabelPaymentMethods',
    id: 'wpm-1',
    tenant: 'floxi',
    enabledMethods: server.enabledMethods,
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
    cryptoBonusPercent: server.cryptoBonusPercent,
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

/**
 * Accepts any input, records it and applies it, as the backend's upsert would: a list, rate or bonus that
 * the input omits is kept, and a bonus of 0 switches the bonus off.
 */
function upsertMock(): MockedResponse {
  return {
    request: { query: UPSERT_WHITELABEL_PAYMENT_METHODS },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Record<string, unknown>) => {
      const sent = variables as unknown as UpsertVariables
      server.upserts.push(sent)
      const previous = server.upis
      if (sent.input.banks) server.banks = sent.input.banks as unknown as BankDetail[]
      if (sent.input.upis) {
        server.upis = (sent.input.upis as unknown as UpiDetail[]).map((upi) => ({
          ...upi,
          qrUrl: previous.find((candidate) => candidate.id === upi.id)?.qrUrl ?? null,
        }))
      }
      if (sent.input.cryptos) {
        server.cryptos = (sent.input.cryptos as unknown as CryptoDetail[]).map((crypto) => ({
          ...crypto,
          qrUrl: crypto.qrKey ?? null,
        }))
      }
      if (sent.input.cryptoRate != null) server.cryptoRate = sent.input.cryptoRate
      if (sent.input.cryptoBonusPercent !== undefined) server.cryptoBonusPercent = sent.input.cryptoBonusPercent || null
      return {
        data: {
          upsertWhitelabelPaymentMethods: {
            __typename: 'WhitelabelPaymentMethodsPayload',
            success: true,
            message: 'Payment methods saved',
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

function renderPage(mocks: MockedResponse[] = [queryMock(), upsertMock()]) {
  return render(
    <MockedProvider mocks={mocks}>
      <MemoryRouter initialEntries={['/payments/methods']}>
        <PageEyebrowProvider value="Payment operations">
          <Routes>
            <Route path="/payments/methods" element={<PaymentMethodsListPage />} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

async function renderLoaded(mocks?: MockedResponse[]) {
  const view = renderPage(mocks)
  await screen.findByRole('table', { name: 'Bank accounts' })
  await waitFor(() => assert.ok(screen.queryByText('Loading Bank accounts') === null))
  return view
}

/** The table row holding a visible title. */
function rowOf(title: string): HTMLElement {
  const cell = screen.getAllByText(title).find((element) => element.closest('tbody tr'))
  const row = cell?.closest('tr')
  assert.ok(row, `Expected a row for ${title}`)
  return row as HTMLElement
}

function bodyRowCount(tableName: string): number {
  const table = screen.getByRole('table', { name: tableName })
  return within(table).getAllByRole('row').length - 1
}

function confirmCopy(index = 0) {
  const options = feedback.confirm.mock.calls[index]?.[0] as ConfirmOptions
  return {
    title: options.title,
    description: options.description,
    confirmLabel: options.confirmLabel,
    cancelLabel: options.cancelLabel,
    tone: options.tone,
  }
}

async function showUpis() {
  fireEvent.click(screen.getByRole('tab', { name: /^UPI Accounts/ }))
  await screen.findByRole('table', { name: 'UPI accounts' })
}

beforeEach(() => {
  server = {
    enabledMethods: ['BANK_TRANSFER', 'UPI'],
    banks: initialBanks(),
    upis: initialUpis(),
    cryptos: [],
    cryptoRate: null,
    cryptoBonusPercent: null,
    queries: 0,
    upserts: [],
  }
  rbacCalls.length = 0
  rbacState.allowed = true
  feedback.confirm.mockReset()
  feedback.confirm.mockResolvedValue(false)
  feedback.toast.mockReset()
})

describe('PaymentMethodsListPage contracts', () => {
  test('shows the header, the guard, the stats and the bank table with every legacy cell', async () => {
    renderPage()

    assert.ok(screen.getByText('Loading Bank accounts').closest('[role="status"]'))
    assert.equal(screen.queryByRole('navigation', { name: 'Pagination' }), null)
    await screen.findByText('Vijay Kumar')

    assert.deepStrictEqual(rbacCalls.at(-1), {
      required: [{ domain: 'payments.methods', actions: ['view'] }],
      requireAny: undefined,
    })
    assert.ok(screen.queryByText('Payment operations') === null)
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Payment Methods' }))
    assert.ok(screen.queryByText('Manage bank accounts and UPI IDs organized by amount tiers') === null)
    assert.equal(server.queries, 1)

    const stats = screen.getByRole('group', { name: 'Payment method statistics' })
    for (const text of [
      'Bank Accounts', 'Active: 1 · Inactive: 1', 'UPI Accounts', 'Active: 2 · Inactive: 1',
      'Crypto Wallets', 'Active: 0 · Inactive: 0',
      'Total Methods', 'Banks: 2 · UPI: 3 · Crypto: 0', 'Active Rate', '60%', 'Active: 3 · Total: 5',
    ]) {
      assert.ok(within(stats).getByText(text), text)
    }

    const bankTab = screen.getByRole('tab', { name: 'Bank Accounts (2)' })
    assert.equal(bankTab.getAttribute('aria-selected'), 'true')
    assert.equal(screen.getByRole('tab', { name: 'UPI Accounts (3)' }).getAttribute('aria-selected'), 'false')
    assert.equal(screen.getByRole('tab', { name: 'Crypto Wallets (0)' }).getAttribute('aria-selected'), 'false')
    assert.equal(screen.queryByRole('heading', { name: 'Crypto settings' }), null, 'crypto settings show on their tab only')
    assert.equal(screen.getByRole('link', { name: 'Add Bank' }).getAttribute('href'), '/payments/methods/create?type=bank')

    const panel = screen.getByRole('tabpanel')
    assert.equal(panel.getAttribute('aria-labelledby'), bankTab.id)
    assert.equal(bankTab.getAttribute('aria-controls'), panel.id)
    assert.ok(within(panel).getByRole('heading', { level: 2, name: 'Bank Accounts' }))
    assert.ok(within(panel).getByText('2 accounts'))

    const table = screen.getByRole('table', { name: 'Bank accounts' })
    assert.deepStrictEqual(
      within(table).getAllByRole('columnheader').map((header) => header.textContent),
      ['Bank Details', 'Limit Range', 'Priority', 'Status', 'Actions'],
    )

    const vijay = rowOf('Vijay Kumar')
    assert.ok(within(vijay).getByText('Verified'))
    for (const [term, value] of [
      ['A/C No', '50100234567812'], ['IFSC', 'HDFC0001204'], ['Bank', 'HDFC Bank'], ['Branch', 'Andheri East'],
    ]) {
      assert.ok(within(vijay).getByText(term), term)
      assert.ok(within(vijay).getByText(value), value)
      assert.ok(within(vijay).getByRole('button', { name: `Copy ${term}` }), `Copy ${term}`)
    }
    assert.ok(within(vijay).getByText('Use IMPS for amounts above 2,00,000'))
    assert.ok(within(vijay).getByText('INR 100.00'))
    assert.ok(within(vijay).getByText('INR 200000.00'))
    assert.ok(within(vijay).getByText('Weight: 3'))
    assert.equal(within(vijay).getByRole('switch', { name: 'Vijay Kumar active' }).getAttribute('aria-checked'), 'true')
    assert.ok(within(vijay).getByText('Active'))

    const sunita = rowOf('Sunita Rathi')
    assert.equal(within(sunita).queryByText('Verified'), null)
    assert.equal(within(sunita).queryByRole('button', { name: 'Copy Branch' }), null, 'nothing to copy')
    assert.ok(within(sunita).getAllByText('—').length >= 2, 'empty branch and no minimum read as a dash')
    assert.ok(within(sunita).getByText('∞'))
    assert.ok(within(sunita).getByText('Weight: 0'))
    assert.equal(within(sunita).getByRole('switch', { name: 'Sunita Rathi active' }).getAttribute('aria-checked'), 'false')
    assert.ok(within(sunita).getByText('Inactive'))

    const pager = screen.getByRole('navigation', { name: 'Pagination' })
    assert.match(pager.textContent ?? '', /Showing 1–2 of 2 bank accounts/)
  })

  test('starts no query when the guard denies access', async () => {
    rbacState.allowed = false
    renderPage()

    assert.match(screen.getByRole('alert').textContent ?? '', /Access denied/)
    assert.equal(screen.queryByRole('heading', { name: 'Payment Methods' }), null)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    assert.equal(server.queries, 0)
  })

  test('shows the empty state without a pager', async () => {
    server.banks = []
    renderPage()

    assert.ok(await screen.findByText('No bank accounts found'))
    assert.ok(screen.getByText('0 accounts'))
    assert.ok(screen.getByRole('tab', { name: 'Bank Accounts (0)' }))
    assert.equal(screen.queryByRole('navigation', { name: 'Pagination' }), null)
  })
})

describe('PaymentMethodsListPage tabs and paging', () => {
  test('arrow keys switch to the UPI tab, which keeps the legacy UPI cells', async () => {
    await renderLoaded()
    const bankTab = screen.getByRole('tab', { name: 'Bank Accounts (2)' })
    bankTab.focus()
    fireEvent.keyDown(bankTab, { key: 'ArrowRight' })

    const upiTab = screen.getByRole('tab', { name: 'UPI Accounts (3)' })
    await waitFor(() => assert.equal(upiTab.getAttribute('aria-selected'), 'true'))
    assert.ok(document.activeElement === upiTab, 'focus follows the selected tab')
    assert.equal(screen.getByRole('link', { name: 'Add UPI' }).getAttribute('href'), '/payments/methods/create?type=upi')

    const panel = screen.getByRole('tabpanel')
    assert.equal(panel.getAttribute('aria-labelledby'), upiTab.id)
    assert.ok(within(panel).getByRole('heading', { level: 2, name: 'UPI Accounts' }))
    assert.ok(within(panel).getByText('3 accounts'))
    const table = screen.getByRole('table', { name: 'UPI accounts' })
    assert.deepStrictEqual(
      within(table).getAllByRole('columnheader').map((header) => header.textContent),
      ['UPI Details', 'Limit Range', 'Priority', 'Status', 'Actions'],
    )

    const floxi = rowOf('Floxi Collections')
    assert.equal(within(floxi).getAllByText('Floxi Collections').length, 2, 'title and the Name line')
    assert.ok(within(floxi).getByText('floxi@okaxis'))
    assert.ok(within(floxi).getByRole('button', { name: 'Copy UPI ID' }))
    assert.ok(within(floxi).getByText('Verified'))
    assert.ok(within(floxi).getByRole('button', { name: 'QR Code Uploaded, view the QR code for Floxi Collections' }))
    assert.ok(within(floxi).getByText('Weight: 5'))

    const desk = rowOf('payout.desk@ybl')
    assert.equal(within(desk).queryByText('Name'), null)
    assert.ok(within(desk).getByRole('button', { name: /^QR Code Uploaded/ }), 'a stored key alone counts as uploaded')

    const ops = rowOf('ops@paytm')
    assert.ok(within(ops).getByText('No QR Code'))
    assert.equal(within(ops).queryByRole('button', { name: /^QR Code Uploaded/ }), null)
    assert.ok(within(ops).getByText('Inactive'))
    assert.match(screen.getByRole('navigation', { name: 'Pagination' }).textContent ?? '', /of 3 UPI accounts/)
  })

  test('pages the list on the client, resets to page 1 on a tab change and honours the page size', async () => {
    server.banks = Array.from({ length: 12 }, (_, index) => ({
      ...initialBanks()[0],
      id: `bank-${index + 1}`,
      accountName: `Holder ${String(index + 1).padStart(2, '0')}`,
    }))
    await renderLoaded()

    assert.equal(bodyRowCount('Bank accounts'), 10)
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    await waitFor(() => assert.equal(bodyRowCount('Bank accounts'), 2))
    assert.ok(screen.getByText('Holder 12'))

    await showUpis()
    fireEvent.click(screen.getByRole('tab', { name: /^Bank Accounts/ }))
    await waitFor(() => assert.equal(bodyRowCount('Bank accounts'), 10))
    assert.ok(screen.getByText('Holder 01'))

    fireEvent.change(screen.getByLabelText('Rows per page:'), { target: { value: '20' } })
    await waitFor(() => assert.equal(bodyRowCount('Bank accounts'), 12))
    assert.equal(server.queries, 1, 'paging never refetches')
  })
})

describe('PaymentMethodsListPage changes', () => {
  test('the status switch sends the whole set with one row changed, shows it busy, then refetches', async () => {
    await renderLoaded()
    const toggle = within(rowOf('Sunita Rathi')).getByRole('switch', { name: 'Sunita Rathi active' })
    fireEvent.click(toggle)

    assert.equal(toggle.getAttribute('aria-busy'), 'true')
    assert.equal(toggle.getAttribute('aria-disabled'), 'true')
    await waitFor(() => assert.equal(server.upserts.length, 1))
    assert.deepStrictEqual(server.upserts[0], {
      input: {
        enabledMethods: ['BANK_TRANSFER', 'UPI'],
        banks: [
          {
            id: 'b1', accountName: 'Vijay Kumar', accountNumber: '50100234567812', ifsc: 'HDFC0001204',
            bankName: 'HDFC Bank', branch: 'Andheri East', notes: 'Use IMPS for amounts above 2,00,000',
            minAmount: 100, maxAmount: 200000, weight: 3, enabled: true,
          },
          {
            id: 'b2', accountName: 'Sunita Rathi', accountNumber: '000201004512', ifsc: 'ICIC0000412',
            bankName: 'ICICI Bank', branch: '', notes: null, minAmount: null, maxAmount: null, weight: 0,
            enabled: true,
          },
        ],
        upis: [
          {
            id: 'u1', upiId: 'floxi@okaxis', displayName: 'Floxi Collections', qrKey: QR_URL,
            minAmount: 500, maxAmount: 100000, weight: 5, enabled: true,
          },
          {
            id: 'u2', upiId: 'payout.desk@ybl', displayName: null, qrKey: 'qr/u2.png', minAmount: null,
            maxAmount: 50000, weight: 1, enabled: true,
          },
          {
            id: 'u3', upiId: 'ops@paytm', displayName: null, qrKey: null, minAmount: null, maxAmount: null,
            weight: 0, enabled: false,
          },
        ],
        limits: { min: 200, max: 250000 },
      },
    })

    await waitFor(() => assert.equal(server.queries, 2))
    await waitFor(() => {
      const refreshed = within(rowOf('Sunita Rathi')).getByRole('switch', { name: 'Sunita Rathi active' })
      assert.equal(refreshed.getAttribute('aria-checked'), 'true')
      assert.equal(refreshed.getAttribute('aria-busy'), null)
    })
    assert.ok(within(rowOf('Sunita Rathi')).getByText('Active'))
  })

  test('a failed switch change still refetches and clears the busy state', async () => {
    await renderLoaded([queryMock(), failingUpsertMock()])
    const toggle = within(rowOf('Vijay Kumar')).getByRole('switch', { name: 'Vijay Kumar active' })
    fireEvent.click(toggle)

    await waitFor(() => assert.equal(server.queries, 2))
    await waitFor(() => assert.equal(
      within(rowOf('Vijay Kumar')).getByRole('switch', { name: 'Vijay Kumar active' }).getAttribute('aria-busy'),
      null,
    ))
    assert.equal(server.upserts[0]?.input.banks[0]?.enabled, false)
    assert.equal(
      within(rowOf('Vijay Kumar')).getByRole('switch', { name: 'Vijay Kumar active' }).getAttribute('aria-checked'),
      'true',
      'the server state is shown',
    )
  })

  test('delete asks with the legacy copy, sends the set without that row and refetches', async () => {
    feedback.confirm.mockImplementation(async (options: ConfirmOptions) => {
      await options.onConfirm?.()
      return true
    })
    await renderLoaded()
    fireEvent.click(within(rowOf('Vijay Kumar')).getByRole('button', { name: 'Delete Vijay Kumar' }))

    await waitFor(() => assert.equal(server.upserts.length, 1))
    assert.deepStrictEqual(confirmCopy(), {
      title: 'Delete Bank Account',
      description: 'This action cannot be undone. Continue?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
    })
    assert.deepStrictEqual(server.upserts[0]?.input.banks.map((bank) => bank.id), ['b2'])
    assert.deepStrictEqual(server.upserts[0]?.input.upis.map((upi) => upi.id), ['u1', 'u2', 'u3'])
    await waitFor(() => assert.equal(server.queries, 2))
    await waitFor(() => assert.ok(screen.queryByText('Vijay Kumar') === null))
    assert.ok(screen.getByText('1 account'))
  })

  test('a cancelled delete sends nothing, and a UPI delete names the UPI account', async () => {
    await renderLoaded()
    fireEvent.click(within(rowOf('Sunita Rathi')).getByRole('button', { name: 'Delete Sunita Rathi' }))
    await waitFor(() => assert.equal(feedback.confirm.mock.calls.length, 1))

    await showUpis()
    fireEvent.click(within(rowOf('ops@paytm')).getByRole('button', { name: 'Delete ops@paytm' }))
    await waitFor(() => assert.equal(feedback.confirm.mock.calls.length, 2))
    assert.equal(confirmCopy(1).title, 'Delete UPI Account')
    assert.equal(server.upserts.length, 0)
  })

  test('edit opens the method form for the row type', async () => {
    await renderLoaded()
    fireEvent.click(within(rowOf('Vijay Kumar')).getByRole('button', { name: 'Edit Vijay Kumar' }))
    assert.equal((await screen.findByTestId('location')).textContent, '/payments/methods/edit/bank/b1')
  })

  test('edit from the UPI tab opens the UPI form', async () => {
    await renderLoaded()
    await showUpis()
    fireEvent.click(within(rowOf('payout.desk@ybl')).getByRole('button', { name: 'Edit payout.desk@ybl' }))
    assert.equal((await screen.findByTestId('location')).textContent, '/payments/methods/edit/upi/u2')
  })

  test('copies a detail byte-for-byte and names it in the feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await renderLoaded()

    const vijay = rowOf('Vijay Kumar')
    fireEvent.click(within(vijay).getByRole('button', { name: 'Copy A/C No' }))
    await waitFor(() => assert.ok(within(vijay).getByText('A/C No copied')))
    assert.deepStrictEqual(writeText.mock.calls, [['50100234567812']])
  })
})

describe('PaymentMethodsListPage QR code dialog', () => {
  test('loads the image, then shows the legacy captions, and returns focus on Close', async () => {
    await renderLoaded()
    await showUpis()
    const trigger = within(rowOf('Floxi Collections')).getByRole('button', { name: /^QR Code Uploaded/ })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: 'UPI QR Code (Floxi Collections)' })
    assert.ok(within(dialog).getByText('Loading QR code...'))
    const image = within(dialog).getByAltText('UPI QR Code') as HTMLImageElement
    assert.equal(image.getAttribute('src'), QR_URL)
    assert.equal(within(dialog).queryByText('Scan this QR code to make a payment'), null)

    fireEvent.load(image)
    assert.ok(await within(dialog).findByText('Scan this QR code to make a payment'))
    // No external file store since 2026-11-04: the dialog no longer names one.
    assert.equal(within(dialog).queryByText(/Amazon|S3/), null)
    assert.equal(within(dialog).queryByText('Loading QR code...'), null)

    const close = within(dialog).getAllByRole('button').find((button) => button.textContent === 'Close')
    assert.ok(close)
    fireEvent.click(close as HTMLElement)
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    await waitFor(() => assert.ok(document.activeElement === trigger, 'focus returns to the QR control'))
  })

  test('a failed image becomes a placeholder naming it with how to replace it, and starts fresh when reopened (SYS-18)', async () => {
    await renderLoaded()
    await showUpis()
    fireEvent.click(within(rowOf('Floxi Collections')).getByRole('button', { name: /^QR Code Uploaded/ }))
    const dialog = await screen.findByRole('dialog', { name: 'UPI QR Code (Floxi Collections)' })

    fireEvent.error(within(dialog).getByAltText('UPI QR Code'))
    const problem = await within(dialog).findByRole('alert')
    assert.equal(within(dialog).queryByAltText('UPI QR Code'), null, 'no broken image is left')
    assert.ok(within(problem).getByRole('img', { name: 'UPI QR Code' }).hasAttribute('data-image-placeholder'))
    assert.ok(within(problem).getByText('This QR code cannot be shown'))
    assert.ok(within(problem).getByText("Upload it again on the payment method's edit page."))
    assert.equal(within(problem).queryByText(/expired|refresh/i), null)
    assert.equal(within(dialog).queryByText('Loading QR code...'), null)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    fireEvent.click(within(rowOf('Floxi Collections')).getByRole('button', { name: /^QR Code Uploaded/ }))
    const reopened = await screen.findByRole('dialog', { name: 'UPI QR Code (Floxi Collections)' })
    assert.ok(within(reopened).getByText('Loading QR code...'))
    assert.equal(within(reopened).queryByRole('alert'), null)
  })

  test('a legacy stored QR the server can no longer serve (no qrUrl) is the same placeholder, not a storage key', async () => {
    await renderLoaded()
    await showUpis()
    fireEvent.click(within(rowOf('payout.desk@ybl')).getByRole('button', { name: /^QR Code Uploaded/ }))
    const dialog = await screen.findByRole('dialog', { name: 'UPI QR Code (payout.desk@ybl)' })

    assert.ok(within(dialog).getByRole('img', { name: 'UPI QR Code' }).hasAttribute('data-image-placeholder'))
    assert.ok(within(dialog).getByText('This QR code cannot be shown'))
    assert.ok(within(dialog).getByText("Upload it again on the payment method's edit page."))
    assert.equal(within(dialog).queryByText(/Presigned|Key: qr/), null)
    assert.equal(within(dialog).queryByAltText('UPI QR Code'), null)
    assert.equal(within(dialog).queryByRole('alert'), null, 'nothing failed while the admin watched')
  })
})

async function showCryptos() {
  fireEvent.click(screen.getByRole('tab', { name: /^Crypto Wallets/ }))
  await screen.findByRole('table', { name: 'Crypto wallets' })
}

function cryptoSettings(): HTMLElement {
  return screen.getByRole('heading', { level: 2, name: 'Crypto settings' }).closest('section') as HTMLElement
}

/** A server that refuses the upsert with a GraphQL error, as the resolver's validation does. */
function refusingUpsertMock(message: string): MockedResponse {
  return {
    request: { query: UPSERT_WHITELABEL_PAYMENT_METHODS },
    variableMatcher: (variables) => {
      server.upserts.push(variables as unknown as UpsertVariables)
      return true
    },
    result: { errors: [new GraphQLError(message)] },
  }
}

describe('PaymentMethodsListPage crypto wallets', () => {
  beforeEach(() => {
    server.cryptos = initialCryptos()
    server.cryptoRate = 92.5
  })

  test('the third tab lists each wallet with its network, address, QR, limits and status', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await renderLoaded()

    const stats = screen.getByRole('group', { name: 'Payment method statistics' })
    for (const text of ['Crypto Wallets', 'Banks: 2 · UPI: 3 · Crypto: 2', '57%', 'Active: 4 · Total: 7']) {
      assert.ok(within(stats).getByText(text), text)
    }

    await showCryptos()
    const tab = screen.getByRole('tab', { name: 'Crypto Wallets (2)' })
    assert.equal(tab.getAttribute('aria-selected'), 'true')
    assert.equal(screen.getByRole('link', { name: 'Add Crypto' }).getAttribute('href'), '/payments/methods/create?type=crypto')
    const panel = screen.getByRole('tabpanel')
    assert.equal(panel.getAttribute('aria-labelledby'), tab.id)
    assert.ok(within(panel).getByRole('heading', { level: 2, name: 'Crypto Wallets' }))
    assert.ok(within(panel).getByText('2 wallets'))
    const table = screen.getByRole('table', { name: 'Crypto wallets' })
    assert.deepStrictEqual(
      within(table).getAllByRole('columnheader').map((header) => header.textContent),
      ['Wallet Details', 'Limit Range', 'Priority', 'Status', 'Actions'],
    )

    const main = rowOf('Main Tron')
    assert.ok(within(main).getByText('Verified'))
    assert.ok(within(main).getByText('USDT · TRC20 (Tron)'))
    assert.ok(within(main).getByText(TRON))
    assert.ok(within(main).getByRole('button', { name: 'QR Code Uploaded, view the QR code for Main Tron' }))
    assert.ok(within(main).getByText('INR 1000.00'))
    assert.ok(within(main).getByText('INR 500000.00'))
    assert.ok(within(main).getByText('Weight: 4'))
    assert.equal(within(main).getByRole('switch', { name: 'Main Tron active' }).getAttribute('aria-checked'), 'true')
    fireEvent.click(within(main).getByRole('button', { name: 'Copy Address' }))
    await waitFor(() => assert.deepStrictEqual(writeText.mock.calls, [[TRON]]))

    const bsc = rowOf('USDT (BEP20)')
    assert.ok(within(bsc).getByText('USDT · BEP20 (BNB Smart Chain)'))
    assert.ok(within(bsc).getByText(EVM))
    assert.ok(within(bsc).getByText('No QR Code'))
    assert.ok(within(bsc).getByText('∞'))
    assert.ok(within(bsc).getByText('Inactive'))
    assert.match(screen.getByRole('navigation', { name: 'Pagination' }).textContent ?? '', /of 2 crypto wallets/)
  })

  test('the rate saves alone, and its example follows what is typed', async () => {
    server.cryptoRate = null
    await renderLoaded()
    await showCryptos()
    const settings = cryptoSettings()

    assert.ok(within(settings).getByText(
      'Set the USDT rate to start crypto deposits. Players do not see crypto wallets until a rate is saved.',
    ))
    assert.ok(within(settings).getByText('No rate saved yet'))
    const rate = within(settings).getByRole('textbox', { name: 'USDT rate' }) as HTMLInputElement
    const saveRate = within(settings).getByRole('button', { name: 'Save Rate' }) as HTMLButtonElement
    assert.equal(saveRate.disabled, true, 'nothing typed')

    fireEvent.change(rate, { target: { value: '0' } })
    assert.ok(within(settings).getByText('The USDT rate must be above 0'))
    assert.equal(rate.getAttribute('aria-invalid'), 'true')
    assert.equal(saveRate.disabled, true)

    fireEvent.change(rate, { target: { value: '92.5' } })
    assert.ok(within(settings).getByText('A INR 10000.00 deposit asks the player for 108.11 USDT'))
    assert.equal(rate.getAttribute('aria-invalid'), null)
    assert.equal(saveRate.disabled, false)
    fireEvent.click(saveRate)

    await waitFor(() => assert.equal(server.upserts.length, 1))
    assert.deepStrictEqual(server.upserts[0], { input: { cryptoRate: 92.5 } }, 'banks, UPIs and wallets are not sent')
    await waitFor(() => assert.equal(server.queries, 2))
    await waitFor(() => assert.ok(within(cryptoSettings()).queryByText(/^Set the USDT rate/) === null, 'the rate prompt clears'))
    assert.equal((within(cryptoSettings()).getByRole('button', { name: 'Save Rate' }) as HTMLButtonElement).disabled, true)
    assert.equal(feedback.toast.mock.calls.length, 0)
    assert.equal(server.banks.length, 2)
    assert.equal(server.cryptos.length, 2)
  })

  test('the bonus saves alone, refuses more than 50%, and an emptied field switches it off', async () => {
    server.cryptoBonusPercent = 5
    await renderLoaded()
    await showCryptos()
    const settings = cryptoSettings()

    assert.equal(within(settings).queryByText(/^Set the USDT rate/), null, 'a rate is saved')
    const bonus = within(settings).getByRole('textbox', { name: 'Deposit bonus' }) as HTMLInputElement
    assert.equal(bonus.value, '5.00')
    assert.ok(within(settings).getByText(
      'On approval a INR 10000.00 crypto deposit also gets INR 500.00 bonus in the cash wallet (INR 10500.00 in all)',
    ))
    const saveBonus = within(settings).getByRole('button', { name: 'Save Bonus' }) as HTMLButtonElement
    assert.equal(saveBonus.disabled, true, 'unchanged')

    fireEvent.change(bonus, { target: { value: '60' } })
    assert.ok(within(settings).getByText('Crypto bonus can be at most 50%'))
    assert.equal(saveBonus.disabled, true)

    fireEvent.change(bonus, { target: { value: '' } })
    assert.ok(within(settings).getByText('No bonus. Set up to 50% to add an extra % to every approved crypto deposit.'))
    assert.equal(saveBonus.disabled, false)
    fireEvent.click(saveBonus)

    await waitFor(() => assert.equal(server.upserts.length, 1))
    assert.deepStrictEqual(server.upserts[0], { input: { cryptoBonusPercent: 0 } })
    await waitFor(() => assert.equal(server.queries, 2))
    assert.equal(server.cryptoBonusPercent, null)
  })

  test('a refused setting shows the server\'s reason and keeps the typed value', async () => {
    await renderLoaded([queryMock(), refusingUpsertMock('Invalid input: The USDT rate must be above 0')])
    await showCryptos()
    const rate = within(cryptoSettings()).getByRole('textbox', { name: 'USDT rate' }) as HTMLInputElement
    fireEvent.change(rate, { target: { value: '90' } })
    fireEvent.click(within(cryptoSettings()).getByRole('button', { name: 'Save Rate' }))

    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], {
      message: 'Invalid input: The USDT rate must be above 0',
      tone: 'error',
    })
    await waitFor(() => assert.equal(server.queries, 2))
    assert.equal(rate.value, '90.00', 'the typed rate stays for a retry')
  })

  test('a wallet switch sends only the wallet list with that wallet changed, then refetches', async () => {
    await renderLoaded()
    await showCryptos()
    fireEvent.click(within(rowOf('USDT (BEP20)')).getByRole('switch', { name: 'USDT (BEP20) active' }))

    await waitFor(() => assert.equal(server.upserts.length, 1))
    assert.deepStrictEqual(server.upserts[0], {
      input: {
        cryptos: [
          {
            id: 'c1', network: 'TRC20', walletAddress: TRON, displayName: 'Main Tron', qrKey: WALLET_QR, minAmount: 1000,
            maxAmount: 500000, weight: 4, enabled: true, vipTierIds: ['11111111-1111-4111-8111-111111111111'],
          },
          {
            id: 'c2', network: 'BEP20', walletAddress: EVM, displayName: null, qrKey: null, minAmount: null,
            maxAmount: null, weight: 0, enabled: true, vipTierIds: null,
          },
        ],
      },
    })
    await waitFor(() => assert.equal(server.queries, 2))
    await waitFor(() => assert.equal(
      within(rowOf('USDT (BEP20)')).getByRole('switch', { name: 'USDT (BEP20) active' }).getAttribute('aria-checked'),
      'true',
    ))
    assert.equal(server.banks.length, 2, 'bank accounts are kept by the server')
  })

  test('a refused wallet change shows the server\'s reason and refetches', async () => {
    const reason = 'Invalid input: A BEP20 address must start with 0x followed by 40 hex characters'
    await renderLoaded([queryMock(), refusingUpsertMock(reason)])
    await showCryptos()
    fireEvent.click(within(rowOf('Main Tron')).getByRole('switch', { name: 'Main Tron active' }))

    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], { message: reason, tone: 'error' })
    await waitFor(() => assert.equal(server.queries, 2))
    assert.deepStrictEqual(Object.keys(server.upserts[0]?.input ?? {}), ['cryptos'])
  })

  test('delete asks with the wallet copy and sends the wallet list without that wallet', async () => {
    feedback.confirm.mockImplementation(async (options: ConfirmOptions) => {
      await options.onConfirm?.()
      return true
    })
    await renderLoaded()
    await showCryptos()
    fireEvent.click(within(rowOf('Main Tron')).getByRole('button', { name: 'Delete Main Tron' }))

    await waitFor(() => assert.equal(server.upserts.length, 1))
    assert.deepStrictEqual(confirmCopy(), {
      title: 'Delete Crypto Wallet',
      description: 'This action cannot be undone. Continue?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
    })
    assert.deepStrictEqual(Object.keys(server.upserts[0]?.input ?? {}), ['cryptos'])
    assert.deepStrictEqual(server.upserts[0]?.input.cryptos?.map((crypto) => crypto.id), ['c2'])
    await waitFor(() => assert.ok(screen.queryByText('Main Tron') === null))
    assert.ok(screen.getByText('1 wallet'))
  })

  test('edit opens the wallet form', async () => {
    await renderLoaded()
    await showCryptos()
    fireEvent.click(within(rowOf('USDT (BEP20)')).getByRole('button', { name: 'Edit USDT (BEP20)' }))
    assert.equal((await screen.findByTestId('location')).textContent, '/payments/methods/edit/crypto/c2')
  })

  test('a wallet QR opens in the preview dialog under its own title', async () => {
    await renderLoaded()
    await showCryptos()
    fireEvent.click(within(rowOf('Main Tron')).getByRole('button', { name: /^QR Code Uploaded/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Wallet QR Code (Main Tron)' })

    const image = within(dialog).getByAltText('Wallet QR Code') as HTMLImageElement
    assert.equal(image.getAttribute('src'), WALLET_QR)
    fireEvent.load(image)
    assert.ok(await within(dialog).findByText('Scan this QR code to make a payment'))
    assert.equal(within(dialog).queryByText(/Amazon|S3/), null)
  })
})
