/**
 * The real create/edit page under MemoryRouter + Apollo MockedProvider. Shared RBAC/currency/feedback
 * infrastructure is stubbed; the route, kit form, shared matka hooks and GraphQL documents are real.
 */
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { beforeEach, describe, test, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import {
  CREATE_MATKA_MUTATION,
  MATKAS_QUERY,
  MATKA_QUERY,
  SET_MATKA_STATUS_MUTATION,
  UPDATE_MATKA_MUTATION,
} from '@/lib/graphql/matka'
import MatkaCreateEditPage from './CreateEditPage'

const apollo = vi.hoisted(() => ({
  queries: [] as Array<{ query: unknown; options: unknown }>,
  mutations: [] as Array<{ mutation: unknown; options: unknown }>,
}))
const rbac = vi.hoisted(() => ({
  allowed: true,
  calls: [] as Array<Array<{ domain: string; actions: string[] }>>,
}))
const feedback = vi.hoisted(() => ({
  loading: vi.fn(),
  close: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  return {
    ...actual,
    useQuery: (...args: Parameters<typeof actual.useQuery>) => {
      apollo.queries.push({ query: args[0], options: args[1] })
      return actual.useQuery(...args)
    },
    useMutation: (...args: Parameters<typeof actual.useMutation>) => {
      apollo.mutations.push({ mutation: args[0], options: args[1] })
      return actual.useMutation(...args)
    },
  }
})

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({
    required,
    children,
  }: {
    required: Array<{ domain: string; actions: string[] }>
    children: ReactNode
  }) => {
    rbac.calls.push(required)
    return rbac.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    getCurrencySymbol: () => '₹',
    formatAmount: (amount: number) => `INR ${amount.toFixed(2)}`,
  }),
}))

vi.mock('@/shared/services/notification', () => ({
  notify: {
    loading: feedback.loading,
    error: feedback.error,
  },
}))

interface VariablesCall {
  input?: Record<string, unknown>
  id?: string
  toStatus?: string
  reason?: string
}

const server = vi.hoisted(() => ({
  creates: [] as VariablesCall[],
  updates: [] as VariablesCall[],
  statuses: [] as VariablesCall[],
}))

const MATKA = {
  __typename: 'Matka',
  id: '7',
  name: 'Kalyan Morning',
  code: 'kalyan-morning',
  description: 'Primary morning market',
  timezone: 'Asia/Kolkata',
  schedule: { openTime: '10:00', closeTime: '12:30', daysOfWeek: [1, 2, 3, 4, 5], session: 'MORNING' },
  status: 'ACTIVE',
  limits: { minBet: 25, maxBet: 50000, exposureCap: 100000 },
  visibility: { featured: true },
  priority: 3,
  settings: {
    autoPauseOnLiabilityThreshold: 75000,
    betWindowMinsBeforeOpen: 12,
    betWindowMinsBeforeClose: 7,
    notes: 'Operations desk',
    risk: 'LOW',
  },
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
  deletedAt: null,
}

const listMock: MockedResponse = {
  request: { query: MATKAS_QUERY },
  maxUsageCount: Number.POSITIVE_INFINITY,
  result: { data: { matkas: { __typename: 'MatkaList', items: [], total: 0 } } },
}

function matkaMock(): MockedResponse {
  return {
    request: { query: MATKA_QUERY, variables: { id: '7' } },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: { data: { matka: MATKA } },
  }
}

/** The server refusing a write with a GraphQL error, as admin-backend answers a rule it enforces. */
function refusedMock(query: typeof CREATE_MATKA_MUTATION, message: string, calls: VariablesCall[]): MockedResponse {
  return {
    request: { query },
    variableMatcher: (variables) => {
      calls.push(variables as VariablesCall)
      return true
    },
    result: { errors: [{ message }] },
  }
}

function createMock(error?: Error): MockedResponse {
  return {
    request: { query: CREATE_MATKA_MUTATION },
    variableMatcher: (variables) => {
      server.creates.push(variables as VariablesCall)
      return true
    },
    ...(error ? { error } : {
      result: {
        data: {
          createMatka: {
            __typename: 'MatkaPayload', success: true, message: 'Created',
            matka: { __typename: 'Matka', id: '8', name: 'Milan Day', code: 'milan-day', status: 'ACTIVE' },
          },
        },
      },
    }),
  }
}

