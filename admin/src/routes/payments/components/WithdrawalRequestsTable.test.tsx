import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ADMIN_WITHDRAWAL_REQUESTS } from '@/lib/graphql/withdrawals'
import {
  WithdrawalRequestsTable,
  type WithdrawalRequest,
  type WithdrawalRequestsExportFilter,
} from './WithdrawalRequestsTable'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  exportWithdrawals: vi.fn(),
  toast: vi.fn(),
  formatAmount: vi.fn((amount: number, currency?: string) => `AMOUNT:${amount}:${currency}`),
  formatDate: vi.fn((value: string, pattern?: string) => `DATE:${value}:${pattern}`),
  formatTime: vi.fn((value: string, pattern?: string) => `TIME:${value}:${pattern}`),
}))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  return { ...actual, useApolloClient: () => ({ query: mocks.query }) }
})

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({ formatAmount: mocks.formatAmount }),
}))

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({ formatDate: mocks.formatDate, formatTime: mocks.formatTime }),
}))

vi.mock('@/ui/components/toast', () => ({ toast: mocks.toast }))

vi.mock('../utils/exportWithdrawals', () => ({
  exportWithdrawalsToExcel: mocks.exportWithdrawals,
}))

const FILTER: WithdrawalRequestsExportFilter = {
  status: 'PENDING',
  query: 'player',
  fromDate: '2026-09-01',
  toDate: '2026-09-30',
}

function request(id: number | string, overrides: Partial<WithdrawalRequest> = {}): WithdrawalRequest {
  const key = String(id)
  return {
    id: key,
    userId: `user-${key}`,
    amount: Number(id) || 100,
    currency: 'INR',
    status: 'PENDING',
    reviewerId: null,
    reviewedAt: null,
    note: null,
    createdAt: '2026-09-21T10:11:12.000Z',
    updatedAt: '2026-09-21T10:11:12.000Z',
    account: {
      id: `acc-${key}`,
      method: 'BANK',
      accountNumber: `00011122${key}`,
      ifscCode: `HDFC000${key}`,
      bankName: 'HDFC Bank',
      accountHolderName: `Holder ${key}`,
    },
    user: {
      id: `user-${key}`,
      name: `Player ${key}`,
      email: `player-${key}@example.test`,
      phone: `900000${key}`,
    },
    ...overrides,
  }
}

interface RenderOptions {
  requests?: WithdrawalRequest[]
  fetching?: boolean
  total?: number
  onView?: (item: WithdrawalRequest) => void
  footer?: React.ReactNode
}

function renderTable({
  requests = [request(1)],
  fetching = false,
  total = requests.length,
  onView = () => {},
  footer,
}: RenderOptions = {}) {
  return render(
    <MemoryRouter>
      <WithdrawalRequestsTable
        requests={requests}
        fetching={fetching}
        total={total}
        exportFilter={FILTER}
        onView={onView}
        footer={footer}
      />
    </MemoryRouter>,
  )
}

function exportButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Export Excel' }) as HTMLButtonElement
}

function queryResult(items: WithdrawalRequest[], total: number, error?: Error) {
  return { data: { adminWithdrawalRequests: { items, total } }, error }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.query.mockResolvedValue(queryResult([request(1)], 1))
  mocks.exportWithdrawals.mockResolvedValue(undefined)
})

afterEach(cleanup)

