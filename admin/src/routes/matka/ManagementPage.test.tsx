/** Real `/matka/list` page with its shared hooks and GraphQL documents under a recording Apollo link. */
import type { ReactNode } from 'react'
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import MatkaManagementPage from './ManagementPage'

interface ServerCall {
  operationName: string
  variables: Record<string, unknown>
}

const guard = vi.hoisted(() => ({
  allowed: true,
  calls: [] as Array<Array<{ domain: string; actions: string[] }>>,
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({
    required,
    children,
  }: {
    required: Array<{ domain: string; actions: string[] }>
    children: ReactNode
  }) => {
    guard.calls.push(required)
    return guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    getCurrencySymbol: () => '₹',
    formatAmount: (amount: number) => `INR ${amount.toFixed(2)}`,
  }),
}))

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDateTime: (value: string | Date) => new Date(value).toISOString().slice(0, 16),
  }),
}))

vi.mock('@/modules/vip/hooks/useVIP', () => ({
  useVIPTiers: () => ({ data: { vipTiers: [] }, loading: false }),
}))

const feedback = vi.hoisted(() => ({ toasts: [] as Array<Record<string, unknown>>, refuseRates: null as string | null }))
vi.mock('@/ui/components/toast', () => ({
  toast: (options: Record<string, unknown>) => {
    feedback.toasts.push(options)
    return feedback.toasts.length
  },
}))

const MATKAS = [
  {
    __typename: 'Matka',
    id: 'm1',
    name: 'Kalyan',
    code: 'KLN',
    description: 'Primary market',
    timezone: 'Asia/Kolkata',
    status: 'ACTIVE',
    priority: 2,
    schedule: { openTime: '10:00', closeTime: '12:00', daysOfWeek: [1, 2, 3, 4, 5] },
    limits: { minBet: 10, maxBet: 1000, exposureDaily: 5000 },
    settings: { message: 'Old message', notes: 'Desk note', riskLevel: 'medium', riskThreshold: 500 },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    __typename: 'Matka',
    id: 'm2',
    name: 'Milan Day',
    code: 'MLD',
    description: null,
    timezone: 'Asia/Kolkata',
    status: 'INACTIVE',
    priority: 1,
    schedule: { openTime: '13:00', closeTime: '15:00', daysOfWeek: [0, 6] },
    limits: { minBet: 20, maxBet: 2000 },
    settings: {},
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
  },
]

const DEFAULT_RATES = [
  { __typename: 'MatkaDefaultRateEntry', betType: 'SINGLE', payoutMultiplier: 9, minOdds: 1, maxOdds: 5 },
]

let calls: ServerCall[]

function sent(call: ServerCall | undefined) {
  return JSON.parse(JSON.stringify(call?.variables ?? null)) as Record<string, unknown>
}

function resultFor(operation: Operation): FetchResult {
  const filters = (operation.variables.filters ?? {}) as { status?: string; page?: number; limit?: number }
  switch (operation.operationName) {
    case 'Matkas': {
      const matching = filters.status
        ? MATKAS.filter((item) => item.status === filters.status)
        : MATKAS
      return {
        data: {
          matkas: {
            __typename: 'MatkaPage',
            items: filters.limit === 1 ? matching.slice(0, 1) : matching,
            total: matching.length,
          },
        },
      }
    }
    case 'MatkaDefaultRates':
      return {
        data: {
          matkaDefaultRates: {
            __typename: 'MatkaDefaultRates', tenant: 't1', entries: DEFAULT_RATES,
            updatedBy: 'u1', updatedAt: '2026-10-01T00:00:00.000Z',
          },
        },
      }
    case 'MatkaBidRules':
      return { data: { matkaBidRules: { __typename: 'MatkaBidRulePage', items: [], total: 0 } } }
    case 'UpdateMatkaSettings':
      return {
        data: {
          updateMatkaSettings: {
            __typename: 'MatkaPayload', success: true, message: 'Updated',
            matka: { __typename: 'Matka', id: 'm1', settings: operation.variables.settings },
          },
        },
      }
    case 'UpdateMatkaDefaultRates':
      if (feedback.refuseRates) return { errors: [{ message: feedback.refuseRates }] }
      return {
        data: {
          updateMatkaDefaultRates: {
            __typename: 'MatkaDefaultRates', tenant: 't1', entries: operation.variables.entries,
            updatedBy: 'u1', updatedAt: '2026-10-07T00:00:00.000Z',
          },
        },
      }
    case 'ReorderMatkas':
      return { data: { reorderMatkas: { __typename: 'MutationResult', success: true, message: 'Reordered' } } }
    case 'SetMatkaStatus':
      return {
        data: {
          setMatkaStatus: {
            __typename: 'MatkaPayload', success: true, message: 'Changed',
            matka: { __typename: 'Matka', id: operation.variables.id, status: operation.variables.toStatus },
          },
        },
      }
    case 'UpdateMatka':
      return {
        data: {
          updateMatka: {
            __typename: 'MatkaPayload', success: true, message: 'Updated',
            matka: { __typename: 'Matka', id: 'm1', name: 'Kalyan', code: 'KLN', status: 'ACTIVE', updatedAt: '2026-10-07' },
          },
        },
      }
    default:
      throw new Error(`unexpected operation ${operation.operationName}`)
  }
}