function updateMock(): MockedResponse {
  return {
    request: { query: UPDATE_MATKA_MUTATION },
    variableMatcher: (variables) => {
      server.updates.push(variables as VariablesCall)
      return true
    },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: {
      data: {
        updateMatka: {
          __typename: 'MatkaPayload', success: true, message: 'Updated',
          matka: {
            __typename: 'Matka', id: '7', name: 'Kalyan Morning', code: 'kalyan-morning',
            status: 'ACTIVE', updatedAt: '2026-10-07T08:00:00.000Z',
          },
        },
      },
    },
  }
}

function statusMock(): MockedResponse {
  return {
    request: { query: SET_MATKA_STATUS_MUTATION },
    variableMatcher: (variables) => {
      server.statuses.push(variables as VariablesCall)
      return true
    },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: {
      data: {
        setMatkaStatus: {
          __typename: 'MatkaPayload', success: true, message: 'Status updated',
          matka: { __typename: 'Matka', id: '7', status: 'INACTIVE' },
        },
      },
    },
  }
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function renderAt(path: string, mocks: MockedResponse[] = [matkaMock(), createMock(), updateMock(), statusMock(), listMock]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MockedProvider mocks={mocks}>
        <PageEyebrowProvider value="Trading">
          <Routes>
            <Route path="/matka/create" element={<MatkaCreateEditPage />} />
            <Route path="/matka/edit/:id" element={<MatkaCreateEditPage />} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </PageEyebrowProvider>
      </MockedProvider>
    </MemoryRouter>,
  )
}

function button(name: string | RegExp) {
  return screen.getByRole('button', { name })
}

function textbox(name: string | RegExp) {
  return screen.getByRole('textbox', { name }) as HTMLInputElement
}

function change(name: string | RegExp, value: string) {
  fireEvent.change(textbox(name), { target: { value } })
}

function currentStep() {
  const navigation = screen.getByRole('navigation', { name: 'Form steps' })
  return within(navigation).getAllByRole('listitem').find((item) => item.getAttribute('aria-current') === 'step')
}

async function next(expected: RegExp) {
  fireEvent.click(button('Next Step'))
  await waitFor(() => assert.match(currentStep()?.textContent ?? '', expected))
}

async function loadEdit() {
  await waitFor(() => assert.equal(textbox('Name').value, 'Kalyan Morning'))
}

beforeEach(() => {
  apollo.queries.length = 0
  apollo.mutations.length = 0
  rbac.allowed = true
  rbac.calls.length = 0
  server.creates.length = 0
  server.updates.length = 0
  server.statuses.length = 0
  feedback.loading.mockReset()
  feedback.close.mockReset()
  feedback.error.mockReset()
  feedback.loading.mockReturnValue(feedback.close)
})

