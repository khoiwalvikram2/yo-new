import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { beforeEach, describe, test, vi } from 'vitest'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import { useCasinoStore } from '@/state/casinoStore'
import ManagementPage from './ManagementPage'

interface ServerCall {
  operationName: string
  variables: Record<string, unknown>
  context: Record<string, unknown>
}

const guard = vi.hoisted(() => ({
  allowed: true,
  calls: [] as Array<Array<{ domain: string; actions: string[] }>>,
}))
const feedback = vi.hoisted(() => ({
  success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, children }: {
    required: Array<{ domain: string; actions: string[] }>
    children: ReactNode
  }) => {
    guard.calls.push(required)
    return guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({ getCurrencySymbol: () => '₹' }),
}))
vi.mock('@/shared/core/useFormatLocale', () => ({ useFormatLocale: () => 'en-IN' }))
vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDate: (value: string) => value.slice(0, 10),
    formatDateTime: (value: string) => value.slice(0, 16),
  }),
}))
vi.mock('@/shared/services/notification', () => ({ notify: feedback }))

let serverCalls: ServerCall[]
/** Games switched on or off through the grid's Enable switch, which the server's later reads reflect. */
let switched: Record<string, boolean>

function sent(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function game(id: string, name: string, category: string, tenantEnabled = true) {
  return {
    __typename: 'CasinoGame',
    id,
    name,
    slug: id,
    mainCategory: category,
    vendorId: 'v1',
    vendorName: 'Evolution',
    thumbnailUrl: null,
    rtp: null,
    demoUrl: null,
    betSettingsCount: id === 'roulette' ? 1 : 0,
    isActive: true,
    tenantEnabled,
    premiumOnly: false,
    order: 1,
    featured: false,
    categoryAssigned: true,
    limits: null,
    updatedAt: '2026-10-01T10:00:00.000Z',
  }
}

function mutationResponse(field: string): FetchResult {
  return { data: { [field]: { __typename: 'MutationResponse', success: true, message: 'ok' } } }
}

function handle(operation: Operation): FetchResult {
  serverCalls.push({
    operationName: operation.operationName,
    variables: sent(operation.variables as Record<string, unknown>),
    context: operation.getContext() as Record<string, unknown>,
  })
  const variables = operation.variables as Record<string, unknown>
  switch (operation.operationName) {
    case 'CasinoApiProviders':
      return { data: { casinoApiProviders: [
        { __typename: 'CasinoApiProvider', id: 'p1', key: 'primary', name: 'Primary API', status: 'ACTIVE', lastSyncAt: null },
      ] } }
    case 'CasinoVendors':
      return { data: { casinoVendors: [
        { __typename: 'CasinoVendor', id: 'v1', name: 'Evolution', slug: 'evolution' },
      ] } }
    case 'CasinoGames': {
      const input = variables.input as { category?: string; search?: string; enabled?: boolean; page?: number; pageSize?: number }
      const byCategory: Record<string, ReturnType<typeof game>> = {
        LIVE_CASINO: game('roulette', 'Roulette Gold', 'LIVE_CASINO'),
        CASINO: game('poker', 'Poker Elite', 'CASINO', false),
        SLOTS: game('aviator', 'Aviator', 'SLOTS'),
      }
      // No category is the All view: every category, paged on the server.
      const rows = (input.category ? [byCategory[input.category]] : Object.values(byCategory))
        .map((row) => (row.id in switched ? { ...row, tenantEnabled: switched[row.id] } : row))
      // The Status filter, as the server reads it: the whitelabel's switch, or the platform flag in core mode.
      const core = useUIStore.getState().directorMode === 'core'
      const matches = rows.filter((row) => !input.search || row.name.toLowerCase().includes(input.search.toLowerCase()))
        .filter((row) => typeof input.enabled !== 'boolean' || (core ? row.isActive : row.tenantEnabled) === input.enabled)
      const page = input.page ?? 1
      const pageSize = input.pageSize ?? 20
      return { data: { casinoGames: {
        __typename: 'CasinoGamesPage', total: matches.length, page, pageSize,
        items: matches.slice((page - 1) * pageSize, page * pageSize),
      } } }
    }
    case 'VIPTiers':
      return { data: { vipTiers: [{
        __typename: 'VipTier', id: 'gold', tenant: 'tenant', name: 'Gold', level: 2,
        minMonthlyDeposit: 1000, color: 'gold', benefits: [], perks: [], status: 'ACTIVE',
        createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
      }] } }
    case 'GameVipTiers':
      return { data: { gameVipTiers: [{
        __typename: 'GameVipTier', tierId: 'gold', tierName: 'Gold', enabled: true,
        updatedAt: '2026-10-01T00:00:00.000Z',
      }] } }
    case 'CasinoGameBetSettings':
      return { data: { casinoGameBetSettings: [{
        __typename: 'CasinoGameBetSetting', id: 'bet-all', gameId: String(variables.gameId), playerId: null,
        playerName: null, playerPhone: null, betEnabled: true, minStake: 10, maxStake: 100,
        maxWin: 1000, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
      }] } }
    case 'BulkUpdateCasinoGameSettings':
      return mutationResponse('bulkUpdateCasinoGameSettings')
    case 'UpdateCasinoGameSettings':
      return mutationResponse('updateCasinoGameSettings')
    case 'ToggleVipTierGameEnabled':
      return mutationResponse('toggleVipTierGameEnabled')
    case 'BulkUpdateVipTierGames':
      return mutationResponse('bulkUpdateVipTierGames')
    case 'ToggleCasinoGameEnabled':
      switched[String(variables.gameId)] = Boolean(variables.enabled)
      return mutationResponse('toggleCasinoGameEnabled')
    case 'ToggleCasinoGameMasterActive':
      return mutationResponse('toggleCasinoGameMasterActive')
    case 'ReorderVendorGames':
      return mutationResponse('reorderVendorGames')
    case 'UpsertCasinoGameBetSettings': {
      const settings = variables.settings as Record<string, unknown>
      return { data: { upsertCasinoGameBetSettings: {
        __typename: 'CasinoGameBetSetting', id: 'saved', gameId: variables.gameId,
        playerId: settings.playerId ?? null, playerName: null, playerPhone: null,
        betEnabled: settings.betEnabled, minStake: settings.minStake ?? null,
        maxStake: settings.maxStake ?? null, maxWin: settings.maxWin ?? null,
        createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
      } } }
    }
    case 'DeleteCasinoGameBetSettings':
      return mutationResponse('deleteCasinoGameBetSettings')
    default:
      throw new Error(`Unexpected operation ${operation.operationName}`)
  }
}

function serverLink() {
  return new ApolloLink((operation) => new Observable((observer) => {
    queueMicrotask(() => {
      try {
        observer.next(handle(operation))
        observer.complete()
      } catch (reason) {
        observer.error(reason)
      }
    })
  }))
}

function calls(operationName: string) {
  return serverCalls.filter((call) => call.operationName === operationName)
}

function renderPage(path = '/casino/management', extra?: ReactNode) {
  return render(
    <MockedProvider link={serverLink()} cache={undefined}>
      <MemoryRouter initialEntries={[path]}>
        <PageEyebrowProvider value="Trading">
          <ManagementPage />
          {extra}
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

async function renderLoaded() {
  const view = renderPage()
  await screen.findByRole('table', { name: 'Casino games' })
  await screen.findByText('Roulette Gold')
  return view
}

beforeEach(() => {
  serverCalls = []
  switched = {}
  guard.allowed = true
  guard.calls = []
  feedback.success.mockReset()
  feedback.error.mockReset()
  feedback.warning.mockReset()
  feedback.info.mockReset()
  useAuthStore.setState({ roles: ['SUPER_ADMIN'] })
  // A Super Admin working on one whitelabel; core mode has its own tests below.
  useUIStore.setState({ directorMode: 'whitelabel', selectedWhitelabelId: 'wl1' })
  useCasinoStore.setState({
    selectedProviderId: null,
    selectedCategory: null,
    selectedVendorId: null,
    selectedVipTierId: null,
    search: '',
    enabled: null,
    page: 1,
    pageSize: 20,
  })
})

describe('/casino/management', () => {
  test('uses the exact RBAC guard and renders the migrated scope, statistics and all-category games', async () => {
    await renderLoaded()
    assert.deepEqual(guard.calls[0], [{ domain: 'casino.management', actions: ['view'] }])
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Casino Management' }))
    assert.ok(screen.queryByText('Manage games by provider, category, and vendor') === null)
    assert.ok(screen.getByRole('search', { name: 'Scope filters' }))
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Casino Games' }))
    assert.ok(screen.getByText('Poker Elite'))
    assert.ok(screen.getByText('Aviator'))
    // One paged query for All, with no category: the server pages the three together. (The statistics count the
    // same scope with one-row reads, B002; they are not the table's.)
    const gameCalls = calls('CasinoGames').filter((call) => {
      const input = call.variables.input as Record<string, unknown> | undefined
      return input && !('category' in input) && input.pageSize !== 1
    })
    assert.ok(gameCalls.length >= 1)
    assert.deepEqual(gameCalls[0].variables, { input: { providerId: 'p1', page: 1, pageSize: 20 } })
    assert.equal(calls('CasinoGames').some((call) => (call.variables.input as Record<string, unknown>).pageSize === 10000), false)
  })

  test('keeps the pagination on a page past the last game and moves back to the last page', async () => {
    // Scope already chosen, so loading the page does not reset the page number.
    useCasinoStore.setState({ selectedProviderId: 'p1', selectedCategory: 'ALL', page: 4 })
    renderPage()
    await screen.findByText('Roulette Gold')
    assert.equal(useCasinoStore.getState().page, 1)
    assert.ok(calls('CasinoGames').some((call) => (call.variables.input as Record<string, unknown>).page === 4))
    assert.ok(screen.getByRole('navigation', { name: 'Pagination' }))
  })

  test('core mode lists every game with Master Control and offers no per-whitelabel setting', async () => {
    useUIStore.setState({ directorMode: 'core', selectedWhitelabelId: null })
    await renderLoaded()
    assert.ok(screen.getByText(/Core mode lists every game on the platform/))
    assert.ok(screen.getByRole('columnheader', { name: 'Master Control' }))
    for (const header of ['Priority', 'VIP Tiers', 'Bet Settings', 'Actions']) {
      assert.equal(screen.queryByRole('columnheader', { name: header }), null, header)
    }
    assert.equal(screen.queryByRole('button', { name: 'Edit settings for Roulette Gold' }), null)
    assert.equal(screen.queryByRole('checkbox', { name: 'Select Roulette Gold' }), null)
    assert.equal(screen.queryByRole('button', { name: 'Reorder Roulette Gold' }), null)
    assert.equal(screen.getAllByText('ACTIVE').length, 3, 'the platform flag is the status')
    assert.equal(calls('GameVipTiers').length, 0, 'no per-game VIP lookups')
  })

  test('refuses a minimum above the maximum on the bet form and sends nothing', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Edit settings for Roulette Gold' }))
    const drawer = await screen.findByRole('dialog', { name: /Edit Game Settings - Roulette Gold/ })
    fireEvent.click(within(drawer).getByRole('tab', { name: 'Bet Settings' }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Expand' }))
    await within(drawer).findByText('Configured Settings')
    const minimum = within(drawer).getByRole('textbox', { name: 'Minimum' })
    fireEvent.focus(minimum)
    fireEvent.change(minimum, { target: { value: '500' } })
    fireEvent.blur(minimum)
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add Setting' }))
    await within(drawer).findByText('Minimum cannot be above the maximum')
    assert.equal(calls('UpsertCasinoGameBetSettings').length, 0)
  })

  test('denies before starting casino queries', async () => {
    guard.allowed = false
    renderPage()
    assert.ok(screen.getByRole('alert'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(calls('CasinoApiProviders').length, 0)
    assert.equal(calls('CasinoGames').length, 0)
  })

  test('keeps category enums and switches to the exact paged single-category query', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Casino' }))
    await waitFor(() => assert.ok(calls('CasinoGames').some((call) => {
      const input = call.variables.input as Record<string, unknown>
      return input.category === 'CASINO' && input.pageSize === 20
    })))
    const call = [...calls('CasinoGames')].reverse().find((entry) => {
      const input = entry.variables.input as Record<string, unknown>
      return input.category === 'CASINO' && input.pageSize === 20
    })
    assert.deepEqual(call?.variables, {
      input: { providerId: 'p1', category: 'CASINO', page: 1, pageSize: 20 },
    })
  })

  test('clear all resets the scope filters but keeps the default provider and the category', async () => {
    await renderLoaded()
    const scope = screen.getByRole('search', { name: 'Scope filters' })
    assert.equal(within(scope).queryByRole('button', { name: 'Clear all' }), null)
    fireEvent.click(within(scope).getByRole('button', { name: 'Casino' }))
    fireEvent.change(within(scope).getByRole('combobox', { name: 'Status' }), { target: { value: 'inactive' } })
    assert.equal(useCasinoStore.getState().enabled, false)
    fireEvent.click(within(scope).getByRole('button', { name: 'Clear all' }))
    const state = useCasinoStore.getState()
    assert.equal(state.enabled, null)
    assert.equal(state.selectedProviderId, 'p1')
    assert.equal(state.selectedCategory, 'CASINO')
    assert.equal(within(scope).queryByRole('button', { name: 'Clear all' }), null)
  })

  test('debounces search and omits terms shorter than three characters', async () => {
    await renderLoaded()
    const search = screen.getByRole('searchbox', { name: 'Search games' })
    fireEvent.change(search, { target: { value: 'ro' } })
    await new Promise((resolve) => setTimeout(resolve, 550))
    assert.equal(calls('CasinoGames').some((call) => {
      const input = call.variables.input as Record<string, unknown>
      return input.search === 'ro'
    }), false)
    fireEvent.change(search, { target: { value: 'rou' } })
    await waitFor(() => assert.ok(calls('CasinoGames').some((call) => {
      const input = call.variables.input as Record<string, unknown>
      return input.search === 'rou'
    })), { timeout: 1500 })
  })

  test('a link naming a game (?search=) starts the box and the games query from it; a later link re-seeds it (DAS-SEARCH-SEEALL)', async () => {
    // The global search routes every casino game result, and its "See all", to /casino/management?search=<name>.
    function GameResult() {
      const navigate = useNavigate()
      return <button type="button" onClick={() => navigate('/casino/management?search=Aviator')}>Open the Aviator result</button>
    }
    renderPage('/casino/management?search=Roulette', <GameResult />)
    await screen.findByText('Roulette Gold')
    const box = screen.getByRole('searchbox', { name: 'Search games' }) as HTMLInputElement
    assert.equal(box.value, 'Roulette')
    assert.equal(useCasinoStore.getState().search, 'Roulette')
    // The first games query already carries the term: no unfiltered list first. (The statistics' one-row counts
    // are not the list, B002.)
    const listCalls = calls('CasinoGames').filter((call) => (call.variables.input as Record<string, unknown>).pageSize !== 1)
    assert.equal((listCalls[0]?.variables.input as Record<string, unknown>).search, 'Roulette')
    assert.equal(screen.queryByText('Poker Elite'), null)
    // A result opened while the page is open: the page stays mounted and takes the new term.
    fireEvent.click(screen.getByRole('button', { name: 'Open the Aviator result' }))
    await waitFor(() => assert.equal(box.value, 'Aviator'))
    await waitFor(() => assert.ok(calls('CasinoGames').some((call) => (call.variables.input as Record<string, unknown>).search === 'Aviator')), { timeout: 1500 })
    // A boolean, not the element: a failed assert.equal(element) formats the whole jsdom tree on every retry.
    await waitFor(() => assert.ok(!screen.queryByText('Roulette Gold'), 'the Roulette results are gone'))
  })

  test('selects a row and preserves both exact bulk access mutations and contexts', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Poker Elite' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update Settings' }))
    const drawer = await screen.findByRole('dialog', { name: 'Bulk Update Settings' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Set Premium' }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Update Settings' }))
    await waitFor(() => assert.equal(calls('BulkUpdateCasinoGameSettings').length, 2))
    assert.deepEqual(calls('BulkUpdateCasinoGameSettings').map((call) => call.variables), [
      { gameIds: ['poker'], enabled: false },
      { gameIds: ['poker'], premiumOnly: true },
    ])
    assert.ok(calls('BulkUpdateCasinoGameSettings').every((call) => call.context.skipNotification === true))
    await waitFor(() => assert.equal(calls('BulkUpdateVipTierGames').length, 1))
    assert.deepEqual(calls('BulkUpdateVipTierGames')[0].variables, {
      tierId: 'gold', gameIds: ['poker'], enabled: true,
    })
    assert.equal(calls('BulkUpdateVipTierGames')[0].context.skipNotification, true)
  })

  test('saves single access as two separate mutations and disables a removed VIP tier', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Edit settings for Roulette Gold' }))
    const drawer = await screen.findByRole('dialog', { name: /Edit Game Settings - Roulette Gold/ })
    const clearTiers = await within(drawer).findByRole('button', { name: 'Set as Available to All' })
    fireEvent.click(clearTiers)
    fireEvent.click(within(drawer).getByRole('button', { name: 'Apply Changes' }))
    await waitFor(() => assert.equal(calls('UpdateCasinoGameSettings').length, 2))
    assert.deepEqual(calls('UpdateCasinoGameSettings').map((call) => call.variables), [
      { gameId: 'roulette', enabled: true },
      { gameId: 'roulette', premiumOnly: false },
    ])
    assert.ok(calls('UpdateCasinoGameSettings').every((call) => call.context.skipNotification === true))
    await waitFor(() => assert.equal(calls('ToggleVipTierGameEnabled').length, 1))
    assert.deepEqual(calls('ToggleVipTierGameEnabled')[0].variables, {
      tierId: 'gold', gameId: 'roulette', enabled: false,
    })
  })

  test('toggles a game from grid view with the legacy notification mutation context', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Grid' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Poker Elite' }))
    await waitFor(() => assert.equal(calls('ToggleCasinoGameEnabled').length, 1))
    assert.deepEqual(calls('ToggleCasinoGameEnabled')[0].variables, { gameId: 'poker', enabled: true })
    assert.equal(calls('ToggleCasinoGameEnabled')[0].context.uiToast, 'notification')
  })

  test('opens the single-game bet tab and sends the all-player upsert variables unchanged', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Edit settings for Roulette Gold' }))
    const drawer = await screen.findByRole('dialog', { name: /Edit Game Settings - Roulette Gold/ })
    fireEvent.click(within(drawer).getByRole('tab', { name: 'Bet Settings' }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Expand' }))
    await within(drawer).findByText('Configured Settings')
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add Setting' }))
    await waitFor(() => assert.equal(calls('UpsertCasinoGameBetSettings').length, 1))
    assert.deepEqual(calls('UpsertCasinoGameBetSettings')[0].variables, {
      gameId: 'roulette',
      settings: { betEnabled: true, minStake: 10, maxStake: 100, maxWin: 1000 },
    })
  })

  /* B002: the cards read only with a provider, one category and a vendor all chosen, so the default All view said
     "Vendors 0 - None selected" and "Games 0 - 0 enabled, 0 disabled" over a full table of games. */
  function stat(label: string) {
    const name = within(screen.getByRole('group', { name: 'Casino statistics' })).getByText(label)
    return { value: name.nextElementSibling?.textContent ?? '', text: name.parentElement?.textContent ?? '' }
  }
  const countReads = () => calls('CasinoGames').filter((call) => (call.variables.input as Record<string, unknown>).pageSize === 1)

  test('the All view counts every vendor and game of the scope, with the enabled split', async () => {
    await renderLoaded()
    await waitFor(() => assert.equal(stat('Games').value, '3'))
    assert.ok(stat('Games').text.includes('2 enabled, 1 disabled'), stat('Games').text)
    assert.equal(stat('Vendors').value, '1')
    assert.ok(stat('Vendors').text.includes('None selected'), stat('Vendors').text)
    // Counted with one-row reads of the table's scope (the second through the Status filter), not loaded.
    assert.deepEqual(countReads().map((call) => call.variables), [
      { input: { providerId: 'p1', page: 1, pageSize: 1 } },
      { input: { providerId: 'p1', page: 1, pageSize: 1, enabled: true } },
    ])
  })

  test('a chosen category and vendor narrow the figures', async () => {
    useCasinoStore.setState({ selectedProviderId: 'p1', selectedCategory: 'CASINO', selectedVendorId: 'v1' })
    renderPage()
    await waitFor(() => assert.equal(stat('Games').value, '1'))
    assert.ok(stat('Games').text.includes('0 enabled, 1 disabled'), stat('Games').text)
    assert.ok(stat('Vendors').text.includes('1 selected'), stat('Vendors').text)
    assert.deepEqual(countReads().at(-1)?.variables, { input: { providerId: 'p1', category: 'CASINO', vendorId: 'v1', page: 1, pageSize: 1, enabled: true } })
    assert.ok(calls('CasinoVendors').some((call) => call.variables.providerId === 'p1' && call.variables.category === 'CASINO'))
  })

  test('core mode counts the platform flag', async () => {
    useUIStore.setState({ directorMode: 'core', selectedWhitelabelId: null })
    await renderLoaded()
    await waitFor(() => assert.equal(stat('Games').value, '3'))
    assert.ok(stat('Games').text.includes('3 active, 0 blocked'), stat('Games').text)
  })

  /* B002 review: the counts are reads of their own, so a game switched on in the table re-read the table alone and
     the card kept "2 enabled, 1 disabled". The card's old row-based figures followed the table's re-read. */
  test('switching a game re-reads the counts with the table', async () => {
    await renderLoaded()
    await waitFor(() => assert.ok(stat('Games').text.includes('2 enabled, 1 disabled'), stat('Games').text))
    const before = countReads().length
    fireEvent.click(screen.getByRole('button', { name: 'Grid' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Poker Elite' }))
    await waitFor(() => assert.ok(stat('Games').text.includes('3 enabled, 0 disabled'), stat('Games').text))
    assert.equal(countReads().length, before + 2, 'the total and the enabled count are each read once more')
  })

  test('a whitelabel admin, who picks no provider, gets its tenant\'s figures', async () => {
    useAuthStore.setState({ roles: ['Whitelabel Admin'] })
    await renderLoaded()
    await waitFor(() => assert.equal(stat('Games').value, '3'))
    assert.equal(stat('Vendors').value, '1')
    assert.ok(countReads().length >= 2 && countReads().every((call) => !('providerId' in (call.variables.input as Record<string, unknown>))))
  })

  test('tenant admins omit provider scope and never render master control', async () => {
    useAuthStore.setState({ roles: ['TENANT_ADMIN'] })
    await renderLoaded()
    assert.equal(screen.queryByRole('combobox', { name: 'API provider' }), null)
    assert.equal(screen.queryByRole('columnheader', { name: 'Master Control' }), null)
    const allCalls = calls('CasinoGames').filter((call) => !('category' in (call.variables.input as Record<string, unknown>)))
    assert.ok(allCalls.length >= 1)
    assert.ok(allCalls.every((call) => !('providerId' in (call.variables.input as Record<string, unknown>))))
  })
})
