/**
 * /casino/providers against a mocked GraphQL server: a link that answers by operation name and records every
 * variable set it is sent (the documents stay in lib/graphql/casino.ts, untouched). Covers the guard and the
 * Super Admin branch, the statistics, the providers table (cells, the legacy sort cycle, the status select with
 * its toasts and revert), the scope tabs and the vendors table with its provider filter and trail, both drawer
 * openers, the per-whitelabel provider / vendor / game lists (queries, filters, switches, infinite scroll) and
 * the loading, empty and error states.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { useCasinoScopeStore } from '@/state/casinoScopeStore'
import { istDayEnd, istDayStart, istToday } from '@/ui/components/istDate'
import ProvidersPage from './ProvidersPage'

interface ServerCall {
  operationName: string
  variables: Record<string, unknown>
}

interface GuardCall {
  required: Array<{ domain: string; actions: string[] }>
}

const auth = vi.hoisted(() => ({ roles: ['Admin'] as string[] }))
const guard = vi.hoisted(() => ({ allowed: true, calls: [] as GuardCall[] }))
const feedback = vi.hoisted(() => ({ toast: vi.fn(), dismiss: vi.fn() }))

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: { roles: string[] }) => unknown) => selector({ roles: auth.roles }),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, children }: GuardCall & { children: ReactNode }) => {
    guard.calls.push({ required })
    return guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number) => `INR ${Number(amount).toFixed(2)}`,
    convertFromWhitelabelCurrency: (amount: number) => amount,
  }),
}))

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({ formatDateTime: (value: string) => `at ${value}` }),
}))

vi.mock('@/shared/core/useWhitelabels', () => ({
  useWhitelabels: () => ({
    whitelabels: [
      { id: 'wl-1', name: 'Royal Bet' },
      { id: 'wl-2', name: 'Lucky Star' },
    ],
  }),
}))

vi.mock('@/ui/components/toast', () => ({
  toast: Object.assign((options: unknown) => feedback.toast(options), {
    dismiss: (id: unknown) => feedback.dismiss(id),
  }),
}))

/* ---------- the mocked server ---------- */

interface ProviderRecord {
  id: string
  key: string
  name: string
  status: string
  lastSyncAt: string | null
  vendors: Array<{ id: string; name: string; slug: string }>
  vendorStats: Array<{ vendorId: string; vendorName: string; totalGames: number; activeGames: number }>
}

interface SettingRecord {
  id: string
  providerId: string
  providerKey: string
  providerName: string
  enabled: boolean
}

interface OverrideRecord {
  id: string
  vendorId: string
  vendorName: string
  providerId: string
  providerKey: string
  disabled: boolean
}

interface GameRecord {
  id: string
  gameId: string
  gameName: string
  vendorId: string
  vendorName: string
  providerId: string
  providerKey: string
  thumbnailUrl: string | null
  disabled: boolean
}

interface ServerState {
  calls: ServerCall[]
  providers: ProviderRecord[]
  providersError: string | null
  statusError: string | null
  toggleError: string | null
  settings: SettingRecord[]
  overrides: OverrideRecord[]
  games: GameRecord[]
}

let server: ServerState

const ANALYTICS: Record<string, { totalGGR: number; vendorBreakdown: Array<Record<string, unknown>> }> = {
  p1: {
    totalGGR: 1500,
    vendorBreakdown: [
      { vendorId: 'v1', vendorName: 'Evolution', ggr: 1000, shareAmount: 100, transactionCount: 8 },
      { vendorId: 'v2', vendorName: 'Ezugi', ggr: 500, shareAmount: 50, transactionCount: 4 },
    ],
  },
  p2: {
    totalGGR: -200,
    vendorBreakdown: [{ vendorId: 'v3', vendorName: 'Aviator', ggr: -200, shareAmount: 0, transactionCount: 3 }],
  },
}

function initialProviders(): ProviderRecord[] {
  return [
    {
      id: 'p1',
      key: 'qtech',
      name: 'QTech',
      status: 'ACTIVE',
      lastSyncAt: null,
      vendors: [
        { id: 'v1', name: 'Evolution', slug: 'evolution' },
        { id: 'v2', name: 'Ezugi', slug: 'ezugi' },
      ],
      vendorStats: [
        { vendorId: 'v1', vendorName: 'Evolution', totalGames: 120, activeGames: 100 },
        { vendorId: 'v2', vendorName: 'Ezugi', totalGames: 40, activeGames: 0 },
      ],
    },
    {
      id: 'p2',
      key: 'spribe',
      name: 'spribe',
      status: 'suspended',
      lastSyncAt: '2026-10-06T10:00:00Z',
      vendors: [{ id: 'v3', name: 'Aviator', slug: 'aviator' }],
      vendorStats: [{ vendorId: 'v3', vendorName: 'Aviator', totalGames: 1, activeGames: 1 }],
    },
    {
      id: 'p3',
      key: 'betsoft',
      name: 'Betsoft',
      status: 'inactive',
      lastSyncAt: null,
      vendors: [
        { id: 'v4', name: 'Alpha', slug: 'alpha' },
        { id: 'v5', name: 'Beta', slug: 'beta' },
        { id: 'v6', name: 'Gamma', slug: 'gamma' },
        { id: 'v7', name: 'Delta', slug: 'delta' },
      ],
      vendorStats: [],
    },
  ]
}

