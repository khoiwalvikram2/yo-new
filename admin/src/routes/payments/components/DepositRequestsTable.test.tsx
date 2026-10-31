import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ADMIN_DEPOSIT_REQUESTS } from '@/lib/graphql/deposits'
import type { DepositRequest } from '../DepositRequests'
import { DepositRequestsTable, type DepositRequestsExportFilter } from './DepositRequestsTable'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  exportDeposits: vi.fn(),
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

vi.mock('../utils/exportDeposits', () => ({
  exportDepositsToExcel: mocks.exportDeposits,
}))

const FILTER: DepositRequestsExportFilter = {
  status: 'PENDING',
  method: 'UPI',
  query: 'player',
  fromDate: '2026-09-01',
  toDate: '2026-09-30',
}

function request(id: number | string, overrides: Partial<DepositRequest> = {}): DepositRequest {
  const key = String(id)
  return {
    id: key,
    userId: `user-${key}`,
    amount: Number(id) || 100,
    currency: 'INR',
    method: 'UPI',
    utr: `UTR-${key}`,
    referenceId: `REF-${key}`,
    proofKey: `deposits/proof-${key}.png`,
    proofUrl: `/proof-${key}.png`,
    status: 'PENDING',
    reviewerId: null,
    reviewedAt: null,
    note: null,
    walletTxnId: null,
    createdAt: '2026-09-21T10:11:12.000Z',
    updatedAt: '2026-09-21T10:11:12.000Z',
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
  requests?: DepositRequest[]
  fetching?: boolean
  total?: number
  onView?: (item: DepositRequest) => void
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
      <DepositRequestsTable
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

function queryResult(items: DepositRequest[], total: number, error?: Error) {
  return { data: { adminDepositRequests: { items, total } }, error }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.query.mockResolvedValue(queryResult([request(1)], 1))
  mocks.exportDeposits.mockResolvedValue(undefined)
})

afterEach(cleanup)

describe('DepositRequestsTable', () => {
  test('uses shared table semantics, split identifiers, formatting, status and preserved footer', () => {
    const footer = <div>Server pagination</div>
    renderTable({
      total: 2,
      footer,
      requests: [
        request(1),
        request(2, {
          method: 'BANK_TRANSFER',
          utr: null,
          referenceId: null,
          status: 'APPROVED',
          user: {
            id: 'user-2',
            name: '',
            email: 'fallback@example.test',
            phone: null,
          },
        }),
      ],
    })

    const table = screen.getByRole('table', { name: 'Deposit requests' })
    assert.deepEqual(
      within(table).getAllByRole('columnheader').map((header) => header.textContent),
      ['ID', 'User', 'Amount', 'Method', 'UTR', 'Reference ID', 'Proof', 'Status', 'Created', 'Actions'],
    )
    assert.ok(screen.getByText('2 requests'))
    assert.ok(screen.getByText('UTR-1'))
    assert.ok(screen.getByText('REF-1'))
    assert.ok(screen.getByText('BANK TRANSFER'))
    assert.ok(screen.getByText('Approved'))
    assert.ok(screen.getByText('fallback@example.test'))
    assert.ok(screen.getByText('AMOUNT:1:INR'))
    assert.ok(screen.getAllByText('—').length >= 2)
    assert.equal(screen.getAllByText('DATE:2026-09-21T10:11:12.000Z:dd MMM yyyy').length, 2)
    assert.equal(screen.getAllByText('TIME:2026-09-21T10:11:12.000Z:HH:mm').length, 2)
    assert.ok(screen.getByText('Server pagination'))
  })

  test('keeps a real player link only when the row has a player id and invokes the matching view action', () => {
    const onView = vi.fn()
    const withoutId = request(2, {
      user: { id: '', name: 'Unlinked Player', email: null, phone: null },
    })
    renderTable({ requests: [request(1), withoutId], onView })

    assert.equal(screen.getByRole('link', { name: 'Player 1' }).getAttribute('href'), '/players/profile/user-1')
    assert.equal(screen.getByText('Unlinked Player').closest('a'), null)

    fireEvent.click(screen.getByRole('button', { name: 'View details for deposit 2' }))
    assert.equal(onView.mock.calls.length, 1)
    assert.equal(onView.mock.calls[0][0], withoutId)
  })

  test('uses the exact proof-validity matrix and exposes previews only for real stored files', () => {
    const rows = [
      request('valid'),
      request('valid-trimmed', {
        proofKey: '  deposits/folder/proof.jpeg  ',
        proofUrl: '  /proof.jpeg  ',
      }),
      request('manual', { proofKey: 'manual' }),
      request('missing-marker', { proofKey: 'proof-missing' }),
      request('no-url', { proofUrl: null }),
      request('non-string-url', { proofUrl: 42 as unknown as string }),
      request('blank-url', { proofUrl: '   ' }),
      request('null-url', { proofUrl: 'null' }),
      request('undefined-url', { proofUrl: 'undefined' }),
      request('non-string-key', { proofKey: 42 as unknown as string }),
      request('wrong-prefix', { proofKey: 'uploads/proof.png' }),
      request('no-extension', { proofKey: 'deposits/proof' }),
      request('empty-key', { proofKey: '' }),
    ]
    renderTable({ requests: rows })

    assert.equal(screen.getAllByRole('button', { name: /View payment proof: Payment proof/ }).length, 2)
  })

  test('keeps old rows and actions visible during refetch, but disables export', () => {
    const onView = vi.fn()
    renderTable({ fetching: true, requests: [request(7)], onView })

    assert.ok(screen.getByText('Player 7'))
    assert.ok(screen.getByRole('button', { name: 'View details for deposit 7' }))
    assert.equal(screen.queryByRole('status'), null)
    assert.equal(screen.getByRole('table', { name: 'Deposit requests' }).getAttribute('aria-busy'), 'true')
    assert.equal(exportButton().disabled, true)
  })

  test('shows the shared initial loading and empty states without fabricating rows', () => {
    const view = renderTable({ fetching: true, requests: [], total: 0 })
    assert.ok(screen.getByRole('status').textContent?.includes('Loading Deposit requests'))

    view.rerender(
      <MemoryRouter>
        <DepositRequestsTable
          requests={[]}
          fetching={false}
          total={0}
          exportFilter={FILTER}
          onView={() => {}}
        />
      </MemoryRouter>,
    )
    assert.ok(screen.getByText('No deposit requests found'))
    assert.equal(screen.queryByRole('button', { name: /View details for deposit/ }), null)
  })

  test('disables export and never queries when the server total is zero', () => {
    renderTable({ requests: [], total: 0 })
    const button = exportButton()
    assert.equal(button.disabled, true)
    fireEvent.click(button)

    assert.equal(mocks.query.mock.calls.length, 0)
    assert.equal(mocks.exportDeposits.mock.calls.length, 0)
    assert.equal(mocks.toast.mock.calls.length, 0)
    assert.equal(exportButton().getAttribute('aria-busy'), null)
  })

  test('exports one network-only batch with the exact query input and singular success copy', async () => {
    const only = request(41)
    mocks.query.mockResolvedValue(queryResult([only], 1))
    renderTable({ total: 1 })
    fireEvent.click(exportButton())

    await waitFor(() => assert.equal(mocks.exportDeposits.mock.calls.length, 1))
    assert.equal(mocks.query.mock.calls.length, 1)
    assert.equal(mocks.query.mock.calls[0][0].query, ADMIN_DEPOSIT_REQUESTS)
    assert.deepEqual(mocks.query.mock.calls[0][0], {
      query: ADMIN_DEPOSIT_REQUESTS,
      variables: { input: { ...FILTER, offset: 0, limit: 500 } },
      fetchPolicy: 'network-only',
    })
    assert.deepEqual(mocks.exportDeposits.mock.calls[0], [[only], 1])
    await waitFor(() => assert.deepEqual(mocks.toast.mock.calls.at(-1)?.[0], {
      title: 'Export Complete',
      message: '1 deposit request exported to Excel.',
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

    await waitFor(() => assert.equal(mocks.exportDeposits.mock.calls.length, 1))
    assert.deepEqual(
      mocks.query.mock.calls.map(([options]) => options.variables.input.offset),
      [0, 501],
    )
    assert.ok(mocks.query.mock.calls.every(([options]) => options.variables.input.limit === 500))
    assert.deepEqual(mocks.exportDeposits.mock.calls[0], [[...first, ...second], 502])
    assert.deepEqual(mocks.toast.mock.calls.at(-1)?.[0], {
      title: 'Export Complete',
      message: '502 deposit requests exported to Excel.',
      tone: 'ok',
    })
  })

  test('writes a short first page, but warns and skips the writer for an empty fetch', async () => {
    const short = [request(8), request(9)]
    mocks.query.mockResolvedValueOnce(queryResult(short, 99))
    const view = renderTable({ total: 99 })
    fireEvent.click(exportButton())
    await waitFor(() => assert.equal(mocks.exportDeposits.mock.calls.length, 1))
    assert.deepEqual(mocks.exportDeposits.mock.calls[0], [short, 2])

    vi.clearAllMocks()
    mocks.query.mockResolvedValueOnce(queryResult([], 99))
    mocks.exportDeposits.mockResolvedValue(undefined)
    view.rerender(
      <MemoryRouter>
        <DepositRequestsTable
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
    assert.equal(mocks.exportDeposits.mock.calls.length, 0)
    assert.deepEqual(mocks.toast.mock.calls[0][0], {
      title: 'No Data',
      message: 'There are no deposit requests to export.',
      tone: 'warn',
    })
    assert.equal(exportButton().getAttribute('aria-busy'), null)
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
    assert.equal(mocks.exportDeposits.mock.calls.length, 0)
    assert.equal(exportButton().getAttribute('aria-busy'), null)
  })

  test('reports a writer rejection, retains the plural failure copy and resets the loading button', async () => {
    mocks.query.mockResolvedValueOnce(queryResult([request(1), request(2)], 2))
    mocks.exportDeposits.mockRejectedValueOnce(new Error('Workbook save failed'))
    renderTable({ total: 2 })
    fireEvent.click(exportButton())

    await waitFor(() => assert.equal(exportButton().getAttribute('aria-busy'), 'true'))
    await waitFor(() => assert.deepEqual(mocks.toast.mock.calls.at(-1)?.[0], {
      title: 'Export Failed',
      message: 'Workbook save failed',
      tone: 'error',
    }))
    assert.equal(mocks.exportDeposits.mock.calls.length, 1)
    await waitFor(() => assert.equal(exportButton().getAttribute('aria-busy'), null))
  })
})
