import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import CategoriesManagementPage from './CategoriesManagementPage'

interface ServerCall {
  operationName: string
  variables: Record<string, unknown>
  context: Record<string, unknown>
}

interface CategoryRecord {
  id: string
  mainCategory: 'LIVE_CASINO' | 'CASINO' | 'SLOTS'
  type: 'GENERAL' | 'TOP' | 'FEATURED' | 'LOUNGE'
  subtitle: string | null
  name: string
  slug: string
  iconData: string | null
  order: number | null
  isActive: boolean
  gameCount: number
}

const guard = vi.hoisted(() => ({
  allowed: true,
  calls: [] as Array<Array<{ domain: string; actions: string[] }>>,
}))
const feedback = vi.hoisted(() => ({ toast: vi.fn() }))
const confirmation = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }))

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

vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))

vi.mock('@/ui/components/confirm', () => ({
  confirm: async (options: Record<string, unknown>) => {
    confirmation.calls.push(options)
    await (options.onConfirm as (() => Promise<void>) | undefined)?.()
    return true
  },
}))

interface ServerState {
  calls: ServerCall[]
  categories: CategoryRecord[]
  gamesByCategory: Record<string, string[]>
}

let server: ServerState

function category(id: string, patch: Partial<CategoryRecord> = {}): CategoryRecord {
  return {
    id,
    mainCategory: 'LIVE_CASINO',
    type: 'GENERAL',
    subtitle: null,
    name: `Category ${id}`,
    slug: `category-${id}`,
    iconData: null,
    order: 1,
    isActive: true,
    gameCount: 0,
    ...patch,
  }
}

function categoryPayload(row: CategoryRecord) {
  return {
    __typename: 'CasinoCategory',
    ...row,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }
}

function handle(operation: Operation): FetchResult {
  server.calls.push({
    operationName: operation.operationName,
    variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown>,
    context: operation.getContext() as Record<string, unknown>,
  })
  const variables = operation.variables as Record<string, unknown>

  switch (operation.operationName) {
    case 'CasinoCustomCategories': {
      const rows = server.categories.filter((row) => !variables.mainCategory || row.mainCategory === variables.mainCategory)
      return { data: { casinoCustomCategories: rows.map(categoryPayload) } }
    }
    case 'GamesInCategory':
      return { data: { gamesInCategory: server.gamesByCategory[String(variables.categoryId)] ?? [] } }
    case 'GamesByIds':
      return {
        data: {
          gamesByIds: (variables.gameIds as string[]).map((id) => ({
            __typename: 'CasinoGame',
            id,
            name: id === 'g1' ? 'Roulette Gold' : 'Blackjack Live',
            slug: id,
            mainCategory: 'LIVE_CASINO',
            vendorId: 'vendor-1',
            vendorName: 'Evolution',
            thumbnailUrl: null,
            rtp: null,
            demoUrl: null,
            isActive: true,
            tenantEnabled: id !== 'g2',
            premiumOnly: false,
            order: 1,
            featured: false,
            categoryAssigned: true,
            limits: null,
            updatedAt: '2026-10-01T00:00:00.000Z',
          })),
        },
      }
    case 'CreateCasinoCategory': {
      const input = variables.input as Omit<CategoryRecord, 'id' | 'order' | 'gameCount'>
      const created = category('created', { ...input, order: server.categories.length + 1, gameCount: 0 })
      server.categories = [...server.categories, created]
      return { data: { createCasinoCategory: categoryPayload(created) } }
    }
    case 'UpdateCasinoCategory': {
      const input = variables.input as Partial<CategoryRecord>
      server.categories = server.categories.map((row) => row.id === variables.id ? { ...row, ...input } : row)
      const updated = server.categories.find((row) => row.id === variables.id)
      return { data: { updateCasinoCategory: updated ? categoryPayload(updated) : null } }
    }
    case 'DeleteCasinoCategory':
      server.categories = server.categories.filter((row) => row.id !== variables.id)
      return { data: { deleteCasinoCategory: true } }
    case 'ReorderCasinoCategories':
      return { data: { reorderCasinoCategories: { __typename: 'MutationResponse', success: true, message: 'ok' } } }
    case 'ReorderCategoryGames':
      server.gamesByCategory[String(variables.categoryId)] = variables.gameIds as string[]
      return { data: { reorderCategoryGames: { __typename: 'MutationResponse', success: true, message: 'ok' } } }
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
      } catch (error) {
        observer.error(error)
      }
    })
  }))
}

function calls(operationName: string) {
  return server.calls.filter((call) => call.operationName === operationName)
}

