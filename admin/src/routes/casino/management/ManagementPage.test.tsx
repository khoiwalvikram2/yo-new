import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, test, vi } from 'vitest'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { useAuthStore } from '@/shared/core/authStore'
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
      const input = variables.input as { category: string; search?: string }
      const row = input.category === 'LIVE_CASINO'
        ? game('roulette', 'Roulette Gold', input.category)
        : input.category === 'CASINO'
          ? game('poker', 'Poker Elite', input.category, false)
          : game('aviator', 'Aviator', input.category)
      const matches = !input.search || row.name.toLowerCase().includes(input.search.toLowerCase())
      return { data: { casinoGames: {
        __typename: 'CasinoGamesPage', total: matches ? 1 : 0, page: 1, pageSize: 10000,
        items: matches ? [row] : [],
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

function renderPage() {
  return render(
    <MockedProvider link={serverLink()} cache={undefined}>
      <MemoryRouter initialEntries={['/casino/management']}>
        <PageEyebrowProvider value="Trading">
          <ManagementPage />
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
  guard.allowed = true
  guard.calls = []
  feedback.success.mockReset()
  feedback.error.mockReset()
  feedback.warning.mockReset()
  feedback.info.mockReset()
  useAuthStore.setState({ roles: ['SUPER_ADMIN'] })
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
    const gameCalls = calls('CasinoGames').filter((call) => {
      const input = call.variables.input as Record<string, unknown> | undefined
      return input?.pageSize === 10000
    })
    assert.deepEqual(gameCalls.map((call) => (call.variables.input as Record<string, unknown>).category).sort(), [
      'CASINO', 'LIVE_CASINO', 'SLOTS',
    ])
    assert.ok(gameCalls.every((call) => {
      const input = call.variables.input as Record<string, unknown>
      return input.providerId === 'p1' && input.page === 1 && input.pageSize === 10000
    }))
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

  test('tenant admins omit provider scope and never render master control', async () => {
    useAuthStore.setState({ roles: ['TENANT_ADMIN'] })
    await renderLoaded()
    assert.equal(screen.queryByRole('combobox', { name: 'API provider' }), null)
    assert.equal(screen.queryByRole('columnheader', { name: 'Master Control' }), null)
    const allCalls = calls('CasinoGames').filter((call) => {
      const input = call.variables.input as Record<string, unknown>
      return input.pageSize === 10000
    })
    assert.ok(allCalls.length >= 3)
    assert.ok(allCalls.every((call) => !('providerId' in (call.variables.input as Record<string, unknown>))))
  })
})
