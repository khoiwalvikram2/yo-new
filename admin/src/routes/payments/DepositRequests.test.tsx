import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import {
  ADMIN_DEPOSIT_REQUESTS,
  DEPOSIT_REQUEST_PROOF,
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

// The drawer's proof reads its screenshot itself (components/DepositRequestsProof.test.tsx); here it names its request.
const proofPreviews = vi.hoisted(() => [] as string[])
vi.mock('./components/DepositRequestsProof', () => ({
  DepositRequestsProofPreview: ({ requestId }: { requestId: string }) => {
    proofPreviews.push(requestId)
    return <div role="img" aria-label={`Payment proof of ${requestId}`} />
  },
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
    proofKey: 'inline',
    hasProof: true,
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
/** The task-link lookup (newest requests of any status), answered apart from the list. */
let linkData: { adminDepositRequests: { items: DepositRequest[]; total: number } } | undefined
let latestLinkOptions: { variables: { input: Record<string, unknown> }; skip: boolean; fetchPolicy: string } | undefined
let latestQueryOptions: QueryOptions | undefined
let latestSubscriptionOptions: SubscriptionOptions | undefined
let approveOptions: MutationOptions | undefined
let rejectOptions: MutationOptions | undefined
let refetchSnapshots: Array<QueryOptions['variables']>

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location-search">{location.search}</output>
}

function renderPage(entry = '/payments/deposits') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <PageEyebrowProvider value="Payment operations">
        <DepositRequestsPage />
      </PageEyebrowProvider>
      <LocationProbe />
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
  linkData = undefined
  latestLinkOptions = undefined
  latestQueryOptions = undefined
  latestSubscriptionOptions = undefined
  approveOptions = undefined
  rejectOptions = undefined
  refetchSnapshots = []
  rbacCalls.length = 0
  rbacState.allowed = true
  proofPreviews.length = 0

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
  hooks.useQuery.mockImplementation((_document: unknown, options: QueryOptions & { skip?: boolean }) => {
    if (options.skip !== undefined) {
      latestLinkOptions = options as unknown as typeof latestLinkOptions
      return options.skip ? { data: undefined, loading: false } : { data: linkData, loading: false }
    }
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
          includeGatewayOrders: true,
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
    const proofSection = screen.getByRole('heading', { level: 3, name: 'Payment Proof' }).closest('section') as HTMLElement
    assert.ok(within(proofSection).getByRole('img', { name: 'Payment proof of dep-1' }))

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

  test('renders settled requests read-only and shows no proof for a manual one, without /undefined links', async () => {
    queryData = {
      adminDepositRequests: {
        items: [makeRequest({
          status: 'APPROVED',
          proofKey: 'manual',
          hasProof: false,
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
    assert.equal(screen.queryByRole('heading', { name: 'Payment Proof' }), null)
    assert.deepEqual(proofPreviews, [], 'no proof is read for a request without one')
    assert.equal(screen.queryByRole('link', { name: 'View Profile' }), null)
    assert.equal(document.querySelector('a[href*="undefined"]'), null)
  })

  test("reads a proof only for the request the drawer shows, when it shows it; none without one", async () => {
    queryData = {
      adminDepositRequests: {
        items: [
          makeRequest({ id: 'dep-1' }),
          makeRequest({ id: 'dep-2' }),
          makeRequest({ id: 'dep-3', proofKey: 'proof-missing', hasProof: false }),
          makeRequest({ id: 'dep-4', proofKey: 'welivepay', hasProof: false }),
          makeRequest({ id: 'dep-5', proofKey: 'manual', hasProof: false }),
        ],
        total: 5,
      },
    }
    renderPage()
    assert.deepEqual(proofPreviews, [], 'the list reads no proof')
    assert.ok(hooks.useQuery.mock.calls.every(([document]) => document !== DEPOSIT_REQUEST_PROOF), 'the page reads no proof itself')

    fireEvent.click(screen.getByRole('button', { name: 'View request dep-2' }))
    const dialog = await screen.findByRole('dialog', { name: 'Deposit Request - #dep-2' })
    assert.ok(within(dialog).getByRole('img', { name: 'Payment proof of dep-2' }))
    assert.equal(within(dialog).queryByRole('img', { name: 'Payment proof of dep-1' }), null)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null, 'the drawer closes'))

    for (const id of ['dep-3', 'dep-4', 'dep-5']) {
      fireEvent.click(screen.getByRole('button', { name: `View request ${id}` }))
      const drawer = await screen.findByRole('dialog', { name: `Deposit Request - #${id}` })
      assert.equal(within(drawer).queryByRole('heading', { name: 'Payment Proof' }), null, `${id} shows no proof section`)
      fireEvent.click(within(drawer).getByRole('button', { name: 'Close dialog' }))
      await waitFor(() => assert.ok(screen.queryByRole('dialog') === null, 'the drawer closes'))
    }
    assert.ok(proofPreviews.length > 0 && proofPreviews.every((id) => id === 'dep-2'), `proofs read for ${proofPreviews.join(', ')}`)
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

describe('DepositRequestsPage crypto deposits', () => {
  const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'

  function cryptoRequest(overrides: Partial<DepositRequest> = {}): DepositRequest {
    return makeRequest({
      amount: 10000,
      method: 'CRYPTO',
      utr: HASH,
      referenceId: HASH,
      proofKey: 'proof-missing',
      hasProof: false,
      note: null,
      cryptoAmount: 108.11,
      cryptoRate: 92.5,
      cryptoNetwork: 'TRC20',
      cryptoBonusPercent: 5,
      cryptoBonusAmount: 500,
      bonusWalletTxnId: null,
      ...overrides,
    })
  }

  function cryptoSection(): HTMLElement {
    return screen.getByRole('heading', { level: 3, name: 'Crypto Payment' }).closest('section') as HTMLElement
  }

  test('shows what to check on the chain: USDT, network, rate, bonus and the TxID with its explorer link', async () => {
    queryData = { adminDepositRequests: { items: [cryptoRequest()], total: 1 } }
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'View request dep-1' }))
    const dialog = await screen.findByRole('dialog')

    assert.ok(within(dialog).getByText('Crypto (USDT)'))
    const section = cryptoSection()
    for (const [term, value] of [
      ['USDT to Receive', '108.11 USDT'],
      ['Network', 'TRC20 (Tron)'],
      ['Rate', '1 USDT = INR 92.50'],
      ['Bonus', '5% · INR 500.00 paid on approval'],
      ['TxID', HASH],
    ]) {
      assert.ok(within(section).getByText(term), term)
      assert.ok(within(section).getByText(value), value)
    }
    assert.ok(within(section).getByRole('button', { name: 'Copy TxID' }))
    const explorer = within(section).getByRole('link', { name: 'View on explorer' })
    assert.equal(explorer.getAttribute('href'), `https://tronscan.org/#/transaction/${HASH}`)
    assert.equal(explorer.getAttribute('target'), '_blank')
    assert.equal(explorer.getAttribute('rel'), 'noopener noreferrer')
    // The TxID is not repeated as a UTR or reference in the transaction details.
    assert.equal(within(dialog).queryByText('UTR Number'), null)
    assert.equal(within(dialog).queryByText('Reference ID'), null)
  })

  test('approving a crypto deposit with a bonus names the bonus in the confirmation', async () => {
    queryData = { adminDepositRequests: { items: [cryptoRequest()], total: 1 } }
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'View request dep-1' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(screen.getByRole('textbox', { name: /^Remark/ }), { target: { value: 'seen on tronscan' } })
    fireEvent.click(dialogButton(dialog, 'Approve Deposit'))

    await waitFor(() => assert.equal(feedback.confirm.mock.calls.length, 1))
    assert.equal(
      (feedback.confirm.mock.calls[0]?.[0] as ConfirmOptions).description,
      "This will credit the player's wallet with the deposit and a INR 500.00 crypto bonus. Are you sure?",
    )
  })

  test('a settled crypto deposit says the bonus was credited and shows its ledger entry; no bonus, no row', async () => {
    queryData = {
      adminDepositRequests: {
        items: [
          cryptoRequest({ status: 'APPROVED', walletTxnId: 'wl-1', bonusWalletTxnId: 'wl-2' }),
          cryptoRequest({ id: 'dep-2', cryptoNetwork: 'ARBITRUM', cryptoBonusAmount: 0, cryptoBonusPercent: null }),
        ],
        total: 2,
      },
    }
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'View request dep-1' }))
    const dialog = await screen.findByRole('dialog')
    assert.ok(within(cryptoSection()).getByText('5% · INR 500.00 credited'))
    assert.ok(within(dialog).getByText('Bonus Txn ID'))
    assert.ok(within(dialog).getByText('wl-2'))

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    fireEvent.click(screen.getByRole('button', { name: 'View request dep-2' }))
    await screen.findByRole('dialog')
    assert.equal(within(cryptoSection()).queryByText('Bonus'), null)
    assert.ok(within(cryptoSection()).getByText('ARBITRUM'), 'an unknown network is shown as stored')
    assert.equal(within(cryptoSection()).queryByRole('link', { name: 'View on explorer' }), null)
  })
})

describe('DepositRequestsPage gateway deposits', () => {
  const gatewayRow = (status: string, overrides: Partial<DepositRequest> = {}) => makeRequest({
    id: 'GW-7',
    method: 'UPI',
    utr: null,
    referenceId: 'ORD_7_abc',
    proofKey: 'welivepay',
    hasProof: false,
    gateway: { provider: 'WELIVEPAY', gateway: 'QPC', gatewayName: 'QuickPayCash', orderId: 'ORD_7_abc', status, txnRef: null, expiresAt: null },
    ...overrides,
  })

  test('a pay-in awaiting payment shows its gateway and offers no Approve or Reject', async () => {
    queryData = { adminDepositRequests: { items: [gatewayRow('pending', { status: 'PENDING' })], total: 1 } }
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'View request GW-7' }))
    const dialog = await screen.findByRole('dialog')
    const section = screen.getByRole('heading', { level: 3, name: 'Payment Gateway' }).closest('section') as HTMLElement
    assert.ok(within(section).getByText('WeLivePay'))
    assert.ok(within(section).getByText('QuickPayCash'))
    assert.ok(within(section).getAllByText('ORD_7_abc').length >= 1)
    assert.ok(within(section).getByText('Awaiting payment'))
    assert.equal(within(dialog).queryByRole('button', { name: /Approve Deposit/ }), null)
    assert.equal(within(dialog).queryByRole('button', { name: /^Reject/ }), null)
    assert.ok(within(dialog).getByText(/cannot be approved or rejected by hand/))
  })

  test('a credited pay-in reads as approved with the gateway UTR', async () => {
    queryData = { adminDepositRequests: { items: [gatewayRow('success', { id: '41', status: 'APPROVED', gateway: { provider: 'WELIVEPAY', gateway: 'IRISPAY', gatewayName: 'Iris Pay', orderId: 'ORD_8', status: 'success', txnRef: 'UTR998877', expiresAt: null } })], total: 1 } }
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'View request 41' }))
    const dialog = await screen.findByRole('dialog')
    assert.ok(within(dialog).getByText('UTR998877'))
    assert.ok(within(dialog).getByText('Paid'))
    assert.equal(within(dialog).queryByRole('button', { name: /Approve Deposit/ }), null)
  })
})