function renderPage() {
  return render(
    <MockedProvider link={serverLink()} cache={undefined}>
      <MemoryRouter initialEntries={['/casino/categories']}>
        <PageEyebrowProvider value="Casino">
          <Routes>
            <Route path="/casino/categories" element={<CategoriesManagementPage />} />
            <Route path="/casino/categories/:categoryId/add-games" element={<div>Assign games route</div>} />
          </Routes>
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

beforeEach(() => {
  server = {
    calls: [],
    categories: [
      category('general', { name: 'Classic Tables', slug: 'classic-tables', order: 1, isActive: false }),
      category('vip', {
        name: 'VIP Live',
        slug: 'vip-live',
        subtitle: 'Premium tables',
        type: 'FEATURED',
        order: 2,
        gameCount: 2,
      }),
      category('slots', {
        mainCategory: 'SLOTS',
        name: 'Hot Slots',
        slug: 'hot-slots',
        type: 'TOP',
      }),
    ],
    gamesByCategory: { vip: ['g1', 'g2'] },
  }
  guard.allowed = true
  guard.calls = []
  feedback.toast.mockReset()
  confirmation.calls = []
})

describe('/casino/categories', () => {
  test('uses the exact RBAC requirement and renders the page, stats and ordered categories', async () => {
    renderPage()
    assert.ok(await screen.findByRole('heading', { name: 'Casino Categories', level: 1 }))
    assert.ok(screen.getAllByText('Casino').length >= 1)
    assert.deepEqual(guard.calls[0], [{ domain: 'casino.categories', actions: ['view'] }])
    assert.ok(screen.getByText('2 categories · Click a category to see its games'))
    assert.ok(screen.getByText('Classic Tables'))
    assert.ok(screen.getByText('VIP Live'))
    assert.ok(screen.getByText('50%'))
    const listCalls = calls('CasinoCustomCategories')
    assert.ok(listCalls.length >= 1)
    assert.ok(listCalls.every((call) => call.variables.mainCategory === 'LIVE_CASINO'))
  })

  test('denies the page before any category query', () => {
    guard.allowed = false
    renderPage()
    assert.ok(screen.getByRole('alert'))
    assert.ok(screen.getByText('Access denied'))
    assert.equal(calls('CasinoCustomCategories').length, 0)
  })

  test('changes main category and type filter without changing their enum values', async () => {
    renderPage()
    await screen.findByText('VIP Live')
    fireEvent.click(screen.getByRole('button', { name: 'Slots' }))
    assert.ok(await screen.findByText('Hot Slots'))
    await waitFor(() => assert.ok(calls('CasinoCustomCategories').some((call) => call.variables.mainCategory === 'SLOTS')))

    fireEvent.click(screen.getByRole('button', { name: 'General' }))
    assert.ok(await screen.findByText('No categories found'))
  })

  test('clear all returns both category filters to their defaults', async () => {
    renderPage()
    await screen.findByText('VIP Live')
    const filters = screen.getByRole('search', { name: 'Category filters' })
    assert.equal(within(filters).queryByRole('button', { name: 'Clear all' }), null)
    fireEvent.click(within(filters).getByRole('button', { name: 'Slots' }))
    fireEvent.click(within(filters).getByRole('button', { name: 'General' }))
    fireEvent.click(within(filters).getByRole('button', { name: 'Clear all' }))
    assert.equal(within(filters).getByRole('button', { name: 'Live Casino' }).getAttribute('aria-pressed'), 'true')
    assert.equal(within(filters).getByRole('button', { name: 'All' }).getAttribute('aria-pressed'), 'true')
    assert.ok(await screen.findByText('VIP Live'))
  })

  test('filters Casino lounge categories and opens their game assignment', async () => {
    server.categories.push(category('lounge', {
      mainCategory: 'CASINO', type: 'LOUNGE', name: 'Casino lounge', slug: 'casino-lounge',
    }))
    renderPage()
    await screen.findByText('VIP Live')
    const filters = screen.getByRole('search', { name: 'Category filters' })
    fireEvent.click(within(filters).getByRole('button', { name: 'Casino' }))
    fireEvent.click(within(filters).getByRole('button', { name: 'Casino lounge' }))
    assert.ok(await screen.findByRole('button', { name: 'Add games to Casino lounge' }))
    assert.equal(screen.queryByText('VIP Live'), null)
    fireEvent.click(screen.getByRole('button', { name: 'Add games to Casino lounge' }))
    assert.ok(await screen.findByText('Assign games route'))
  })

  test('expands a category, fetches its ids and games and retains status text', async () => {
    renderPage()
    const toggle = await screen.findByRole('button', { name: 'VIP Live' })
    fireEvent.click(toggle)
    assert.ok(await screen.findByText('Roulette Gold'))
    assert.ok(screen.getByText('Blackjack Live'))
    assert.ok(screen.getByText('Disabled'))
    assert.deepEqual(calls('GamesInCategory').at(-1)?.variables, { categoryId: 'vip' })
    assert.deepEqual(calls('GamesByIds').at(-1)?.variables, {
      gameIds: ['g1', 'g2'],
      skipVendorFilter: true,
    })
  })

  test('navigates to the category game assignment route', async () => {
    renderPage()
    await screen.findByText('VIP Live')
    fireEvent.click(screen.getByRole('button', { name: 'Add games to VIP Live' }))
    assert.ok(await screen.findByText('Assign games route'))
  })

  test('toggles active with the legacy mutation context', async () => {
    renderPage()
    await screen.findByText('VIP Live')
    fireEvent.click(screen.getByRole('switch', { name: 'Set VIP Live inactive' }))
    await waitFor(() => assert.ok(calls('UpdateCasinoCategory').length > 0))
    const call = calls('UpdateCasinoCategory')[0]
    assert.deepEqual(call?.variables, { id: 'vip', input: { isActive: false } })
    assert.equal(call?.context.uiToast, 'notification')
  })

  test('confirms and deletes with the exact destructive copy', async () => {
    renderPage()
    await screen.findByText('VIP Live')
    fireEvent.click(screen.getByRole('button', { name: 'Delete VIP Live' }))
    await waitFor(() => assert.equal(calls('DeleteCasinoCategory').length, 1))
    assert.equal(confirmation.calls[0]?.title, 'Delete category?')
    assert.equal(confirmation.calls[0]?.confirmLabel, 'Delete')
    assert.equal(confirmation.calls[0]?.tone, 'danger')
    assert.deepEqual(calls('DeleteCasinoCategory')[0]?.variables, { id: 'vip' })
    assert.equal(calls('DeleteCasinoCategory')[0]?.context.uiToast, 'notification')
  })

  test('creates a category, refetches the list and shows the legacy success copy', async () => {
    renderPage()
    await screen.findByText('VIP Live')
    fireEvent.click(screen.getByRole('button', { name: 'Create Category' }))
    fireEvent.change(screen.getByPlaceholderText('Category name'), { target: { value: 'New Lobby' } })
    fireEvent.change(screen.getByPlaceholderText('unique-slug'), { target: { value: 'new-lobby' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Category' }))

    await waitFor(() => assert.equal(calls('CreateCasinoCategory').length, 1))
    const call = calls('CreateCasinoCategory')[0]
    assert.deepEqual(call?.variables, {
      input: {
        mainCategory: 'LIVE_CASINO',
        type: 'GENERAL',
        name: 'New Lobby',
        slug: 'new-lobby',
        isActive: true,
      },
    })
    assert.equal(call?.context.skipNotification, true)
    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.equal(feedback.toast.mock.calls[0]?.[0].title, 'Category Created')
  })

  test('edits a category and sends the exact update patch', async () => {
    renderPage()
    await screen.findByText('VIP Live')
    fireEvent.click(screen.getByRole('button', { name: 'Edit VIP Live' }))
    assert.ok(await screen.findByRole('heading', { name: 'Edit Category - VIP Live' }))
    fireEvent.change(screen.getByPlaceholderText('Category name'), { target: { value: 'VIP Elite' } })
    fireEvent.change(screen.getByPlaceholderText('unique-slug'), { target: { value: 'vip-elite' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => assert.ok(calls('UpdateCasinoCategory').some((call) => call.variables.id === 'vip')))
    const call = calls('UpdateCasinoCategory').find((entry) => entry.variables.id === 'vip')
    assert.deepEqual(call?.variables, {
      id: 'vip',
      input: {
        mainCategory: 'LIVE_CASINO',
        name: 'VIP Elite',
        slug: 'vip-elite',
        subtitle: 'Premium tables',
        isActive: true,
        type: 'FEATURED',
      },
    })
    assert.equal(call?.context.skipNotification, true)
    await waitFor(() => assert.equal(feedback.toast.mock.calls.at(-1)?.[0].title, 'Category Updated'))
  })

  test('clearing the subtitle sends null, so the update clears it', async () => {
    // The emptied field used to be left out of the patch: "Category Updated", and the old subtitle stayed.
    renderPage()
    await screen.findByText('VIP Live')
    fireEvent.click(screen.getByRole('button', { name: 'Edit VIP Live' }))
    assert.ok(await screen.findByRole('heading', { name: 'Edit Category - VIP Live' }))
    fireEvent.change(screen.getByPlaceholderText('Optional subtitle (max 200 chars)'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => assert.ok(calls('UpdateCasinoCategory').some((call) => call.variables.id === 'vip')))
    const call = calls('UpdateCasinoCategory').find((entry) => entry.variables.id === 'vip')
    assert.deepEqual(call?.variables, {
      id: 'vip',
      input: { mainCategory: 'LIVE_CASINO', name: 'VIP Live', slug: 'vip-live', subtitle: null, isActive: true, type: 'FEATURED' },
    })
  })

  test('renders the list empty state', async () => {
    server.categories = []
    renderPage()
    assert.ok(await screen.findByText('No categories found'))
    assert.ok(screen.getByText('Create your first category to get started.'))
  })
})