describe('MatkaCreateEditPage create', () => {
  test('renders the guarded kit page, the exact header/step copy and legacy defaults', () => {
    renderAt('/matka/create')

    assert.deepEqual(rbac.calls[0], [{ domain: 'matka.management', actions: ['view', 'create', 'update'] }])
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Create Matka' }))
    assert.ok(screen.queryByText('Configure new matka with schedule and betting limits') === null)
    assert.ok(screen.queryByText('Trading') === null)
    assert.ok(button('Back to Matkas'))
    assert.match(currentStep()?.textContent ?? '', /Basic InfoName & schedule/)
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Basic Matka Information' }))
    assert.equal(textbox('Name').getAttribute('placeholder'), 'e.g., Kalyan Morning')
    assert.equal(textbox('Code').getAttribute('placeholder'), 'kalyan-morning')
    assert.equal((screen.getByLabelText(/Open Time/) as HTMLInputElement).value, '09:00')
    assert.equal((screen.getByLabelText(/Close Time/) as HTMLInputElement).value, '21:00')
    assert.equal(button('Sunday').getAttribute('aria-pressed'), 'false')
    assert.equal(button('Monday').getAttribute('aria-pressed'), 'true')
    assert.ok(screen.getByText('6 days selected'))
    assert.ok(screen.getByRole('progressbar', { name: 'Step 1 of 3' }))

    const lookup = apollo.queries.find((call) => call.query === MATKA_QUERY)
    assert.deepEqual(lookup?.options, { variables: { id: '' }, skip: true, errorPolicy: 'all' })
    for (const document of [CREATE_MATKA_MUTATION, UPDATE_MATKA_MUTATION, SET_MATKA_STATUS_MUTATION]) {
      const hook = apollo.mutations.find((call) => call.mutation === document)
      assert.ok(hook)
      assert.deepEqual(hook.options, { refetchQueries: [{ query: MATKAS_QUERY }] })
    }
  })

  test('auto-generates the code, preserves a manual code, and resumes after Clear code', async () => {
    renderAt('/matka/create')
    change('Name', '  Milan Day++ ')
    await waitFor(() => assert.equal(textbox('Code').value, 'milan-day'))

    change('Code', 'desk-code')
    change('Name', 'Milan Night')
    await act(async () => undefined)
    assert.equal(textbox('Code').value, 'desk-code')

    fireEvent.click(button('Clear Code'))
    await waitFor(() => assert.equal(textbox('Code').value, 'milan-night'))
  })

  test('Next keeps an invalid basic step open, reports fields and focuses the first invalid control', async () => {
    renderAt('/matka/create')
    fireEvent.click(button('Clear'))
    fireEvent.click(button('Next Step'))

    assert.ok(await screen.findByText('Please enter name'))
    assert.ok(screen.getByText('kebab-case only (a-z, 0-9, - )'))
    assert.ok(screen.getByText('Select at least one day'))
    assert.match(currentStep()?.textContent ?? '', /Basic Info/)
    await waitFor(() => assert.equal(document.activeElement, textbox('Name')))
  })

  test('day presets are pressed controls and configuration keeps every field, default and helper', async () => {
    renderAt('/matka/create')
    change('Name', 'Milan Day')
    await waitFor(() => assert.equal(textbox('Code').value, 'milan-day'))
    fireEvent.click(button('Weekend'))
    assert.equal(button('Weekend').getAttribute('aria-pressed'), 'true')
    assert.equal(button('Sunday').getAttribute('aria-pressed'), 'true')
    assert.equal(button('Monday').getAttribute('aria-pressed'), 'false')
    assert.ok(screen.getByText('2 days selected'))

    await next(/Betting Configuration/)
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Betting Configuration' }))
    assert.equal(textbox('Min Bet Amount').value, '10')
    assert.equal(textbox('Max Bet Amount').value, '10000')
    assert.equal((screen.getByRole('combobox', { name: 'Status' }) as HTMLSelectElement).value, 'ACTIVE')
    assert.ok(screen.getByText('Inactive prevents placing bets'))
    assert.ok(screen.getByText('Auto-pause when total liability exceeds this amount Minimum: 0.'))
    assert.equal(textbox('Betting Cutoff (Before Open)').value, '15')
    assert.equal(textbox('Betting Cutoff (Before Close)').value, '10')
    assert.equal(screen.getByRole('switch', { name: 'Featured' }).getAttribute('aria-checked'), 'false')
  })

  test('Betting Configuration Next checks its fields with the submit rules and stays on the step until they pass', async () => {
    renderAt('/matka/create')
    change('Name', 'Milan Day')
    await waitFor(() => assert.equal(textbox('Code').value, 'milan-day'))
    await next(/Betting Configuration/)
    change('Min Bet Amount', '')
    change('Betting Cutoff (Before Open)', '')

    // It used to go on to Review, and only Create Matka found the errors.
    fireEvent.click(button('Next Step'))
    assert.ok(await screen.findByText('Please enter min bet amount'))
    assert.ok(screen.getByText('Please enter betting cutoff before open'))
    assert.match(currentStep()?.textContent ?? '', /Betting Configuration/)
    await waitFor(() => assert.ok(document.activeElement === textbox('Min Bet Amount'), 'focus moves to the first invalid field'))

    change('Min Bet Amount', '25')
    change('Betting Cutoff (Before Open)', '15')
    await next(/Review/)
    assert.ok(screen.getByText('INR 25.00'))
    assert.equal(server.creates.length, 0)
  })

  test('review keeps the entered facts, days, amounts, status, featured flag and notes', async () => {
    renderAt('/matka/create')
    change('Name', 'Milan Day')
    await waitFor(() => assert.equal(textbox('Code').value, 'milan-day'))
    await next(/Betting Configuration/)
    fireEvent.click(screen.getByRole('switch', { name: 'Featured' }))
    change('Internal Notes', 'Desk note')
    await next(/Review/)

    for (const value of ['Milan Day', 'milan-day', '09:00', '21:00', 'INR 10.00', 'INR 10000.00', 'ACTIVE', 'Yes', 'Desk note']) {
      assert.ok(screen.getByText(value), value)
    }
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
      assert.ok(screen.getByText(day), day)
    }
  })

  test('creates with the exact cleaned input, closes progress feedback and returns to the list', async () => {
    renderAt('/matka/create')
    change('Name', 'Milan Day')
    await waitFor(() => assert.equal(textbox('Code').value, 'milan-day'))
    await next(/Betting Configuration/)
    change('Internal Notes', 'Desk note')
    const previousNext = button('Next Step')
    await next(/Review/)
    assert.equal(previousNext.isConnected, false, 'Next must not morph into submit during activation')
    assert.equal(server.creates.length, 0)
    fireEvent.click(button('Create Matka'))

    assert.equal((await screen.findByTestId('location')).textContent, '/matka/list')
    assert.equal(server.creates.length, 1)
    assert.deepEqual(server.creates[0], {
      input: {
        name: 'Milan Day', code: 'milan-day', timezone: 'Asia/Kolkata', status: 'ACTIVE',
        schedule: { openTime: '09:00', closeTime: '21:00', daysOfWeek: [1, 2, 3, 4, 5, 6], closesNextDay: false },
        limits: { minBet: 10, maxBet: 10000 }, visibility: { featured: false }, priority: 0,
        settings: { matkaType: 'worli', openSuspended: false, closeSuspended: false, message: '', betWindowMinsBeforeOpen: 15, betWindowMinsBeforeClose: 10, notes: 'Desk note' },
      },
    })
    assert.deepEqual(feedback.loading.mock.calls[0], ['Creating matka…', 0])
    assert.equal(feedback.close.mock.calls.length, 1)
    assert.equal(feedback.error.mock.calls.length, 0)
  })

  test('a rejected create stays on the form, closes the loader and shows the exact failure', async () => {
    renderAt('/matka/create', [createMock(new Error('Network down')), listMock])
    change('Name', 'Milan Day')
    await waitFor(() => assert.equal(textbox('Code').value, 'milan-day'))
    await next(/Betting Configuration/)
    await next(/Review/)
    fireEvent.click(button('Create Matka'))

    await waitFor(() => assert.equal(feedback.error.mock.calls.length, 1))
    assert.deepEqual(feedback.error.mock.calls[0], ['Network down'])
    assert.equal(feedback.close.mock.calls.length, 1)
    assert.ok(button('Create Matka'))
    assert.equal(screen.queryByTestId('location'), null)
  })

  test('a create the server refuses shows its reason instead of the catch-all', async () => {
    renderAt('/matka/create', [refusedMock(CREATE_MATKA_MUTATION, 'A matka with this code already exists', server.creates), listMock])
    change('Name', 'Milan Day')
    await waitFor(() => assert.equal(textbox('Code').value, 'milan-day'))
    await next(/Betting Configuration/)
    await next(/Review/)
    fireEvent.click(button('Create Matka'))

    await waitFor(() => assert.equal(feedback.error.mock.calls.length, 1))
    assert.deepEqual(feedback.error.mock.calls[0], ['A matka with this code already exists'])
    assert.equal(screen.queryByTestId('location'), null)
  })

  test('Min Bet 0 is stopped at Next on Betting Configuration, and the field hint states the same rule', async () => {
    renderAt('/matka/create')
    change('Name', 'Milan Day')
    await waitFor(() => assert.equal(textbox('Code').value, 'milan-day'))
    await next(/Betting Configuration/)
    // The hint read "Minimum: 0." beside the error "Value must be more than 0".
    const described = () => (textbox('Min Bet Amount').getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? '').join(' | ')
    assert.equal(described(), 'Must be more than 0.')
    change('Min Bet Amount', '0')
    fireEvent.blur(textbox('Min Bet Amount'))
    fireEvent.click(button('Next Step'))

    // It used to reach Review ("Min Bet Amount ₹0.00"); only Create Matka refused it.
    assert.ok(await screen.findByText('Value must be more than 0'))
    assert.match(currentStep()?.textContent ?? '', /Betting Configuration/)
    assert.ok(screen.queryByRole('heading', { level: 2, name: 'Review Matka Information' }) === null, 'Review is not reached')
    assert.equal(described(), 'Must be more than 0. | Value must be more than 0')
    assert.equal(textbox('Min Bet Amount').getAttribute('aria-invalid'), 'true')
    assert.equal(server.creates.length, 0)
    assert.equal(feedback.error.mock.calls.length, 0)
  })
})

