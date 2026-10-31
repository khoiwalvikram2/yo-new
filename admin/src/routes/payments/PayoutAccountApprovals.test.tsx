import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import {
  ADMIN_PAYOUT_ACCOUNTS,
  APPROVE_PAYOUT_ACCOUNT,
  REJECT_PAYOUT_ACCOUNT,
} from '@/lib/graphql/payoutAccounts'
import PayoutAccountApprovalsPage from './PayoutAccountApprovals'
import type { PayoutAccountItem } from './payoutAccountApprovalsModel'

interface QueryOptions {
  variables: { input: Record<string, unknown> }
  errorPolicy: string
  fetchPolicy: string
}

interface MutationPayload {
  success?: boolean
  message?: string | null
}

interface MutationOptions {
  context?: { skipNotification?: boolean }
  onCompleted?: (data: {
    approvePayoutAccount?: MutationPayload
    rejectPayoutAccount?: MutationPayload
  }) => void
  onError?: (error: Error) => void
}

interface ConfirmOptions {
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: string
  onConfirm?: () => void | Promise<void>
}

interface FilterProps {
  status: string
  query: string
  onChangeStatus: (value: string) => void
  onChangeQuery: (value: string) => void
  onChangeDateRange: (range: { from?: string; to?: string } | null) => void
  onClearAll: () => void
}

interface TableProps {
  items: PayoutAccountItem[]
  fetching: boolean
  total?: number
  onView: (item: PayoutAccountItem) => void
  footer?: ReactNode
}

interface DrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  restoreFocusTo?: { readonly current: HTMLElement | null }
}

const hooks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  refetch: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
}))

const feedback = vi.hoisted(() => ({
  confirm: vi.fn(),
  toast: vi.fn(),
}))

const rbacCalls = vi.hoisted(() => [] as Array<{
  required: Array<{ domain: string; actions: string[]; mode?: string }>
  requireAny?: boolean
}>)
const rbacState = vi.hoisted(() => ({ allowed: true }))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  return {
    ...actual,
    useQuery: hooks.useQuery,
    useMutation: hooks.useMutation,
  }
})

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDateTime: (value: string, pattern: string) => `formatted:${value}:${pattern}`,
  }),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({
    required,
    requireAny,
    children,
  }: {
    required: Array<{ domain: string; actions: string[]; mode?: string }>
    requireAny?: boolean
    children: ReactNode
  }) => {
    rbacCalls.push({ required, requireAny })
    return rbacState.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/ui/components/confirm', () => ({ confirm: feedback.confirm }))
vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))

vi.mock('@/ui/components/Drawer', async () => {
  const React = await import('react')
  return {
    Drawer: ({ open, onOpenChange, title, children, footer, restoreFocusTo }: DrawerProps) => {
      const wasOpen = React.useRef(false)

      React.useEffect(() => {
        if (!open && wasOpen.current) queueMicrotask(() => restoreFocusTo?.current?.focus())
        wasOpen.current = open
      }, [open, restoreFocusTo])

      if (!open) return null
      return (
        <div role="dialog" aria-label={typeof title === 'string' ? title : undefined}>
          <h2>{title}</h2>
          <button type="button" aria-label="Close dialog" onClick={() => onOpenChange(false)}>
            Close
          </button>
          <div>{children}</div>
          {footer ? <footer>{footer}</footer> : null}
        </div>
      )
    },
  }
})

vi.mock('./components/PayoutAccountsStatsCards', () => ({
  PayoutAccountsStatsCards: () => <section aria-label="Payout account statistics" />,
}))

vi.mock('./components/PayoutAccountsFiltersBar', () => ({
  PayoutAccountsFiltersBar: (props: FilterProps) => (
    <section aria-label="Mock payout filters">
      <output data-testid="filter-state">{`${props.status}|${props.query}`}</output>
      <button type="button" onClick={() => props.onChangeStatus('APPROVED')}>Set approved</button>
      <button type="button" onClick={() => props.onChangeQuery('x')}>Search one character</button>
      <button type="button" onClick={() => props.onChangeQuery('  98  ')}>Search phone</button>
      <button
        type="button"
        onClick={() => props.onChangeDateRange({ from: '2026-09-01', to: '2026-09-30' })}
      >
        Set custom dates
      </button>
      <button type="button" onClick={() => props.onChangeDateRange({ from: '2026-09-01' })}>Set half range</button>
      <button type="button" onClick={() => props.onChangeDateRange(null)}>Clear dates</button>
      <button type="button" onClick={props.onClearAll}>Clear All</button>
    </section>
  ),
}))