function games(count: number): GameRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `g${index + 1}`,
    gameId: String(101 + index),
    gameName: `Game ${String(index + 1).padStart(2, '0')}`,
    vendorId: 'v1',
    vendorName: 'Evolution',
    providerId: 'p1',
    providerKey: 'qtech',
    thumbnailUrl: index === 0 ? 'https://cdn.example/g1.png' : null,
    disabled: index === 1,
  }))
}

function analyticsPayload(providerId: string) {
  const entry = ANALYTICS[providerId] ?? { totalGGR: 0, vendorBreakdown: [] }
  return {
    __typename: 'ProviderAnalytics',
    providerId,
    totalGGR: entry.totalGGR,
    vendorBreakdown: entry.vendorBreakdown.map((v) => ({ __typename: 'VendorBreakdown', ...v })),
  }
}

function providersPayload() {
  return server.providers.map((p) => ({
    __typename: 'ProviderWithVendors',
    ...p,
    vendors: p.vendors.map((v) => ({ __typename: 'CasinoVendor', ...v })),
    vendorStats: p.vendorStats.map((s) => ({ __typename: 'VendorGamesStats', ...s })),
  }))
}

const ok = (field: string) => ({ data: { [field]: { __typename: 'MutationResponse', success: true, message: 'ok' } } })

