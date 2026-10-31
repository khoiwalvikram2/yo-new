/**
 * The Declare Matka Result drawer and its form, against a mocked GraphQL server (MockedProvider with a link
 * that answers by operation name). The hooks are the real ones, wrapped only to record their options, so
 * the documents stay untouched in modules/matka/results/graphql.ts. Covers the legacy defaults and copy,
 * the required and pattern rules, digits-only entry and the live preview, the open-result check and the
 * automatic type switch, the locked Close state, the exact mutation input and context, a refused
 * declaration, Reset, and the refused later day.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { istToday } from '@/ui/components/istDate'
import { CREATE_MATKA_RESULT_MUTATION, MATKA_RESULTS_QUERY, MATKA_RESULT_EXISTS_QUERY } from '@/modules/matka/results'
import { DeclareResultDrawer } from './DeclareResultDrawer'

interface HookCall {
  document: unknown
  options: Record<string, unknown> | undefined
}

interface ServerCall {
  operationName: string
  variables: Record<string, unknown>
}

const apollo = vi.hoisted(() => ({
  queries: [] as HookCall[],
  mutations: [] as HookCall[],
  mutateCalls: [] as Array<Record<string, unknown> | undefined>,
}))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  return {
    ...actual,
    useQuery: (...args: Parameters<typeof actual.useQuery>) => {
      apollo.queries.push({ document: args[0], options: args[1] as Record<string, unknown> | undefined })
      return actual.useQuery(...args)
    },
    useMutation: (...args: Parameters<typeof actual.useMutation>) => {
      apollo.mutations.push({ document: args[0], options: args[1] as Record<string, unknown> | undefined })
      const [mutate, result] = actual.useMutation(...args)
      const recorded = ((options?: Record<string, unknown>) => {
        apollo.mutateCalls.push(options)
        return mutate(options)
      }) as typeof mutate
      return [recorded, result] as const
    },
  }
})

const MATKAS = [
  { id: 'm1', name: 'Kalyan', code: 'KLN' },
  { id: 'm2', name: 'Milan Day', code: 'MLD' },
].map((matka) => ({
  __typename: 'Matka',
  ...matka,
  description: null,
  timezone: 'Asia/Kolkata',
  status: 'ACTIVE',
  priority: 1,
  schedule: null,
  limits: null,
  settings: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}))

interface ServerState {
  calls: ServerCall[]
  openExists: Record<string, boolean>
  create: { success: boolean; message: string }
}

let server: ServerState

function calls(operationName: string) {
  return server.calls.filter((call) => call.operationName === operationName)
}

function sent(call: ServerCall | undefined) {
  return JSON.parse(JSON.stringify(call?.variables ?? null)) as Record<string, unknown>
}

function handle(operation: Operation): FetchResult {
  const variables = operation.variables as Record<string, unknown>
  switch (operation.operationName) {
    case 'MatkaCatalog':
      return { data: { matkas: { __typename: 'MatkaPage', items: MATKAS, total: MATKAS.length } } }
    case 'MatkaResultExists':
      return { data: { matkaResultExists: Boolean(server.openExists[String(variables.matkaId)]) } }
    case 'CreateMatkaResult':
      return {
        data: {
          createMatkaResult: {
            __typename: 'MatkaResultPayload',
            success: server.create.success,
            message: server.create.message,
            result: null,
            impact: null,
          },
        },
      }
    case 'MatkaResults':
      return { data: { matkaResults: { __typename: 'MatkaResultPage', items: [], total: 0 } } }
    default:
      throw new Error(`unexpected operation ${operation.operationName}`)
  }
}

function serverLink() {
  return new ApolloLink((operation) => new Observable<FetchResult>((observer) => {
    server.calls.push({ operationName: operation.operationName, variables: { ...operation.variables } })
    Promise.resolve()
      .then(() => handle(operation))
      .then(
        (result) => {
          observer.next(result)
          observer.complete()
        },
        (error: unknown) => observer.error(error),
      )
  }))
}

const callbacks = { onClose: vi.fn(), onSuccess: vi.fn() }

async function renderDrawer() {
  render(
    <MockedProvider link={serverLink()}>
      <DeclareResultDrawer open onClose={callbacks.onClose} onSuccess={callbacks.onSuccess} />
    </MockedProvider>,
  )
  const drawer = await screen.findByRole('dialog', { name: 'Declare Matka Result' })
  await waitFor(() => assert.equal(calls('MatkaCatalog').length, 1))
  return drawer
}

function market() {
  return screen.getByRole('combobox', { name: /^Market/ }) as HTMLInputElement
}

function dateField() {
  return screen.getByLabelText(/^Date/) as HTMLInputElement
}

function typeField() {
  return screen.getByRole('combobox', { name: /^Type/ }) as HTMLSelectElement
}

function resultField() {
  return screen.getByRole('textbox', { name: /^Result/ }) as HTMLInputElement
}

function declareButton() {
  return screen.getByRole('button', { name: 'Declare Result' })
}

async function pickMarket(name: string) {
  fireEvent.keyDown(market(), { key: 'ArrowDown' })
  const list = await screen.findByRole('listbox', { name: /^Market/ })
  fireEvent.click(within(list).getByRole('option', { name }))
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

beforeEach(() => {
  server = { calls: [], openExists: { m1: true, m2: false }, create: { success: true, message: 'Declared' } }
  apollo.queries.length = 0
  apollo.mutations.length = 0
  apollo.mutateCalls.length = 0
  callbacks.onClose.mockReset()
  callbacks.onSuccess.mockReset()
})

describe('DeclareResultDrawer', () => {
  test('opens on the legacy defaults, copy and hooks', async () => {
    const drawer = await renderDrawer()

    assert.deepEqual(
      within(drawer).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
      ['Market & Date', 'Result Type', 'Result Value'],
    )
    assert.ok(within(drawer).getByText('Select the Matka market and result date'))
    assert.ok(within(drawer).getByText('Choose open or close result'))
    assert.ok(within(drawer).getByText('Enter the winning result number'))
    assert.ok(within(drawer).getByText('Declare open or close result for a Matka market'))

    assert.equal(market().value, '')
    assert.equal(market().getAttribute('placeholder'), 'Select market')
    assert.equal(dateField().value, istToday())
    assert.equal(dateField().getAttribute('max'), istToday())
    assert.equal(typeField().value, 'open')
    assert.deepEqual([...typeField().options].map((option) => option.textContent), ['Open', 'Close'])
    assert.equal(resultField().value, '')
    assert.equal(resultField().getAttribute('placeholder'), 'e.g., 267')
    assert.equal(resultField().getAttribute('maxlength'), '3')
    assert.ok(within(drawer).getByRole('button', { name: 'Reset' }))
    assert.ok(within(drawer).getByRole('button', { name: 'Cancel' }))
    assert.equal(declareButton().getAttribute('aria-disabled'), null)
    assert.ok(screen.queryByText('Live Preview') === null)

    const create = apollo.mutations.find((call) => call.document === CREATE_MATKA_RESULT_MUTATION)
    assert.deepEqual(create?.options, { refetchQueries: [{ query: MATKA_RESULTS_QUERY }], errorPolicy: 'all' })
    const exists = apollo.queries.find((call) => call.document === MATKA_RESULT_EXISTS_QUERY)
    assert.deepEqual(exists?.options, {
      variables: { matkaId: undefined, date: istToday(), type: 'open' },
      errorPolicy: 'all',
      fetchPolicy: 'no-cache',
      nextFetchPolicy: 'no-cache',
      notifyOnNetworkStatusChange: true,
      skip: true,
    })
    assert.equal(calls('MatkaResultExists').length, 0, 'no check before a market is chosen')
  })

  test('Declare with nothing chosen shows the legacy messages and focuses the first field', async () => {
    await renderDrawer()

    fireEvent.click(declareButton())
    assert.ok(screen.getByText('Please select a market'))
    assert.ok(screen.getByText('Please enter result'))
    assert.ok(document.activeElement === market())
    assert.equal(calls('CreateMatkaResult').length, 0)
  })

  test('the result takes digits only, checks its pattern as it changes, and previews the declaration', async () => {
    await renderDrawer()

    fireEvent.change(resultField(), { target: { value: 'a4' } })
    assert.equal(resultField().value, '4')
    assert.ok(screen.getByText('Enter a three-digit Pana in 1-9,0 order'))
    assert.ok(screen.queryByText('Live Preview') === null)

    fireEvent.change(resultField(), { target: { value: '4b56' } })
    assert.equal(resultField().value, '456')
    assert.ok(screen.queryByText('Enter a three-digit Pana in 1-9,0 order') === null)
    assert.ok(screen.getByText('Live Preview'))
    assert.equal(screen.getByText('Result:').closest('p')?.textContent, 'Result: 456')
    assert.ok(screen.getByText(`This will be the open result for ${istToday()}`))

    fireEvent.change(resultField(), { target: { value: '' } })
    assert.ok(screen.getByText('Please enter result'))
  })

  test('choosing a market checks for an open result, and Close follows when there is one', async () => {
    await renderDrawer()

    await pickMarket('Kalyan (KLN)')
    await waitFor(() => assert.equal(calls('MatkaResultExists').length, 1))
    assert.deepEqual(sent(calls('MatkaResultExists')[0]), { matkaId: 'm1', date: istToday(), type: 'open' })

    await waitFor(() => assert.equal(typeField().value, 'close'))
    assert.ok(await screen.findByText('Open result found'))
    assert.ok(screen.getByText(
      'Open result exists for the selected market/date. You can safely declare the close result.',
    ))
    assert.equal(resultField().disabled, false)
    assert.equal(declareButton().getAttribute('aria-disabled'), null)

    fireEvent.change(resultField(), { target: { value: '78' } })
    assert.ok(screen.getByText(`This will be the close result for ${istToday()}`))
  })

  test('Close without an open result locks the result and Declare says why', async () => {
    await renderDrawer()

    await pickMarket('Milan Day (MLD)')
    await waitFor(() => assert.equal(calls('MatkaResultExists').length, 1))
    assert.equal(typeField().value, 'open', 'no open result: the type stays Open')

    fireEvent.change(typeField(), { target: { value: 'close' } })
    // choosing Close re-checks
    await waitFor(() => assert.equal(calls('MatkaResultExists').length, 2))
    assert.ok(await screen.findByText('Open result required'))
    assert.ok(screen.getByText('Cannot declare close result until open result is declared for this date/market.'))
    assert.equal(typeField().value, 'close', 'a hand-picked type is not switched back')
    assert.equal(resultField().disabled, true)

    const button = declareButton()
    assert.equal(button.getAttribute('aria-disabled'), 'true')
    const notice = document.getElementById(button.getAttribute('aria-describedby') ?? '')
    assert.ok(notice?.textContent?.includes('Open result required'))

    fireEvent.click(button)
    assert.equal(calls('CreateMatkaResult').length, 0)
  })

  test('Declare sends the exact input and context, then reloads and closes', async () => {
    await renderDrawer()

    await pickMarket('Milan Day (MLD)')
    await waitFor(() => assert.equal(calls('MatkaResultExists').length, 1))
    fireEvent.change(resultField(), { target: { value: '267' } })
    fireEvent.click(declareButton())

    await waitFor(() => assert.equal(calls('CreateMatkaResult').length, 1))
    assert.deepEqual(sent(calls('CreateMatkaResult')[0]).input, { matkaId: 'm2', date: istToday(), type: 'open', result: '267' })
    assert.match(String(sent(calls('CreateMatkaResult')[0]).idempotencyKey), /^[0-9a-f-]{36}$/i)
    assert.deepEqual(apollo.mutateCalls[apollo.mutateCalls.length - 1]?.context, { uiToast: 'notification' })
    await waitFor(() => assert.equal(callbacks.onSuccess.mock.calls.length, 1))
    assert.equal(callbacks.onClose.mock.calls.length, 1)
  })

  test('a refused declaration keeps the form as it was', async () => {
    server.create = { success: false, message: 'Result already declared' }
    await renderDrawer()

    await pickMarket('Milan Day (MLD)')
    fireEvent.change(resultField(), { target: { value: '267' } })
    fireEvent.click(declareButton())

    await waitFor(() => assert.equal(calls('CreateMatkaResult').length, 1))
    await waitFor(() => assert.equal(declareButton().getAttribute('aria-busy'), null))
    assert.equal(callbacks.onSuccess.mock.calls.length, 0)
    assert.equal(callbacks.onClose.mock.calls.length, 0)
    assert.equal(resultField().value, '267')
  })

  test('Reset returns every field to its default', async () => {
    await renderDrawer()

    await pickMarket('Milan Day (MLD)')
    fireEvent.change(dateField(), { target: { value: '2026-09-01' } })
    fireEvent.change(typeField(), { target: { value: 'close' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))

    await waitFor(() => assert.equal(market().value, ''))
    assert.equal(dateField().value, istToday())
    assert.equal(typeField().value, 'open')
    assert.equal(resultField().value, '')
    assert.ok(screen.queryByText('Please select a market') === null)
  })

  test('a later day is refused as the legacy picker refused it; a cleared date is required', async () => {
    await renderDrawer()

    fireEvent.change(dateField(), { target: { value: nextDay(istToday()) } })
    assert.equal(dateField().value, istToday())

    fireEvent.change(dateField(), { target: { value: '2026-09-01' } })
    assert.equal(dateField().value, '2026-09-01')

    fireEvent.change(dateField(), { target: { value: '' } })
    assert.equal(dateField().value, '')
    assert.ok(screen.getByText('Please select a date'))
  })
})
