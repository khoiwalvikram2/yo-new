import assert from 'node:assert/strict'
import { beforeEach, describe, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { DocumentNode } from 'graphql'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import WhitelabelsListPage from './WhitelabelsListPage'
import type { Whitelabel } from './whitelabelsListModel'

interface MutationOptions {
  onCompleted?: (data: Record<string, unknown>) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  guardCalls: [] as unknown[],
  roles: ['Super Admin'] as string[],
  listRows: [] as Whitelabel[],
  statsRows: [] as Whitelabel[],
  loading: false,
  refetch: vi.fn(async () => undefined),
  exportOptions: [] as Array<Record<string, unknown>>,
  handleExport: vi.fn(async () => undefined),
  mutationCalls: new Map<string, Array<Record<string, unknown>>>(),
  mutationReplies: new Map<string, Record<string, unknown>>(),
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
  notifyInfo: vi.fn(),
}))

vi.mock('@apollo/client', async () => {
  const actual = await vi.importActual<typeof import('@apollo/client')>('@apollo/client')
  return { ...actual, useQuery: mocks.useQuery, useMutation: mocks.useMutation }
})

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, children }: { required: unknown; children: ReactNode }) => {
    mocks.guardCalls.push(required)
    return <>{children}</>
  },
}))

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: { roles: string[] }) => unknown) => selector({ roles: mocks.roles }),
}))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => `₹${value.toLocaleString('en-IN')}`,
    getCurrencySymbol: () => '₹',
  }),
}))

vi.mock('@/shared/hooks/useTableExport', () => ({
  useTableExport: (options: Record<string, unknown>) => {
    mocks.exportOptions.push(options)
    return { exporting: false, handleExport: mocks.handleExport }
  },
}))

vi.mock('@/shared/services/notification', () => ({
  notify: {
    success: mocks.notifySuccess,
    error: mocks.notifyError,
    info: mocks.notifyInfo,
  },
}))

vi.mock('@/shell/PageEyebrowContext', () => ({ usePageEyebrow: () => 'Configuration' }))

function operationName(document: DocumentNode): string {
  const operation = document.definitions.find((definition) => definition.kind === 'OperationDefinition')
  if (!operation || operation.kind !== 'OperationDefinition') throw new Error('Missing operation')
  return operation.name?.value || ''
}

function documentText(document: DocumentNode): string {
  return document.loc?.source.body || ''
}

function sample(index: number): Whitelabel {
  const number = String(index).padStart(2, '0')
  return {
    id: `wl-${number}`,
    name: `Partner ${number}`,
    domain: `partner-${number}.example`,
    status: index % 3 === 0 ? 'suspended' : index % 2 === 0 ? 'inactive' : 'active',
    sharingRates: [
      { domain: 'sports', rate: 12.5 },
      { domain: 'casino', rate: 4 },
      { domain: 'matka', rate: 0 },
    ],
    creditLimit: 1000 * index,
    creditUsed: 250 * index,
    creditAvailable: 750 * index,
    creditAlertThreshold: 80,
    logoUrl: null,
    faviconUrl: null,
    theme: {
      primary: '#4f46e5',
      success: '#047857',
      warning: '#b45309',
      danger: '#b91c1c',
      bgPage: '#f7f8fc',
      textPrimary: '#101426',
      textSecondary: '#5a6379',
      border: '#eaecf4',
    },
  }
}