function handle(operation: Operation): FetchResult {
  const variables = operation.variables as Record<string, unknown>
  switch (operation.operationName) {
    case 'ProvidersWithVendors':
      if (server.providersError) return { errors: [{ message: server.providersError }] }
      return { data: { providersWithVendors: providersPayload() } }
    case 'ProviderAnalytics':
      return { data: { providerAnalytics: analyticsPayload(String(variables.providerId)) } }
    case 'ProvidersAnalytics':
      return { data: { providersAnalytics: (variables.providerIds as string[]).map(analyticsPayload) } }
    case 'VendorAnalytics':
      return {
        data: {
          vendorAnalytics: {
            __typename: 'VendorAnalytics',
            vendorId: variables.vendorId,
            vendorName: 'Evolution',
            ggr: 1000,
            shareAmount: 100,
            transactionCount: 8,
          },
        },
      }
    case 'UpdateCasinoProvider': {
      if (server.statusError) return { errors: [{ message: server.statusError }] }
      const input = variables.input as { status: string }
      server.providers = server.providers.map((p) => (p.id === variables.id ? { ...p, status: input.status } : p))
      const updated = server.providers.find((p) => p.id === variables.id)
      return {
        data: {
          updateCasinoProvider: {
            __typename: 'CasinoProvider',
            id: updated?.id,
            key: updated?.key,
            name: updated?.name,
            status: updated?.status,
            lastSyncAt: updated?.lastSyncAt,
          },
        },
      }
    }
    case 'ProviderVendorShares':
      return { data: { providerVendorShares: [] } }
    case 'WhitelabelCasinoProviderSettings':
      return {
        data: {
          whitelabelCasinoProviderSettings: server.settings.map((s) => ({
            __typename: 'WhitelabelCasinoProviderSetting',
            tenantId: variables.tenantId,
            displayOrder: null,
            ...s,
          })),
        },
      }
    case 'ToggleWhitelabelCasinoProvider':
      if (server.toggleError) return { errors: [{ message: server.toggleError }] }
      server.settings = server.settings.map((s) =>
        s.providerId === variables.providerId ? { ...s, enabled: variables.enabled as boolean } : s,
      )
      return ok('toggleWhitelabelCasinoProvider')
    case 'WhitelabelCasinoVendorOverrideSettings':
      return {
        data: {
          whitelabelCasinoVendorOverrideSettings: server.overrides.map((o) => ({
            __typename: 'WhitelabelCasinoVendorOverride',
            tenantId: variables.tenantId,
            vendorSlug: null,
            ...o,
          })),
        },
      }
    case 'SetWhitelabelCasinoVendorSuperAdminOverride':
      server.overrides = server.overrides.map((o) =>
        o.vendorId === variables.vendorId ? { ...o, disabled: variables.disabled as boolean } : o,
      )
      return ok('setWhitelabelCasinoVendorSuperAdminOverride')
    case 'WhitelabelCasinoGameOverrideSettings': {
      const page = Number(variables.page)
      const pageSize = Number(variables.pageSize)
      const search = typeof variables.search === 'string' ? variables.search.toLowerCase() : ''
      const list = server.games.filter((g) => !search || g.gameName.toLowerCase().includes(search))
      const items = list.slice((page - 1) * pageSize, page * pageSize)
      return {
        data: {
          whitelabelCasinoGameOverrideSettings: {
            __typename: 'WhitelabelCasinoGameOverridePage',
            items: items.map((g) => ({
              __typename: 'WhitelabelCasinoGameOverride',
              tenantId: variables.tenantId,
              externalId: `ext-${g.gameId}`,
              ...g,
            })),
            total: list.length,
            hasMore: page * pageSize < list.length,
          },
        },
      }
    }
    case 'SetWhitelabelCasinoGameSuperAdminOverride':
      server.games = server.games.map((g) =>
        g.gameId === variables.gameId ? { ...g, disabled: variables.disabled as boolean } : g,
      )
      return ok('setWhitelabelCasinoGameSuperAdminOverride')
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

function calls(operationName: string) {
  return server.calls.filter((call) => call.operationName === operationName)
}

/** Variables as they travel: undefined keys dropped. */
function sent(call: ServerCall | undefined) {
  return JSON.parse(JSON.stringify(call?.variables ?? null)) as Record<string, unknown>
}

function lastSent(operationName: string) {
  return sent(calls(operationName).at(-1))
}

/* ---------- a controllable IntersectionObserver for the games list ---------- */

class FakeObserver {
  static instances: FakeObserver[] = []
  readonly root: Element | Document | null
  readonly rootMargin: string
  readonly thresholds: number[] = []
  readonly callback: IntersectionObserverCallback
  readonly options: IntersectionObserverInit
  target: Element | null = null
  disconnected = false

  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.callback = callback
    this.options = options
    this.root = options.root ?? null
    this.rootMargin = options.rootMargin ?? ''
    FakeObserver.instances.push(this)
  }

  observe(target: Element) {
    this.target = target
  }

  unobserve() {}

  disconnect() {
    this.disconnected = true
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

function liveGameObserver(): FakeObserver | undefined {
  return FakeObserver.instances.filter((o) => !o.disconnected && o.rootMargin === '100px').at(-1)
}

/* ---------- rendering ---------- */

function renderPage() {
  return render(
    <MockedProvider link={serverLink()}>
      <MemoryRouter initialEntries={['/casino/providers']}>
        <PageEyebrowProvider value="Trading">
          <ProvidersPage />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

function table(name: string): HTMLElement {
  return screen.getByRole('table', { name })
}

function bodyRows(name: string): HTMLElement[] {
  return within(table(name)).getAllByRole('row').slice(1)
}

function rowOf(tableName: string, text: string): HTMLElement {
  const row = within(table(tableName)).getByText(text).closest('tr')
  assert.ok(row, `Expected a row for ${text}`)
  return row as HTMLElement
}

function cellTexts(row: HTMLElement): string[] {
  return within(row).getAllByRole('cell').map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim())
}

/** A providers row by the name on its button (names and keys can share text). */
function providerRow(name: string): HTMLElement {
  const row = bodyRows('Providers').find(
    (candidate) => within(candidate).getAllByRole('cell')[0].querySelector('button')?.textContent === name,
  )
  assert.ok(row, `Expected a provider row for ${name}`)
  return row
}

async function waitForLoaded() {
  await screen.findByRole('table', { name: 'Providers' })
  await waitFor(() => assert.equal(bodyRows('Providers').length, 3))
  const stats = await screen.findByRole('group', { name: 'Provider statistics' })
  await waitFor(() => assert.equal(stats.getAttribute('aria-busy'), null))
  await waitFor(() => assert.equal(within(table('Providers')).queryAllByText('Loading…').length, 0))
}

async function renderLoaded() {
  const view = renderPage()
  await waitForLoaded()
  return view
}

function scopeTab(name: string): HTMLElement {
  return within(screen.getByRole('tablist', { name: 'Scope selector' })).getByRole('tab', { name })
}

function visibilityTab(name: string): HTMLElement {
  return within(screen.getByRole('tablist', { name: 'Per-whitelabel provider visibility' })).getByRole('tab', { name })
}

async function chooseOption(comboboxName: string, optionName: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: comboboxName }), { key: 'ArrowDown' })
  const list = await screen.findByRole('listbox', { name: comboboxName })
  fireEvent.click(within(list).getByRole('option', { name: optionName }))
}

async function chooseWhitelabel() {
  await chooseOption('Whitelabel', 'Royal Bet')
  await screen.findByRole('table', { name: 'Provider visibility' })
}

const todayStart = () => istDayStart(istToday())
const todayEnd = () => istDayEnd(istToday())

beforeEach(() => {
  auth.roles = ['Admin']
  guard.allowed = true
  guard.calls.length = 0
  feedback.toast.mockReset()
  feedback.dismiss.mockReset()
  FakeObserver.instances = []
  useCasinoScopeStore.setState({ scope: 'providers', selectedProviderId: undefined })
  server = {
    calls: [],
    providers: initialProviders(),
    providersError: null,
    statusError: null,
    toggleError: null,
    settings: [
      { id: 's1', providerId: '7', providerKey: 'qtech', providerName: 'QTech', enabled: true },
      { id: 's2', providerId: '8', providerKey: 'evo', providerName: 'Evolution Direct', enabled: false },
    ],
    overrides: [
      { id: 'o1', vendorId: '11', vendorName: 'Evolution', providerId: 'p1', providerKey: 'qtech', disabled: false },
      { id: 'o2', vendorId: '12', vendorName: 'Ezugi', providerId: 'p1', providerKey: 'qtech', disabled: true },
      { id: 'o3', vendorId: '13', vendorName: 'Aviator', providerId: 'p2', providerKey: 'spribe', disabled: false },
    ],
    games: games(25),
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ProvidersPage', () => {
  test('loads under the guard: header, statistics and the providers table, with no Super Admin card', async () => {
    renderPage()
    assert.equal(screen.getByRole('group', { name: 'Provider statistics' }).getAttribute('aria-busy'), 'true')
    await waitForLoaded()

    assert.deepEqual(guard.calls.at(-1), { required: [{ domain: 'casino.providers', actions: ['view'] }] })
    assert.ok(screen.queryByText('Trading') === null)
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Casino Providers' }))
    assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1)
    assert.ok(screen.queryByText('Manage providers and vendor sharing configuration') === null)
    assert.equal(screen.queryByRole('heading', { name: 'Per-whitelabel provider visibility' }), null)
    assert.equal(calls('WhitelabelCasinoProviderSettings').length, 0)

    const stats = screen.getByRole('group', { name: 'Provider statistics' })
    for (const text of [
      'Total Providers', '3', '1 active, 2 suspended',
      'Vendors', '7', '2 with active games',
      "Today's GGR", 'INR 1500.00', '3 providers',
      'Active Rate', '33%', '1 of 3',
    ]) {
      assert.ok(within(stats).getByText(text), text)
    }
    // today's GGR is the first provider's, from the IST start of today
    const statsCall = calls('ProviderAnalytics').find((call) => call.variables.providerId === 'p1')
    assert.equal(statsCall?.variables.start, todayStart())

    const providersCard = screen.getByRole('heading', { level: 2, name: 'Providers' }).closest('section')
    assert.ok(providersCard)
    assert.ok(within(providersCard).getByText('3 providers', { selector: 'p' }))
    const headers = within(table('Providers')).getAllByRole('columnheader').map((th) => (th.textContent ?? '').trim())
    assert.deepEqual(headers, ['Provider Details', 'Status & Sync', 'Vendors & Games', "Today's Revenue", 'Performance', 'Actions'])

    const qtech = cellTexts(providerRow('QTech'))
    assert.equal(qtech[0], 'QTechqtech')
    assert.ok(qtech[1].endsWith('Never synced'))
    assert.equal(qtech[2], '2 vendorsEvolutionEzugi')
    assert.equal(qtech[3], 'INR 1500.00Up 15.0%vs yesterdayVendors: 2 activeTxns: 12')
    assert.equal(qtech[4], '2Vendors: 2Games: 160Active: 100')
    assert.equal((screen.getByRole('combobox', { name: 'Status of QTech' }) as HTMLSelectElement).value, 'active')

    const spribe = cellTexts(providerRow('spribe'))
    assert.ok(spribe[1].endsWith('Last sync:at 2026-10-06T10:00:00Z'))
    assert.equal(spribe[3], 'INR -200.00Down 2.0%vs yesterdayVendors: 1 activeTxns: 3')
    assert.equal((screen.getByRole('combobox', { name: 'Status of spribe' }) as HTMLSelectElement).value, 'suspended')

    const betsoft = cellTexts(providerRow('Betsoft'))
    assert.equal(betsoft[2], '4 vendorsAlphaBetaGamma+1 more')
    assert.equal(betsoft[3], 'INR 0.00No change 0%vs yesterdayVendors: 0 activeTxns: 0')

    assert.ok(screen.getByRole('button', { name: 'Manage Vendor Shares for QTech' }))
    assert.ok(screen.getByRole('button', { name: 'View Analytics for QTech' }))
    assert.equal(scopeTab('Providers').getAttribute('aria-selected'), 'true')
    assert.equal(calls('VendorAnalytics').length, 0)
  })

  test('a denied caller starts no query', async () => {
    guard.allowed = false
    renderPage()

    assert.ok(screen.getByRole('alert'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(server.calls.length, 0)
    assert.equal(screen.queryByRole('heading', { level: 1 }), null)
  })

  test('the sortable headers sort ascending, then flip, and never clear', async () => {
    await renderLoaded()
    const order = () => bodyRows('Providers').map((row) => within(row).getAllByRole('cell')[0].querySelector('button')?.textContent)
    const header = () => within(table('Providers')).getByRole('columnheader', { name: 'Provider Details' })

    assert.deepEqual(order(), ['QTech', 'spribe', 'Betsoft'])
    fireEvent.click(within(header()).getByRole('button'))
    assert.deepEqual(order(), ['Betsoft', 'QTech', 'spribe'])
    assert.equal(header().getAttribute('aria-sort'), 'ascending')
    fireEvent.click(within(header()).getByRole('button'))
    assert.deepEqual(order(), ['spribe', 'QTech', 'Betsoft'])
    assert.equal(header().getAttribute('aria-sort'), 'descending')
    fireEvent.click(within(header()).getByRole('button'))
    assert.deepEqual(order(), ['Betsoft', 'QTech', 'spribe'])
    assert.equal(header().getAttribute('aria-sort'), 'ascending')

    const vendorsHeader = within(table('Providers')).getByRole('columnheader', { name: 'Vendors & Games' })
    fireEvent.click(within(vendorsHeader).getByRole('button'))
    assert.deepEqual(order(), ['spribe', 'QTech', 'Betsoft'])
    assert.equal(header().getAttribute('aria-sort'), 'none')
  })

  test('the status select updates optimistically, toasts, refetches, and reverts on failure', async () => {
    await renderLoaded()
    const before = calls('ProvidersWithVendors').length

    fireEvent.change(screen.getByRole('combobox', { name: 'Status of QTech' }), { target: { value: 'suspended' } })
    assert.equal((screen.getByRole('combobox', { name: 'Status of QTech' }) as HTMLSelectElement).value, 'suspended')
    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.deepEqual(lastSent('UpdateCasinoProvider'), { id: 'p1', input: { status: 'suspended' } })
    assert.deepEqual(feedback.toast.mock.calls[0][0], {
      message: 'Provider "QTech" status updated to Suspended',
      tone: 'ok',
      duration: 3000,
    })
    assert.ok(calls('ProvidersWithVendors').length > before)

    server.statusError = 'Provider is locked'
    fireEvent.change(screen.getByRole('combobox', { name: 'Status of spribe' }), { target: { value: 'active' } })
    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 2))
    assert.deepEqual(feedback.toast.mock.calls[1][0], { message: 'Provider is locked', tone: 'error', duration: 3000 })
    await waitFor(() =>
      assert.equal((screen.getByRole('combobox', { name: 'Status of spribe' }) as HTMLSelectElement).value, 'suspended'),
    )
  })

  test('a provider name opens its vendors; the trail and the scope tabs lead back', async () => {
    await renderLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'QTech' }))
    assert.equal(scopeTab('Vendors').getAttribute('aria-selected'), 'true')
    await screen.findByRole('table', { name: 'Vendors' })
    assert.equal((screen.getByRole('combobox', { name: 'Filter by provider' }) as HTMLInputElement).value, 'QTech')
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })
    assert.ok(within(trail).getByRole('button', { name: 'Providers' }))
    assert.equal(within(trail).getByText('QTech').closest('[aria-current]')?.getAttribute('aria-current'), 'location')
    assert.ok(screen.getByText('2 vendors for QTech'))

    await waitFor(() => assert.ok(calls('ProvidersAnalytics').length > 0))
    assert.deepEqual(
      { providerIds: lastSent('ProvidersAnalytics').providerIds, start: lastSent('ProvidersAnalytics').start },
      { providerIds: ['p1'], start: todayStart() },
    )
    await waitFor(() => assert.ok(cellTexts(rowOf('Vendors', 'Evolution'))[3].startsWith('INR 1000.00')))
    const evolution = cellTexts(rowOf('Vendors', 'Evolution'))
    assert.deepEqual(evolution.slice(0, 5), [
      'Evolutionevolution',
      'QTechIntegration active',
      '120 gamesActive: 100',
      'INR 1000.00Up 20.0%vs yesterdayShare: INR 100.00Txns: 8',
      '8Txns: 8Avg: INR 125.00',
    ])
    assert.equal(cellTexts(rowOf('Vendors', 'Ezugi'))[3], 'INR 500.00Up 10.0%vs yesterdayShare: INR 50.00Txns: 4')
    assert.equal(calls('VendorAnalytics').length, 0)

    fireEvent.click(within(trail).getByRole('button', { name: 'Providers' }))
    assert.equal(scopeTab('Providers').getAttribute('aria-selected'), 'true')
    await screen.findByRole('table', { name: 'Providers' })
  })

  test('the vendors scope lists every vendor, filters by provider and sorts by provider', async () => {
    await renderLoaded()
    fireEvent.click(scopeTab('Vendors'))
    await screen.findByRole('table', { name: 'Vendors' })
    assert.ok(screen.getByText('7 vendors across all providers'))
    assert.equal(screen.queryByRole('navigation', { name: 'Breadcrumb' })?.textContent, 'Providers')
    await waitFor(() => assert.deepEqual(lastSent('ProvidersAnalytics').providerIds, ['p1', 'p2', 'p3']))
    // a vendor missing from the batched analytics reads as zeros (and shows no average)
    await waitFor(() => assert.ok(cellTexts(rowOf('Vendors', 'Evolution'))[3].startsWith('INR 1000.00')))
    assert.deepEqual(cellTexts(rowOf('Vendors', 'Alpha')).slice(3, 5), [
      'INR 0.00No change 0%vs yesterdayShare: INR 0.00Txns: 0',
      '0Txns: 0',
    ])

    await chooseOption('Filter by provider', 'spribe')
    await waitFor(() => assert.equal(bodyRows('Vendors').length, 1))
    assert.ok(screen.getByText('1 vendor for spribe'))
    assert.ok(within(table('Vendors')).getByText('Aviator'))

    fireEvent.click(screen.getByRole('button', { name: 'Clear Filter by provider' }))
    await waitFor(() => assert.equal(bodyRows('Vendors').length, 7))

    const providerHeader = within(table('Vendors')).getByRole('columnheader', { name: 'Provider' })
    fireEvent.click(within(providerHeader).getByRole('button'))
    assert.deepEqual(
      bodyRows('Vendors').map((row) => within(row).getAllByRole('cell')[1].querySelector('span')?.textContent),
      ['Betsoft', 'Betsoft', 'Betsoft', 'Betsoft', 'QTech', 'QTech', 'spribe'],
    )
  })

  test('the row actions open the shares and analytics drawers with the provider or vendor', async () => {
    await renderLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Manage Vendor Shares for QTech' }))
    const shares = await screen.findByRole('dialog', { name: 'Manage Vendor Shares' })
    await waitFor(() => assert.deepEqual(lastSent('ProviderVendorShares'), { providerId: 'p1' }))
    assert.ok(within(shares).getByRole('textbox', { name: 'Share Percentage for Evolution' }))
    fireEvent.click(within(shares).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))

    fireEvent.click(screen.getByRole('button', { name: 'View Analytics for QTech' }))
    await screen.findByRole('dialog', { name: 'Analytics • QTech' })
    await waitFor(() =>
      assert.ok(calls('ProviderAnalytics').some((call) => call.variables.end === todayEnd() && call.variables.providerId === 'p1')),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))

    fireEvent.click(scopeTab('Vendors'))
    await screen.findByRole('table', { name: 'Vendors' })
    fireEvent.click(screen.getByRole('button', { name: 'View Analytics for Evolution' }))
    await screen.findByRole('dialog', { name: 'Analytics • Evolution' })
    await waitFor(() =>
      assert.deepEqual(lastSent('VendorAnalytics'), { providerId: 'p1', vendorId: 'v1', start: todayStart(), end: todayEnd() }),
    )
  })

  test('loads, then shows the empty state with zero statistics', async () => {
    server.providers = []
    renderPage()
    assert.ok(await screen.findByText('Loading Providers'))

    await screen.findByText('No providers found')
    const providersCard = screen.getByRole('heading', { level: 2, name: 'Providers' }).closest('section')
    assert.ok(providersCard)
    assert.ok(within(providersCard).getByText('0 providers', { selector: 'p' }))
    const stats = await screen.findByRole('group', { name: 'Provider statistics' })
    await waitFor(() => assert.equal(stats.getAttribute('aria-busy'), null))
    assert.ok(within(stats).getByText('0 active, 0 suspended'))
    assert.ok(within(stats).getByText('0%'))
    // no provider, so no analytics query for today's GGR
    assert.equal(calls('ProviderAnalytics').length, 0)
  })

  test('a failed provider list shows the error above the table', async () => {
    server.providersError = 'Upstream timeout'
    renderPage()
    const alert = await screen.findByRole('alert')
    assert.ok(within(alert).getByText('Failed to load providers'))
    assert.ok(within(alert).getByText('Upstream timeout'))
    assert.ok(screen.getByRole('table', { name: 'Providers' }))
    assert.ok(screen.getByText('No providers found'))
  })
})