vi.mock('./components/PayoutAccountsTable', () => ({
  PayoutAccountsTable: (props: TableProps) => (
    <section aria-label="Mock payout table">
      <output data-testid="table-state">
        {JSON.stringify({ fetching: props.fetching, total: props.total, rows: props.items.length })}
      </output>
      {props.items.map((item) => (
        <button key={item.id} type="button" onClick={() => props.onView(item)}>
          View account {item.id}
        </button>
      ))}
      {props.footer}
    </section>
  ),
}))

function operationName(document: unknown): string | undefined {
  const definition = (document as {
    definitions?: Array<{ name?: { value?: string } }>
  }).definitions?.[0]
  return definition?.name?.value
}

function makeAccount(overrides: Partial<PayoutAccountItem> = {}): PayoutAccountItem {
  return {
    id: 'pa-1',
    userId: 'user-1',
    method: 'BANK',
    accountNumber: '50100234567812',
    ifscCode: 'HDFC0001204',
    bankName: 'HDFC Bank',
    accountHolderName: 'Vijay Kumar',
    approvalStatus: 'PENDING',
    rejectionReason: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: '2026-09-22T08:30:00.000Z',
    user: {
      id: 'user-1',
      name: 'Vijay Kumar',
      phone: '9000000001',
      email: 'vijay@example.test',
    },
    ...overrides,
  }
}

let queryData: { adminPayoutAccounts: { items: PayoutAccountItem[]; total: number } }
let latestQueryOptions: QueryOptions | undefined
let approveOptions: MutationOptions | undefined
let rejectOptions: MutationOptions | undefined
let mutationDocuments: unknown[]
let refetchSnapshots: Array<QueryOptions['variables']>

function renderPage() {
  return render(
    <MemoryRouter>
      <PageEyebrowProvider value="Payment operations">
        <PayoutAccountApprovalsPage />
      </PageEyebrowProvider>
    </MemoryRouter>,
  )
}

function dialogButton(dialog: HTMLElement, label: string): HTMLButtonElement {
  const button = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === label)
  assert.ok(button, `Expected dialog button: ${label}`)
  return button
}

function hasDialogButton(dialog: HTMLElement, label: string): boolean {
  return [...dialog.querySelectorAll('button')].some((button) => button.textContent?.trim() === label)
}

async function openAccount(id = 'pa-1') {
  fireEvent.click(screen.getByRole('button', { name: `View account ${id}` }))
  return screen.findByRole('dialog', { name: `Payout Account - #${id}` })
}

function confirmCopy(index = 0) {
  const confirmation = feedback.confirm.mock.calls[index]?.[0] as ConfirmOptions
  return {
    title: confirmation.title,
    description: confirmation.description,
    confirmLabel: confirmation.confirmLabel,
    cancelLabel: confirmation.cancelLabel,
    tone: confirmation.tone,
  }
}

