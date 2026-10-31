import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { ADMIN_WITHDRAWAL_REQUESTS, SET_WITHDRAWAL_STATUS } from '@/lib/graphql/withdrawals'
import { ADMIN_WITHDRAWAL_HISTORY } from '@/lib/graphql/withdrawalHistory'
import WithdrawalRequestsPage from './WithdrawalRequests'
import {
  getWithdrawalRangeForPreset,
  type WithdrawalHistoryEntry,
  type WithdrawalRequest,
} from './withdrawalRequestsModel'

interface QueryOptions {
  variables: { input: Record<string, unknown> }
  errorPolicy: string
  pollInterval: number
  fetchPolicy: string
}

interface HistoryQueryOptions {
  variables: { id: string }
  skip: boolean
  fetchPolicy: string
}

interface MutationPayload {
  success?: boolean
  message?: string | null
}

interface MutationOptions {
  context?: { skipNotification?: boolean }
  onCompleted?: (data: { setWithdrawalStatus?: MutationPayload }) => void
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
  requests: WithdrawalRequest[]
  fetching: boolean
  total?: number
  exportFilter: Record<string, unknown>
  onView: (request: WithdrawalRequest) => void
  footer?: ReactNode
}

interface OverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  sub?: ReactNode
  children: ReactNode
  footer?: ReactNode
  restoreFocusTo?: { readonly current: HTMLElement | null }
}