describe('ProvidersPage per-whitelabel visibility (Super Admin)', () => {
  beforeEach(() => {
    auth.roles = ['Super Admin']
  })

  test('the card asks for a whitelabel, then lists its providers with search and the Yes / No switches', async () => {
    await renderLoaded()
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Per-whitelabel provider visibility' }))
    assert.ok(screen.getByText('Super Admin only'))
    assert.ok(screen.getByText('Select a whitelabel to enable or disable casino providers, vendors, or games for that brand.'))
    assert.equal(calls('WhitelabelCasinoProviderSettings').length, 0)

    await chooseWhitelabel()
    assert.deepEqual(lastSent('WhitelabelCasinoProviderSettings'), { tenantId: 'wl-1' })
    assert.equal(visibilityTab('Providers').getAttribute('aria-selected'), 'true')
    assert.ok(screen.queryByText('Select a whitelabel to enable or disable casino providers, vendors, or games for that brand.') === null)
    assert.equal(calls('WhitelabelCasinoVendorOverrideSettings').length, 0)
    assert.equal(calls('WhitelabelCasinoGameOverrideSettings').length, 0)

    assert.deepEqual(cellTexts(rowOf('Provider visibility', 'QTech')), ['QTechqtech', 'No'])
    assert.equal(screen.getByRole('switch', { name: 'QTech disabled' }).getAttribute('aria-checked'), 'false')
    assert.equal(screen.getByRole('switch', { name: 'Evolution Direct disabled' }).getAttribute('aria-checked'), 'true')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search providers' }), { target: { value: ' EVO ' } })
    assert.equal(bodyRows('Provider visibility').length, 1)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search providers' }), { target: { value: 'zzz' } })
    assert.ok(screen.getByText('No providers match your search'))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search providers' }), { target: { value: '' } })

    fireEvent.click(screen.getByRole('button', { name: 'Clear Whitelabel' }))
    assert.ok(screen.getByText('Select a whitelabel to enable or disable casino providers, vendors, or games for that brand.'))
    assert.equal(screen.queryByRole('tablist', { name: 'Per-whitelabel provider visibility' }), null)
  })

  test('a provider switch sends the enabled flag, holds every switch while saving, refetches, and toasts a failure', async () => {
    await renderLoaded()
    await chooseWhitelabel()
    const settingsBefore = calls('WhitelabelCasinoProviderSettings').length

    fireEvent.click(screen.getByRole('switch', { name: 'QTech disabled' }))
    assert.equal(screen.getByRole('switch', { name: 'Evolution Direct disabled' }).getAttribute('aria-disabled'), 'true')
    await waitFor(() =>
      assert.equal(screen.getByRole('switch', { name: 'QTech disabled' }).getAttribute('aria-checked'), 'true'),
    )
    assert.deepEqual(lastSent('ToggleWhitelabelCasinoProvider'), { tenantId: 'wl-1', providerId: '7', enabled: false })
    assert.ok(calls('WhitelabelCasinoProviderSettings').length > settingsBefore)
    await waitFor(() =>
      assert.equal(screen.getByRole('switch', { name: 'QTech disabled' }).getAttribute('aria-disabled'), null),
    )
    assert.equal(feedback.toast.mock.calls.length, 0)

    server.toggleError = 'Tenant is locked'
    fireEvent.click(screen.getByRole('switch', { name: 'Evolution Direct disabled' }))
    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.deepEqual(feedback.toast.mock.calls[0][0], {
      title: 'Error',
      message: 'Tenant is locked',
      tone: 'error',
      duration: 4500,
    })
    assert.deepEqual(lastSent('ToggleWhitelabelCasinoProvider'), { tenantId: 'wl-1', providerId: '8', enabled: true })
  })

  test('the vendors list loads on its tab, filters by provider and search, and sends the disabled flag', async () => {
    await renderLoaded()
    await chooseWhitelabel()

    fireEvent.click(visibilityTab('Vendors'))
    await screen.findByRole('table', { name: 'Vendor visibility' })
    assert.deepEqual(lastSent('WhitelabelCasinoVendorOverrideSettings'), { tenantId: 'wl-1' })
    assert.equal(bodyRows('Vendor visibility').length, 3)
    assert.equal(screen.getByRole('switch', { name: 'Ezugi disabled' }).getAttribute('aria-checked'), 'true')

    // its hidden label names the list it filters; the visible placeholder option keeps the legacy copy
    const providerFilter = screen.getByRole('combobox', { name: 'Filter vendor visibility by provider' }) as HTMLSelectElement
    assert.deepEqual([...providerFilter.options].map((o) => o.text), ['Filter by provider', 'QTech', 'spribe', 'Betsoft'])
    fireEvent.change(providerFilter, { target: { value: 'p2' } })
    assert.deepEqual(bodyRows('Vendor visibility').map((row) => cellTexts(row)[0]), ['Aviatorspribe'])
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search vendors' }), { target: { value: 'evo' } })
    assert.ok(screen.getByText('No vendors match filters'))
    fireEvent.change(providerFilter, { target: { value: '' } })
    assert.deepEqual(bodyRows('Vendor visibility').map((row) => cellTexts(row)[0]), ['Evolutionqtech'])

    fireEvent.click(screen.getByRole('switch', { name: 'Evolution disabled' }))
    await waitFor(() =>
      assert.deepEqual(lastSent('SetWhitelabelCasinoVendorSuperAdminOverride'), { tenantId: 'wl-1', vendorId: '11', disabled: true }),
    )
    await waitFor(() =>
      assert.equal(screen.getByRole('switch', { name: 'Evolution disabled' }).getAttribute('aria-checked'), 'true'),
    )
  })

  test('the games list pages on scroll, filters by provider then vendor, and refetches page 1 after a switch', async () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    await renderLoaded()
    await chooseWhitelabel()

    fireEvent.click(visibilityTab('Games'))
    await screen.findByRole('table', { name: 'Game visibility' })
    assert.deepEqual(lastSent('WhitelabelCasinoGameOverrideSettings'), {
      tenantId: 'wl-1',
      providerId: null,
      vendorId: null,
      search: null,
      page: 1,
      pageSize: 20,
    })
    await waitFor(() => assert.equal(bodyRows('Game visibility').length, 20))
    assert.ok(screen.getByText('20 of 25 games'))
    assert.equal(cellTexts(bodyRows('Game visibility')[0])[0], 'Game 01qtech • Evolution')
    // the games table takes a fixed layout with a fixed Disabled column, so it never overflows its box sideways;
    // a cut name or sub line keeps its full text as a title
    assert.match(table('Game visibility').className, /gameTable/)
    assert.match(within(table('Game visibility')).getByRole('columnheader', { name: 'Disabled' }).className, /switchCol/)
    assert.equal(within(bodyRows('Game visibility')[0]).getByText('Game 01').getAttribute('title'), 'Game 01')
    assert.equal(within(bodyRows('Game visibility')[0]).getByText('qtech • Evolution').getAttribute('title'), 'qtech • Evolution')
    assert.equal(table('Game visibility').querySelector('img')?.getAttribute('src'), 'https://cdn.example/g1.png')
    assert.equal(screen.getByRole('switch', { name: 'Game 02 disabled' }).getAttribute('aria-checked'), 'true')

    // the sentinel at the end of the 420px box loads the next page
    const observer = liveGameObserver()
    assert.ok(observer)
    assert.ok(observer.root === table('Game visibility').closest('div[class*="gameScroll"]'))
    act(() => {
      observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], observer as unknown as IntersectionObserver)
    })
    await waitFor(() => assert.equal(bodyRows('Game visibility').length, 25))
    assert.equal(lastSent('WhitelabelCasinoGameOverrideSettings').page, 2)
    assert.ok(screen.getByText('25 of 25 games'))

    const vendorFilter = screen.getByRole('combobox', { name: 'Filter game visibility by vendor' }) as HTMLSelectElement
    assert.equal(vendorFilter.disabled, true)
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter game visibility by provider' }), { target: { value: 'p1' } })
    await waitFor(() =>
      assert.deepEqual(lastSent('WhitelabelCasinoGameOverrideSettings'), {
        tenantId: 'wl-1', providerId: 'p1', vendorId: null, search: null, page: 1, pageSize: 20,
      }),
    )
    assert.equal(vendorFilter.disabled, false)
    assert.deepEqual([...vendorFilter.options].map((o) => o.text), ['Filter by vendor', 'Evolution', 'Ezugi'])
    fireEvent.change(vendorFilter, { target: { value: 'v1' } })
    await waitFor(() => assert.equal(lastSent('WhitelabelCasinoGameOverrideSettings').vendorId, 'v1'))
    await waitFor(() => assert.equal(bodyRows('Game visibility').length, 20))

    fireEvent.click(screen.getByRole('switch', { name: 'Game 03 disabled' }))
    await waitFor(() =>
      assert.deepEqual(lastSent('SetWhitelabelCasinoGameSuperAdminOverride'), { tenantId: 'wl-1', gameId: '103', disabled: true }),
    )
    await waitFor(() =>
      assert.deepEqual(lastSent('WhitelabelCasinoGameOverrideSettings'), {
        tenantId: 'wl-1', providerId: 'p1', vendorId: 'v1', search: null, page: 1, pageSize: 20,
      }),
    )
    await waitFor(() =>
      assert.equal(screen.getByRole('switch', { name: 'Game 03 disabled' }).getAttribute('aria-checked'), 'true'),
    )

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search games' }), { target: { value: 'zzz' } })
    await screen.findByText('No games match filters')
    assert.equal(lastSent('WhitelabelCasinoGameOverrideSettings').search, 'zzz')
  })

  test('a whitelabel without games says how to list them', async () => {
    server.games = []
    await renderLoaded()
    await chooseWhitelabel()
    fireEvent.click(visibilityTab('Games'))
    assert.ok(await screen.findByText('Select provider (and optionally vendor) to list games'))
  })
})
