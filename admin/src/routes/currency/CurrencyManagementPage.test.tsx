/**
 * /currency against a mocked GraphQL server (MockedProvider): the guard, the exact list query and each
 * mutation's variables, the statistics, search / status / paging, the create and edit dialog with its
 * legacy toasts, the row actions with their confirmations, Export Excel, the error state with Retry, and the
 * converter and settings views staying unreachable, as before (they have no opener on the currencies view;
 * the converter has its own component test). The mocked server applies each mutation, so a refetch shows
 * what the backend would return.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { GraphQLError, print } from 'graphql'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import {
  ACTIVATE_CURRENCY,
  CREATE_CURRENCY,
  DEACTIVATE_CURRENCY,
  DELETE_CURRENCY,
  UPDATE_CURRENCY,
} from '@/lib/graphql/currency'
import { useAuthStore } from '@/shared/core/authStore'
import type { Currency } from '@/shared/types/currency'
import CurrencyManagementPage from './CurrencyManagementPage'
import { ALL_CURRENCIES } from './currencyQueries'

interface ConfirmOptions {
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: string
  onConfirm?: () => void | Promise<void>
}

interface GuardCall {
  required: Array<{ domain: string; actions: string[] }>
  requireAny?: boolean
}

const feedback = vi.hoisted(() => ({
  confirm: vi.fn(),
  closeLoading: vi.fn(),
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}))
const guard = vi.hoisted(() => ({ allowed: true, calls: [] as GuardCall[] }))
const exporter = vi.hoisted(() => ({
  options: [] as Array<{ data: unknown[]; columns: unknown[]; filename: string; sheetName?: string; title?: string }>,
  handleExport: vi.fn(),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, requireAny, children }: GuardCall & { children: ReactNode }) => {
    guard.calls.push({ required, requireAny })
    return guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/ui/components/confirm', () => ({ confirm: feedback.confirm }))

vi.mock('@/shared/services/notification', () => ({ notify: feedback.notify }))

vi.mock('@/shared/hooks/useTableExport', () => ({
  useTableExport: (options: (typeof exporter.options)[number]) => {
    exporter.options.push(options)
    return { exporting: false, handleExport: exporter.handleExport }
  },
}))

// A failed query names what it looked for without printing the whole page, which can exhaust the worker.
configure({ getElementError: (message) => new Error(message ?? 'Element not found') })

type Vars = Record<string, unknown>

interface ServerState {
  currencies: Currency[]
  queries: number
  failNextQuery: boolean
  sent: Array<{ op: string; variables: Vars }>
  createReply: 'ok' | 'refuse' | 'throw'
  updateReply: 'ok' | 'refuse'
}

let server: ServerState

function currency(code: string, name: string, symbol: string, decimals: number, isActive: boolean, exchangeRate: number | null): Currency {
  return { code, name, symbol, decimals, isActive, exchangeRate: exchangeRate ?? undefined }
}

function initialCurrencies(): Currency[] {
  return [
    currency('USD', 'US Dollar', '$', 2, true, 1),
    currency('INR', 'Indian Rupee', '₹', 2, true, 83.12),
    currency('EUR', 'Euro', '€', 2, true, 0.92),
    currency('GBP', 'Pound Sterling', '£', 2, true, 0.79),
    currency('JPY', 'Japanese Yen', '¥', 0, false, 149.5),
    currency('AED', 'UAE Dirham', 'د.إ', 2, true, 3.6725),
    currency('SGD', 'Singapore Dollar', 'S$', 2, true, 1.34),
    currency('AUD', 'Australian Dollar', 'A$', 2, true, 1.52),
    currency('CAD', 'Canadian Dollar', 'C$', 2, true, 1.36),
    currency('CHF', 'Swiss Franc', 'Fr', 2, true, 0.88),
    currency('CNY', 'Chinese Yuan', '¥', 2, false, 7.24),
    currency('BTC', 'Bitcoin', '₿', 8, false, null),
  ]
}

function payload(c: Currency) {
  return {
    __typename: 'Currency',
    code: c.code,
    name: c.name,
    symbol: c.symbol,
    decimals: c.decimals,
    isActive: c.isActive,
    exchangeRate: c.exchangeRate ?? null,
  }
}

function listMock(): MockedResponse {
  return {
    request: { query: ALL_CURRENCIES },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => {
      server.queries += 1
      if (server.failNextQuery) {
        server.failNextQuery = false
        return { errors: [new GraphQLError('Currency service unavailable')] }
      }
      return { data: { currencies: server.currencies.map(payload) } }
    },
  }
}

function record(op: string, variables: Vars) {
  server.sent.push({ op, variables })
}

function result(fields: Record<string, unknown>) {
  return { __typename: 'CurrencyOperationResult', ...fields }
}

function createMock(): MockedResponse {
  return {
    request: { query: CREATE_CURRENCY },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Vars) => {
      record('create', variables)
      if (server.createReply === 'throw') return { errors: [new GraphQLError('Create exploded')] }
      if (server.createReply === 'refuse') {
        return { data: { createCurrency: result({ success: false, message: 'Currency GBP already exists', currency: null }) } }
      }
      const input = variables.input as Currency
      server.currencies = [...server.currencies, { ...input, isActive: true }]
      return { data: { createCurrency: result({ success: true, message: 'Created', currency: null }) } }
    },
  }
}

function updateMock(): MockedResponse {
  return {
    request: { query: UPDATE_CURRENCY },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Vars) => {
      record('update', variables)
      if (server.updateReply === 'refuse') {
        return { data: { updateCurrency: result({ success: false, message: 'Update refused', currency: null }) } }
      }
      const input = variables.input as Currency
      server.currencies = server.currencies.map((c) => (c.code === input.code ? { ...c, ...input } : c))
      return { data: { updateCurrency: result({ success: true, message: 'Updated', currency: null }) } }
    },
  }
}

function codeMutationMock(op: string, query: typeof DELETE_CURRENCY, field: string, apply: (code: string) => void, withCurrency: boolean): MockedResponse {
  return {
    request: { query },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Vars) => {
      record(op, variables)
      const code = variables.code as string
      apply(code)
      const changed = server.currencies.find((c) => c.code === code)
      return {
        data: {
          [field]: result({
            success: true,
            message: `${op} ${code}`,
            ...(withCurrency ? { currency: changed ? { __typename: 'Currency', code, isActive: changed.isActive } : null } : {}),
          }),
        },
      }
    },
  }
}

function mocks(): MockedResponse[] {
  return [
    listMock(),
    createMock(),
    updateMock(),
    codeMutationMock('delete', DELETE_CURRENCY, 'deleteCurrency', (code) => {
      server.currencies = server.currencies.filter((c) => c.code !== code)
    }, false),
    codeMutationMock('activate', ACTIVATE_CURRENCY, 'activateCurrency', (code) => {
      server.currencies = server.currencies.map((c) => (c.code === code ? { ...c, isActive: true } : c))
    }, true),
    codeMutationMock('deactivate', DEACTIVATE_CURRENCY, 'deactivateCurrency', (code) => {
      server.currencies = server.currencies.map((c) => (c.code === code ? { ...c, isActive: false } : c))
    }, true),
  ]
}

function renderPage() {
  return render(
    <MockedProvider mocks={mocks()}>
      <MemoryRouter initialEntries={['/currency']}>
        <PageEyebrowProvider value="System">
          <CurrencyManagementPage />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

async function renderLoaded() {
  const view = renderPage()
  await screen.findByText('US Dollar')
  return view
}

function table() {
  return screen.getByRole('table', { name: 'Currencies' })
}

function bodyRows(): HTMLElement[] {
  return within(table()).getAllByRole('row').slice(1)
}

function rowOf(name: string): HTMLElement {
  const row = within(table()).getByText(name).closest('tr')
  assert.ok(row, `a row for ${name}`)
  return row as HTMLElement
}

function confirmOptions(index = 0): ConfirmOptions {
  return feedback.confirm.mock.calls[index]?.[0] as ConfirmOptions
}

function sentOf(op: string) {
  return server.sent.filter((entry) => entry.op === op).map((entry) => entry.variables)
}

function textbox(name: string, scope: HTMLElement = document.body): HTMLInputElement {
  return within(scope).getByRole('textbox', { name }) as HTMLInputElement
}

function type(scope: HTMLElement, name: string, value: string) {
  const input = textbox(name, scope)
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

beforeEach(() => {
  server = {
    currencies: initialCurrencies(),
    queries: 0,
    failNextQuery: false,
    sent: [],
    createReply: 'ok',
    updateReply: 'ok',
  }
  guard.allowed = true
  guard.calls.length = 0
  useAuthStore.setState({ permissions: [{ domain: 'all', actions: ['*'] }] })
  exporter.options.length = 0
  exporter.handleExport.mockReset()
  feedback.confirm.mockReset()
  feedback.confirm.mockResolvedValue(false)
  feedback.closeLoading.mockReset()
  for (const spy of Object.values(feedback.notify)) spy.mockReset()
  feedback.notify.loading.mockImplementation(() => feedback.closeLoading)
  try {
    window.localStorage.clear()
  } catch {
    // storage blocked: the page reads nothing stored
  }
})

afterEach(() => {
  try {
    window.localStorage.clear()
  } catch {
    // nothing to clear
  }
})

describe('CurrencyManagementPage', () => {
  test('shows the header, the guard, the statistics and the first page of currencies', async () => {
    renderPage()

    assert.equal(screen.getByRole('group', { name: 'Currency statistics' }).getAttribute('aria-busy'), 'true')
    assert.ok(screen.getByText('Loading Currencies'))
    await screen.findByText('US Dollar')

    assert.deepEqual(guard.calls.at(-1), {
      required: [{ domain: 'currency.list', actions: ['view'] }],
      requireAny: undefined,
    })
    assert.equal(server.queries, 1)
    assert.ok(screen.queryByText('System') === null)
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Currency Management' }))
    assert.ok(screen.queryByText('Manage currencies, exchange rates, and conversions') === null)
    assert.equal(screen.queryByRole('button', { name: 'Bulk Actions' }), null, 'a button with no action behind it is gone')
    assert.ok(screen.getByRole('button', { name: 'Add Currency' }))
    assert.match(print(ALL_CURRENCIES), /currencies\(includeInactive: true\)/, 'inactive currencies are listed too')

    const stats = screen.getByRole('group', { name: 'Currency statistics' })
    assert.equal(stats.getAttribute('aria-busy'), null)
    for (const text of [
      'Total Currencies', '12', '9 active, 3 inactive',
      'Exchange Rates', '11', '1 missing',
      'Active Currencies', '9 with rates',
      'Active Rate', '75%', '9 of 12',
    ]) {
      assert.ok(within(stats).getAllByText(text).length > 0, text)
    }

    // No view switch on the currencies view, as before.
    assert.ok(screen.queryByRole('tablist') === null, 'expected no view switch')
    assert.ok(screen.queryByRole('tabpanel') === null, 'expected no tab panel')

    assert.ok(screen.getByRole('heading', { level: 2, name: 'Currencies List' }))
    assert.ok(screen.getByText('10 currencies'))
    assert.equal(bodyRows().length, 10)
    const usd = rowOf('US Dollar')
    for (const text of ['USD', '$', '2', '1.000000', 'Active']) {
      assert.ok(within(usd).getAllByText(text).length > 0, text)
    }
    const jpy = rowOf('Japanese Yen')
    for (const text of ['JPY', '0', '149.500000', 'Inactive']) {
      assert.ok(within(jpy).getAllByText(text).length > 0, text)
    }
    const pager = screen.getByRole('navigation', { name: 'Pagination' })
    assert.match(pager.textContent ?? '', /Showing 1–10 of 12 currencies/)
  })

  test('a denied caller sees the denial and starts no query', async () => {
    guard.allowed = false
    renderPage()
    assert.ok(screen.getByRole('alert'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(server.queries, 0)
    assert.ok(screen.queryByRole('heading', { level: 1 }) === null, 'expected nothing')
  })

  test('search and status filter the rows on the client; a page past the end shows the last page; Clear all resets', async () => {
    await renderLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    await waitFor(() => assert.equal(bodyRows().length, 2))
    assert.ok(within(table()).getByText('Chinese Yuan'))

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search currencies' }), { target: { value: 'eu' } })
    await waitFor(() => assert.equal(bodyRows().length, 1))
    assert.ok(within(table()).getByText('Euro'))
    assert.match(screen.getByRole('navigation', { name: 'Pagination' }).textContent ?? '', /Showing 1 of 1 currency/)
    assert.ok(screen.getByText('1 currency'))

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search currencies' }), { target: { value: '¥' } })
    await waitFor(() => assert.equal(bodyRows().length, 2))
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'active' } })
    await screen.findByText('No currencies found')
    assert.ok(screen.queryByRole('navigation', { name: 'Pagination' }) === null, 'expected nothing')

    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'inactive' } })
    await waitFor(() => assert.equal(bodyRows().length, 2))

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => assert.equal(bodyRows().length, 10))
    assert.equal((screen.getByRole('searchbox', { name: 'Search currencies' }) as HTMLInputElement).value, '')
    assert.equal((screen.getByRole('combobox', { name: 'Status' }) as HTMLSelectElement).value, '')
    assert.equal(screen.getByRole('button', { name: 'Page 1' }).getAttribute('aria-current'), 'page')
    // Filtering never queries again.
    assert.equal(server.queries, 1)
  })

  test('the page size shows more rows from page one', async () => {
    await renderLoaded()
    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page:' }), { target: { value: '25' } })
    await waitFor(() => assert.equal(bodyRows().length, 12))
    assert.ok(screen.getByText('12 currencies'))
  })

  test('shows the load error with Retry, which loads the page', async () => {
    server.failNextQuery = true
    renderPage()

    await screen.findByText('Error Loading Currencies')
    assert.ok(screen.getByText('Currency service unavailable'))
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Currency Management' }))
    assert.ok(screen.queryByRole('table') === null, 'expected nothing')

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('US Dollar')
    assert.equal(server.queries, 2)
  })

  test('Add Currency opens the create dialog, refuses an empty form, and creates with the exact input', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Add Currency' }))

    const dialog = await screen.findByRole('dialog', { name: 'Create New Currency' })
    await waitFor(() => assert.ok(document.activeElement === textbox('Currency Code', dialog), 'the code has focus'))
    assert.ok(within(dialog).queryByRole('switch') === null, 'expected nothing')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Currency' }))
    await within(dialog).findByText('Please enter currency code')
    assert.equal(sentOf('create').length, 0)

    type(dialog, 'Currency Code', 'nzd')
    type(dialog, 'Currency Name', 'New Zealand Dollar')
    type(dialog, 'Currency Symbol', 'NZ$')
    type(dialog, 'Exchange Rate (vs USD)', '1.65')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Currency' }))

    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null, 'expected nothing'))
    assert.deepEqual(sentOf('create'), [{
      input: { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', decimals: 2, exchangeRate: 1.65 },
    }])
    assert.deepEqual(feedback.notify.loading.mock.calls[0], ['Creating currency...'])
    await waitFor(() => assert.equal(feedback.closeLoading.mock.calls.length, 1))
    // The server's own message is the one toast (the Apollo notification link); the page adds none.
    assert.equal(feedback.notify.success.mock.calls.length, 0)
    assert.ok(server.queries >= 2, 'the list refetched')
    await waitFor(() => assert.match(
      screen.getByRole('navigation', { name: 'Pagination' }).textContent ?? '',
      /of 13 currencies/,
    ))
  })

  test('a refused create keeps the dialog open and leaves the message to the server; a failed one says so', async () => {
    await renderLoaded()
    server.createReply = 'refuse'
    fireEvent.click(screen.getByRole('button', { name: 'Add Currency' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create New Currency' })
    type(dialog, 'Currency Code', 'gbp')
    type(dialog, 'Currency Name', 'Pound')
    type(dialog, 'Currency Symbol', '£')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Currency' }))
    await waitFor(() => assert.equal(feedback.closeLoading.mock.calls.length, 1))
    assert.equal(sentOf('create').length, 1)
    assert.ok(screen.getByRole('dialog', { name: 'Create New Currency' }))
    // "Currency GBP already exists" is toasted once, by the notification link; the page used to repeat it.
    assert.equal(feedback.notify.error.mock.calls.length, 0)
    assert.equal(feedback.notify.success.mock.calls.length, 0)

    server.createReply = 'throw'
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Currency' }))
    await waitFor(() => assert.deepEqual(feedback.notify.error.mock.calls.at(-1), ['Failed to create currency']))
    assert.ok(screen.getByRole('dialog', { name: 'Create New Currency' }))
    assert.equal(feedback.closeLoading.mock.calls.length, 2)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null, 'expected nothing'))
  })

  test('Edit opens the record, saves the exact update, then closes the dialog', async () => {
    await renderLoaded()
    fireEvent.click(within(rowOf('Euro')).getByRole('button', { name: 'Edit EUR' }))

    const dialog = await screen.findByRole('dialog', { name: 'Edit Currency' })
    await waitFor(() => assert.ok(document.activeElement === textbox('Currency Name', dialog), 'the name has focus'))
    assert.equal(textbox('Currency Code', dialog).value, 'EUR')
    assert.equal(textbox('Currency Code', dialog).disabled, true)
    assert.equal(textbox('Exchange Rate (vs USD)', dialog).value, '0.920000')
    const active = within(dialog).getByRole('switch', { name: 'Active Status' })
    assert.equal(active.getAttribute('aria-checked'), 'true')

    type(dialog, 'Currency Name', 'Euro (EU)')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update Currency' }))

    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null, 'expected nothing'))
    assert.deepEqual(sentOf('update'), [{
      input: { code: 'EUR', name: 'Euro (EU)', symbol: '€', decimals: 2, exchangeRate: 0.92, isActive: true },
    }])
    assert.deepEqual(feedback.notify.loading.mock.calls[0], ['Updating currency...'])
    await screen.findByText('Euro (EU)')
    assert.equal(feedback.notify.success.mock.calls.length, 0, 'the server message is the one toast')
  })

  test('a refused update keeps the edit dialog open and leaves the message to the server', async () => {
    await renderLoaded()
    server.updateReply = 'refuse'
    fireEvent.click(within(rowOf('Japanese Yen')).getByRole('button', { name: 'Edit JPY' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Currency' })
    assert.equal(textbox('Decimal Places', dialog).value, '0')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Update Currency' }))
    await waitFor(() => assert.equal(feedback.closeLoading.mock.calls.length, 1))
    assert.equal(feedback.notify.error.mock.calls.length, 0, '"Update refused" is toasted once, by the notification link')
    assert.deepEqual(sentOf('update')[0], {
      input: { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0, exchangeRate: 149.5, isActive: false },
    })
    assert.ok(screen.getByRole('dialog', { name: 'Edit Currency' }))
  })

  test('Deactivate and Delete confirm with the legacy copy; Activate runs at once; an active currency cannot be deleted', async () => {
    await renderLoaded()

    fireEvent.click(within(rowOf('Euro')).getByRole('button', { name: 'Deactivate EUR' }))
    assert.equal(feedback.confirm.mock.calls.length, 1)
    const deactivate = confirmOptions(0)
    assert.equal(deactivate.title, 'Deactivate currency?')
    assert.equal(deactivate.confirmLabel, 'Deactivate')
    assert.equal(deactivate.cancelLabel, 'Cancel')
    assert.equal(deactivate.tone, undefined)
    await act(async () => {
      await deactivate.onConfirm?.()
    })
    assert.deepEqual(sentOf('deactivate'), [{ code: 'EUR' }])

    const deleteActive = within(rowOf('US Dollar')).getByRole('button', { name: 'Delete USD' })
    assert.equal(deleteActive.getAttribute('aria-disabled'), 'true')
    fireEvent.click(deleteActive)
    assert.equal(feedback.confirm.mock.calls.length, 1)

    // The refetch shows Euro inactive, so it can be deleted now.
    await waitFor(() => assert.ok(within(rowOf('Euro')).getByText('Inactive')))
    const deleteEuro = within(rowOf('Euro')).getByRole('button', { name: 'Delete EUR' })
    assert.equal(deleteEuro.getAttribute('aria-disabled'), null)
    fireEvent.click(deleteEuro)
    assert.equal(feedback.confirm.mock.calls.length, 2)
    const remove = confirmOptions(1)
    assert.equal(remove.title, 'Delete currency?')
    assert.equal(remove.confirmLabel, 'Delete')
    assert.equal(remove.cancelLabel, 'Cancel')
    assert.equal(remove.tone, 'danger')
    await act(async () => {
      await remove.onConfirm?.()
    })
    assert.deepEqual(sentOf('delete'), [{ code: 'EUR' }])
    await waitFor(() => assert.ok(within(table()).queryByText('Euro') === null, 'expected nothing'))

    fireEvent.click(within(rowOf('Japanese Yen')).getByRole('button', { name: 'Activate JPY' }))
    await waitFor(() => assert.deepEqual(sentOf('activate'), [{ code: 'JPY' }]))
    assert.equal(feedback.confirm.mock.calls.length, 2)
    await waitFor(() => assert.ok(within(rowOf('Japanese Yen')).getByRole('button', { name: 'Deactivate JPY' })))
  })

  test('Export Excel exports the rows on the page with the legacy columns and title', async () => {
    await renderLoaded()
    const options = exporter.options.at(-1)
    assert.ok(options)
    assert.equal(options.data.length, 10)
    assert.equal(options.filename, 'Currencies')
    assert.equal(options.sheetName, 'Currencies')
    assert.equal(options.title, 'Currencies — 10 currency(ies)')
    assert.equal(options.columns.length, 6)

    const exportButton = screen.getByRole('button', { name: 'Export Excel' })
    fireEvent.click(exportButton)
    assert.equal(exporter.handleExport.mock.calls.length, 1)

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search currencies' }), { target: { value: 'nothing' } })
    await screen.findByText('No currencies found')
    assert.equal(screen.getByRole('button', { name: 'Export Excel' }).hasAttribute('disabled'), true)
  })

  test('the converter and settings views stay unreachable, as before; the stored default is left alone', async () => {
    window.localStorage.setItem('defaultCurrency', 'USD')
    await renderLoaded()

    const unreachable = () => {
      assert.ok(screen.queryByRole('tablist') === null, 'expected no view switch')
      for (const name of ['Currencies', 'Currency Converter', 'Settings']) {
        assert.ok(screen.queryByRole('tab', { name }) === null, `expected no ${name} tab`)
      }
      assert.ok(screen.queryByRole('heading', { name: 'Currency Converter' }) === null, 'expected no converter')
      assert.ok(screen.queryByRole('heading', { name: 'Currency Settings' }) === null, 'expected no settings')
      assert.ok(screen.queryByRole('combobox', { name: 'From' }) === null, 'expected no converter field')
      assert.ok(
        screen.queryByRole('combobox', { name: 'Default Display Currency' }) === null,
        'expected no default currency select',
      )
    }
    unreachable()

    // The page's own interactions open neither view.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search currencies' }), { target: { value: 'eu' } })
    await waitFor(() => assert.equal(bodyRows().length, 1))
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => assert.equal(bodyRows().length, 10))
    fireEvent.click(screen.getByRole('button', { name: 'Add Currency' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create New Currency' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null, 'expected nothing'))
    unreachable()
    assert.ok(table())

    // No other operation ran, and nothing was written to the key CurrencyContext reads.
    assert.equal(server.queries, 1)
    assert.equal(server.sent.length, 0)
    assert.equal(window.localStorage.getItem('defaultCurrency'), 'USD')
    assert.equal(feedback.notify.success.mock.calls.length, 0)
  })

  test('an admin who may only read currencies is offered no change', async () => {
    useAuthStore.setState({ permissions: [{ domain: 'currency', actions: ['read'] }] })
    await renderLoaded()

    assert.equal(screen.queryByRole('button', { name: 'Add Currency' }), null)
    for (const code of ['USD', 'JPY']) {
      for (const action of ['Edit', 'Deactivate', 'Activate', 'Delete']) {
        assert.equal(screen.queryByRole('button', { name: `${action} ${code}` }), null, `${action} ${code}`)
      }
    }
    assert.ok(within(rowOf('Japanese Yen')).getByText('Inactive'), 'inactive currencies are still listed')
    assert.ok(screen.getByRole('button', { name: 'Export Excel' }), 'reading and exporting stay available')
  })

  test('each kind of change needs its own permission', async () => {
    useAuthStore.setState({ permissions: [{ domain: 'currency.list', actions: ['view', 'update'] }] })
    await renderLoaded()

    assert.equal(screen.queryByRole('button', { name: 'Add Currency' }), null)
    assert.ok(within(rowOf('Euro')).getByRole('button', { name: 'Edit EUR' }))
    assert.ok(within(rowOf('Euro')).getByRole('button', { name: 'Deactivate EUR' }))
    assert.ok(within(rowOf('Japanese Yen')).getByRole('button', { name: 'Activate JPY' }))
    assert.equal(within(rowOf('Japanese Yen')).queryByRole('button', { name: 'Delete JPY' }), null)
  })
})
