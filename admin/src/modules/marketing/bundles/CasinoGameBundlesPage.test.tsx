import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import type { DocumentNode } from 'graphql'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { GAMES_BY_IDS } from '@/lib/graphql/casino'
import { MATKAS_BY_IDS } from '@/lib/graphql/matka'
import type { ConfirmOptions } from '@/ui/components/confirm'
import CasinoGameBundlesPage, { BundleGamesList } from './CasinoGameBundlesPage'

const mocks = vi.hoisted(() => ({
  allowed: true, query: vi.fn(), mutation: vi.fn(), refetch: vi.fn(), confirm: vi.fn(), toast: vi.fn(), failure: false,
  games: Array.from({ length: 12 }, (_, index) => ({ id: String(index + 1), name: `Game ${index + 1}`, slug: `game-${index + 1}`, isActive: true, tenantEnabled: true, vendorName: 'Provider' })),
  markets: [{ id: 'market-1', name: 'Morning Market', code: 'MORNING', status: 'ACTIVE' }],
}))
vi.mock('@apollo/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@apollo/client')>(),
  useQuery: (document: DocumentNode, options: { variables?: { domain?: string }; skip?: boolean }) => {
    mocks.query(document, options)
    return { data: options.skip ? undefined : document === GAMES_BY_IDS ? { gamesByIds: mocks.games } : document === MATKAS_BY_IDS ? { matkasByIds: mocks.markets } :
      { casinoGameBundles: [{ id: 'bundle-1', name: 'Starter bundle', domain: options.variables?.domain || 'casino', gameIds: options.variables?.domain === 'matka' ? ['market-1'] : ['1', '2'], gameCount: 2, gameWeights: { '1': 0 } }] }, loading: false, refetch: mocks.refetch }
  },
  useMutation: (document: DocumentNode, callbacks: { onCompleted: (data: unknown) => void }) => [async (options: unknown) => {
    mocks.mutation(document, options)
    const operation = document.definitions.find((definition) => definition.kind === 'OperationDefinition')
    const update = operation?.kind === 'OperationDefinition' && operation.name?.value === 'UpdateCasinoGameBundle'
    const data = { [update ? 'updateCasinoGameBundle' : 'deleteCasinoGameBundle']: { success: !mocks.failure, message: mocks.failure ? 'Operation refused' : 'Done' } }
    callbacks.onCompleted(data); return { data }
  }, { loading: false }],
}))
vi.mock('@/shared/core/RBACGuard', () => ({ RBACGuard: ({ children }: { children: ReactNode }) => mocks.allowed ? children : <div>Access denied</div> }))
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDate: (value: string) => value }) }))
vi.mock('@/ui/components/confirm', () => ({ confirm: mocks.confirm }))
vi.mock('@/ui/components/toast', () => ({ toast: mocks.toast }))
beforeEach(() => { vi.clearAllMocks(); mocks.allowed = true; mocks.failure = false })
afterEach(cleanup)
function page() { return render(<MemoryRouter><PageEyebrowProvider value="Bonuses"><CasinoGameBundlesPage /></PageEyebrowProvider></MemoryRouter>) }
describe('bundle list and saved weights', () => {
  test('retains domain/search policies, create/edit links, lazy expansion and casino vendor bypass', () => {
    page()
    assert.equal(screen.getByRole('link', { name: 'Create Bundle' }).getAttribute('href'), '/bonuses/bundles/new')
    assert.ok(mocks.query.mock.calls.some(([, options]) => options.variables?.domain === 'casino' && options.fetchPolicy === 'cache-and-network'))
    assert.ok(mocks.query.mock.calls.some(([document, options]) => document === GAMES_BY_IDS && options.skip === true))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search bundles' }), { target: { value: ' starter ' } })
    assert.ok(mocks.query.mock.calls.some(([, options]) => options.variables?.search === 'starter'))
    fireEvent.click(screen.getByRole('button', { name: 'Starter bundle' }))
    assert.ok(mocks.query.mock.calls.some(([document, options]) => document === GAMES_BY_IDS && options.skip === false && options.variables.skipVendorFilter === true))
    assert.equal(screen.getByRole('link', { name: 'Edit Starter bundle' }).getAttribute('href'), '/bonuses/bundles/bundle-1/edit')
  })
  test('casino zero weight is not dirty, editing saves the complete numeric map and refetches', async () => {
    render(<BundleGamesList gameIds={['1', '2']} domain="casino" bundleId="b1" gameWeights={{ '1': 0 }} onWeightsUpdate={mocks.refetch} />)
    await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Save Weights' }).getAttribute('aria-disabled'), 'true'))
    fireEvent.change(screen.getByLabelText('Weight for Game 1'), { target: { value: '0.25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Weights' }))
    await waitFor(() => assert.equal(mocks.mutation.mock.calls.length, 1))
    const options = mocks.mutation.mock.calls[0][1]
    assert.equal(options.variables.id, 'b1'); assert.equal(options.variables.input.gameWeights['1'], 0.25)
    assert.equal(options.variables.input.gameWeights['2'], 1); assert.equal(Object.keys(options.variables.input.gameWeights).length, 12)
    assert.equal(mocks.refetch.mock.calls.length, 1)
  })
  test('paging keeps a ten-item default, all-item selection and read-only embedded weights', () => {
    render(<BundleGamesList gameIds={['1', '2']} domain="casino" />)
    assert.equal(screen.queryByText('Game 11'), null)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all games' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    assert.ok(screen.getByText('Game 11')); assert.equal((screen.getByRole('checkbox', { name: 'Select Game 11' }) as HTMLInputElement).checked, true)
    assert.equal((screen.getByLabelText('Weight for Game 11') as HTMLInputElement).disabled, true)
  })
  test('matka expansion uses UUID query variables and a collapsed list skips both requests', () => {
    const first = render(<BundleGamesList gameIds={['market-1']} domain="matka" bundleId="m1" />)
    assert.ok(screen.getByText('Morning Market'))
    assert.ok(mocks.query.mock.calls.some(([document, options]) => document === MATKAS_BY_IDS && options.variables.matkaIds[0] === 'market-1' && options.fetchPolicy === 'network-only'))
    first.unmount(); mocks.query.mockClear(); render(<BundleGamesList gameIds={['1']} domain="casino" isExpanded={false} />)
    assert.ok(mocks.query.mock.calls.every(([, options]) => options.skip === true))
  })
  test('confirmed deletion retains id-only payload; refused weight saves do not refetch', async () => {
    page(); fireEvent.click(screen.getByRole('button', { name: 'Delete Starter bundle' }))
    const options = mocks.confirm.mock.calls[0][0] as ConfirmOptions
    assert.equal(options.title, 'Delete bundle?'); assert.equal(options.confirmLabel, 'Yes')
    await act(async () => { await options.onConfirm?.() })
    assert.deepEqual(mocks.mutation.mock.calls[0][1], { variables: { id: 'bundle-1' } })
    cleanup(); mocks.mutation.mockClear(); mocks.refetch.mockClear(); mocks.failure = true
    render(<BundleGamesList gameIds={['market-1']} domain="matka" bundleId="m1" />)
    fireEvent.change(screen.getByLabelText('Weight for Morning Market'), { target: { value: '0.2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Weights' }))
    await waitFor(() => assert.equal(mocks.toast.mock.calls.at(-1)?.[0].message, 'Operation refused'))
    assert.equal(mocks.refetch.mock.calls.length, 0)
  })
  test('denied callers perform no bundle or child queries', () => {
    mocks.allowed = false; page(); assert.ok(screen.getByText('Access denied')); assert.equal(mocks.query.mock.calls.length, 0)
  })
})
