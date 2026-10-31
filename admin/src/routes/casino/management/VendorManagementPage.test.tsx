/**
 * /casino/vendors against a mocked GraphQL server (MockedProvider): the exact documents and variables of
 * the two queries and two mutations, the guard and the whitelabel branch, the local search, the server
 * filters, client paging, row and select-all selection, the status switch and row toggle, the bulk
 * confirmation, every toast, and the loading, empty and error states. The mocked server applies each
 * mutation, so a refetch shows what the backend would return.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import {
  BULK_UPDATE_VENDOR_SETTINGS,
  CASINO_API_PROVIDERS,
  CASINO_VENDORS_WITH_SETTINGS,
  TOGGLE_CASINO_VENDOR_ENABLED,
} from '@/lib/graphql/casino'
import VendorManagementPage from './VendorManagementPage'
import type { VendorWithSettings } from './vendorManagementModel'

interface ConfirmOptions {
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: string
  onConfirm?: () => void | Promise<void>
}

type Variables = Record<string, unknown>

const feedback = vi.hoisted(() => ({ confirm: vi.fn(), toast: vi.fn() }))
const auth = vi.hoisted(() => ({ roles: ['SUPER_ADMIN'] as string[] }))
const rbacCalls = vi.hoisted(() => [] as Array<{ required: Array<{ domain: string; actions: string[] }> }>)
const rbacState = vi.hoisted(() => ({ allowed: true }))

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: { roles: string[] }) => unknown) => selector({ roles: auth.roles }),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({
    required,
    children,
  }: {
    required: Array<{ domain: string; actions: string[] }>
    children: ReactNode
  }) => {
    rbacCalls.push({ required })
    return rbacState.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/ui/components/confirm', () => ({ confirm: feedback.confirm }))
vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))

interface ServerState {
  vendors: VendorWithSettings[]
  vendorRequests: Variables[]
  providerRequests: number
  toggles: Variables[]
  bulks: Variables[]
  toggleReply: 'ok' | 'refused' | 'error'
  bulkReply: 'ok' | 'error'
}

let server: ServerState

function vendor(
  id: string,
  name: string,
  slug: string,
  enabled: boolean | null,
  gamesCount: number,
  enabledGamesCount: number,
): VendorWithSettings {
  return { id, name, slug, enabled, gamesCount, enabledGamesCount, displayOrder: null }
}

function initialVendors(): VendorWithSettings[] {
  return [
    vendor('v1', 'Evolution', 'evolution', true, 128, 120),
    vendor('v2', 'Ezugi', 'ezugi', null, 94, 90),
    vendor('v3', 'Pragmatic Play', 'pragmatic-play', false, 216, 0),
    vendor('v4', 'Spribe', 'spribe', true, 12, 12),
  ]
}

function manyVendors(count: number): VendorWithSettings[] {
  return Array.from({ length: count }, (_, index) => {
    const n = String(index + 1).padStart(2, '0')
    return vendor(`m${n}`, `Vendor ${n}`, `vendor-${n}`, index % 3 !== 0, 10 + index, index % 4)
  })
}

/** Keys left undefined are not sent on the wire, so the assertions compare what the server receives. */
function sent(variables: Variables | undefined): Variables {
  return JSON.parse(JSON.stringify(variables ?? {})) as Variables
}

/** The category and provider filters run on the server; the mock answers them from small fixed sets. */
function vendorsFor(variables: Variables): VendorWithSettings[] {
  if (variables.category === 'SLOTS') return server.vendors.filter((v) => v.id === 'v4')
  if (variables.providerId === 'p2') return server.vendors.filter((v) => v.id === 'v1' || v.id === 'v2')
  return server.vendors
}

function vendorsPayload(list: VendorWithSettings[]) {
  return {
    casinoVendorsWithSettings: list.map((v) => ({ __typename: 'CasinoVendorWithSettings', ...v })),
  }
}

function vendorsMock(): MockedResponse {
  return {
    request: { query: CASINO_VENDORS_WITH_SETTINGS },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Variables) => {
      const body = sent(variables)
      server.vendorRequests.push(body)
      return { data: vendorsPayload(vendorsFor(body)) }
    },
  }
}

