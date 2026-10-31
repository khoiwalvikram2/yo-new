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

  test('Betting Configuration Next has no hard validation; final submit still validates all fields', async () => {
    renderAt('/matka/create')
    change('Name', 'Milan Day')
    await waitFor(() => assert.equal(textbox('Code').value, 'milan-day'))
    await next(/Betting Configuration/)
    change('Min Bet Amount', '')
    change('Betting Cutoff (Before Open)', '')

    await next(/Review/)
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Review Matka Information' }))
    fireEvent.click(button('Create Matka'))
    await act(async () => undefined)
    assert.equal(server.creates.length, 0)
    assert.match(currentStep()?.textContent ?? '', /Review/)

    fireEvent.click(button('Previous'))
    await waitFor(() => assert.ok(screen.getByText('Please enter min bet amount')))
    assert.ok(screen.getByText('Please enter betting cutoff before open'))
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
    assert.deepEqual(feedback.error.mock.calls[0], ['Failed to save matka. Please check the form and try again.'])
    assert.equal(feedback.close.mock.calls.length, 1)
    assert.ok(button('Create Matka'))
    assert.equal(screen.queryByTestId('location'), null)
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
})