function serverLink() {
  return new ApolloLink((operation) => new Observable<FetchResult>((observer) => {
    calls.push({ operationName: operation.operationName, variables: { ...operation.variables } })
    Promise.resolve().then(() => resultFor(operation)).then(
      (result) => {
        observer.next(result)
        observer.complete()
      },
      (error: unknown) => observer.error(error),
    )
  }))
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

function renderPage(path = '/matka/list') {
  return render(
    <MockedProvider link={serverLink()}>
      <MemoryRouter initialEntries={[path]}>
        <PageEyebrowProvider value="Trading">
          <MatkaManagementPage />
          <LocationProbe />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

async function renderLoaded() {
  const view = renderPage()
  await screen.findByRole('table', { name: 'Matka catalog' })
  await screen.findByText('Kalyan')
  await waitFor(() => assert.ok(screen.queryByText('Loading matkas') === null))
  return view
}

beforeEach(() => {
  calls = []
  feedback.toasts.length = 0
  feedback.refuseRates = null
  guard.allowed = true
  guard.calls.length = 0
})

describe('MatkaManagementPage', () => {
  test('guards before data hooks and loads the exact list/stat/default-rate query contracts', async () => {
    await renderLoaded()

    assert.deepEqual(guard.calls[0], [{ domain: 'matka.management', actions: ['view'] }])
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Matka Management' }))
    assert.equal(screen.getAllByText('Manage matka catalog and schedules').length, 1)
    assert.ok(screen.queryByText('Trading') === null)
    assert.equal(screen.getByRole('link', { name: 'Create Matka' }).getAttribute('href'), '/matka/create')
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Matkas List' }))
    assert.deepEqual(within(screen.getByRole('table', { name: 'Matka catalog' }))
      .getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[2].textContent?.includes('Milan Day')),
    [true, false], 'priority order is local and stable')

    const list = calls.find((call) => call.operationName === 'Matkas'
      && (call.variables.filters as { limit?: number })?.limit === 20)
    assert.deepEqual(sent(list), { filters: { page: 1, limit: 20 } })
    for (const status of [undefined, 'ACTIVE', 'INACTIVE', 'SUSPEND']) {
      assert.ok(calls.some((call) => call.operationName === 'Matkas'
        && (call.variables.filters as { limit?: number; status?: string })?.limit === 1
        && (call.variables.filters as { status?: string })?.status === status))
    }
    assert.equal(calls.filter((call) => call.operationName === 'MatkaDefaultRates').length, 1)
  })

  test('denial renders no page and starts no GraphQL operation', () => {
    guard.allowed = false
    renderPage()
    assert.ok(screen.getByRole('alert', { name: '' }))
    assert.equal(calls.length, 0)
    assert.ok(screen.queryByRole('heading', { name: 'Matka Management' }) === null)
  })

  test('changes status/search variables and keeps the two-character debounce', async () => {
    await renderLoaded()
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'ACTIVE' } })
    await waitFor(() => assert.ok(calls.some((call) => {
      const filters = call.variables.filters as { status?: string; limit?: number }
      return call.operationName === 'Matkas' && filters?.status === 'ACTIVE' && filters.limit === 20
    })))

    const search = screen.getByRole('searchbox', { name: 'Search matka draws' })
    fireEvent.change(search, { target: { value: 'k' } })
    await new Promise((resolve) => setTimeout(resolve, 320))
    assert.ok(!calls.some((call) => (call.variables.filters as { query?: string })?.query === 'k'))
    fireEvent.change(search, { target: { value: '  ka  ' } })
    await waitFor(() => assert.ok(calls.some((call) => {
      const filters = call.variables.filters as { query?: string; status?: string; page?: number }
      return filters?.query === 'ka' && filters.status === 'ACTIVE' && filters.page === 1
    })), { timeout: 1500 })
  })

  test('a link with ?search= (the global search "See all Matka") opens the list already filtered by the term', async () => {
    renderPage('/matka/management?search=Kalyan')
    await screen.findByRole('table', { name: 'Matka catalog' })
    assert.equal((screen.getByRole('searchbox', { name: 'Search matka draws' }) as HTMLInputElement).value, 'Kalyan')
    // The first list request already carries it: no unfiltered page first.
    const first = calls.find((call) => call.operationName === 'Matkas' && (call.variables.filters as { limit?: number })?.limit === 20)
    assert.deepEqual(sent(first), { filters: { query: 'Kalyan', page: 1, limit: 20 } })
  })

  test('saves the inline message with the full legacy settings object', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Edit message for Kalyan' }))
    const message = await screen.findByRole('textbox', { name: 'User message' })
    fireEvent.change(message, { target: { value: '  New desk message  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => assert.ok(calls.some((call) => call.operationName === 'UpdateMatkaSettings')))
    const mutation = calls.find((call) => call.operationName === 'UpdateMatkaSettings')
    assert.deepEqual(sent(mutation), {
      id: 'm1',
      settings: { message: 'New desk message', notes: 'Desk note', riskLevel: 'medium', riskThreshold: 500 },
    })
  })

  test('opens individual bid settings as a dedicated page link instead of a drawer', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Open bid settings for Kalyan' }))
    await waitFor(() => assert.equal(screen.getByTestId('location').textContent, '/matka/settings/m1?tab=bid'))
    assert.equal(screen.queryByRole('dialog', { name: 'Edit Matka Settings' }), null)
  })

  test('offers ten payout types and submits only configured positive rates', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Rates Defaults' }))
    const drawer = await screen.findByRole('dialog', { name: 'Rates Defaults' })
    const payouts = within(drawer).getAllByRole('textbox', { name: 'Payout x' })
    assert.equal(payouts.length, 10)
    assert.equal((payouts[0] as HTMLInputElement).value, '9')
    fireEvent.change(payouts[0], { target: { value: '10' } })
    fireEvent.blur(payouts[0])
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save' }))

    await waitFor(() => assert.ok(calls.some((call) => call.operationName === 'UpdateMatkaDefaultRates')))
    const mutation = calls.find((call) => call.operationName === 'UpdateMatkaDefaultRates')
    const entries = sent(mutation).entries as Array<Record<string, unknown>>
    assert.equal(entries.length, 1)
    assert.deepEqual(entries[0], { betType: 'SINGLE', payoutMultiplier: 10, minOdds: 1, maxOdds: 5 })
    assert.ok(entries.every(entry => Number(entry.payoutMultiplier) > 0))
    // The mutation answers the rates (no { success, message }), so the page says it saved.
    await waitFor(() => assert.ok(feedback.toasts.some((entry) => entry.message === 'Default rates saved' && entry.tone === 'ok')))
    await waitFor(() => assert.ok(screen.queryByRole('dialog', { name: 'Rates Defaults' }) === null, 'the drawer closes'))
  })

  test('a refused Rates Defaults save keeps the drawer open with the server reason', async () => {
    feedback.refuseRates = 'Payout multiplier must be below 1000000'
    try {
      await renderLoaded()
      fireEvent.click(screen.getByRole('button', { name: 'Rates Defaults' }))
      const drawer = await screen.findByRole('dialog', { name: 'Rates Defaults' })
      fireEvent.click(within(drawer).getByRole('button', { name: 'Save' }))
      await waitFor(() => assert.ok(feedback.toasts.some((entry) => entry.message === 'Payout multiplier must be below 1000000' && entry.tone === 'error')))
      assert.ok(screen.getByRole('dialog', { name: 'Rates Defaults' }))
      assert.ok(!feedback.toasts.some((entry) => entry.tone === 'ok'))
    } finally {
      feedback.refuseRates = null
    }
  })

  test('a Super Admin in core mode is asked to select a whitelabel: nothing is read and no rates warning shows', async () => {
    // Core mode read the platform's own tenant, which holds no markets: TOTAL MATKAS 0, "Default payout rates are
    // not configured", and Create Matka and Rates Defaults still offered.
    const auth = useAuthStore.getState(), ui = useUIStore.getState()
    useAuthStore.setState({ roles: ['Super Admin'] }); useUIStore.setState({ directorMode: 'core', selectedWhitelabelId: null })
    try {
      const core = renderPage()
      assert.ok(await screen.findByText('Select a whitelabel'))
      assert.ok(screen.getByRole('heading', { level: 1, name: 'Matka Management' }))
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
      assert.equal(calls.length, 0, 'no Matkas or MatkaDefaultRates request')
      assert.ok(screen.queryByText('Default payout rates are not configured') === null, 'no rates warning')
      assert.ok(screen.queryByRole('button', { name: 'Rates Defaults' }) === null, 'no Rates Defaults')
      assert.ok(screen.queryByRole('link', { name: 'Create Matka' }) === null, 'no Create Matka')
      assert.ok(screen.queryByRole('table', { name: 'Matka catalog' }) === null, 'no catalog')
      core.unmount()
      // With a site selected the same admin gets the page, as a whitelabel admin always does.
      useUIStore.setState({ directorMode: 'whitelabel', selectedWhitelabelId: 'grandwinn-com' })
      await renderLoaded()
      assert.ok(screen.queryByText('Select a whitelabel') === null, 'no select state with a site selected')
      assert.ok(calls.some((call) => call.operationName === 'MatkaDefaultRates'))
    } finally {
      useAuthStore.setState({ roles: auth.roles }); useUIStore.setState({ directorMode: ui.directorMode, selectedWhitelabelId: ui.selectedWhitelabelId })
    }
  })
})
