import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { useAuthStore } from '@/shared/core/authStore'
import CategoryAddGamesPage from './CategoryAddGamesPage'

const imageCompression = vi.hoisted(() => ({ compress: vi.fn() }))
vi.mock('@/shared/utils/imageCompression', () => ({ compressImageToDataUrl: imageCompression.compress }))

interface Call {
  operationName: string
  variables: Record<string, unknown>
  context: Record<string, unknown>
}

const guard = vi.hoisted(() => ({
  allowed: true,
  calls: [] as Array<Array<{ domain: string; actions: string[] }>>,
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

let calls: Call[]
let assigned: string[]
let categoryType: 'FEATURED' | 'LOUNGE'
let loungeImages: Record<string, string | null>
let imagesUnavailable: boolean
let saveFailure: string | null
const customImage = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4IAYAAAAvAAAAAA=='

const games = [
  {
    __typename: 'CasinoGame',
    id: 'g1',
    name: 'Roulette Gold',
    slug: 'roulette-gold',
    mainCategory: 'LIVE_CASINO',
    vendorId: 'v1',
    vendorName: 'Evolution',
    thumbnailUrl: null,
    rtp: 97.3,
    demoUrl: null,
    betSettingsCount: 0,
    isActive: true,
    tenantEnabled: true,
    premiumOnly: false,
    order: 1,
    featured: true,
    categoryAssigned: true,
    limits: null,
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    __typename: 'CasinoGame',
    id: 'g2',
    name: 'Blackjack VIP',
    slug: 'blackjack-vip',
    mainCategory: 'LIVE_CASINO',
    vendorId: 'v2',
    vendorName: 'Pragmatic Play',
    thumbnailUrl: null,
    rtp: 96.1,
    demoUrl: null,
    betSettingsCount: 0,
    isActive: true,
    tenantEnabled: false,
    premiumOnly: true,
    order: 2,
    featured: false,
    categoryAssigned: false,
    limits: null,
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
]

function response(operation: Operation): FetchResult {
  calls.push({
    operationName: operation.operationName,
    variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown>,
    context: operation.getContext() as Record<string, unknown>,
  })
  const variables = operation.variables as Record<string, unknown>
  switch (operation.operationName) {
    case 'CasinoCategory':
      return {
        data: {
          casinoCategory: {
            __typename: 'CasinoCategory',
            id: 'c1',
            mainCategory: 'LIVE_CASINO',
            type: categoryType,
            subtitle: 'Premium tables',
            name: 'VIP Live',
            slug: 'vip-live',
            iconData: null,
            order: 1,
            isActive: true,
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
          },
        },
      }
    case 'CasinoApiProviders':
      return { data: { casinoApiProviders: [{ __typename: 'CasinoApiProvider', id: 'p1', key: 'p1', name: 'Provider One', status: 'ACTIVE', lastSyncAt: null }] } }
    case 'GamesInCategory':
      return { data: { gamesInCategory: [...assigned] } }
    case 'CasinoLoungeGameImages':
      if (imagesUnavailable) throw new Error('Images offline')
      return { data: { casinoLoungeGameImages: assigned.map(gameId => ({ __typename: 'CasinoLoungeGameImage', gameId, imageData: loungeImages[gameId] ?? null })) } }
    case 'SaveCasinoLoungeGames': {
      if (saveFailure) return { data: { saveCasinoLoungeGames: { __typename: 'MutationResult', success: false, message: saveFailure } } }
      assigned = [...variables.gameIds as string[]]
      for (const image of variables.images as Array<{ gameId: string; imageData: string | null }>) loungeImages[image.gameId] = image.imageData
      return { data: { saveCasinoLoungeGames: { __typename: 'MutationResult', success: true, message: 'Saved Lounge' } } }
    }
    case 'CasinoVendors':
      return { data: { casinoVendors: [{ __typename: 'CasinoVendor', id: 'v1', name: 'Evolution', slug: 'evolution' }, { __typename: 'CasinoVendor', id: 'v2', name: 'Pragmatic Play', slug: 'pragmatic' }] } }
    case 'CasinoGames': {
      const input = variables.input as { enabled?: boolean; vendorId?: string; search?: string }
      let items = [...games]
      if (input.enabled !== undefined) items = items.filter((game) => game.tenantEnabled === input.enabled)
      if (input.vendorId) items = items.filter((game) => game.vendorId === input.vendorId)
      if (input.search) items = items.filter((game) => game.name.toLowerCase().includes(input.search!.toLowerCase()))
      return { data: { casinoGames: { __typename: 'CasinoGamesResult', total: items.length, page: 1, pageSize: 50, items } } }
    }
    case 'GamesByIds':
      return { data: { gamesByIds: games.filter((game) => (variables.gameIds as string[]).includes(game.id)) } }
    case 'RemoveGamesFromCategory':
      assigned = assigned.filter((id) => !(variables.gameIds as string[]).includes(id))
      return { data: { removeGamesFromCategory: { __typename: 'MutationResponse', success: true, message: 'removed' } } }
    case 'AssignGamesToCategory':
      assigned = [...new Set([...assigned, ...(variables.gameIds as string[])])]
      return { data: { assignGamesToCategory: { __typename: 'MutationResponse', success: true, message: 'assigned' } } }
    case 'CasinoCustomCategories':
      return { data: { casinoCustomCategories: [] } }
    default:
      throw new Error(`Unexpected operation ${operation.operationName}`)
  }
}

function serverLink() {
  return new ApolloLink((operation) => new Observable((observer) => {
    queueMicrotask(() => {
      try {
        observer.next(response(operation))
        observer.complete()
      } catch (error) {
        observer.error(error)
      }
    })
  }))
}

function operationCalls(name: string) {
  return calls.filter((call) => call.operationName === name)
}

function renderPage() {
  return render(
    <MockedProvider link={serverLink()} cache={undefined}>
      <MemoryRouter initialEntries={['/casino/categories/c1/add-games']}>
        <PageEyebrowProvider value="Trading">
          <Routes>
            <Route path="/casino/categories/:categoryId/add-games" element={<CategoryAddGamesPage />} />
            <Route path="/casino/categories" element={<div>Categories route</div>} />
          </Routes>
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

async function openLoungeImage(name: string) {
  const button = await screen.findByRole('button', { name })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(button)
}

async function customImagePreview() {
  const button = await screen.findByRole('button', { name: 'Open preview: Custom Lounge image preview' })
  return button.querySelector('img') as HTMLImageElement
}

beforeEach(() => {
  calls = []
  assigned = ['g1']
  categoryType = 'FEATURED'
  loungeImages = {}
  imagesUnavailable = false
  saveFailure = null
  imageCompression.compress.mockReset().mockResolvedValue(customImage)
  guard.allowed = true
  guard.calls = []
  useAuthStore.setState({ roles: ['Super Admin'], permissions: [] })
  class Observer {
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() { return [] }
    readonly root = null
    readonly rootMargin = '0px'
    readonly thresholds = [0]
  }
  vi.stubGlobal('IntersectionObserver', Observer)
})

describe('/casino/categories/:categoryId/add-games', () => {
  test('uses the exact RBAC contract and renders category, statistics and games', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'VIP Live' })).toBeTruthy()
    expect(screen.getByText('LIVE CASINO')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove Roulette Gold' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Select Blackjack VIP' })).toBeTruthy()
    expect(guard.calls[0]).toEqual([{ domain: 'casino.categories', actions: ['view', 'update'] }])
  })

  test('denies before starting any GraphQL operation', () => {
    guard.allowed = false
    renderPage()
    expect(screen.getByRole('alert').textContent).toContain('Access denied')
    expect(calls).toHaveLength(0)
  })

  test('auto-selects the first provider for non-whitelabel admins', async () => {
    useAuthStore.setState({ roles: ['Operations Admin'] })
    renderPage()
    await screen.findByRole('button', { name: 'Remove Roulette Gold' })
    await waitFor(() => {
      const latest = operationCalls('CasinoGames').at(-1)
      expect(latest?.variables).toEqual({
        input: expect.objectContaining({ providerId: 'p1', category: 'LIVE_CASINO', page: 1, pageSize: 50 }),
      })
    })
    expect(operationCalls('CasinoVendors').at(-1)?.variables).toEqual({ providerId: 'p1', category: 'LIVE_CASINO' })
  })

  test('omits provider filtering for whitelabel admins', async () => {
    useAuthStore.setState({ roles: ['Whitelabel Admin'] })
    renderPage()
    await screen.findByRole('button', { name: 'Remove Roulette Gold' })
    expect(operationCalls('CasinoGames')[0]?.variables).toEqual({
      input: expect.not.objectContaining({ providerId: expect.anything() }),
    })
  })

  test('removes and adds only the changed games with legacy mutation context', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Roulette Gold' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select Blackjack VIP' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Save Changes' })[0])
    await waitFor(() => expect(operationCalls('AssignGamesToCategory')).toHaveLength(1))
    expect(operationCalls('RemoveGamesFromCategory')[0]).toEqual(expect.objectContaining({
      variables: { categoryId: 'c1', gameIds: ['g1'] },
      context: expect.objectContaining({ uiToast: 'notification' }),
    }))
    expect(operationCalls('AssignGamesToCategory')[0]).toEqual(expect.objectContaining({
      variables: { categoryId: 'c1', gameIds: ['g2'] },
      context: expect.objectContaining({ uiToast: 'notification' }),
    }))
    await waitFor(() => expect(operationCalls('GamesInCategory').length).toBeGreaterThan(1))
  })

  test('sends the vendor and enabled filters through the catalog query', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Remove Roulette Gold' })
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'v2' } })
    await waitFor(() => expect(operationCalls('CasinoGames').some((call) => (
      (call.variables.input as { vendorId?: string }).vendorId === 'v2'
    ))).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Disabled' }))
    await waitFor(() => expect(operationCalls('CasinoGames').some((call) => (
      (call.variables.input as { enabled?: boolean }).enabled === false
    ))).toBe(true))
  })

  test('supports selected-only filtering from fetched persistent details', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Remove Roulette Gold' })
    fireEvent.click(screen.getByRole('button', { name: 'Selected' }))
    expect(screen.getByRole('button', { name: 'Remove Roulette Gold' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Select Blackjack VIP' })).toBeNull()
  })

  test('switches to list view and keeps keyboard selection semantics', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Select Blackjack VIP' })
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select Blackjack VIP' }))
    expect(screen.getByRole('button', { name: 'Remove Blackjack VIP' }).getAttribute('aria-pressed')).toBe('true')
  })

  test('clears all visible filters and restores both games', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Select Blackjack VIP' })
    fireEvent.click(screen.getByRole('button', { name: 'Premium' }))
    expect(screen.queryByRole('button', { name: 'Remove Roulette Gold' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(await screen.findByRole('button', { name: 'Remove Roulette Gold' })).toBeTruthy()
  })

  test('returns to the categories route', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
    expect(await screen.findByText('Categories route')).toBeTruthy()
  })

  test('keeps image uploading exclusive to Lounge categories', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Remove Roulette Gold' })
    expect(screen.queryByRole('button', { name: /Upload image|Replace image/ })).toBeNull()
    expect(operationCalls('CasinoLoungeGameImages')).toHaveLength(0)
  })

  test('uploads a Base64 Lounge image and atomically saves it with selected games', async () => {
    categoryType = 'LOUNGE'
    renderPage()
    await openLoungeImage('Upload image for Roulette Gold')
    const file = new File(['image'], 'lounge.png', { type: 'image/png' })
    fireEvent.change(await screen.findByLabelText('Lounge image for Roulette Gold'), { target: { files: [file] } })
    expect(await customImagePreview()).toHaveProperty('src', customImage)
    expect(imageCompression.compress).toHaveBeenCalledWith(file, 'casinoLounge')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Save Changes' })[0])
    await waitFor(() => expect(operationCalls('SaveCasinoLoungeGames')).toHaveLength(1))
    expect(operationCalls('SaveCasinoLoungeGames')[0].variables).toEqual({
      categoryId: 'c1', gameIds: ['g1'], images: [{ gameId: 'g1', imageData: customImage }],
    })
    expect(operationCalls('AssignGamesToCategory')).toHaveLength(0)
    expect(operationCalls('RemoveGamesFromCategory')).toHaveLength(0)
    await waitFor(() => expect(operationCalls('CasinoLoungeGameImages').length).toBeGreaterThan(1))
    expect(await screen.findByRole('button', { name: 'Replace image for Roulette Gold' })).toBeTruthy()
  })

  test('loads a saved image, replaces it, and can reset it to the game original', async () => {
    categoryType = 'LOUNGE'
    loungeImages.g1 = customImage
    const replacement = customImage + 'replacement'
    imageCompression.compress.mockResolvedValue(replacement)
    renderPage()
    await openLoungeImage('Replace image for Roulette Gold')
    expect((await customImagePreview()).src).toBe(customImage)
    fireEvent.change(screen.getByLabelText('Lounge image for Roulette Gold'), { target: { files: [new File(['new'], 'new.jpg', { type: 'image/jpeg' })] } })
    await waitFor(async () => expect((await customImagePreview()).src).toBe(replacement))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use original image for Roulette Gold' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Save Changes' })[0])
    await waitFor(() => expect(operationCalls('SaveCasinoLoungeGames')).toHaveLength(1))
    expect(operationCalls('SaveCasinoLoungeGames')[0].variables.images).toEqual([{ gameId: 'g1', imageData: null }])
  })

  test('uploads for a newly selected game and preserves its image draft after a save failure', async () => {
    categoryType = 'LOUNGE'
    saveFailure = 'Changes rejected'
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Select Blackjack VIP' }))
    await openLoungeImage('Upload image for Blackjack VIP')
    fireEvent.change(await screen.findByLabelText('Lounge image for Blackjack VIP'), { target: { files: [new File(['new'], 'new.webp', { type: 'image/webp' })] } })
    await customImagePreview()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Save Changes' })[0])
    expect(await screen.findByText('Changes rejected')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Replace image for Blackjack VIP' })).toBeTruthy()
    saveFailure = null
    fireEvent.click(screen.getAllByRole('button', { name: 'Save Changes' })[0])
    await waitFor(() => expect(operationCalls('SaveCasinoLoungeGames')).toHaveLength(2))
    expect(operationCalls('SaveCasinoLoungeGames')[1].variables).toEqual({
      categoryId: 'c1', gameIds: ['g1', 'g2'], images: [{ gameId: 'g2', imageData: customImage }],
    })
  })

  test('keeps the existing image after image processing fails and rejects SVG uploads', async () => {
    categoryType = 'LOUNGE'
    loungeImages.g1 = customImage
    imageCompression.compress.mockRejectedValue(new Error('Unreadable image'))
    renderPage()
    await openLoungeImage('Replace image for Roulette Gold')
    const input = await screen.findByLabelText('Lounge image for Roulette Gold')
    fireEvent.change(input, { target: { files: [new File(['bad'], 'bad.png', { type: 'image/png' })] } })
    expect(await screen.findByText('Unreadable image')).toBeTruthy()
    expect((await customImagePreview()).src).toBe(customImage)
    imageCompression.compress.mockClear()
    fireEvent.change(input, { target: { files: [new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' })] } })
    expect(imageCompression.compress).not.toHaveBeenCalled()
  })

  test('blocks saving when saved images cannot load, retries them, and permits clearing all Lounge games', async () => {
    categoryType = 'LOUNGE'
    imagesUnavailable = true
    renderPage()
    expect(await screen.findByText('Lounge images unavailable')).toBeTruthy()
    expect((screen.getAllByRole('button', { name: 'Save Changes' })[0] as HTMLButtonElement).disabled).toBe(true)
    imagesUnavailable = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry images' }))
    await waitFor(() => expect((screen.getAllByRole('button', { name: 'Save Changes' })[0] as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Clear all selected games' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Save Changes' })[0])
    await waitFor(() => expect(operationCalls('SaveCasinoLoungeGames')).toHaveLength(1))
    expect(operationCalls('SaveCasinoLoungeGames')[0].variables).toEqual({ categoryId: 'c1', gameIds: [], images: [] })
  })

  test('blocks saving while an upload is pending and discards completion after its editor is closed', async () => {
    categoryType = 'LOUNGE'
    let finishUpload!: (value: string) => void
    imageCompression.compress.mockImplementation(() => new Promise<string>(resolve => { finishUpload = resolve }))
    renderPage()
    await openLoungeImage('Upload image for Roulette Gold')
    fireEvent.change(await screen.findByLabelText('Lounge image for Roulette Gold'), { target: { files: [new File(['new'], 'new.png', { type: 'image/png' })] } })
    const saveButtons = [...document.querySelectorAll('button')].filter(button => button.textContent?.includes('Save Changes'))
    expect(saveButtons.length).toBeGreaterThan(0)
    expect(saveButtons.every(button => button.disabled)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await act(async () => { finishUpload(customImage) })
    expect(screen.queryByRole('button', { name: 'Replace image for Roulette Gold' })).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Save Changes' })[0])
    await waitFor(() => expect(operationCalls('SaveCasinoLoungeGames')).toHaveLength(1))
    expect(operationCalls('SaveCasinoLoungeGames')[0].variables.images).toEqual([])
  })
})
