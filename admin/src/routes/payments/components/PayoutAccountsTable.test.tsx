import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PayoutAccountsTable, type PayoutAccountItem } from './PayoutAccountsTable'

const mocks = vi.hoisted(() => ({
  exportPayoutAccounts: vi.fn(),
  toast: vi.fn(),
  formatDate: vi.fn((value: string, pattern?: string) => `DATE:${value}:${pattern}`),
  formatTime: vi.fn((value: string, pattern?: string) => `TIME:${value}:${pattern}`),
}))

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({ formatDate: mocks.formatDate, formatTime: mocks.formatTime }),
}))

vi.mock('@/ui/components/toast', () => ({ toast: mocks.toast }))

vi.mock('../utils/exportPayoutAccounts', () => ({
  exportPayoutAccountsToExcel: mocks.exportPayoutAccounts,
}))

function account(id: number | string, overrides: Partial<PayoutAccountItem> = {}): PayoutAccountItem {
  const key = String(id)
  return {
    id: key,
    userId: `user-${key}`,
    method: 'BANK',
    accountNumber: `5010023456${key}`,
    ifscCode: `HDFC000${key}`,
    bankName: 'HDFC Bank',
    accountHolderName: `Holder ${key}`,
    approvalStatus: 'PENDING',
    rejectionReason: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: '2026-09-21T10:11:12.000Z',
    user: {
      id: `user-${key}`,
      name: `Player ${key}`,
      phone: `900000${key}`,
      email: `player-${key}@example.test`,
    },
    ...overrides,
  }
}

interface RenderOptions {
  items?: PayoutAccountItem[]
  fetching?: boolean
  total?: number
  onView?: (item: PayoutAccountItem) => void
  footer?: ReactNode
}

function renderTable({
  items = [account(1)],
  fetching = false,
  total = items.length,
  onView = () => {},
  footer,
}: RenderOptions = {}) {
  return render(
    <MemoryRouter>
      <PayoutAccountsTable items={items} fetching={fetching} total={total} onView={onView} footer={footer} />
    </MemoryRouter>,
  )
}

function exportButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Export Excel' }) as HTMLButtonElement
}

function bodyRows(): HTMLElement[] {
  return within(screen.getByRole('table', { name: 'Payout accounts' })).getAllByRole('row').slice(1)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.exportPayoutAccounts.mockResolvedValue(undefined)
})

afterEach(cleanup)