/** Answers one vendor request with a network error. It records nothing: only answered requests count. */
function vendorsErrorMock(message: string): MockedResponse {
  return {
    request: { query: CASINO_VENDORS_WITH_SETTINGS },
    variableMatcher: () => true,
    error: new Error(message),
  }
}

function providersMock(): MockedResponse {
  return {
    request: { query: CASINO_API_PROVIDERS },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => {
      server.providerRequests += 1
      return {
        data: {
          casinoApiProviders: [
            { __typename: 'CasinoApiProvider', id: 'p1', key: 'qtech', name: 'QTech', status: 'ACTIVE', lastSyncAt: null },
            { __typename: 'CasinoApiProvider', id: 'p2', key: 'evo', name: 'Evolution Direct', status: 'ACTIVE', lastSyncAt: null },
          ],
        },
      }
    },
  }
}

function toggleMock(): MockedResponse {
  return {
    request: { query: TOGGLE_CASINO_VENDOR_ENABLED },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Variables) => {
      server.toggles.push(sent(variables))
      if (server.toggleReply === 'error') return { errors: [{ message: 'Vendor not found' }] }
      if (server.toggleReply === 'refused') {
        return {
          data: {
            toggleCasinoVendorEnabled: { __typename: 'MutationResponse', success: false, message: 'Vendor is locked' },
          },
        }
      }
      server.vendors = server.vendors.map((v) =>
        v.id === variables.vendorId ? { ...v, enabled: variables.enabled as boolean } : v,
      )
      return {
        data: {
          toggleCasinoVendorEnabled: {
            __typename: 'MutationResponse',
            success: true,
            message: `Vendor ${variables.enabled ? 'enabled' : 'disabled'} successfully`,
          },
        },
      }
    },
  }
}

function bulkMock(): MockedResponse {
  return {
    request: { query: BULK_UPDATE_VENDOR_SETTINGS },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Variables) => {
      server.bulks.push(sent(variables))
      if (server.bulkReply === 'error') return { errors: [{ message: 'Bulk update failed' }] }
      const ids = variables.vendorIds as string[]
      server.vendors = server.vendors.map((v) =>
        ids.includes(v.id) ? { ...v, enabled: variables.enabled as boolean } : v,
      )
      return {
        data: {
          bulkUpdateVendorSettings: {
            __typename: 'MutationResponse',
            success: true,
            message: `${ids.length} vendors updated`,
          },
        },
      }
    },
  }
}

function defaultMocks(): MockedResponse[] {
  return [providersMock(), vendorsMock(), toggleMock(), bulkMock()]
}