describe('MatkaCreateEditPage edit and access', () => {
  test('loads by route id, hydrates every stored field and shows Priority instead of Code', async () => {
    renderAt('/matka/edit/7')
    await loadEdit()

    assert.ok(screen.getByRole('heading', { level: 1, name: 'Edit Matka' }))
    assert.ok(screen.queryByText('Update matka configuration') === null)
    assert.equal(screen.queryByRole('textbox', { name: 'Code' }), null)
    assert.equal(textbox('Priority').value, '3')
    assert.equal((screen.getByLabelText(/Open Time/) as HTMLInputElement).value, '10:00')
    assert.equal((screen.getByLabelText(/Close Time/) as HTMLInputElement).value, '12:30')
    assert.equal(button('Weekdays').getAttribute('aria-pressed'), 'true')
    const lookup = apollo.queries.find((call) => call.query === MATKA_QUERY)
    assert.deepEqual(lookup?.options, { variables: { id: '7' }, skip: false, errorPolicy: 'all' })
  })

  test('an unchanged-status edit includes status, preserves unknown objects and returns to the list', async () => {
    renderAt('/matka/edit/7')
    await loadEdit()
    change('Name', 'Kalyan Morning Plus')
    await next(/Betting Configuration/)
    await next(/Review/)
    fireEvent.click(button('Save Changes'))

    assert.equal((await screen.findByTestId('location')).textContent, '/matka/list')
    assert.equal(server.updates.length, 1)
    const input = server.updates[0]?.input as Record<string, unknown>
    assert.equal(input.id, '7')
    assert.equal(input.name, 'Kalyan Morning Plus')
    assert.equal(input.description, 'Primary morning market')
    assert.equal(input.status, 'ACTIVE')
    assert.equal('code' in input, false)
    assert.deepEqual(input.schedule, { closesNextDay: false, ...MATKA.schedule })
    assert.deepEqual(input.limits, MATKA.limits)
    assert.deepEqual(input.settings, { matkaType: 'worli', openSuspended: false, closeSuspended: false, message: '', ...MATKA.settings })
    assert.equal(server.statuses.length, 0)
    assert.deepEqual(feedback.loading.mock.calls[0], ['Saving changes…', 0])
  })

  test('a changed status asks for a reason; Cancel does nothing, Apply updates then changes status', async () => {
    renderAt('/matka/edit/7')
    await loadEdit()
    await next(/Betting Configuration/)
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'INACTIVE' } })
    await next(/Review/)
    fireEvent.click(button('Save Changes'))

    const dialog = await screen.findByRole('dialog', { name: 'Reason for Status Change' })
    assert.ok(within(dialog).getByText('Please provide a brief reason for changing the status. This will be recorded in the audit log.'))
    assert.ok(within(dialog).getByRole('textbox', { name: 'Reason' }))
    assert.equal(server.updates.length, 0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    assert.equal(server.updates.length, 0)

    fireEvent.click(button('Save Changes'))
    const reopened = await screen.findByRole('dialog', { name: 'Reason for Status Change' })
    fireEvent.change(within(reopened).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Operator review' } })
    fireEvent.click(within(reopened).getByRole('button', { name: 'Apply' }))

    assert.equal((await screen.findByTestId('location')).textContent, '/matka/list')
    assert.equal(server.updates.length, 1)
    assert.equal('status' in (server.updates[0]?.input as Record<string, unknown>), false)
    assert.deepEqual(server.statuses, [{ id: '7', toStatus: 'INACTIVE', reason: 'Operator review' }])
    assert.equal(feedback.close.mock.calls.length, 1)
  })

  test('an edit the server refuses (open bets on a schedule change) says why and stays on the form', async () => {
    const reason = 'Settle or void pending bets before changing the market type or schedule'
    renderAt('/matka/edit/7', [matkaMock(), refusedMock(UPDATE_MATKA_MUTATION, reason, server.updates), statusMock(), listMock])
    await loadEdit()
    fireEvent.change(screen.getByLabelText(/Close Time/), { target: { value: '12:35' } })
    await next(/Betting Configuration/)
    await next(/Review/)
    fireEvent.click(button('Save Changes'))

    await waitFor(() => assert.equal(feedback.error.mock.calls.length, 1))
    assert.deepEqual(feedback.error.mock.calls[0], [reason])
    assert.equal(server.updates.length, 1)
    assert.equal(screen.queryByTestId('location'), null)
  })

  test('a submit refused for a field no Next checks still returns to the step that shows it', async () => {
    // An old record's negative priority passes both Next checks; the full submit still finds it on Basic Info.
    const record: MockedResponse = { request: { query: MATKA_QUERY, variables: { id: '7' } }, maxUsageCount: Number.POSITIVE_INFINITY, result: { data: { matka: { ...MATKA, priority: -1 } } } }
    renderAt('/matka/edit/7', [record, updateMock(), statusMock(), listMock])
    await loadEdit()
    await next(/Betting Configuration/)
    await next(/Review/)
    fireEvent.click(button('Save Changes'))

    await waitFor(() => assert.match(currentStep()?.textContent ?? '', /Basic Info/))
    assert.ok(await screen.findByText('Value must be at least 0'))
    assert.equal(server.updates.length, 0)
  })

  test('Apply accepts an empty reason and sends the legacy default', async () => {
    renderAt('/matka/edit/7')
    await loadEdit()
    await next(/Betting Configuration/)
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'SUSPEND' } })
    await next(/Review/)
    fireEvent.click(button('Save Changes'))
    const dialog = await screen.findByRole('dialog', { name: 'Reason for Status Change' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))

    await waitFor(() => assert.equal(server.statuses.length, 1))
    assert.deepEqual(server.statuses[0], { id: '7', toStatus: 'SUSPEND', reason: 'Status change' })
  })

  test('an id the server does not return opens a not-found state, not an empty savable editor (SCO-11)', async () => {
    // Another whitelabel's or a deleted matka answers matka: null with no error.
    const foreign = '726fc97a-cf23-4e5c-98d3-64a51e2a2a7e'
    const missing: MockedResponse = { request: { query: MATKA_QUERY, variables: { id: foreign } }, result: { data: { matka: null } } }
    const view = renderAt(`/matka/edit/${foreign}`, [missing, updateMock(), statusMock(), listMock])
    assert.ok(await screen.findByText('Matka not found'))
    assert.ok(screen.getByText('There is no such matka in this whitelabel. It may have been deleted.'))
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Edit Matka' }))
    assert.equal(screen.queryByRole('button', { name: 'Next Step' }), null)
    assert.equal(screen.queryByRole('textbox', { name: 'Name' }), null)
    fireEvent.click(button('Back to Matkas'))
    assert.equal((await screen.findByTestId('location')).textContent, '/matka/list')
    assert.equal(server.updates.length + server.statuses.length, 0)
    view.unmount()

    // A failed load says so, with the server's reason.
    const failed: MockedResponse = { request: { query: MATKA_QUERY, variables: { id: '9' } }, result: { errors: [{ message: 'Matka lookup failed' }] } }
    renderAt('/matka/edit/9', [failed, listMock])
    assert.ok(await screen.findByText('Error loading matka'))
    assert.ok(screen.getByText('Matka lookup failed'))
    assert.equal(screen.queryByRole('button', { name: 'Next Step' }), null)
  })

  test('while the matka loads the editor is not replaced by the not-found state', async () => {
    renderAt('/matka/edit/7')
    assert.equal(screen.queryByText('Matka not found'), null)
    await loadEdit()
    assert.equal(screen.queryByText('Matka not found'), null)
    assert.ok(button('Next Step'))
  })

  test('Cancel and Back to Matkas return to the list without a mutation', async () => {
    renderAt('/matka/create')
    fireEvent.click(button('Cancel'))
    assert.equal((await screen.findByTestId('location')).textContent, '/matka/list')
    assert.equal(server.creates.length, 0)
  })

  test('the RBAC denial stops before the page and starts no GraphQL operation', async () => {
    rbac.allowed = false
    renderAt('/matka/edit/7')
    assert.equal(screen.getByRole('alert').textContent, 'Access denied')
    await act(async () => undefined)
    assert.equal(apollo.queries.length, 0)
    assert.equal(apollo.mutations.length, 0)
    assert.equal(screen.queryByRole('heading', { level: 1 }), null)
  })

  test('a Super Admin in core mode is asked to select a whitelabel on create and edit: no lookup, no form, no write', async () => {
    // Core mode has no whitelabel: Create Matka wrote to the platform's own tenant ('default'), where no whitelabel
    // sees it, and an edit read that tenant and called a real matka "not found".
    const auth = useAuthStore.getState(), ui = useUIStore.getState()
    useAuthStore.setState({ roles: ['Super Admin'] }); useUIStore.setState({ directorMode: 'core', selectedWhitelabelId: null })
    try {
      // The permission check still comes first.
      rbac.allowed = false
      const denied = renderAt('/matka/create')
      assert.equal(screen.getByRole('alert').textContent, 'Access denied')
      assert.ok(screen.queryByText('Select a whitelabel') === null, 'the denial, not the select state')
      denied.unmount()
      rbac.allowed = true

      const create = renderAt('/matka/create')
      assert.ok(await screen.findByText('Select a whitelabel'))
      assert.ok(screen.getByRole('heading', { level: 1, name: 'Create Matka' }))
      assert.ok(screen.queryByRole('button', { name: 'Next Step' }) === null, 'no Next Step')
      assert.ok(screen.queryByRole('textbox', { name: 'Name' }) === null, 'no form')
      create.unmount()

      const edit = renderAt('/matka/edit/7')
      assert.ok(await screen.findByText('Select a whitelabel'))
      assert.ok(screen.getByRole('heading', { level: 1, name: 'Edit Matka' }))
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
      assert.ok(screen.queryByText('Matka not found') === null, 'no misleading not-found')
      assert.equal(apollo.queries.length, 0, 'no Matka lookup')
      assert.equal(apollo.mutations.length, 0, 'no create, update or status mutation is prepared')
      assert.equal(server.creates.length + server.updates.length + server.statuses.length, 0)
      edit.unmount()

      // With a site selected the same admin gets the editor, as a whitelabel admin always does.
      useUIStore.setState({ directorMode: 'whitelabel', selectedWhitelabelId: 'grandwinn-com' })
      const selected = renderAt('/matka/edit/7')
      await loadEdit()
      assert.ok(screen.queryByText('Select a whitelabel') === null, 'no select state with a site selected')
      assert.ok(button('Next Step'))
      selected.unmount()

      // A whitelabel admin is never asked, whatever mode the store holds.
      useAuthStore.setState({ roles: ['Whitelabel Admin'] }); useUIStore.setState({ directorMode: 'core', selectedWhitelabelId: null })
      renderAt('/matka/create')
      assert.ok(screen.getByRole('textbox', { name: 'Name' }))
      assert.ok(screen.queryByText('Select a whitelabel') === null, 'no select state for a whitelabel admin')
    } finally {
      rbac.allowed = true
      useAuthStore.setState({ roles: auth.roles }); useUIStore.setState({ directorMode: ui.directorMode, selectedWhitelabelId: ui.selectedWhitelabelId })
    }
  })
})