describe('WithdrawalRequestsTable', () => {
  test('keeps the legacy columns, formatting, readable statuses and the preserved footer', () => {
    renderTable({
      total: 3,
      footer: <div>Server pagination</div>,
      requests: [
        request(1),
        request(2, {
          status: 'PROCESSING',
          user: { id: 'user-2', name: '', email: 'fallback@example.test', phone: null },
        }),
        request(3, { status: 'ON_HOLD' as WithdrawalRequest['status'], account: null }),
      ],
    })

    const table = screen.getByRole('table', { name: 'Withdrawal requests' })
    assert.deepEqual(
      within(table).getAllByRole('columnheader').map((header) => header.textContent),
      ['ID', 'User', 'Amount', 'Account', 'Status', 'Created', 'Actions'],
    )
    assert.ok(screen.getByRole('heading', { name: 'Withdrawal Requests', level: 2 }))
    assert.ok(screen.getByText('3 requests'))
    assert.ok(screen.getByText('#1'))
    assert.ok(screen.getByText('AMOUNT:1:INR'))
    assert.ok(screen.getByText('Pending'))
    assert.ok(screen.getByText('Processing'))
    assert.ok(screen.getByText('ON_HOLD'), 'an unknown status keeps its server value instead of reading Cancelled')
    assert.ok(screen.getByText('N/A'))
    assert.ok(screen.getByText('fallback@example.test'))
    assert.ok(screen.getByText('9000001'))
    assert.equal(screen.getAllByText('DATE:2026-09-21T10:11:12.000Z:dd MMM yyyy').length, 3)
    assert.equal(screen.getAllByText('TIME:2026-09-21T10:11:12.000Z:HH:mm').length, 3)
    assert.ok(screen.getByText('Server pagination'))
  })

  test('summarises a bank account with IFSC and any other method with its name, with copy actions', () => {
    renderTable({
      requests: [
        request(1),
        request(2, {
          account: {
            id: 'acc-2',
            method: 'UPI',
            accountNumber: 'player2@okbank',
            accountHolderName: undefined,
          },
        }),
        request(3, {
          account: { id: 'acc-3', method: 'BANK', accountNumber: '', ifscCode: undefined, accountHolderName: 'Holder 3' },
        }),
        request(4, { account: null }),
      ],
    })

    const rows = within(screen.getByRole('table', { name: 'Withdrawal requests' })).getAllByRole('row').slice(1)
    const [bank, upi, emptyBank, noAccount] = rows

    assert.ok(within(bank).getByText('Holder 1'))
    assert.equal(within(bank).getByText('Holder 1').getAttribute('title'), 'Holder 1')
    assert.ok(within(bank).getByText('000111221'))
    assert.ok(within(bank).getByText('HDFC0001'))
    assert.ok(within(bank).getByRole('button', { name: 'Copy Account Number' }))
    assert.ok(within(bank).getByRole('button', { name: 'Copy IFSC' }))
    assert.equal(within(bank).queryByText('Method'), null)

    assert.ok(within(upi).getByText('player2@okbank'))
    assert.ok(within(upi).getByText('Method'))
    assert.ok(within(upi).getByText('UPI'))
    assert.equal(within(upi).queryByText('IFSC'), null)
    assert.equal(within(upi).getByText('—').getAttribute('title'), '—')

    assert.ok(within(emptyBank).getByText('IFSC'))
    assert.equal(within(emptyBank).getAllByText('—').length, 2)
    assert.equal(within(emptyBank).queryByRole('button', { name: /^Copy/ }), null)

    assert.equal(within(noAccount).queryByText('Name'), null)
    assert.ok(within(noAccount).getByText('—'))
  })

  test('marks an account the player deleted with a Deleted pill beside its holder, and only that account', () => {
    renderTable({
      requests: [
        request(1, {
          status: 'COMPLETED',
          account: {
            id: 'acc-1',
            method: 'BANK',
            accountNumber: '000111221',
            ifscCode: 'HDFC0001',
            accountHolderName: 'Holder 1',
            deletedAt: '2026-11-04T06:15:00.000Z',
          },
        }),
        request(2),
        request(3, {
          account: { id: 'acc-3', method: 'UPI', accountNumber: 'player3@okbank', accountHolderName: 'Holder 3', deletedAt: null },
        }),
      ],
    })

    const rows = within(screen.getByRole('table', { name: 'Withdrawal requests' })).getAllByRole('row').slice(1)
    const [deleted, live, liveNull] = rows

    const nameRow = within(deleted).getByText('Name').parentElement as HTMLElement
    assert.ok(within(nameRow).getByText('Holder 1'))
    const pill = within(nameRow).getByText('Deleted')
    assert.equal(pill.closest('[title]')?.getAttribute('title'), 'The player deleted this payout account')
    assert.ok(within(deleted).getByText('000111221'), 'the deleted account is still shown')
    assert.ok(within(deleted).getByRole('button', { name: 'Copy Account Number' }))
    assert.ok(within(deleted).getByText('Completed'))

    assert.equal(within(live).queryByText('Deleted'), null, 'an account without deletedAt is not marked')
    assert.equal(within(liveNull).queryByText('Deleted'), null, 'deletedAt null is a live account')
  })

  test('copies the exact account number and announces it by name', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderTable({ requests: [request(5)] })

    fireEvent.click(screen.getByRole('button', { name: 'Copy Account Number' }))
    await waitFor(() => assert.ok(screen.getByText('Account Number copied')))
    assert.deepStrictEqual(writeText.mock.calls, [['000111225']])
  })

  test('links a player only when the row has a player id and invokes the matching view action', () => {
    const onView = vi.fn()
    const withoutId = request(2, {
      user: { id: '', name: 'Unlinked Player', email: null, phone: null },
    })
    renderTable({ requests: [request(1), withoutId], onView })

    assert.equal(screen.getByRole('link', { name: 'Player 1' }).getAttribute('href'), '/players/profile/user-1')
    assert.equal(screen.getByText('Unlinked Player').closest('a'), null)
    assert.equal(document.querySelector('a[href*="undefined"]'), null)

    fireEvent.click(screen.getByRole('button', { name: 'View details for withdrawal 2' }))
    assert.equal(onView.mock.calls.length, 1)
    assert.ok(onView.mock.calls[0][0] === withoutId)
  })

  test('keeps old rows and actions visible during a refetch, but disables export', () => {
    renderTable({ fetching: true, requests: [request(7)] })

    assert.ok(screen.getByText('Player 7'))
    assert.ok(screen.getByRole('button', { name: 'View details for withdrawal 7' }))
    assert.equal(screen.getByRole('table', { name: 'Withdrawal requests' }).getAttribute('aria-busy'), 'true')
    assert.equal(exportButton().disabled, true)
  })

  test('shows the shared initial loading and empty states without fabricating rows', () => {
    const view = renderTable({ fetching: true, requests: [], total: 0 })
    assert.ok(screen.getByRole('status').textContent?.includes('Loading Withdrawal requests'))

    view.rerender(
      <MemoryRouter>
        <WithdrawalRequestsTable
          requests={[]}
          fetching={false}
          total={0}
          exportFilter={FILTER}
          onView={() => {}}
        />
      </MemoryRouter>,
    )
    assert.ok(screen.getByText('No withdrawal requests found'))
    assert.ok(screen.getByText('0 requests'))
    assert.equal(screen.queryByRole('button', { name: /View details for withdrawal/ }), null)
  })

  test('disables export and never queries when the server total is zero', () => {
    renderTable({ requests: [], total: 0 })
    const button = exportButton()
    assert.equal(button.disabled, true)
    fireEvent.click(button)

    assert.equal(mocks.query.mock.calls.length, 0)
    assert.equal(mocks.exportWithdrawals.mock.calls.length, 0)
    assert.equal(mocks.toast.mock.calls.length, 0)
  })

  test('exports one network-only batch with the exact query input and singular success copy', async () => {
    const only = request(41)
    mocks.query.mockResolvedValue(queryResult([only], 1))
    renderTable({ total: 1 })
    fireEvent.click(exportButton())

    await waitFor(() => assert.equal(mocks.exportWithdrawals.mock.calls.length, 1))
    assert.equal(mocks.query.mock.calls.length, 1)
    assert.equal(mocks.query.mock.calls[0][0].query, ADMIN_WITHDRAWAL_REQUESTS)
    assert.deepEqual(mocks.query.mock.calls[0][0], {
      query: ADMIN_WITHDRAWAL_REQUESTS,
      variables: { input: { ...FILTER, offset: 0, limit: 500 } },
      fetchPolicy: 'network-only',
    })
    assert.deepEqual(mocks.exportWithdrawals.mock.calls[0], [[only], 1])
    await waitFor(() => assert.deepEqual(mocks.toast.mock.calls.at(-1)?.[0], {
      title: 'Export Complete',
      message: '1 withdrawal request exported to Excel.',
      tone: 'ok',
    }))
    assert.equal(exportButton().getAttribute('aria-busy'), null)
  })

  test('follows changing server totals and advances by the actual returned batch length', async () => {
    const first = Array.from({ length: 501 }, (_, index) => request(`a-${index}`))
    const second = [request('b-0')]
    mocks.query
      .mockResolvedValueOnce(queryResult(first, 1_200))
      .mockResolvedValueOnce(queryResult(second, 502))
    renderTable({ total: 1_500 })
    fireEvent.click(exportButton())

    await waitFor(() => assert.equal(mocks.exportWithdrawals.mock.calls.length, 1))
    assert.deepEqual(
      mocks.query.mock.calls.map(([options]) => options.variables.input.offset),
      [0, 501],
    )
    assert.ok(mocks.query.mock.calls.every(([options]) => options.variables.input.limit === 500))
    assert.equal(mocks.exportWithdrawals.mock.calls[0][0].length, 502)
    assert.equal(mocks.exportWithdrawals.mock.calls[0][1], 502)
    assert.deepEqual(mocks.toast.mock.calls.at(-1)?.[0], {
      title: 'Export Complete',
      message: '502 withdrawal requests exported to Excel.',
      tone: 'ok',
    })
  })

  test('writes a short first page, but warns and skips the writer for an empty fetch', async () => {
    const short = [request(8), request(9)]
    mocks.query.mockResolvedValueOnce(queryResult(short, 99))
    const view = renderTable({ total: 99 })
    fireEvent.click(exportButton())
    await waitFor(() => assert.equal(mocks.exportWithdrawals.mock.calls.length, 1))
    assert.deepEqual(mocks.exportWithdrawals.mock.calls[0], [short, 2])

    vi.clearAllMocks()
    mocks.query.mockResolvedValueOnce(queryResult([], 99))
    mocks.exportWithdrawals.mockResolvedValue(undefined)
    view.rerender(
      <MemoryRouter>
        <WithdrawalRequestsTable
          requests={[request(1)]}
          fetching={false}
          total={99}
          exportFilter={FILTER}
          onView={() => {}}
        />
      </MemoryRouter>,
    )
    fireEvent.click(exportButton())
    await waitFor(() => assert.equal(mocks.toast.mock.calls.length, 1))
    assert.equal(mocks.exportWithdrawals.mock.calls.length, 0)
    assert.deepEqual(mocks.toast.mock.calls[0][0], {
      title: 'No Data',
      message: 'There are no withdrawal requests to export.',
      tone: 'warn',
    })
  })

  test.each([
    ['GraphQL result error', () => Promise.resolve(queryResult([], 4, new Error('GraphQL export failed'))), 'GraphQL export failed'],
    ['query rejection', () => Promise.reject(new Error('Network export failed')), 'Network export failed'],
    ['non-Error rejection', () => Promise.reject('offline'), 'Something went wrong during export.'],
  ])('reports %s and always clears the exporting state', async (_case, result, copy) => {
    mocks.query.mockImplementationOnce(result)
    renderTable({ total: 4 })
    fireEvent.click(exportButton())

    await waitFor(() => assert.deepEqual(mocks.toast.mock.calls.at(-1)?.[0], {
      title: 'Export Failed',
      message: copy,
      tone: 'error',
    }))
    assert.equal(mocks.exportWithdrawals.mock.calls.length, 0)
    await waitFor(() => assert.equal(exportButton().getAttribute('aria-busy'), null))
  })

  test('reports a writer rejection and resets the loading button', async () => {
    mocks.query.mockResolvedValueOnce(queryResult([request(1), request(2)], 2))
    mocks.exportWithdrawals.mockRejectedValueOnce(new Error('Workbook save failed'))
    renderTable({ total: 2 })
    fireEvent.click(exportButton())

    await waitFor(() => assert.equal(exportButton().getAttribute('aria-busy'), 'true'))
    await waitFor(() => assert.deepEqual(mocks.toast.mock.calls.at(-1)?.[0], {
      title: 'Export Failed',
      message: 'Workbook save failed',
      tone: 'error',
    }))
    assert.equal(mocks.exportWithdrawals.mock.calls.length, 1)
    await waitFor(() => assert.equal(exportButton().getAttribute('aria-busy'), null))
  })
})