function calls(name: string) {
  return mocks.mutationCalls.get(name) ?? []
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/config/whitelabels']}>
      <Routes>
        <Route path="/config/whitelabels" element={<WhitelabelsListPage />} />
        <Route path="/config/whitelabels/create" element={<p>Create whitelabel route</p>} />
        <Route path="/config/app-configuration" element={<p>App configuration route</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function openMore(name = 'Partner 01') {
  fireEvent.click(screen.getByRole('button', { name: `More actions for ${name}` }))
  return screen.findByRole('menu')
}

beforeEach(() => {
  mocks.guardCalls.length = 0
  mocks.roles = ['Super Admin']
  mocks.listRows = Array.from({ length: 12 }, (_, index) => sample(index + 1))
  mocks.statsRows = mocks.listRows
  mocks.loading = false
  mocks.refetch.mockClear()
  mocks.exportOptions.length = 0
  mocks.handleExport.mockClear()
  mocks.mutationCalls.clear()
  mocks.mutationReplies = new Map([
    ['GenerateCasinoCategories', {
      generateCasinoCategories: {
        success: true,
        message: 'Generated',
        categoriesCreated: 3,
        gamesAssigned: 8,
        nonLatinDisabled: 0,
      },
    }],
    ['AdjustWhitelabelCredit', {
      adjustWhitelabelCredit: { success: true, message: 'Adjusted', whitelabel: sample(1) },
    }],
    ['ResetWhitelabelAdminPassword', {
      resetWhitelabelAdminPassword: { success: true, message: 'Reset' },
    }],
  ])
  mocks.notifySuccess.mockClear()
  mocks.notifyError.mockClear()
  mocks.notifyInfo.mockClear()

  mocks.useQuery.mockReset().mockImplementation((document: DocumentNode, options: Record<string, unknown>) => {
    assert.deepEqual(options, { errorPolicy: 'all' })
    const list = documentText(document).includes('theme {')
    // While loading, the stats query has no answer yet (a first load); the list keeps its rows as before.
    if (!list && mocks.loading) return { data: undefined, loading: true, refetch: mocks.refetch }
    const rows = list ? mocks.listRows : mocks.statsRows
    return { data: { whitelabels: rows }, loading: mocks.loading, refetch: mocks.refetch }
  })

  mocks.useMutation.mockReset().mockImplementation((document: DocumentNode, options: MutationOptions = {}) => {
    const name = operationName(document)
    const run = vi.fn(async (request: Record<string, unknown>) => {
      const entries = mocks.mutationCalls.get(name) ?? []
      entries.push(request)
      mocks.mutationCalls.set(name, entries)
      const reply = mocks.mutationReplies.get(name) ?? {}
      options.onCompleted?.(reply)
      return { data: reply }
    })
    return [run, { loading: false }]
  })
})

describe('WhitelabelsListPage', () => {
  test('keeps RBAC, query options, statistics, full-result export and real paging', async () => {
    renderPage()
    assert.deepEqual(mocks.guardCalls[0], [{ domain: 'config.whitelabels', actions: ['view'] }])
    assert.equal(screen.getByRole('heading', { level: 1, name: 'Whitelabels' }).textContent, 'Whitelabels')
    assert.ok(screen.queryByText('Manage partners and domains') === null)
    assert.ok(screen.getByText('4 active, 8 inactive'))
    assert.ok(screen.getByText('Partner 01'))
    assert.ok(screen.queryByText('Partner 11') === null)

    const latestExport = mocks.exportOptions.at(-1)!
    assert.equal((latestExport.data as Whitelabel[]).length, 12)
    assert.equal(latestExport.filename, 'Whitelabels')
    assert.equal(latestExport.sheetName, 'Whitelabels')
    assert.equal(latestExport.title, 'Whitelabels — 12 whitelabel(s)')
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }))
    assert.equal(mocks.handleExport.mock.calls.length, 1)

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    assert.ok(await screen.findByText('Partner 11'))
    assert.ok(screen.queryByText('Partner 01') === null)
  })

  test('searches by the legacy debounced name/domain/id filter and resets paging', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    assert.ok(await screen.findByText('Partner 11'))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search whitelabels' }), {
      target: { value: 'wl-03' },
    })
    assert.ok(await screen.findByText('Partner 03', {}, { timeout: 1500 }))
    assert.ok(screen.queryByText('Partner 11') === null)
    await waitFor(() => {
      const latest = mocks.exportOptions.at(-1)?.data as Whitelabel[]
      assert.deepEqual(latest.map((row) => row.id), ['wl-03'])
    })
  })

  test('opens the real details drawer with assets, sharing, status and all theme values', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'View details for Partner 01' }))
    const drawer = await screen.findByRole('dialog', { name: 'Whitelabel Details' })
    assert.ok(within(drawer).getByText('Basic Information'))
    assert.ok(within(drawer).getByText('Branding Assets'))
    assert.ok(within(drawer).getByText('Revenue Share Configuration'))
    assert.ok(within(drawer).getByText('Theme Configuration'))
    assert.ok(within(drawer).getByText('12.50%'))
    assert.ok(within(drawer).getAllByText('Not uploaded').length >= 2)
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
    await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Whitelabel Details' }), null))
  })

  test('submits exact adjust-credit variables, default reason, success copy and refetch', async () => {
    renderPage()
    const menu = await openMore()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Adjust Credit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Adjust Whitelabel Credit' })
    const limit = within(dialog).getByRole('textbox', { name: /Credit Limit/ })
    fireEvent.focus(limit)
    fireEvent.change(limit, { target: { value: '2500' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adjust Credit' }))
    await waitFor(() => assert.equal(calls('AdjustWhitelabelCredit').length, 1))
    assert.deepEqual(calls('AdjustWhitelabelCredit')[0], {
      variables: {
        input: {
          whitelabelId: 'wl-01',
          creditLimit: 2500,
          reason: 'Credit adjustment by Super Admin',
        },
      },
    })
    assert.deepEqual(mocks.notifySuccess.mock.calls.at(-1), ['Adjusted', 'Credit Adjusted'])
    assert.equal(mocks.refetch.mock.calls.length, 1)
  })

  test('keeps generate context/copy and the super-admin-only exact password reset variables', async () => {
    renderPage()
    let menu = await openMore()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Generate casino categories' }))
    await waitFor(() => assert.equal(calls('GenerateCasinoCategories').length, 1))
    assert.deepEqual(calls('GenerateCasinoCategories')[0], {
      variables: { tenantId: 'wl-01' },
      context: { skipNotification: true },
    })
    assert.deepEqual(mocks.notifySuccess.mock.calls.at(-1), ['Generated', 'Casino categories generated'])

    menu = await openMore()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Reset Admin Password' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reset Whitelabel Admin Password' })
    fireEvent.change(within(dialog).getByLabelText('Admin Email (optional)'), { target: { value: '  ' } })
    fireEvent.change(within(dialog).getByLabelText(/^New Password/), { target: { value: 'secret1' } })
    fireEvent.change(within(dialog).getByLabelText(/^Confirm Password/), { target: { value: 'secret1' } })
    fireEvent.change(within(dialog).getByLabelText(/^Your Password/), { target: { value: 'owner-password' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset Password' }))
    await waitFor(() => assert.equal(calls('ResetWhitelabelAdminPassword').length, 1))
    assert.deepEqual(calls('ResetWhitelabelAdminPassword')[0], {
      variables: {
        whitelabelId: 'wl-01',
        adminEmail: null,
        newPassword: 'secret1',
        adminPassword: 'owner-password',
      },
    })
    assert.deepEqual(mocks.notifySuccess.mock.calls.at(-1), ['Reset', 'Admin Password Reset'])
  })

  test('routes create/configuration actions, hides reset for non-super admins, and renders loading/empty', async () => {
    const view = renderPage()
    fireEvent.click(screen.getByRole('link', { name: 'Add Whitelabel' }))
    assert.ok(await screen.findByText('Create whitelabel route'))

    view.unmount()
    mocks.roles = ['Support Admin']
    const regularView = renderPage()
    const menu = await openMore()
    assert.equal(within(menu).queryByRole('menuitem', { name: 'Reset Admin Password' }), null)
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'App Configuration' }))
    assert.ok(await screen.findByText('App configuration route'))

    regularView.unmount()
    mocks.loading = true
    const loadingView = renderPage()
    assert.ok(screen.getByText('Total Whitelabels').closest('[aria-busy="true"]'), 'the stat tiles hold their place')
    assert.equal(screen.getByRole('table', { name: 'Whitelabels' }).getAttribute('aria-busy'), 'true')
    loadingView.unmount()

    mocks.loading = false
    mocks.listRows = []
    mocks.statsRows = []
    renderPage()
    assert.ok(screen.getByText('No whitelabels found'))
  })
})