function renderPage(mocks: MockedResponse[] = defaultMocks()) {
  return render(
    <MockedProvider mocks={mocks}>
      <MemoryRouter initialEntries={['/casino/vendors']}>
        <PageEyebrowProvider value="Trading">
          <VendorManagementPage />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

async function renderLoaded(mocks?: MockedResponse[]) {
  const view = renderPage(mocks)
  await screen.findByRole('table', { name: 'Vendors' })
  await waitFor(() => assert.ok(screen.queryByText('Loading Vendors') === null))
  return view
}

function table(): HTMLElement {
  return screen.getByRole('table', { name: 'Vendors' })
}

/** Body rows: every row but the header. */
function bodyRows(): HTMLElement[] {
  return within(table()).getAllByRole('row').slice(1)
}

function rowOf(name: string): HTMLElement {
  const row = within(table()).getByText(name).closest('tr')
  assert.ok(row, `Expected a row for ${name}`)
  return row as HTMLElement
}

function cellTexts(row: HTMLElement): string[] {
  return within(row).getAllByRole('cell').map((cell) => (cell.textContent ?? '').trim())
}

function paginationSummary(): string {
  const nav = screen.getByRole('navigation', { name: 'Pagination' })
  return (nav.querySelector('p')?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function lastToast(): unknown {
  return feedback.toast.mock.calls.at(-1)?.[0]
}

function confirmCopy(index = 0) {
  const options = feedback.confirm.mock.calls[index]?.[0] as ConfirmOptions
  return {
    title: options.title,
    description: options.description,
    confirmLabel: options.confirmLabel,
    cancelLabel: options.cancelLabel,
    tone: options.tone,
  }
}

beforeEach(() => {
  server = {
    vendors: initialVendors(),
    vendorRequests: [],
    providerRequests: 0,
    toggles: [],
    bulks: [],
    toggleReply: 'ok',
    bulkReply: 'ok',
  }
  auth.roles = ['SUPER_ADMIN']
  rbacCalls.length = 0
  rbacState.allowed = true
  feedback.confirm.mockReset()
  feedback.confirm.mockResolvedValue(false)
  feedback.toast.mockReset()
})

describe('VendorManagementPage contracts', () => {
  test('loads under the guard, then shows the header, stats, filters, rows and pager', async () => {
    renderPage()

    assert.ok(screen.getByText('Loading Vendors').closest('[role="status"]'))
    assert.equal(screen.queryByRole('navigation', { name: 'Pagination' }), null)
    await screen.findByText('Pragmatic Play')

    assert.deepStrictEqual(rbacCalls.at(-1), { required: [{ domain: 'casino.vendors', actions: ['view'] }] })
    assert.ok(screen.queryByText('Trading') === null)
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Casino Vendor Management' }))
    assert.ok(screen.queryByText('Manage vendors and their game configurations') === null)
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Casino Vendor Management' }))
    assert.ok(screen.getByText('4 vendors'))
    assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1)

    // both queries, once each; the vendor query with no filter sends no variables
    assert.equal(server.providerRequests, 1)
    assert.deepStrictEqual(server.vendorRequests, [{}])

    const stats = screen.getByRole('group', { name: 'Vendor statistics' })
    for (const text of ['Total Vendors', '4', 'Enabled', '3', 'Disabled', '1']) {
      assert.ok(within(stats).getByText(text), text)
    }

    const headers = within(table()).getAllByRole('columnheader').map((th) => (th.textContent ?? '').trim())
    // the first header carries the select-all box (its label is visually hidden) beside "Vendor Details"
    assert.equal(headers[0], 'Select all vendorsVendor Details')
    assert.deepStrictEqual(headers.slice(1), ['Slug', 'Total Games', 'Enabled Games', 'Status', 'Actions'])
    assert.equal(bodyRows().length, 4)
    assert.deepStrictEqual(cellTexts(rowOf('Evolution')).slice(0, 4), [
      'Select EvolutionEvolutionEnabled', 'evolution', '128', '120',
    ])
    // a null flag reads as enabled; false as disabled, with a zero enabled-games figure
    assert.deepStrictEqual(cellTexts(rowOf('Ezugi')).slice(0, 4), ['Select EzugiEzugiEnabled', 'ezugi', '94', '90'])
    assert.deepStrictEqual(cellTexts(rowOf('Pragmatic Play')).slice(0, 4), [
      'Select Pragmatic PlayPragmatic PlayDisabled', 'pragmatic-play', '216', '0',
    ])

    assert.equal(screen.getByRole('switch', { name: 'Ezugi enabled' }).getAttribute('aria-checked'), 'true')
    assert.equal(screen.getByRole('switch', { name: 'Pragmatic Play enabled' }).getAttribute('aria-checked'), 'false')
    assert.ok(screen.getByRole('button', { name: 'Disable Evolution' }))
    assert.ok(screen.getByRole('button', { name: 'Enable Pragmatic Play' }))

    assert.ok(screen.getByRole('searchbox', { name: 'Search vendors' }))
    assert.ok(screen.getByRole('combobox', { name: 'Filter by Provider' }))
    const category = screen.getByRole('combobox', { name: 'Filter by Category' }) as HTMLSelectElement
    assert.deepStrictEqual([...category.options].map((o) => o.text), ['Filter by Category', 'Live Casino', 'Casino', 'Slots'])
    const provider = screen.getByRole('combobox', { name: 'Filter by Provider' }) as HTMLSelectElement
    await waitFor(() => assert.equal(provider.options.length, 3))
    assert.deepStrictEqual([...provider.options].map((o) => o.text), ['Filter by Provider', 'QTech', 'Evolution Direct'])

    assert.equal(paginationSummary(), 'Showing 1–4 of 4 vendors')
    assert.equal((screen.getByLabelText('Rows per page:') as HTMLSelectElement).value, '20')
    assert.equal(screen.queryByRole('group', { name: 'Bulk actions' }), null)
  })

  test('a denied caller starts no query', async () => {
    rbacState.allowed = false
    renderPage()

    assert.ok(screen.getByRole('alert'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(server.providerRequests, 0)
    assert.deepStrictEqual(server.vendorRequests, [])
    assert.equal(screen.queryByRole('heading', { level: 1 }), null)
  })

  test('a whitelabel admin gets no provider query and no provider filter', async () => {
    auth.roles = ['whitelabel_admin']
    await renderLoaded()

    assert.equal(server.providerRequests, 0)
    assert.deepStrictEqual(server.vendorRequests, [{}])
    assert.equal(screen.queryByRole('combobox', { name: 'Filter by Provider' }), null)

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by Category' }), { target: { value: 'SLOTS' } })
    await waitFor(() => assert.deepStrictEqual(server.vendorRequests.at(-1), { category: 'SLOTS' }))
    await waitFor(() => assert.equal(bodyRows().length, 1))
  })

  test('provider and category filter on the server; search filters locally; Clear all resets them', async () => {
    await renderLoaded()

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by Provider' }), { target: { value: 'p2' } })
    await waitFor(() => assert.deepStrictEqual(server.vendorRequests.at(-1), { providerId: 'p2' }))
    await waitFor(() => assert.equal(bodyRows().length, 2))
    assert.ok(screen.getByText('2 vendors'))

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by Category' }), { target: { value: 'SLOTS' } })
    await waitFor(() => assert.deepStrictEqual(server.vendorRequests.at(-1), { providerId: 'p2', category: 'SLOTS' }))
    assert.ok(screen.getByText('2 filters applied'))

    // the provider placeholder option clears that filter alone
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by Provider' }), { target: { value: '' } })
    await waitFor(() => assert.deepStrictEqual(server.vendorRequests.at(-1), { category: 'SLOTS' }))
    await waitFor(() => assert.equal(bodyRows().length, 1))

    const requests = server.vendorRequests.length
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => assert.equal(bodyRows().length, 4))
    // the unfiltered result is already cached: clearing asks the server nothing new
    assert.equal(server.vendorRequests.length, requests)
    assert.equal((screen.getByRole('combobox', { name: 'Filter by Category' }) as HTMLSelectElement).value, '')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search vendors' }), { target: { value: 'EVO' } })
    assert.deepStrictEqual(bodyRows().map((row) => within(row).getAllByRole('cell')[1]?.textContent), ['evolution'])
    assert.ok(screen.getByText('1 vendor'))
    assert.equal(paginationSummary(), 'Showing 1 of 1 vendor')
    // the stats still count every vendor the query returned
    assert.ok(within(screen.getByRole('group', { name: 'Vendor statistics' })).getByText('4'))
    assert.equal(server.vendorRequests.length, requests)

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search vendors' }), { target: { value: 'nothing' } })
    assert.ok(screen.getByText('No vendors found'))
    assert.equal(screen.queryByRole('navigation', { name: 'Pagination' }), null)
    assert.ok(screen.getByText('0 vendors'))
  })

  test('the status switch sends the next state, is inert while saving, toasts and refetches', async () => {
    await renderLoaded()
    const ezugi = screen.getByRole('switch', { name: 'Ezugi enabled' })

    fireEvent.click(ezugi)
    assert.equal(ezugi.getAttribute('aria-disabled'), 'true')
    assert.equal(ezugi.getAttribute('aria-busy'), 'true')
    assert.equal(screen.getByRole('button', { name: 'Disable Ezugi' }).getAttribute('aria-disabled'), 'true')
    fireEvent.click(ezugi)

    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.deepStrictEqual(server.toggles, [{ vendorId: 'v2', enabled: false }])
    assert.deepStrictEqual(lastToast(), {
      title: 'Success',
      message: 'Vendor disabled successfully',
      tone: 'ok',
      duration: 4500,
    })
    await waitFor(() => assert.equal(server.vendorRequests.length, 2))
    await waitFor(() =>
      assert.equal(screen.getByRole('switch', { name: 'Ezugi enabled' }).getAttribute('aria-checked'), 'false'),
    )
    assert.equal(screen.getByRole('switch', { name: 'Ezugi enabled' }).getAttribute('aria-disabled'), null)
    // Enabled and Disabled are now 2 each
    assert.equal(within(screen.getByRole('group', { name: 'Vendor statistics' })).getAllByText('2').length, 2)
  })

  test('the row toggle flips the current state', async () => {
    await renderLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Enable Pragmatic Play' }))
    await waitFor(() => assert.deepStrictEqual(server.toggles, [{ vendorId: 'v3', enabled: true }]))
    await screen.findByRole('button', { name: 'Disable Pragmatic Play' })

    fireEvent.click(screen.getByRole('button', { name: 'Disable Evolution' }))
    await waitFor(() => assert.equal(server.toggles.length, 2))
    assert.deepStrictEqual(server.toggles[1], { vendorId: 'v1', enabled: false })
  })

  test('a refused toggle shows nothing and does not refetch; a failed one raises the error toast', async () => {
    await renderLoaded()

    server.toggleReply = 'refused'
    fireEvent.click(screen.getByRole('switch', { name: 'Spribe enabled' }))
    await waitFor(() => assert.equal(server.toggles.length, 1))
    await waitFor(() =>
      assert.equal(screen.getByRole('switch', { name: 'Spribe enabled' }).getAttribute('aria-disabled'), null),
    )
    assert.equal(feedback.toast.mock.calls.length, 0)
    assert.equal(server.vendorRequests.length, 1)

    server.toggleReply = 'error'
    fireEvent.click(screen.getByRole('switch', { name: 'Spribe enabled' }))
    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.deepStrictEqual(lastToast(), { title: 'Error', message: 'Vendor not found', tone: 'error', duration: 4500 })
    assert.equal(server.vendorRequests.length, 1)
    await waitFor(() =>
      assert.equal(screen.getByRole('switch', { name: 'Spribe enabled' }).getAttribute('aria-disabled'), null),
    )
  })

  test('selected rows drive the bulk bar; the confirmed bulk update clears them, toasts and refetches', async () => {
    feedback.confirm.mockImplementation(async (options: ConfirmOptions) => {
      await options.onConfirm?.()
      return true
    })
    await renderLoaded()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Pragmatic Play' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Evolution' }))
    const bar = screen.getByRole('group', { name: 'Bulk actions' })
    assert.ok(within(bar).getByText('2 selected'))
    assert.ok(within(bar).getByRole('button', { name: 'Enable Selected (2)' }))

    fireEvent.click(within(bar).getByRole('button', { name: 'Disable Selected (2)' }))
    assert.deepStrictEqual(confirmCopy(), {
      title: 'Disable selected vendors?',
      description: undefined,
      confirmLabel: 'Yes',
      cancelLabel: 'No',
      tone: undefined,
    })
    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    // the ids go in the order they were ticked
    assert.deepStrictEqual(server.bulks, [{ vendorIds: ['v3', 'v1'], enabled: false }])
    assert.deepStrictEqual(lastToast(), { title: 'Success', message: '2 vendors updated', tone: 'ok', duration: 4500 })
    await waitFor(() => assert.equal(screen.queryByRole('group', { name: 'Bulk actions' }), null))
    assert.equal((screen.getByRole('checkbox', { name: 'Select Evolution' }) as HTMLInputElement).checked, false)
    await waitFor(() => assert.equal(server.vendorRequests.length, 2))
    await waitFor(() =>
      assert.equal(screen.getByRole('switch', { name: 'Evolution enabled' }).getAttribute('aria-checked'), 'false'),
    )

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Spribe' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enable Selected (1)' }))
    assert.equal(confirmCopy(1).title, 'Enable selected vendors?')
    await waitFor(() => assert.equal(server.bulks.length, 2))
    assert.deepStrictEqual(server.bulks[1], { vendorIds: ['v4'], enabled: true })
  })

  test('a cancelled confirmation sends nothing; a failed bulk update keeps the selection', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ezugi' }))

    fireEvent.click(screen.getByRole('button', { name: 'Enable Selected (1)' }))
    await waitFor(() => assert.equal(feedback.confirm.mock.calls.length, 1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.deepStrictEqual(server.bulks, [])

    server.bulkReply = 'error'
    feedback.confirm.mockImplementation(async (options: ConfirmOptions) => {
      await options.onConfirm?.()
      return true
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enable Selected (1)' }))
    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.deepStrictEqual(lastToast(), { title: 'Error', message: 'Bulk update failed', tone: 'error', duration: 4500 })
    assert.ok(screen.getByRole('group', { name: 'Bulk actions' }))
    assert.equal(server.vendorRequests.length, 1)
  })

  test('the header box selects every searched vendor across pages and clears the whole selection', async () => {
    server.vendors = manyVendors(45)
    await renderLoaded()
    const all = screen.getByRole('checkbox', { name: 'Select all vendors' }) as HTMLInputElement

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Vendor 02' }))
    assert.equal(all.indeterminate, true)
    assert.equal(all.checked, false)

    fireEvent.click(all)
    assert.equal(all.checked, true)
    assert.equal(all.indeterminate, false)
    assert.ok(screen.getByRole('button', { name: 'Enable Selected (45)' }))

    fireEvent.click(all)
    assert.equal(screen.queryByRole('group', { name: 'Bulk actions' }), null)

    // with a search, only the vendors it leaves are taken
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search vendors' }), { target: { value: 'vendor 1' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all vendors' }))
    assert.ok(screen.getByRole('button', { name: 'Disable Selected (10)' }))
  })

  test('client paging keeps the legacy sizes and shows the last page when a search shrinks the list', async () => {
    server.vendors = manyVendors(45)
    await renderLoaded()

    assert.equal(bodyRows().length, 20)
    assert.equal(paginationSummary(), 'Showing 1–20 of 45 vendors')
    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }))
    assert.equal(paginationSummary(), 'Showing 41–45 of 45 vendors')
    assert.ok(within(table()).getByText('Vendor 45'))

    // the legacy search did not reset the page; a page past the end now shows the last page
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search vendors' }), { target: { value: 'vendor 0' } })
    assert.equal(bodyRows().length, 9)
    assert.equal(paginationSummary(), 'Showing 1–9 of 9 vendors')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search vendors' }), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Rows per page:'), { target: { value: '10' } })
    assert.equal(paginationSummary(), 'Showing 1–10 of 45 vendors')
    assert.equal(bodyRows().length, 10)
    assert.deepStrictEqual(
      [...(screen.getByLabelText('Rows per page:') as HTMLSelectElement).options].map((o) => o.value),
      ['10', '20', '50', '100'],
    )
    assert.equal(server.vendorRequests.length, 1)
  })

  test('an empty list shows the empty state and no pager', async () => {
    server.vendors = []
    await renderLoaded()

    assert.ok(screen.getByText('No vendors found'))
    assert.ok(screen.getByText('0 vendors'))
    assert.equal(screen.queryByRole('navigation', { name: 'Pagination' }), null)
    const stats = screen.getByRole('group', { name: 'Vendor statistics' })
    assert.equal(within(stats).getAllByText('0').length, 3)
  })

  test('a failed load shows the error with Retry, which refetches', async () => {
    renderPage([providersMock(), vendorsErrorMock('Network down'), vendorsMock()])

    const alert = await screen.findByRole('alert')
    assert.ok(within(alert).getByText('Error loading vendors'))
    assert.ok(within(alert).getByText('Network down'))
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Casino Vendor Management' }))
    assert.equal(screen.queryByRole('table'), null)
    assert.equal(server.vendorRequests.length, 0)

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    await screen.findByRole('table', { name: 'Vendors' })
    await screen.findByText('Pragmatic Play')
    // the refetch is the one answered request, with the same (empty) variables
    assert.deepStrictEqual(server.vendorRequests, [{}])
    assert.ok(screen.queryByText('Error loading vendors') === null)
  })

  test('a GraphQL error with partial data still shows only the error, as the legacy page did', async () => {
    const partial: MockedResponse = {
      request: { query: CASINO_VENDORS_WITH_SETTINGS },
      variableMatcher: () => true,
      result: { data: vendorsPayload(initialVendors()), errors: [{ message: 'Some vendors could not be read' }] },
    }
    renderPage([providersMock(), partial])

    const alert = await screen.findByRole('alert')
    assert.ok(within(alert).getByText('Some vendors could not be read'))
    assert.equal(screen.queryByRole('table'), null)
    assert.equal(screen.queryByRole('group', { name: 'Vendor statistics' }), null)
  })
})
