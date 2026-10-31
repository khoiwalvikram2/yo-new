import type { ReactNode } from 'react'
import type { DocumentNode } from 'graphql'
import assert from 'node:assert/strict'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, afterEach, describe, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import type { ConfirmOptions } from '@/ui/components/confirm'
import AdvertisementsPage from './AdvertisementsPage'

const mocks = vi.hoisted(() => ({
  allowed: true, loading: false, error: undefined as Error | undefined,
  refetch: vi.fn(), mutation: vi.fn(), toast: vi.fn(), confirm: vi.fn(), compress: vi.fn(),
  query: vi.fn(), export: vi.fn(), exportOptions: undefined as unknown,
  rows: [
    { id: 'banner', title: 'Welcome bonus', subtitle: 'New players', type: 'BANNER', status: 'ACTIVE', deviceType: 'BOTH', imageUrl: 'https://example.test/welcome.png', url: '/bonuses', order: 1, createdAt: '2026-01-01' },
    { id: 'sports', title: 'Sports promo', subtitle: 'Cricket', type: 'PROMOTIONAL', status: 'INACTIVE', deviceType: 'MOBILE', imageUrl: 'https://example.test/sports.png', url: null, order: 2 },
  ],
}))

vi.mock('@apollo/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@apollo/client')>(),
  useQuery: (document: DocumentNode, options: { variables?: { status?: string }; errorPolicy?: string }) => {
    mocks.query(document, options)
    return { data: { advertisements: mocks.rows.filter((row) => !options.variables?.status || row.status === options.variables.status) },
      loading: mocks.loading, error: mocks.error, refetch: mocks.refetch }
  },
  useMutation: (document: DocumentNode) => [
    (options: unknown) => mocks.mutation(document, options), { loading: false },
  ],
}))
vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ children }: { children: ReactNode }) => mocks.allowed ? children : <div>Access denied</div>,
}))
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDate: (date: string) => date, formatTime: () => '10:00' }) }))
vi.mock('@/shared/hooks/useTableExport', () => ({ useTableExport: (options: unknown) => {
  mocks.exportOptions = options
  return { exporting: false, handleExport: mocks.export }
} }))
vi.mock('@/shared/utils/imageCompression', () => ({ compressImageToDataUrl: mocks.compress }))
vi.mock('@/ui/components/toast', () => ({ toast: mocks.toast }))
vi.mock('@/ui/components/confirm', () => ({ confirm: mocks.confirm }))

beforeEach(() => {
  vi.clearAllMocks(); mocks.allowed = true; mocks.loading = false; mocks.error = undefined
  mocks.compress.mockResolvedValue('data:image/png;base64,QUJD')
  mocks.mutation.mockImplementation(async (document: DocumentNode) => {
    const operation = document.definitions.find((item) => item.kind === 'OperationDefinition')
    const name = operation?.kind === 'OperationDefinition' ? operation.name?.value : undefined
    const field = name ? name[0].toLowerCase() + name.slice(1) : 'unknown'
    return { data: { [field]: { success: true } } }
  })
})
afterEach(cleanup)

function page() { return render(<MemoryRouter><PageEyebrowProvider value="Configuration"><AdvertisementsPage /></PageEyebrowProvider></MemoryRouter>) }