describe('DepositRequestsPage task links', () => {
  test('?depositId opens that request over the list, and closing it drops the link', async () => {
    linkData = {
      adminDepositRequests: {
        items: [makeRequest({ id: '2776', status: 'APPROVED', createdAt: '2026-11-01T09:00:00.000Z' })],
        total: 1,
      },
    }
    renderPage('/payments/deposits?depositId=2776')

    const dialog = await screen.findByRole('dialog', { name: 'Deposit Request - #2776' })
    // FIN-04: the lookup names the request by its id, so an old one is found too (it searched the 100 newest)
    assert.deepStrictEqual(latestLinkOptions, {
      variables: { input: { id: '2776', offset: 0, limit: 1 } },
      skip: false,
      fetchPolicy: 'network-only',
    })
    assert.equal(latestQueryOptions?.variables.input.status, 'PENDING', 'the list keeps its own filters')

    fireEvent.click(dialogButton(dialog, 'Close'))
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    await waitFor(() => assert.equal(screen.getByTestId('location-search').textContent, ''))
  })

  test('a link to a request that does not exist (or is another tenant\'s) says so and is dropped', async () => {
    linkData = { adminDepositRequests: { items: [], total: 0 } }
    renderPage('/payments/deposits?depositId=12')

    await waitFor(() => assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], {
      message: 'Deposit request #12 was not found',
      tone: 'warn',
    }))
    // asked for by its id (the link is dropped after, so the lookup is skipped again)
    assert.ok(hooks.useQuery.mock.calls.some(([, options]) => options?.skip === false
      && JSON.stringify(options.variables) === JSON.stringify({ input: { id: '12', offset: 0, limit: 1 } })))
    assert.equal(latestLinkOptions?.skip, true)
    assert.equal(screen.queryByRole('dialog'), null)
    await waitFor(() => assert.equal(screen.getByTestId('location-search').textContent, ''))
  })

  test('opens only the request the link names, never another row of the answer', async () => {
    linkData = { adminDepositRequests: { items: [makeRequest({ id: '2775' })], total: 1 } }
    renderPage('/payments/deposits?depositId=2776')

    await waitFor(() => assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], {
      message: 'Deposit request #2776 was not found',
      tone: 'warn',
    }))
    assert.equal(screen.queryByRole('dialog'), null)
  })

  test('without a link the lookup is skipped', () => {
    renderPage()
    assert.equal(latestLinkOptions?.skip, true)
  })
})