beforeEach(() => {
  queryData = { adminPayoutAccounts: { items: [makeAccount()], total: 25 } }
  latestQueryOptions = undefined
  approveOptions = undefined
  rejectOptions = undefined
  mutationDocuments = []
  refetchSnapshots = []
  rbacCalls.length = 0
  rbacState.allowed = true

  hooks.useQuery.mockReset()
  hooks.useMutation.mockReset()
  hooks.refetch.mockReset()
  hooks.approve.mockReset()
  hooks.reject.mockReset()
  feedback.confirm.mockReset()
  feedback.toast.mockReset()

  hooks.refetch.mockImplementation(() => {
    if (latestQueryOptions) refetchSnapshots.push(latestQueryOptions.variables)
    return Promise.resolve({ data: queryData })
  })
  hooks.useQuery.mockImplementation((_document: unknown, options: QueryOptions) => {
    latestQueryOptions = options
    return { data: queryData, loading: false, refetch: hooks.refetch }
  })
  hooks.useMutation.mockImplementation((document: unknown, options: MutationOptions) => {
    mutationDocuments.push(document)
    if (operationName(document) === 'ApprovePayoutAccount') {
      approveOptions = options
      return [hooks.approve, { loading: false }]
    }
    rejectOptions = options
    return [hooks.reject, { loading: false }]
  })
  hooks.approve.mockResolvedValue({ data: { approvePayoutAccount: { success: false } } })
  hooks.reject.mockResolvedValue({ data: { rejectPayoutAccount: { success: false } } })
  feedback.confirm.mockResolvedValue(false)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PayoutAccountApprovalsPage query and access contracts', () => {
  test('keeps the exact unfiltered list query, both mutations, the guard and the header', () => {
    renderPage()

    assert.ok(hooks.useQuery.mock.calls.every(([document]) => document === ADMIN_PAYOUT_ACCOUNTS))
    assert.deepStrictEqual(latestQueryOptions, {
      variables: {
        input: {
          status: undefined,
          query: undefined,
          fromDate: undefined,
          toDate: undefined,
          offset: 0,
          limit: 10,
        },
      },
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    })
    assert.ok(mutationDocuments.includes(APPROVE_PAYOUT_ACCOUNT))
    assert.ok(mutationDocuments.includes(REJECT_PAYOUT_ACCOUNT))
    assert.deepStrictEqual(approveOptions?.context, { skipNotification: true })
    assert.deepStrictEqual(rejectOptions?.context, { skipNotification: true })
    assert.deepStrictEqual(rbacCalls.at(-1), {
      required: [{ domain: 'payments.withdrawals', actions: ['view', 'approve', 'reject'] }],
      requireAny: undefined,
    })
    assert.ok(screen.queryByText('Payment operations') === null)
    assert.ok(screen.getByRole('heading', { name: 'Payout Account Approvals', level: 1 }))
    assert.ok(screen.queryByText(
      'Approve or reject user withdrawal accounts. Only approved accounts can be used for withdrawals.',
    ) === null)
    assert.ok(screen.getByLabelText('Payout account statistics'))

    hooks.refetch.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    assert.equal(hooks.refetch.mock.calls.length, 1)
  })

  test('does not mount page content or start a query or mutation when the guard denies access', () => {
    rbacState.allowed = false
    renderPage()

    assert.match(screen.getByRole('alert').textContent ?? '', /Access denied/)
    assert.equal(screen.queryByRole('heading', { name: 'Payout Account Approvals' }), null)
    assert.equal(hooks.useQuery.mock.calls.length, 0)
    assert.equal(hooks.useMutation.mock.calls.length, 0)
    assert.deepStrictEqual(rbacCalls.at(-1), {
      required: [{ domain: 'payments.withdrawals', actions: ['view', 'approve', 'reject'] }],
      requireAny: undefined,
    })
  })

  test('updates paging and filter variables, enforces the two-character search and resets the offset', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    await waitFor(() => assert.equal(latestQueryOptions?.variables.input.offset, 10))

    fireEvent.click(screen.getByRole('button', { name: 'Set approved' }))
    await waitFor(() => {
      assert.equal(latestQueryOptions?.variables.input.status, 'APPROVED')
      assert.equal(latestQueryOptions?.variables.input.offset, 0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Search one character' }))
    await waitFor(() => assert.equal(latestQueryOptions?.variables.input.query, undefined))

    fireEvent.click(screen.getByRole('button', { name: 'Search phone' }))
    await waitFor(
      () => assert.equal(latestQueryOptions?.variables.input.query, '98'),
      { timeout: 1000 },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Set custom dates' }))
    await waitFor(() => {
      assert.equal(latestQueryOptions?.variables.input.fromDate, '2026-09-01')
      assert.equal(latestQueryOptions?.variables.input.toDate, '2026-09-30')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Set half range' }))
    await waitFor(() => {
      assert.equal(latestQueryOptions?.variables.input.fromDate, undefined)
      assert.equal(latestQueryOptions?.variables.input.toDate, undefined)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Set custom dates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear dates' }))
    await waitFor(() => assert.equal(latestQueryOptions?.variables.input.fromDate, undefined))

    fireEvent.change(screen.getByLabelText('Rows per page:'), { target: { value: '20' } })
    await waitFor(() => {
      assert.equal(latestQueryOptions?.variables.input.limit, 20)
      assert.equal(latestQueryOptions?.variables.input.offset, 0)
    })
    assert.equal(screen.getByTestId('filter-state').textContent, 'APPROVED|  98  ')
  })

  test('Clear All keeps the immediate stale refetch, then clears every filter', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Set approved' }))
    fireEvent.click(screen.getByRole('button', { name: 'Set custom dates' }))
    await waitFor(() => {
      assert.equal(latestQueryOptions?.variables.input.status, 'APPROVED')
      assert.equal(latestQueryOptions?.variables.input.fromDate, '2026-09-01')
    })

    refetchSnapshots.length = 0
    fireEvent.click(screen.getByRole('button', { name: 'Clear All' }))

    assert.deepStrictEqual(refetchSnapshots[0], {
      input: {
        ...latestQueryOptions?.variables.input,
        status: 'APPROVED',
        fromDate: '2026-09-01',
        toDate: '2026-09-30',
      },
    })
    await waitFor(() => {
      assert.equal(latestQueryOptions?.variables.input.status, undefined)
      assert.equal(latestQueryOptions?.variables.input.fromDate, undefined)
      assert.equal(latestQueryOptions?.variables.input.toDate, undefined)
    })
    assert.equal(screen.getByTestId('filter-state').textContent, '|')
  })
})

describe('PayoutAccountApprovalsPage drawer', () => {
  test('shows a pending bank account with its copy actions and review controls, then restores focus', async () => {
    renderPage()
    const trigger = screen.getByRole('button', { name: 'View account pa-1' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Payout Account - #pa-1' })

    assert.ok(within(dialog).getAllByText('Vijay Kumar').length >= 1)
    assert.ok(within(dialog).getByText('vijay@example.test'), 'the drawer prefers the email')
    assert.equal(within(dialog).getByRole('link', { name: 'View Profile' }).getAttribute('href'), '/players/profile/user-1')
    assert.ok(within(dialog).getByRole('heading', { name: 'Account Details', level: 3 }))
    assert.ok(within(dialog).getByRole('heading', { name: 'Approval Status', level: 3 }))
    assert.ok(within(dialog).getByText('Bank'))
    assert.ok(within(dialog).getByText('50100234567812'))
    for (const label of ['Account Holder Name', 'Account Number', 'IFSC', 'Bank Name']) {
      assert.ok(within(dialog).getByRole('button', { name: `Copy ${label}` }), label)
    }
    assert.ok(within(dialog).getByText('Pending'))
    assert.ok(within(dialog).getByText('formatted:2026-09-22T08:30:00.000Z:dd MMM yyyy, HH:mm:ss'))
    assert.equal(within(dialog).queryByText('Reviewed At'), null)
    assert.equal(within(dialog).queryByText('Reviewer ID'), null)
    assert.equal(within(dialog).queryByRole('complementary', { name: 'Rejection reason' }), null)
    assert.ok(within(dialog).getByText('Optional note if rejecting this account'))
    assert.ok(within(dialog).getByText('Review this account'))
    assert.ok(hasDialogButton(dialog, 'Reject'))
    assert.ok(hasDialogButton(dialog, 'Approve'))

    const reason = within(dialog).getByRole('textbox', { name: 'Rejection reason' }) as HTMLTextAreaElement
    assert.equal(reason.getAttribute('placeholder'), 'Enter reason for rejection (optional, shown to user)...')
    fireEvent.change(reason, { target: { value: 'draft' } })

    fireEvent.click(dialogButton(dialog, 'Cancel'))
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    await waitFor(() => assert.ok(document.activeElement === trigger, 'focus returns to the row action'))

    const reopened = await openAccount()
    assert.equal(
      (within(reopened).getByRole('textbox', { name: 'Rejection reason' }) as HTMLTextAreaElement).value,
      '',
    )
  })

  test('copies a drawer value byte-for-byte and announces it by name', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    renderPage()
    const dialog = await openAccount()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy IFSC' }))

    await waitFor(() => assert.ok(within(dialog).getByText('IFSC copied')))
    assert.deepStrictEqual(writeText.mock.calls, [['HDFC0001204']])
  })

  test('renders an approved account read-only with its review details and no player link', async () => {
    queryData = {
      adminPayoutAccounts: {
        items: [makeAccount({
          approvalStatus: 'APPROVED',
          approvedAt: '2026-09-22T09:00:00.000Z',
          approvedBy: 'admin-7',
          user: null,
        })],
        total: 1,
      },
    }
    renderPage()
    const dialog = await openAccount()

    assert.ok(within(dialog).getByText('This account has been approved'))
    assert.ok(hasDialogButton(dialog, 'Close'))
    for (const label of ['Cancel', 'Reject', 'Approve']) {
      assert.equal(hasDialogButton(dialog, label), false, label)
    }
    assert.equal(within(dialog).queryByRole('textbox'), null)
    assert.equal(within(dialog).queryByRole('link', { name: 'View Profile' }), null)
    assert.equal(document.querySelector('a[href*="undefined"]'), null)
    assert.ok(within(dialog).getByText('N/A'))
    assert.ok(within(dialog).getByText('No contact info'))
    assert.ok(within(dialog).getByText('Approved'))
    assert.ok(within(dialog).getByText('Reviewed At'))
    assert.ok(within(dialog).getByText('formatted:2026-09-22T09:00:00.000Z:dd MMM yyyy, HH:mm:ss'))
    assert.ok(within(dialog).getByText('admin-7'))
  })

  test('labels a UPI account by its VPA, hides empty bank rows and shows a recorded rejection', async () => {
    queryData = {
      adminPayoutAccounts: {
        items: [makeAccount({
          method: 'UPI',
          accountNumber: 'vijay@okaxis',
          ifscCode: null,
          bankName: '',
          approvalStatus: 'REJECTED',
          rejectionReason: 'Name does not match KYC',
        })],
        total: 1,
      },
    }
    renderPage()
    const dialog = await openAccount()

    assert.ok(within(dialog).getByText('UPI'))
    assert.ok(within(dialog).getByText('UPI ID'))
    assert.ok(within(dialog).getByRole('button', { name: 'Copy UPI ID' }))
    assert.equal(within(dialog).queryByText('IFSC'), null)
    assert.equal(within(dialog).queryByText('Bank Name'), null)
    const rejection = within(dialog).getByRole('complementary', { name: 'Rejection reason' })
    assert.ok(within(rejection).getByText('Name does not match KYC'))
    assert.ok(within(dialog).getByText('This account has been rejected'))
    assert.equal(within(dialog).queryByRole('textbox'), null)
  })
})

describe('PayoutAccountApprovalsPage review actions', () => {
  test('approves with the exact confirmation and payload, closes and shows the fallback toast', async () => {
    feedback.confirm.mockImplementation(async (options: ConfirmOptions) => {
      await options.onConfirm?.()
      return true
    })
    hooks.approve.mockImplementation(async () => {
      const data = { approvePayoutAccount: { success: true, message: '' } }
      approveOptions?.onCompleted?.(data)
      return { data }
    })

    renderPage()
    const dialog = await openAccount()
    hooks.refetch.mockClear()
    fireEvent.click(dialogButton(dialog, 'Approve'))

    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    assert.deepStrictEqual(confirmCopy(), {
      title: 'Approve Account',
      description: 'Allow this user to use this account for withdrawals?',
      confirmLabel: 'Yes, Approve',
      cancelLabel: 'Cancel',
      tone: undefined,
    })
    assert.deepStrictEqual(hooks.approve.mock.calls[0]?.[0], { variables: { input: { id: 'pa-1' } } })
    assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], { message: 'Account approved', tone: 'ok' })
    assert.equal(hooks.refetch.mock.calls.length, 1)
    assert.equal(hooks.reject.mock.calls.length, 0)
  })

  test('rejects with a danger confirmation and the trimmed reason, showing the server message', async () => {
    feedback.confirm.mockImplementation(async (options: ConfirmOptions) => {
      await options.onConfirm?.()
      return true
    })
    hooks.reject.mockImplementation(async () => {
      const data = { rejectPayoutAccount: { success: true, message: 'Payout account rejected' } }
      rejectOptions?.onCompleted?.(data)
      return { data }
    })

    renderPage()
    const dialog = await openAccount()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Rejection reason' }), {
      target: { value: '  Name does not match KYC  ' },
    })
    fireEvent.click(dialogButton(dialog, 'Reject'))

    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    assert.deepStrictEqual(confirmCopy(), {
      title: 'Reject Account',
      description: 'Are you sure you want to reject this account?',
      confirmLabel: 'Yes, Reject',
      cancelLabel: 'Cancel',
      tone: 'danger',
    })
    assert.deepStrictEqual(hooks.reject.mock.calls[0]?.[0], {
      variables: { input: { id: 'pa-1', reason: 'Name does not match KYC' } },
    })
    assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], { message: 'Payout account rejected', tone: 'ok' })
  })

  test('omits a blank rejection reason and falls back to the legacy success copy', async () => {
    feedback.confirm.mockImplementation(async (options: ConfirmOptions) => {
      await options.onConfirm?.()
      return true
    })
    hooks.reject.mockImplementation(async () => {
      const data = { rejectPayoutAccount: { success: true, message: null } }
      rejectOptions?.onCompleted?.(data)
      return { data }
    })

    renderPage()
    const dialog = await openAccount()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Rejection reason' }), { target: { value: '   ' } })
    fireEvent.click(dialogButton(dialog, 'Reject'))

    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    assert.deepStrictEqual(hooks.reject.mock.calls[0]?.[0], {
      variables: { input: { id: 'pa-1', reason: undefined } },
    })
    assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], { message: 'Account rejected', tone: 'ok' })
  })

  test('keeps the drawer when a confirmation is cancelled', async () => {
    renderPage()
    const dialog = await openAccount()
    fireEvent.click(dialogButton(dialog, 'Approve'))
    await waitFor(() => assert.equal(feedback.confirm.mock.calls.length, 1))
    fireEvent.click(dialogButton(dialog, 'Reject'))
    await waitFor(() => assert.equal(feedback.confirm.mock.calls.length, 2))

    assert.equal(hooks.approve.mock.calls.length, 0)
    assert.equal(hooks.reject.mock.calls.length, 0)
    assert.ok(screen.getByRole('dialog', { name: 'Payout Account - #pa-1' }))
  })

  test('keeps the drawer and reason after a failed approval and reuses onConfirm for retry', async () => {
    let capturedConfirmation: ConfirmOptions | undefined
    feedback.confirm.mockImplementation(async (options: ConfirmOptions) => {
      capturedConfirmation = options
      try {
        await options.onConfirm?.()
      } catch {
        return false
      }
      return true
    })
    hooks.approve.mockImplementation(async () => {
      const error = new Error('')
      approveOptions?.onError?.(error)
      throw error
    })

    renderPage()
    const dialog = await openAccount()
    const reason = within(dialog).getByRole('textbox', { name: 'Rejection reason' }) as HTMLTextAreaElement
    fireEvent.change(reason, { target: { value: 'keep me' } })
    fireEvent.click(dialogButton(dialog, 'Approve'))

    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], { message: 'Failed to approve', tone: 'error' })
    assert.ok(screen.getByRole('dialog', { name: 'Payout Account - #pa-1' }))
    assert.equal(reason.value, 'keep me')
    assert.ok(capturedConfirmation?.onConfirm)

    hooks.approve.mockImplementation(async () => {
      const data = { approvePayoutAccount: { success: true, message: 'Approved on retry' } }
      approveOptions?.onCompleted?.(data)
      return { data }
    })
    await act(async () => {
      await capturedConfirmation?.onConfirm?.()
    })
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    assert.equal(hooks.approve.mock.calls.length, 2)
    assert.deepStrictEqual(hooks.approve.mock.calls[1]?.[0], { variables: { input: { id: 'pa-1' } } })
    assert.deepStrictEqual(feedback.toast.mock.calls[1]?.[0], { message: 'Approved on retry', tone: 'ok' })
  })

  test('keeps a false-success rejection inside the confirmation without a toast', async () => {
    let confirmationFailure: Error | undefined
    feedback.confirm.mockImplementation(async (options: ConfirmOptions) => {
      try {
        await options.onConfirm?.()
      } catch (error) {
        confirmationFailure = error as Error
      }
      return false
    })
    hooks.reject.mockResolvedValue({
      data: { rejectPayoutAccount: { success: false, message: 'Account is already reviewed' } },
    })

    renderPage()
    const dialog = await openAccount()
    fireEvent.click(dialogButton(dialog, 'Reject'))

    await waitFor(() => assert.equal(confirmationFailure?.message, 'Account is already reviewed'))
    assert.ok(screen.getByRole('dialog', { name: 'Payout Account - #pa-1' }))
    assert.equal(feedback.toast.mock.calls.length, 0)
  })

  test('a false success with no message names the failed action', async () => {
    let confirmationFailure: Error | undefined
    feedback.confirm.mockImplementation(async (options: ConfirmOptions) => {
      try {
        await options.onConfirm?.()
      } catch (error) {
        confirmationFailure = error as Error
      }
      return false
    })

    renderPage()
    const dialog = await openAccount()
    fireEvent.click(dialogButton(dialog, 'Approve'))

    await waitFor(() => assert.equal(confirmationFailure?.message, 'Failed to approve'))
    assert.ok(screen.getByRole('dialog', { name: 'Payout Account - #pa-1' }))
  })
})