const hooks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  refetch: vi.fn(),
  setStatus: vi.fn(),
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

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number, currency: string) => `${currency} ${amount.toFixed(2)}`,
  }),
}))

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
    Drawer: ({ open, onOpenChange, title, sub, children, footer, restoreFocusTo }: OverlayProps) => {
      const wasOpen = React.useRef(false)

      React.useEffect(() => {
        if (!open && wasOpen.current) queueMicrotask(() => restoreFocusTo?.current?.focus())
        wasOpen.current = open
      }, [open, restoreFocusTo])

      if (!open) return null
      return (
        <div role="dialog" aria-label={typeof title === 'string' ? title : undefined}>
          <h2>{title}</h2>
          {sub ? <p>{sub}</p> : null}
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

vi.mock('@/ui/components/Dialog', () => ({
  Dialog: ({ open, onOpenChange, title, children }: OverlayProps) => (open ? (
    <div role="dialog" aria-label={typeof title === 'string' ? title : undefined}>
      <h2>{title}</h2>
      <button type="button" aria-label="Close dialog" onClick={() => onOpenChange(false)}>
        Close
      </button>
      {children}
    </div>
  ) : null),
}))

vi.mock('./components/WithdrawalRequestsStatsCards', () => ({
  WithdrawalRequestsStatsCards: () => <section aria-label="Withdrawal request statistics" />,
}))

vi.mock('./components/WithdrawalRequestsFiltersBar', () => ({
  WithdrawalRequestsFiltersBar: (props: FilterProps) => (
    <section aria-label="Mock withdrawal filters">
      <output data-testid="filter-state">{`${props.status}|${props.query}`}</output>
      <button type="button" onClick={() => props.onChangeStatus('COMPLETED')}>Set completed</button>
      <button type="button" onClick={() => props.onChangeQuery('x')}>Search one character</button>
      <button type="button" onClick={() => props.onChangeQuery('  98  ')}>Search phone</button>
      <button
        type="button"
        onClick={() => props.onChangeDateRange({ from: '2026-01-01', to: '2026-01-31' })}
      >
        Set custom dates
      </button>
      <button type="button" onClick={() => props.onChangeDateRange(null)}>Clear dates</button>
      <button type="button" onClick={props.onClearAll}>Clear All</button>
    </section>
  ),
}))

vi.mock('./components/WithdrawalRequestsTable', () => ({
  WithdrawalRequestsTable: (props: TableProps) => (
    <section aria-label="Mock withdrawal table">
      <output data-testid="table-state">
        {JSON.stringify({ fetching: props.fetching, total: props.total, exportFilter: props.exportFilter })}
      </output>
      {props.requests.map((request) => (
        <button key={request.id} type="button" onClick={() => props.onView(request)}>
          View request {request.id}
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

function makeRequest(overrides: Partial<WithdrawalRequest> = {}): WithdrawalRequest {
  return {
    id: 'wd-1',
    userId: 'user-1',
    amount: 1250,
    currency: 'INR',
    status: 'PENDING',
    reviewerId: null,
    reviewedAt: null,
    note: 'Player asked for a same-day payout.',
    createdAt: '2026-09-22T08:30:00.000Z',
    updatedAt: '2026-09-22T08:30:00.000Z',
    account: {
      id: 'acc-1',
      method: 'UPI',
      accountNumber: 'asha@okbank',
      ifscCode: '',
      bankName: undefined,
      accountHolderName: 'Asha Player',
    },
    user: {
      id: 'user-1',
      name: 'Asha Player',
      email: 'asha@example.test',
      phone: null,
    },
    ...overrides,
  }
}

let queryData: { adminWithdrawalRequests: { items: WithdrawalRequest[]; total: number } }
let queryLoading = false
let historyData: { adminWithdrawalHistory: WithdrawalHistoryEntry[] } | undefined
let historyLoading = false
let latestQueryOptions: QueryOptions | undefined
let latestHistoryOptions: HistoryQueryOptions | undefined
let mutationOptions: MutationOptions | undefined
let mutationDocument: unknown
let refetchSnapshots: Array<QueryOptions['variables']>

function renderPage() {
  return render(
    <MemoryRouter>
      <PageEyebrowProvider value="Payment operations">
        <WithdrawalRequestsPage />
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

async function openRequest(id = 'wd-1') {
  fireEvent.click(screen.getByRole('button', { name: `View request ${id}` }))
  return screen.findByRole('dialog', { name: `Withdrawal Request - #${id}` })
}

/** A new-status tile by its raw status: the tile is named by its label first (Failed, then its meaning). */
function statusTile(scope: HTMLElement, status: string) {
  const label = status.charAt(0) + status.slice(1).toLowerCase()
  return within(within(scope).getByRole('group', { name: 'New status' })).getByRole('button', { name: new RegExp(`^${label}\\b`) })
}

function chooseStatus(dialog: HTMLElement, status: string) {
  fireEvent.click(statusTile(dialog, status))
}

beforeEach(() => {
  queryData = { adminWithdrawalRequests: { items: [makeRequest()], total: 25 } }
  queryLoading = false
  historyData = undefined
  historyLoading = false
  latestQueryOptions = undefined
  latestHistoryOptions = undefined
  mutationOptions = undefined
  mutationDocument = undefined
  refetchSnapshots = []
  rbacCalls.length = 0
  rbacState.allowed = true

  hooks.useQuery.mockReset()
  hooks.useMutation.mockReset()
  hooks.refetch.mockReset()
  hooks.setStatus.mockReset()
  feedback.confirm.mockReset()
  feedback.toast.mockReset()

  hooks.refetch.mockImplementation(() => {
    if (latestQueryOptions) refetchSnapshots.push(latestQueryOptions.variables)
    return Promise.resolve({ data: queryData })
  })
  hooks.useQuery.mockImplementation((document: unknown, options: QueryOptions & HistoryQueryOptions) => {
    if (operationName(document) === 'AdminWithdrawalHistory') {
      latestHistoryOptions = options
      return options.skip
        ? { data: undefined, loading: false }
        : { data: historyData, loading: historyLoading }
    }
    latestQueryOptions = options
    return { data: queryData, loading: queryLoading, refetch: hooks.refetch }
  })
  hooks.useMutation.mockImplementation((document: unknown, options: MutationOptions) => {
    mutationDocument = document
    mutationOptions = options
    return [hooks.setStatus, { loading: false }]
  })
  hooks.setStatus.mockResolvedValue({ data: { setWithdrawalStatus: { success: false } } })
  feedback.confirm.mockResolvedValue(false)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('WithdrawalRequestsPage query and access contracts', () => {
  test('keeps the exact list query, the skipped history query, the guard and the header', () => {
    renderPage()

    const listCall = hooks.useQuery.mock.calls.find(([document]) => document === ADMIN_WITHDRAWAL_REQUESTS)
    assert.ok(listCall)
    assert.deepStrictEqual(latestQueryOptions, {
      variables: {
        input: {
          status: 'PENDING',
          query: undefined,
          fromDate: getWithdrawalRangeForPreset('today')?.from,
          toDate: getWithdrawalRangeForPreset('today')?.to,
          offset: 0,
          limit: 10,
        },
      },
      errorPolicy: 'all',
      pollInterval: 15000,
      fetchPolicy: 'cache-and-network',
    })
    assert.ok(hooks.useQuery.mock.calls.some(([document]) => document === ADMIN_WITHDRAWAL_HISTORY))
    assert.deepStrictEqual(latestHistoryOptions, {
      variables: { id: '' },
      skip: true,
      fetchPolicy: 'network-only',
    })
    assert.equal(mutationDocument, SET_WITHDRAWAL_STATUS)
    assert.deepStrictEqual(mutationOptions?.context, { skipNotification: true })
    assert.deepStrictEqual(rbacCalls.at(-1), {
      required: [{ domain: 'payments.withdrawals', actions: ['view', 'approve', 'reject'] }],
      requireAny: undefined,
    })
    assert.ok(screen.queryByText('Payment operations') === null)
    assert.ok(screen.getByRole('heading', { name: 'Withdrawal Requests', level: 1 }))
    assert.ok(screen.queryByText('Review and approve/reject withdrawal requests from players') === null)

    hooks.refetch.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    assert.equal(hooks.refetch.mock.calls.length, 1)
  })

  test('does not mount page content or start a query or mutation when the guard denies access', () => {
    rbacState.allowed = false
    renderPage()

    assert.match(screen.getByRole('alert').textContent ?? '', /Access denied/)
    assert.equal(screen.queryByRole('heading', { name: 'Withdrawal Requests' }), null)
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

    fireEvent.click(screen.getByRole('button', { name: 'Set completed' }))
    await waitFor(() => {
      assert.equal(latestQueryOptions?.variables.input.status, 'COMPLETED')
      assert.equal(latestQueryOptions?.variables.input.offset, 0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Search one character' }))
    await waitFor(() => assert.equal(latestQueryOptions?.variables.input.query, undefined))

    fireEvent.click(screen.getByRole('button', { name: 'Search phone' }))
    await waitFor(
      () => assert.equal(latestQueryOptions?.variables.input.query, '98'),
      { timeout: 1000 },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Clear dates' }))
    await waitFor(() => {
      assert.equal(latestQueryOptions?.variables.input.fromDate, undefined)
      assert.equal(latestQueryOptions?.variables.input.toDate, undefined)
    })

    fireEvent.change(screen.getByLabelText('Rows per page:'), { target: { value: '20' } })
    await waitFor(() => {
      assert.equal(latestQueryOptions?.variables.input.limit, 20)
      assert.equal(latestQueryOptions?.variables.input.offset, 0)
    })
    assert.match(screen.getByTestId('table-state').textContent ?? '', /"exportFilter":\{"status":"COMPLETED","query":"98"\}/)
  })

  test('Clear All keeps the immediate stale refetch, then applies Pending + Today', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Set completed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Set custom dates' }))
    await waitFor(() => {
      assert.equal(latestQueryOptions?.variables.input.status, 'COMPLETED')
      assert.equal(latestQueryOptions?.variables.input.fromDate, '2026-01-01')
    })

    refetchSnapshots.length = 0
    fireEvent.click(screen.getByRole('button', { name: 'Clear All' }))

    assert.deepStrictEqual(refetchSnapshots[0], {
      input: {
        ...latestQueryOptions?.variables.input,
        status: 'COMPLETED',
        fromDate: '2026-01-01',
        toDate: '2026-01-31',
      },
    })
    await waitFor(() => {
      assert.equal(latestQueryOptions?.variables.input.status, 'PENDING')
      assert.equal(latestQueryOptions?.variables.input.fromDate, getWithdrawalRangeForPreset('today')?.from)
      assert.equal(latestQueryOptions?.variables.input.toDate, getWithdrawalRangeForPreset('today')?.to)
    })
  })
})

describe('WithdrawalRequestsPage drawer', () => {
  test('shows the request, hides empty account rows, links only a real player and restores focus', async () => {
    renderPage()
    const trigger = screen.getByRole('button', { name: 'View request wd-1' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Withdrawal Request - #wd-1' })

    assert.ok(within(dialog).getAllByText('Asha Player').length >= 1)
    assert.ok(within(dialog).getByText('asha@example.test'))
    assert.equal(within(dialog).getByRole('link', { name: 'View Profile' }).getAttribute('href'), '/players/profile/user-1')
    assert.ok(within(dialog).getByText('INR 1250.00'))
    assert.ok(within(dialog).getByText('Pending'))
    assert.ok(within(dialog).getByText('Account Details'))
    assert.ok(within(dialog).getByText('UPI ID'))
    assert.ok(within(dialog).getByText('asha@okbank'))
    assert.ok(within(dialog).getByRole('button', { name: 'Copy UPI ID' }))
    assert.ok(within(dialog).getByRole('button', { name: 'Copy Account Holder Name' }))
    assert.equal(within(dialog).queryByText('IFSC'), null, 'an empty IFSC row is left out')
    assert.equal(within(dialog).queryByText('Bank Name'), null, 'a missing bank name row is left out')
    assert.ok(within(dialog).getByText('formatted:2026-09-22T08:30:00.000Z:dd MMM yyyy, HH:mm:ss'))
    assert.equal(within(dialog).queryByText('Reviewed At'), null)
    assert.equal(within(dialog).queryByText('Reviewer ID'), null)
    assert.ok(within(dialog).getByText('Player asked for a same-day payout.'))
    assert.ok(within(dialog).getByText('Select new status for this request'))
    assert.ok(within(dialog).getByText('Select status to update'))

    const group = within(dialog).getByRole('group', { name: 'New status' })
    assert.deepStrictEqual(
      within(group).getAllByRole('button').map((button) => [button.querySelector('b')?.textContent, button.getAttribute('aria-pressed')]),
      [['Processing', 'false'], ['Completed', 'false'], ['Failed', 'false'], ['Cancelled', 'false']],
    )
    assert.equal(dialogButton(dialog, 'Update Status').disabled, true)

    chooseStatus(dialog, 'FAILED')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Note' }), { target: { value: 'draft' } })
    assert.equal(statusTile(dialog, 'FAILED').getAttribute('aria-pressed'), 'true')
    assert.ok(within(dialog).getByText('Update to Failed'))
    assert.equal(dialogButton(dialog, 'Update Status').disabled, false)

    fireEvent.click(dialogButton(dialog, 'Cancel'))
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    await waitFor(() => assert.ok(document.activeElement === trigger, 'focus returns to the row action'))

    const reopened = await openRequest()
    assert.equal((within(reopened).getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement).value, '')
    assert.ok(within(reopened).getByText('Select status to update'))
    assert.equal(
      statusTile(reopened, 'FAILED').getAttribute('aria-pressed'),
      'false',
    )
  })

  test('copies a drawer value byte-for-byte and announces it by name', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    renderPage()
    const dialog = await openRequest()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy UPI ID' }))

    await waitFor(() => assert.ok(within(dialog).getByText('UPI ID copied')))
    assert.deepStrictEqual(writeText.mock.calls, [['asha@okbank']])
  })

  test('shows a Processing request as still open and a bank account with its IFSC and bank', async () => {
    queryData = {
      adminWithdrawalRequests: {
        items: [makeRequest({
          status: 'PROCESSING',
          account: {
            id: 'acc-2',
            method: 'BANK',
            accountNumber: '001122334455',
            ifscCode: 'HDFC0001234',
            bankName: 'HDFC Bank',
            accountHolderName: 'Asha Player',
          },
        })],
        total: 1,
      },
    }
    renderPage()
    const dialog = await openRequest()

    assert.ok(within(dialog).getByText('Account Number'))
    assert.ok(within(dialog).getByRole('button', { name: 'Copy Account Number' }))
    assert.ok(within(dialog).getByRole('button', { name: 'Copy IFSC' }))
    assert.ok(within(dialog).getByText('HDFC Bank'))
    assert.ok(within(dialog).getByRole('group', { name: 'New status' }))
    assert.ok(hasDialogButton(dialog, 'Update Status'))
  })

  test('renders a settled request read-only without a player link or account section', async () => {
    queryData = {
      adminWithdrawalRequests: {
        items: [makeRequest({
          status: 'COMPLETED',
          reviewedAt: '2026-09-22T09:00:00.000Z',
          reviewerId: 'admin-7',
          note: null,
          account: null,
          user: null,
        })],
        total: 1,
      },
    }
    renderPage()
    const dialog = await openRequest()

    assert.ok(within(dialog).getByText('This request has been completed'))
    assert.ok(hasDialogButton(dialog, 'Close'))
    assert.equal(hasDialogButton(dialog, 'Update Status'), false)
    assert.equal(hasDialogButton(dialog, 'Cancel'), false)
    assert.equal(within(dialog).queryByRole('group', { name: 'New status' }), null)
    assert.equal(within(dialog).queryByRole('textbox'), null)
    assert.equal(within(dialog).queryByText('Account Details'), null)
    assert.equal(within(dialog).queryByRole('link', { name: 'View Profile' }), null)
    assert.equal(document.querySelector('a[href*="undefined"]'), null)
    assert.ok(within(dialog).getByText('N/A'))
    assert.ok(within(dialog).getByText('No contact info'))
    assert.ok(within(dialog).getByText('formatted:2026-09-22T09:00:00.000Z:dd MMM yyyy, HH:mm:ss'))
    assert.ok(within(dialog).getByText('admin-7'))
    assert.ok(hasDialogButton(dialog, 'View History'))
  })
})

describe('WithdrawalRequestsPage status update', () => {
  test('confirms with the exact copy, sends the trimmed note and closes on success with the fallback toast', async () => {
    feedback.confirm.mockImplementation(async (options: ConfirmOptions) => {
      await options.onConfirm?.()
      return true
    })
    hooks.setStatus.mockImplementation(async () => {
      const data = { setWithdrawalStatus: { success: true, message: '' } }
      mutationOptions?.onCompleted?.(data)
      return { data }
    })

    renderPage()
    const dialog = await openRequest()
    chooseStatus(dialog, 'COMPLETED')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Note' }), { target: { value: '  paid out  ' } })
    hooks.refetch.mockClear()
    fireEvent.click(dialogButton(dialog, 'Update Status'))

    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    const confirmation = feedback.confirm.mock.calls[0]?.[0] as ConfirmOptions
    assert.deepStrictEqual(
      {
        title: confirmation.title,
        description: confirmation.description,
        confirmLabel: confirmation.confirmLabel,
        cancelLabel: confirmation.cancelLabel,
        tone: confirmation.tone,
      },
      {
        title: 'Update Withdrawal Status',
        description: 'Are you sure you want to update this request to Completed?',
        confirmLabel: 'Yes, Update',
        cancelLabel: 'Cancel',
        tone: undefined,
      },
    )
    assert.deepStrictEqual(hooks.setStatus.mock.calls[0]?.[0], {
      variables: { input: { id: 'wd-1', status: 'COMPLETED', note: 'paid out' } },
    })
    assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], {
      message: 'Status updated successfully',
      tone: 'ok',
    })
    assert.equal(hooks.refetch.mock.calls.length, 1)
  })

  test('omits a blank note and shows the server message on success', async () => {
    feedback.confirm.mockImplementation(async (options: ConfirmOptions) => {
      await options.onConfirm?.()
      return true
    })
    hooks.setStatus.mockImplementation(async () => {
      const data = { setWithdrawalStatus: { success: true, message: 'Moved to processing' } }
      mutationOptions?.onCompleted?.(data)
      return { data }
    })

    renderPage()
    const dialog = await openRequest()
    chooseStatus(dialog, 'PROCESSING')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Note' }), { target: { value: '   ' } })
    fireEvent.click(dialogButton(dialog, 'Update Status'))

    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    assert.deepStrictEqual(hooks.setStatus.mock.calls[0]?.[0], {
      variables: { input: { id: 'wd-1', status: 'PROCESSING', note: undefined } },
    })
    assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], { message: 'Moved to processing', tone: 'ok' })
  })

  test('does nothing while no status is chosen and keeps the drawer when the confirmation is cancelled', async () => {
    renderPage()
    const dialog = await openRequest()
    fireEvent.click(dialogButton(dialog, 'Update Status'))
    assert.equal(feedback.confirm.mock.calls.length, 0)

    chooseStatus(dialog, 'CANCELLED')
    fireEvent.click(dialogButton(dialog, 'Update Status'))
    await waitFor(() => assert.equal(feedback.confirm.mock.calls.length, 1))
    assert.equal(hooks.setStatus.mock.calls.length, 0)
    assert.ok(screen.getByRole('dialog', { name: 'Withdrawal Request - #wd-1' }))
    assert.ok(within(dialog).getByText('Update to Cancelled'))
  })

  test('keeps the drawer, choice and note after a failed mutation and reuses onConfirm for retry', async () => {
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
    hooks.setStatus.mockImplementation(async () => {
      const error = new Error('')
      mutationOptions?.onError?.(error)
      throw error
    })

    renderPage()
    const dialog = await openRequest()
    chooseStatus(dialog, 'FAILED')
    const noteField = within(dialog).getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement
    fireEvent.change(noteField, { target: { value: '  bank rejected  ' } })
    fireEvent.click(dialogButton(dialog, 'Update Status'))

    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], {
      message: 'Failed to update withdrawal status',
      tone: 'error',
    })
    assert.ok(screen.getByRole('dialog', { name: 'Withdrawal Request - #wd-1' }))
    assert.equal(noteField.value, '  bank rejected  ')
    assert.ok(within(dialog).getByText('Update to Failed'))
    assert.ok(capturedConfirmation?.onConfirm)

    hooks.setStatus.mockImplementation(async () => {
      const data = { setWithdrawalStatus: { success: true, message: 'Marked failed on retry' } }
      mutationOptions?.onCompleted?.(data)
      return { data }
    })
    await act(async () => {
      await capturedConfirmation?.onConfirm?.()
    })
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    assert.equal(hooks.setStatus.mock.calls.length, 2)
    assert.deepStrictEqual(hooks.setStatus.mock.calls[1]?.[0], {
      variables: { input: { id: 'wd-1', status: 'FAILED', note: 'bank rejected' } },
    })
    assert.deepStrictEqual(feedback.toast.mock.calls[1]?.[0], { message: 'Marked failed on retry', tone: 'ok' })
  })

  test('keeps a false-success response inside the confirmation without a toast', async () => {
    let confirmationFailure: Error | undefined
    feedback.confirm.mockImplementation(async (options: ConfirmOptions) => {
      try {
        await options.onConfirm?.()
      } catch (error) {
        confirmationFailure = error as Error
      }
      return false
    })
    hooks.setStatus.mockResolvedValue({
      data: { setWithdrawalStatus: { success: false, message: 'Request is already settled' } },
    })

    renderPage()
    const dialog = await openRequest()
    chooseStatus(dialog, 'COMPLETED')
    fireEvent.click(dialogButton(dialog, 'Update Status'))

    await waitFor(() => assert.equal(confirmationFailure?.message, 'Request is already settled'))
    assert.ok(screen.getByRole('dialog', { name: 'Withdrawal Request - #wd-1' }))
    assert.ok(within(dialog).getByText('Update to Completed'))
    assert.equal(feedback.toast.mock.calls.length, 0)
  })
})

describe('WithdrawalRequestsPage history', () => {
  test('loads the history network-only for the open request and renders its rows', async () => {
    historyLoading = true
    const view = renderPage()
    const drawer = await openRequest()
    fireEvent.click(dialogButton(drawer, 'View History'))

    const history = await screen.findByRole('dialog', { name: 'Withdrawal History' })
    assert.deepStrictEqual(latestHistoryOptions, {
      variables: { id: 'wd-1' },
      skip: false,
      fetchPolicy: 'network-only',
    })
    assert.match(within(history).getByRole('status').textContent ?? '', /Loading Withdrawal history/)

    historyLoading = false
    historyData = {
      adminWithdrawalHistory: [
        { status: 'PROCESSING', reviewerId: 'admin-7', reviewedAt: '2026-09-22T09:00:00.000Z', note: 'Sent to bank' },
        { status: 'ON_HOLD', reviewerId: null, reviewedAt: null, note: null },
      ],
    }
    view.rerender(
      <MemoryRouter>
        <PageEyebrowProvider value="Payment operations">
          <WithdrawalRequestsPage />
        </PageEyebrowProvider>
      </MemoryRouter>,
    )

    const table = within(history).getByRole('table', { name: 'Withdrawal history' })
    assert.deepStrictEqual(
      within(table).getAllByRole('columnheader').map((header) => header.textContent),
      ['Status', 'Reviewer', 'Reviewed At', 'Note'],
    )
    assert.ok(within(table).getByText('Processing'))
    assert.ok(within(table).getByText('admin-7'))
    assert.ok(within(table).getByText('formatted:2026-09-22T09:00:00.000Z:dd MMM yyyy, HH:mm:ss'))
    assert.ok(within(table).getByText('Sent to bank'))
    assert.ok(within(table).getByText('ON_HOLD'), 'an unknown status keeps its server value')
    assert.equal(within(table).getAllByText('—').length, 3)

    fireEvent.click(within(history).getByRole('button', { name: 'Close dialog' }))
    await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Withdrawal History' }), null))
    assert.ok(screen.getByRole('dialog', { name: 'Withdrawal Request - #wd-1' }))
    assert.equal(latestHistoryOptions?.skip, true)
  })

  test('shows the empty history state for a settled request', async () => {
    queryData = {
      adminWithdrawalRequests: { items: [makeRequest({ status: 'CANCELLED' })], total: 1 },
    }
    historyData = { adminWithdrawalHistory: [] }
    renderPage()
    const drawer = await openRequest()
    fireEvent.click(dialogButton(drawer, 'View History'))

    const history = await screen.findByRole('dialog', { name: 'Withdrawal History' })
    assert.ok(within(history).getByText('No data'))
  })
})
