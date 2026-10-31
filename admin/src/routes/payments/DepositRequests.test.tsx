import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import {
  ADMIN_DEPOSIT_REQUESTS,
  DEPOSIT_REQUEST_UPDATED_SUBSCRIPTION,
} from '@/lib/graphql/deposits'
import DepositRequestsPage from './DepositRequests'
import { getDepositRangeForPreset, type DepositRequest } from './depositRequestsModel'

interface QueryOptions {
  variables: { input: Record<string, unknown> }
  errorPolicy: string
  pollInterval: number
  fetchPolicy: string
}

interface SubscriptionOptions {
  variables: { tenant?: string }
  onData: (payload: { data?: { data?: { depositRequestUpdated?: unknown } } }) => void
  onError: (error: Error) => void
}

interface MutationPayload {
  success?: boolean
  message?: string | null
}

interface MutationOptions {
  context?: { skipNotification?: boolean }
  onCompleted?: (data: {
    approveDepositRequest?: MutationPayload
    rejectDepositRequest?: MutationPayload
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
  method: string
  query: string
  onChangeStatus: (value: string) => void
  onChangeMethod: (value: string) => void
  onChangeQuery: (value: string) => void
  onChangeDateRange: (range: { from?: string; to?: string } | null) => void
  onClearAll: () => void
}

interface TableProps {
  requests: DepositRequest[]
  fetching: boolean
  total?: number
  exportFilter: Record<string, unknown>
  onView: (request: DepositRequest) => void
  footer?: ReactNode
}

interface DrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  sub?: ReactNode
  children: ReactNode
  footer?: ReactNode
  initialFocus?: { readonly current: HTMLElement | null }
  restoreFocusTo?: { readonly current: HTMLElement | null }
}

const hooks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  useSubscription: vi.fn(),
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
    useSubscription: hooks.useSubscription,
  }
})

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number, currency: string) => `${currency} ${amount.toFixed(2)}`,
  }),
}))

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDateTime: (value: string) => `formatted:${value}`,
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
    Drawer: ({
      open,
      onOpenChange,
      title,
      sub,
      children,
      footer,
      initialFocus,
      restoreFocusTo,
    }: DrawerProps) => {
      const wasOpen = React.useRef(false)

      React.useEffect(() => {
        if (open) queueMicrotask(() => initialFocus?.current?.focus())
        else if (wasOpen.current) queueMicrotask(() => restoreFocusTo?.current?.focus())
        wasOpen.current = open
      }, [initialFocus, open, restoreFocusTo])

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

vi.mock('./components/DepositRequestsStatsCards', () => ({
  DepositRequestsStatsCards: () => <section aria-label="Deposit request statistics" />,
}))

vi.mock('./components/DepositRequestsFiltersBar', () => ({
  DepositRequestsFiltersBar: (props: FilterProps) => (
    <section aria-label="Mock deposit filters">
      <output data-testid="filter-state">{`${props.status}|${props.method}|${props.query}`}</output>
      <button type="button" onClick={() => props.onChangeStatus('APPROVED')}>Set approved</button>
      <button type="button" onClick={() => props.onChangeMethod('UPI')}>Set UPI</button>
      <button type="button" onClick={() => props.onChangeQuery('x')}>Search one character</button>
      <button type="button" onClick={() => props.onChangeQuery('  UT  ')}>Search UTR</button>
      <button
        type="button"
        onClick={() => props.onChangeDateRange({ from: '2026-01-01', to: '2026-01-31' })}
      >
        Set custom dates
      </button>
      <button type="button" onClick={props.onClearAll}>Clear All</button>
    </section>
  ),
}))

vi.mock('./components/DepositRequestsTable', () => ({
  DepositRequestsTable: (props: TableProps) => (
    <section aria-label="Mock deposit table">
      <output data-testid="table-state">
        {JSON.stringify({ fetching: props.fetching, total: props.total, exportFilter: props.exportFilter })}
      </output>
      {props.requests.map((request) => (
        <button
          key={request.id}
          type="button"
          onClick={() => props.onView(request)}
        >
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

function makeRequest(overrides: Partial<DepositRequest> = {}): DepositRequest {
  return {
    id: 'dep-1',
    userId: 'user-1',
    amount: 125,
    currency: 'INR',
    method: 'UPI',
    utr: 'UTR-101',
    referenceId: 'REF-101',
    proofKey: 'deposits/dep-1.png',
    proofUrl: 'https://cdn.test/dep-1.png',
    status: 'PENDING',
    reviewerId: null,
    reviewedAt: null,
    note: 'Player supplied a bank receipt.',
    walletTxnId: null,
    createdAt: '2026-09-22T08:30:00.000Z',
    updatedAt: '2026-09-22T08:30:00.000Z',
    user: {
      id: 'user-1',
      name: 'Asha Player',
      email: 'asha@example.test',
      phone: null,
    },
    ...overrides,
  }
}

let queryData: { adminDepositRequests: { items: DepositRequest[]; total: number } }
let queryLoading = false
let latestQueryOptions: QueryOptions | undefined
let latestSubscriptionOptions: SubscriptionOptions | undefined
let approveOptions: MutationOptions | undefined
let rejectOptions: MutationOptions | undefined
let refetchSnapshots: Array<QueryOptions['variables']>

function renderPage() {
  return render(
    <MemoryRouter>
      <PageEyebrowProvider value="Payment operations">
        <DepositRequestsPage />
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

beforeEach(() => {
  queryData = { adminDepositRequests: { items: [makeRequest()], total: 25 } }
  queryLoading = false
  latestQueryOptions = undefined
  latestSubscriptionOptions = undefined
  approveOptions = undefined
  rejectOptions = undefined
  refetchSnapshots = []
  rbacCalls.length = 0
  rbacState.allowed = true

  hooks.useQuery.mockReset()
  hooks.useMutation.mockReset()
  hooks.useSubscription.mockReset()
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
    return { data: queryData, loading: queryLoading, refetch: hooks.refetch }
  })
  hooks.useSubscription.mockImplementation((_document: unknown, options: SubscriptionOptions) => {
    latestSubscriptionOptions = options
    return { data: undefined }
  })
  hooks.useMutation.mockImplementation((document: unknown, options: MutationOptions) => {
    if (operationName(document) === 'ApproveDepositRequest') {
      approveOptions = options
      return [hooks.approve, { loading: false }]
    }
    rejectOptions = options
    return [hooks.reject, { loading: false }]
  })
  hooks.approve.mockResolvedValue({ data: { approveDepositRequest: { success: false } } })
  hooks.reject.mockResolvedValue({ data: { rejectDepositRequest: { success: false } } })
  feedback.confirm.mockResolvedValue(false)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DepositRequestsPage query and access contracts', () => {
  test('keeps the exact initial query, guard OR requirement, section eyebrow and links', () => {
    renderPage()

    assert.equal(hooks.useQuery.mock.calls[0]?.[0], ADMIN_DEPOSIT_REQUESTS)
    assert.deepStrictEqual(latestQueryOptions, {
      variables: {
        input: {
          status: 'PENDING',
          method: undefined,
          query: undefined,
          fromDate: getDepositRangeForPreset('today')?.from,
          toDate: getDepositRangeForPreset('today')?.to,
          offset: 0,
          limit: 10,
        },
      },
      errorPolicy: 'all',
      pollInterval: 15000,
      fetchPolicy: 'cache-and-network',
    })
    assert.deepStrictEqual(rbacCalls.at(-1), {
      required: [{ domain: 'payments.deposits', actions: ['view', 'approve', 'reject'] }],
      requireAny: undefined,
    })
    assert.ok(screen.queryByText('Payment operations') === null)
    assert.ok(screen.getByRole('heading', { name: 'Deposit Requests', level: 1 }))
    assert.equal(
      screen.getByRole('link', { name: 'Payment Methods' }).getAttribute('href'),
      '/payments/methods',
    )
  })

  test('does not mount page content or start its query when the OR guard denies access', () => {
    rbacState.allowed = false
    renderPage()

    assert.ok(screen.getByRole('alert', { name: '' }))
    assert.match(screen.getByRole('alert').textContent ?? '', /Access denied/)
    assert.equal(screen.queryByRole('heading', { name: 'Deposit Requests' }), null)
    assert.equal(hooks.useQuery.mock.calls.length, 0)
    assert.equal(hooks.useSubscription.mock.calls.length, 0)
    assert.equal(hooks.useMutation.mock.calls.length, 0)
    assert.deepStrictEqual(rbacCalls.at(-1), {
      required: [{ domain: 'payments.deposits', actions: ['view', 'approve', 'reject'] }],
      requireAny: undefined,
    })
  })

  test('updates paging/filter variables, enforces the two-character debounce and resets offset', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    await waitFor(() => assert.equal(latestQueryOptions?.variables.input.offset, 10))

    fireEvent.click(screen.getByRole('button', { name: 'Set approved' }))
    await waitFor(() => {
      assert.equal(latestQueryOptions?.variables.input.status, 'APPROVED')
      assert.equal(latestQueryOptions?.variables.input.offset, 0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Set UPI' }))
    await waitFor(() => assert.equal(latestQueryOptions?.variables.input.method, 'UPI'))

    fireEvent.click(screen.getByRole('button', { name: 'Search one character' }))
    await waitFor(() => assert.equal(latestQueryOptions?.variables.input.query, undefined))

    fireEvent.click(screen.getByRole('button', { name: 'Search UTR' }))
    await waitFor(
      () => assert.equal(latestQueryOptions?.variables.input.query, 'UT'),
      { timeout: 1000 },
    )

    fireEvent.change(screen.getByLabelText('Rows per page:'), { target: { value: '20' } })
    await waitFor(() => {
      assert.equal(latestQueryOptions?.variables.input.limit, 20)
      assert.equal(latestQueryOptions?.variables.input.offset, 0)
    })
  })

  test('Clear All preserves the immediate stale refetch, then applies Pending + Today', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Set approved' }))
    fireEvent.click(screen.getByRole('button', { name: 'Set UPI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Set custom dates' }))
    await waitFor(() => {
      assert.equal(latestQueryOptions?.variables.input.status, 'APPROVED')
      assert.equal(latestQueryOptions?.variables.input.method, 'UPI')
      assert.equal(latestQueryOptions?.variables.input.fromDate, '2026-01-01')
    })

    refetchSnapshots.length = 0
    fireEvent.click(screen.getByRole('button', { name: 'Clear All' }))

    assert.deepStrictEqual(refetchSnapshots[0], {
      input: {
        ...latestQueryOptions?.variables.input,
        status: 'APPROVED',
        method: 'UPI',
        fromDate: '2026-01-01',
        toDate: '2026-01-31',
      },
    })
    await waitFor(() => {
      assert.equal(latestQueryOptions?.variables.input.status, 'PENDING')
      assert.equal(latestQueryOptions?.variables.input.method, undefined)
      assert.equal(latestQueryOptions?.variables.input.fromDate, getDepositRangeForPreset('today')?.from)
      assert.equal(latestQueryOptions?.variables.input.toDate, getDepositRangeForPreset('today')?.to)
    })
  })

  test('subscribes without a tenant and refetches only when an update arrives', async () => {
    renderPage()
    assert.equal(hooks.useSubscription.mock.calls[0]?.[0], DEPOSIT_REQUEST_UPDATED_SUBSCRIPTION)
    assert.deepStrictEqual(latestSubscriptionOptions?.variables, { tenant: undefined })

    hooks.refetch.mockClear()
    await act(async () => {
      latestSubscriptionOptions?.onData({ data: { data: {} } })
      latestSubscriptionOptions?.onData({
        data: { data: { depositRequestUpdated: { id: 'dep-2' } } },
      })
    })
    assert.equal(hooks.refetch.mock.calls.length, 1)
    assert.doesNotThrow(() => latestSubscriptionOptions?.onError(new Error('socket closed')))
  })
})

describe('DepositRequestsPage drawer and mutations', () => {
  test('opens accessibly, avoids /undefined, restores focus and clears notes on close', async () => {
    renderPage()
    const trigger = screen.getByRole('button', { name: 'View request dep-1' })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: 'Deposit Request - #dep-1' })
    assert.ok(screen.getByText('Asha Player'))
    assert.equal(screen.getByRole('link', { name: 'View Profile' }).getAttribute('href'), '/players/profile/user-1')
    assert.equal(screen.queryByRole('link', { name: /undefined/i }), null)
    assert.ok(screen.getByRole('button', { name: 'View payment proof: Payment proof' }))

    const approveField = screen.getByRole('textbox', { name: /^Remark/ }) as HTMLTextAreaElement
    const rejectField = screen.getByRole('textbox', { name: 'Rejection note' }) as HTMLTextAreaElement
    const cancelButton = dialogButton(dialog, 'Cancel')
    await waitFor(() => assert.equal(document.activeElement, approveField))
    fireEvent.change(approveField, { target: { value: 'reviewed' } })
    fireEvent.change(rejectField, { target: { value: 'not valid' } })

    fireEvent.click(cancelButton)
    await waitFor(() => assert.equal(document.querySelector('[role="dialog"]'), null))
    await waitFor(() => assert.equal(document.activeElement, trigger))

    fireEvent.click(trigger)
    await screen.findByRole('dialog', { name: 'Deposit Request - #dep-1' })
    assert.equal((screen.getByRole('textbox', { name: /^Remark/ }) as HTMLTextAreaElement).value, '')
    assert.equal((screen.getByRole('textbox', { name: 'Rejection note' }) as HTMLTextAreaElement).value, '')
    assert.ok(dialog)
  })

  test('renders settled requests read-only and rejects placeholder proof without /undefined links', async () => {
    queryData = {
      adminDepositRequests: {
        items: [makeRequest({
          status: 'APPROVED',
          proofKey: 'manual',
          proofUrl: 'https://cdn.test/not-a-persisted-proof.png',
          user: null,
        })],
        total: 1,
      },
    }
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'View request dep-1' }))
    const dialog = await screen.findByRole('dialog')

    assert.ok(screen.getByText('This request has been approved'))
    assert.ok(dialogButton(dialog, 'Close'))
    assert.equal([...dialog.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Reject'), false)
    assert.equal([...dialog.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Approve Deposit'), false)
    assert.equal(screen.queryByRole('textbox'), null)
    assert.equal(screen.queryByRole('button', { name: /payment proof/i }), null)
    assert.equal(screen.queryByRole('link', { name: 'View Profile' }), null)
    assert.equal(document.querySelector('a[href*="undefined"]'), null)
  })

  test('approves with trimmed required note, exact confirmation/payload and fallback toast', async () => {
    feedback.confirm.mockImplementation(async (options: ConfirmOptions) => {
      await options.onConfirm?.()
      return true
    })
    hooks.approve.mockImplementation(async (variables: unknown) => {
      const data = { approveDepositRequest: { success: true, message: '' } }
      approveOptions?.onCompleted?.(data)
      return { data, variables }
    })

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'View request dep-1' }))
    const dialog = await screen.findByRole('dialog')
    const approveField = screen.getByRole('textbox', { name: /^Remark/ })
    const rejectField = screen.getByRole('textbox', { name: 'Rejection note' })
    const approveButton = dialogButton(dialog, 'Approve Deposit')
    assert.equal(approveButton.disabled, true)
    fireEvent.change(approveField, { target: { value: '  wallet verified  ' } })
    fireEvent.change(rejectField, { target: { value: 'keep this draft' } })
    fireEvent.click(approveButton)

    await waitFor(() => assert.equal(document.querySelector('[role="dialog"]'), null))
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
        title: 'Approve Deposit Request',
        description: "This will credit the player's wallet. Are you sure?",
        confirmLabel: 'Yes, Approve',
        cancelLabel: 'Cancel',
        tone: undefined,
      },
    )
    assert.deepStrictEqual(hooks.approve.mock.calls[0]?.[0], {
      variables: { input: { id: 'dep-1', note: 'wallet verified' } },
    })
    assert.deepStrictEqual(approveOptions?.context, { skipNotification: true })
    assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], {
      message: 'Deposit approved successfully',
      tone: 'ok',
    })

    fireEvent.click(screen.getByRole('button', { name: 'View request dep-1' }))
    await screen.findByRole('dialog')
    assert.equal((screen.getByRole('textbox', { name: /^Remark/ }) as HTMLTextAreaElement).value, '')
    assert.equal(
      (screen.getByRole('textbox', { name: 'Rejection note' }) as HTMLTextAreaElement).value,
      'keep this draft',
      'approval success clears only its own note',
    )
  })

  test('keeps drawer and notes after a failed approval and reuses onConfirm for retry', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'View request dep-1' }))
    const dialog = await screen.findByRole('dialog')
    const approveField = screen.getByRole('textbox', { name: /^Remark/ }) as HTMLTextAreaElement
    const approveButton = dialogButton(dialog, 'Approve Deposit')
    fireEvent.change(approveField, { target: { value: '  retain me  ' } })
    fireEvent.click(approveButton)

    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], {
      message: 'Failed to approve deposit request',
      tone: 'error',
    })
    assert.ok(screen.getByRole('dialog'))
    assert.equal(approveField.value, '  retain me  ')
    assert.ok(capturedConfirmation?.onConfirm)

    hooks.approve.mockImplementation(async () => {
      const data = { approveDepositRequest: { success: true, message: 'Approved on retry' } }
      approveOptions?.onCompleted?.(data)
      return { data }
    })
    await act(async () => {
      await capturedConfirmation?.onConfirm?.()
    })
    await waitFor(() => assert.equal(document.querySelector('[role="dialog"]'), null))
    assert.equal(hooks.approve.mock.calls.length, 2)
    assert.deepStrictEqual(hooks.approve.mock.calls[1]?.[0], {
      variables: { input: { id: 'dep-1', note: 'retain me' } },
    })
    assert.deepStrictEqual(feedback.toast.mock.calls[1]?.[0], {
      message: 'Approved on retry',
      tone: 'ok',
    })
  })

  test('rejects with nullable optional note and exact destructive confirmation', async () => {
    feedback.confirm.mockImplementation(async (options: ConfirmOptions) => {
      await options.onConfirm?.()
      return true
    })
    hooks.reject.mockImplementation(async () => {
      const data = { rejectDepositRequest: { success: true, message: null } }
      rejectOptions?.onCompleted?.(data)
      return { data }
    })

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'View request dep-1' }))
    const dialog = await screen.findByRole('dialog')
    const rejectButton = dialogButton(dialog, 'Reject')
    fireEvent.change(screen.getByRole('textbox', { name: 'Rejection note' }), {
      target: { value: '   ' },
    })
    fireEvent.click(rejectButton)

    await waitFor(() => assert.equal(document.querySelector('[role="dialog"]'), null))
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
        title: 'Reject Deposit Request',
        description: 'Are you sure you want to reject this deposit?',
        confirmLabel: 'Yes, Reject',
        cancelLabel: 'Cancel',
        tone: 'danger',
      },
    )
    assert.deepStrictEqual(hooks.reject.mock.calls[0]?.[0], {
      variables: { input: { id: 'dep-1', note: null } },
    })
    assert.deepStrictEqual(rejectOptions?.context, { skipNotification: true })
    assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], {
      message: 'Deposit rejected successfully',
      tone: 'ok',
    })
  })

  test('keeps a false-success mutation in the confirmation flow without a duplicate toast', async () => {
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
      data: { rejectDepositRequest: { success: false, message: 'Request is already settled' } },
    })

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'View request dep-1' }))
    const dialog = await screen.findByRole('dialog')
    const rejectButton = dialogButton(dialog, 'Reject')
    fireEvent.change(screen.getByRole('textbox', { name: 'Rejection note' }), {
      target: { value: 'retain rejection' },
    })
    fireEvent.click(rejectButton)

    await waitFor(() => assert.equal(confirmationFailure?.message, 'Request is already settled'))
    assert.ok(screen.getByRole('dialog'))
    assert.equal(
      (screen.getByRole('textbox', { name: 'Rejection note' }) as HTMLTextAreaElement).value,
      'retain rejection',
    )
    assert.equal(feedback.toast.mock.calls.length, 0)
  })
})