describe('PayoutAccountsTable', () => {
  test('keeps the legacy columns, count, labels, dates and the supplied footer', () => {
    renderTable({
      total: 3,
      footer: <div>Server pagination</div>,
      items: [
        account(1),
        account(2, { method: 'UPI', approvalStatus: 'APPROVED', ifscCode: null, bankName: null }),
        account(3, { approvalStatus: 'REJECTED', createdAt: '' }),
      ],
    })

    const table = screen.getByRole('table', { name: 'Payout accounts' })
    assert.deepEqual(
      within(table).getAllByRole('columnheader').map((header) => header.textContent),
      ['User', 'Type', 'Account Details', 'Status', 'Created', 'Actions'],
    )
    assert.ok(screen.getByRole('heading', { name: 'Payout Account Approvals', level: 2 }))
    assert.ok(screen.getByText('3 accounts'))

    const [bank, upi, rejected] = bodyRows()
    const typeAndStatus = (row: HTMLElement) => {
      const cells = within(row).getAllByRole('cell')
      return [cells[1].textContent, cells[3].textContent]
    }
    assert.deepEqual(typeAndStatus(bank), ['Bank', 'Pending'])
    assert.deepEqual(typeAndStatus(upi), ['UPI', 'Approved'])
    assert.deepEqual(typeAndStatus(rejected), ['Bank', 'Rejected'])
    assert.ok(within(bank).getByText('DATE:2026-09-21T10:11:12.000Z:dd MMM yyyy'))
    assert.ok(within(bank).getByText('TIME:2026-09-21T10:11:12.000Z:HH:mm'))
    assert.equal(within(rejected).getAllByText('—').length, 2, 'a missing date shows a dash on both lines')
    assert.ok(screen.getByText('Server pagination'))
  })

  test('summarises a bank account in four lines and a UPI account in two, each copyable by name', () => {
    renderTable({
      items: [
        account(1),
        account(2, { method: 'UPI', accountNumber: 'player2@okaxis', ifscCode: null, bankName: null }),
        account(3, { ifscCode: '', bankName: null }),
      ],
    })
    const [bank, upi, partial] = bodyRows()

    assert.deepEqual(
      within(bank).getAllByRole('term').map((term) => term.textContent),
      ['Holder', 'Account No', 'IFSC', 'Bank'],
    )
    assert.equal(within(bank).getByText('50100234561').getAttribute('title'), '50100234561')
    assert.ok(within(bank).getByRole('button', { name: 'Copy Holder' }))
    assert.ok(within(bank).getByRole('button', { name: 'Copy Account No' }))
    assert.ok(within(bank).getByRole('button', { name: 'Copy IFSC' }))
    assert.ok(within(bank).getByRole('button', { name: 'Copy Bank' }))

    assert.deepEqual(within(upi).getAllByRole('term').map((term) => term.textContent), ['Holder', 'UPI ID'])
    assert.ok(within(upi).getByText('player2@okaxis'))
    assert.ok(within(upi).getByRole('button', { name: 'Copy UPI ID' }))

    assert.deepEqual(within(partial).getAllByRole('term').map((term) => term.textContent), ['Holder', 'Account No'])
  })

  test('copies the exact account number and announces it by name', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderTable({ items: [account(5)] })

    fireEvent.click(screen.getByRole('button', { name: 'Copy Account No' }))
    await waitFor(() => assert.ok(screen.getByText('Account No copied')))
    assert.deepStrictEqual(writeText.mock.calls, [['50100234565']])
  })

  test('links a user only with a real id, falls back to dashes and opens the matching row', () => {
    const onView = vi.fn()
    const unlinked = account(2, { user: { id: '', name: 'Unlinked Player', phone: null, email: null } })
    const noUser = account(3, { user: null })
    renderTable({ items: [account(1), unlinked, noUser], onView })

    assert.equal(screen.getByRole('link', { name: 'Player 1' }).getAttribute('href'), '/players/profile/user-1')
    assert.ok(screen.getByText('9000001'), 'the table prefers the phone')
    assert.equal(screen.getByText('Unlinked Player').closest('a'), null)
    assert.equal(document.querySelector('a[href*="undefined"]'), null)
    const [, unlinkedRow, noUserRow] = bodyRows()
    assert.ok(within(unlinkedRow).getByText('—'))
    assert.equal(within(noUserRow).getAllByText('—').length, 2)

    fireEvent.click(screen.getByRole('button', { name: 'View details for payout account 2' }))
    assert.equal(onView.mock.calls.length, 1)
    assert.ok(onView.mock.calls[0][0] === unlinked)
  })

  test('keeps rows visible during a refetch but disables export', () => {
    renderTable({ fetching: true, items: [account(7)] })

    assert.ok(screen.getByText('Player 7'))
    assert.ok(screen.getByRole('button', { name: 'View details for payout account 7' }))
    assert.equal(screen.getByRole('table', { name: 'Payout accounts' }).getAttribute('aria-busy'), 'true')
    assert.equal(exportButton().disabled, true)
  })

  test('shows the loading and empty states and disables export without rows', () => {
    const view = renderTable({ fetching: true, items: [], total: 0 })
    assert.match(screen.getByRole('status').textContent ?? '', /Loading Payout accounts/)

    view.rerender(
      <MemoryRouter>
        <PayoutAccountsTable items={[]} fetching={false} total={0} onView={() => {}} />
      </MemoryRouter>,
    )
    assert.ok(screen.getByText('No payout accounts found'))
    assert.ok(screen.getByText('0 accounts'))
    assert.equal(exportButton().disabled, true)
    fireEvent.click(exportButton())
    assert.equal(mocks.exportPayoutAccounts.mock.calls.length, 0)
  })

  test('says one account in the singular', () => {
    renderTable({ items: [account(1)], total: 1 })
    assert.ok(screen.getByText('1 account'))
  })

  test('exports the rows on screen with the server total and the legacy success copy', async () => {
    const rows = [account(1), account(2)]
    renderTable({ items: rows, total: 40 })
    fireEvent.click(exportButton())

    await waitFor(() => assert.equal(mocks.toast.mock.calls.length, 1))
    assert.equal(mocks.exportPayoutAccounts.mock.calls.length, 1)
    assert.ok(mocks.exportPayoutAccounts.mock.calls[0][0] === rows)
    assert.equal(mocks.exportPayoutAccounts.mock.calls[0][1], 40)
    assert.deepEqual(mocks.toast.mock.calls[0][0], {
      title: 'Export Complete',
      message: 'Payout accounts exported to Excel successfully.',
      tone: 'ok',
    })
    await waitFor(() => assert.equal(exportButton().getAttribute('aria-busy'), null))
  })

  test.each([
    ['an Error', new Error('Workbook save failed'), 'Workbook save failed'],
    ['a non-Error rejection', 'offline', 'Something went wrong during export.'],
  ])('reports %s and clears the exporting state', async (_case, failure, copy) => {
    mocks.exportPayoutAccounts.mockRejectedValueOnce(failure)
    renderTable({ items: [account(1)], total: 1 })
    fireEvent.click(exportButton())

    await waitFor(() => assert.equal(mocks.toast.mock.calls.length, 1))
    assert.deepEqual(mocks.toast.mock.calls[0][0], { title: 'Export Failed', message: copy, tone: 'error' })
    await waitFor(() => assert.equal(exportButton().getAttribute('aria-busy'), null))
  })
})