describe('advertisement management workflows', () => {
  test('keeps list/aggregate query contracts, status filtering and client filters/export', () => {
    page()
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Advertisements' }))
    assert.ok(mocks.query.mock.calls.some(([, options]) => options.variables && options.errorPolicy === 'all'))
    assert.ok(mocks.query.mock.calls.some(([, options]) => !options.variables && options.errorPolicy === 'all'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'INACTIVE' } })
    assert.equal(screen.queryByText('Welcome bonus'), null)
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search advertisements' }), { target: { value: 'players' } })
    assert.equal(screen.queryByText('Sports promo'), null)
    assert.ok(screen.getByText('Welcome bonus'))
    assert.equal((mocks.exportOptions as { data: unknown[] }).data.length, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }))
    assert.equal(mocks.export.mock.calls.length, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    assert.ok(screen.getByText('Sports promo'))
  })

  test('denied users start no page queries', () => {
    mocks.allowed = false; page()
    assert.ok(screen.getByText('Access denied'))
    assert.equal(mocks.query.mock.calls.length, 0)
  })

  test('create uploads a compressed string, retains defaults and sends exact nullable input', async () => {
    page(); fireEvent.click(screen.getByRole('button', { name: 'Create Advertisement' }))
    const drawer = screen.getByRole('dialog', { name: 'Create Advertisement' })
    fireEvent.change(within(drawer).getByRole('textbox', { name: 'Title' }), { target: { value: 'Deposit offer' } })
    fireEvent.change(within(drawer).getByLabelText('Upload Image'), { target: { files: [new File(['image'], 'banner.png', { type: 'image/png' })] } })
    await waitFor(() => assert.equal(mocks.compress.mock.calls.length, 1))
    await waitFor(() => assert.ok(within(drawer).getByRole('button', { name: 'Open preview: Preview' })))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create' }))
    await waitFor(() => assert.equal(mocks.mutation.mock.calls.length, 1))
    assert.deepEqual(mocks.mutation.mock.calls[0][1], { variables: { input: {
      title: 'Deposit offer', subtitle: null, type: 'BANNER', url: null, order: null,
      status: 'ACTIVE', deviceType: 'BOTH', imageUrl: 'data:image/png;base64,QUJD',
    } } })
    await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Create Advertisement' }), null))
    assert.equal(mocks.refetch.mock.calls.length, 1)
  })

  test('edit preserves image/status and includes id while failed saves retain the drawer', async () => {
    page(); fireEvent.click(screen.getByRole('button', { name: 'Edit Sports promo' }))
    const drawer = screen.getByRole('dialog', { name: 'Edit Advertisement' })
    assert.equal(within(drawer).getByRole('switch', { name: 'Status: Active' }).getAttribute('aria-checked'), 'false')
    mocks.mutation.mockResolvedValue({ data: { updateAdvertisement: { success: false, message: 'Save refused' } } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => assert.ok(screen.getByText('Save refused')))
    assert.deepEqual(mocks.mutation.mock.calls[0][1], { variables: { input: {
      id: 'sports', title: 'Sports promo', subtitle: 'Cricket', type: 'PROMOTIONAL', url: null, order: 2,
      status: 'INACTIVE', deviceType: 'MOBILE', imageUrl: 'https://example.test/sports.png',
    } } })
    assert.equal(mocks.refetch.mock.calls.length, 0)
    assert.ok(screen.getByRole('dialog', { name: 'Edit Advertisement' }))
  })

  test('toggle and confirmed delete retain mutation variables and confirmation copy', async () => {
    page()
    fireEvent.click(screen.getByRole('switch', { name: 'Active: Welcome bonus' }))
    await waitFor(() => assert.deepEqual(mocks.mutation.mock.calls[0][1], { variables: { input: { id: 'banner', status: 'INACTIVE' } } }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Welcome bonus' }))
    const options = mocks.confirm.mock.calls[0][0] as ConfirmOptions
    assert.equal(options.title, 'Delete advertisement?')
    assert.equal(options.confirmLabel, 'Yes'); assert.equal(options.cancelLabel, 'No')
    await act(async () => { await options.onConfirm?.() })
    assert.deepEqual(mocks.mutation.mock.calls[1][1], { variables: { id: 'banner' } })
  })

  test('required image/title validation blocks mutations and invalid file types never compress', async () => {
    page(); fireEvent.click(screen.getByRole('button', { name: 'Create Advertisement' }))
    const drawer = screen.getByRole('dialog', { name: 'Create Advertisement' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create' }))
    await waitFor(() => assert.ok(screen.getByText('Please enter title')))
    assert.ok(screen.getByText('Please upload an image'))
    assert.equal(mocks.mutation.mock.calls.length, 0)
    fireEvent.change(within(drawer).getByLabelText('Upload Image'), { target: { files: [new File(['text'], 'file.txt', { type: 'text/plain' })] } })
    assert.equal(mocks.compress.mock.calls.length, 0)
    assert.equal(mocks.toast.mock.calls.at(-1)?.[0].message, 'You can only upload image files!')
  })
})
