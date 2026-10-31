import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { GraphQLError } from 'graphql'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, test, vi } from 'vitest'
import { DELETE_RBAC_ROLE_MUTATION, ROLES_QUERY } from '@/lib/graphql/roles'
import { useAuthStore } from '@/shared/core/authStore'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import RolesManagementPage from './RolesManagementPage'
import type { GraphQLRole } from './types'

interface ConfirmOptions {
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: string
  onConfirm?: () => void | Promise<void>
}

interface ExportOptions {
  data: GraphQLRole[]
  filename: string
  sheetName: string
  title: string
  columns: Array<{ header: string }>
}

const feedback = vi.hoisted(() => ({
  confirm: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
const exporter = vi.hoisted(() => ({
  options: null as ExportOptions | null,
  handleExport: vi.fn(),
}))

vi.mock('@/ui/components/confirm', () => ({ confirm: feedback.confirm }))
vi.mock('@/shared/services/notification', () => ({
  notify: { success: feedback.success, error: feedback.error },
}))
vi.mock('@/shared/hooks/useTableExport', () => ({
  useTableExport: (options: ExportOptions) => {
    exporter.options = options
    return { exporting: false, handleExport: exporter.handleExport }
  },
}))
vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDate: (value: string, pattern?: string) => `${pattern ?? 'date'}:${value.slice(0, 10)}`,
    formatTime: (value: string, pattern?: string) => `${pattern ?? 'time'}:${value.slice(11, 16)}`,
  }),
}))

function role(id: string, overrides: Partial<GraphQLRole> = {}): GraphQLRole {
  return {
    id,
    name: `Role ${id}`,
    tenant: null,
    permissions: [{ domain: 'users', actions: ['read'] }],
    updatedAt: '2026-09-22T10:15:00.000Z',
    ...overrides,
  }
}

const OPERATIONS = role('operations', {
  name: 'Operations Admin',
  permissions: [
    { domain: 'users', actions: ['read', 'write', 'delete'] },
    { domain: 'payments', actions: ['read', 'approve'] },
  ],
})
const AUDITOR = role('auditor', {
  name: 'Risk Auditor',
  permissions: [{ domain: 'audit', actions: ['read', 'export'] }],
})
const EMPTY = role('empty', { name: 'Empty Role', permissions: [], updatedAt: 'not-a-date' })

interface Server {
  roles: GraphQLRole[]
  queryCalls: number
  failQueries: number
  mutations: Array<Record<string, unknown>>
  deleteReply: { success: boolean; message: string } | Error
}

let server: Server

function rolesMock(): MockedResponse {
  return {
    request: { query: ROLES_QUERY },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => {
      server.queryCalls += 1
      if (server.failQueries > 0) {
        server.failQueries -= 1
        return { errors: [new GraphQLError('Roles service unavailable')] }
      }
      return { data: { roles: server.roles } }
    },
  }
}

function deleteMock(): MockedResponse {
  return {
    request: { query: DELETE_RBAC_ROLE_MUTATION },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Record<string, unknown>) => {
      server.mutations.push(JSON.parse(JSON.stringify(variables)) as Record<string, unknown>)
      if (server.deleteReply instanceof Error) {
        return { errors: [new GraphQLError(server.deleteReply.message)] }
      }
      return {
        data: {
          deleteRBACRole: {
            ...server.deleteReply,
            role: { id: String(variables.id), name: 'deleted' },
          },
        },
      }
    },
  }
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function renderPage() {
  return render(
    <MockedProvider mocks={[rolesMock(), deleteMock()]}>
      <MemoryRouter initialEntries={['/security/roles']}>
        <PageEyebrowProvider value="Security">
          <Routes>
            <Route path="/security/roles" element={<RolesManagementPage />} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

async function renderLoaded() {
  const view = renderPage()
  await screen.findByText('Operations Admin')
  await waitFor(() => assert.ok(screen.queryByText('Loading Roles') === null, 'roles loaded'))
  return view
}

function allow(actions: string[]) {
  useAuthStore.setState({
    user: { id: 'admin-1', name: 'Admin' },
    agent: undefined,
    permissions: [{ domain: 'roles', actions }],
  })
}

function rowOf(name: string): HTMLElement {
  const cell = screen.getAllByText(name).find((candidate) => candidate.closest('tbody tr'))
  const tableRow = cell?.closest('tr')
  assert.ok(tableRow, `Expected a row for ${name}`)
  return tableRow as HTMLElement
}

function bodyRowNames(): string[] {
  return within(screen.getByRole('table', { name: 'Roles' }))
    .getAllByRole('row')
    .slice(1)
    .map((tableRow) => within(tableRow).getAllByRole('cell')[0]?.textContent ?? '')
}

function confirmAt(index: number): ConfirmOptions {
  const options = feedback.confirm.mock.calls[index]?.[0] as ConfirmOptions | undefined
  assert.ok(options, `Expected confirmation ${index + 1}`)
  return options
}

beforeEach(() => {
  server = {
    roles: [OPERATIONS, AUDITOR, EMPTY],
    queryCalls: 0,
    failQueries: 0,
    mutations: [],
    deleteReply: { success: true, message: 'Role removed' },
  }
  allow(['read', 'write', 'delete'])
  feedback.confirm.mockReset()
  feedback.confirm.mockResolvedValue(false)
  feedback.success.mockReset()
  feedback.error.mockReset()
  exporter.options = null
  exporter.handleExport.mockReset()
})

describe('RolesManagementPage', () => {
  test('renders the kit page, statistics, legacy cells and current-page export', async () => {
    await renderLoaded()

    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Roles & Permissions')
    assert.ok(screen.queryByText('Manage roles and permissions for admin users') === null)
    assert.ok(screen.queryByText('Security') === null)
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Roles List' }))
    assert.ok(within(screen.getByRole('region', { name: 'Roles List' })).getByText('3 roles'))

    const stats = screen.getByRole('group', { name: 'Role statistics' })
    for (const value of ['Total Roles', 'Total Permissions', 'Domains', 'Active Rate', '100%']) {
      assert.ok(within(stats).getAllByText(value).length > 0, value)
    }

    const operations = rowOf('Operations Admin')
    for (const value of ['5 permissions', 'users', 'payments', 'MMM dd, yyyy:2026-09-22', 'HH:mm:10:15']) {
      assert.ok(within(operations).getAllByText(value).length > 0, value)
    }
    const empty = rowOf('Empty Role')
    assert.ok((empty.textContent ?? '').includes('—'))

    assert.equal(exporter.options?.filename, 'Roles')
    assert.equal(exporter.options?.sheetName, 'Roles')
    assert.equal(exporter.options?.title, 'Roles — 3 role(s)')
    assert.equal(exporter.options?.data.length, 3)
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }))
    assert.equal(exporter.handleExport.mock.calls.length, 1)
  })

  test('shows the explicit denial and starts no roles query without read permission', async () => {
    allow([])
    renderPage()

    assert.ok(screen.getByRole('heading', { level: 1, name: 'Roles & Permissions' }))
    assert.ok(screen.getByText('Access Denied'))
    assert.ok(screen.getByText("You don't have permission to view roles. Please contact your administrator."))
    assert.ok(screen.getByText('roles:read'))
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(server.queryCalls, 0)
  })

  test('keeps create/delete RBAC while preserving view and edit for a read-only caller', async () => {
    allow(['read'])
    await renderLoaded()

    assert.ok(screen.queryByRole('button', { name: 'Create Role' }) === null)
    const row = rowOf('Operations Admin')
    assert.ok(within(row).getByRole('button', { name: 'View Operations Admin' }))
    assert.ok(within(row).getByRole('button', { name: 'Edit Operations Admin' }))
    assert.ok(within(row).queryByRole('button', { name: 'Delete Operations Admin' }) === null)
  })

  test('searches client-side, clears with focus restored and opens the permission dialog', async () => {
    await renderLoaded()
    const search = screen.getByRole('searchbox', { name: 'Search roles' }) as HTMLInputElement

    fireEvent.change(search, { target: { value: 'export' } })
    await waitFor(() => assert.deepEqual(bodyRowNames(), ['Risk Auditor']))
    assert.equal(server.queryCalls, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    assert.equal(search.value, '')
    assert.ok(document.activeElement === search)
    await waitFor(() => assert.equal(bodyRowNames().length, 3))

    fireEvent.click(within(rowOf('Operations Admin')).getByRole('button', { name: 'View Operations Admin' }))
    const dialog = await screen.findByRole('dialog', { name: 'Permissions' })
    assert.ok(within(dialog).getByText('Operations Admin'))
    assert.ok(within(dialog).getByText('Perms:').parentElement?.textContent?.includes('5'))
    assert.ok(within(dialog).getByText('payments'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null, 'dialog closed'))
  })

  test('paginates locally, clamps a filtered page and exports only visible rows', async () => {
    server.roles = Array.from({ length: 23 }, (_, index) => role(String(index + 1)))
    renderPage()
    await screen.findByText('Role 1')
    assert.equal(bodyRowNames().length, 10)
    assert.equal(exporter.options?.data.length, 10)

    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }))
    await waitFor(() => assert.deepEqual(bodyRowNames(), ['Role 21', 'Role 22', 'Role 23']))
    assert.equal(exporter.options?.data.length, 3)

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search roles' }), { target: { value: 'Role 1' } })
    await waitFor(() => assert.deepEqual(bodyRowNames(), ['Role 19']))
    assert.equal(screen.getByRole('button', { name: 'Page 2' }).getAttribute('aria-current'), 'page')

    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page:' }), { target: { value: '20' } })
    await waitFor(() => assert.equal(bodyRowNames().length, 11))
    assert.equal(screen.getByRole('button', { name: 'Page 1' }).getAttribute('aria-current'), 'page')
  })

  test('navigates to create and edit with the unchanged paths', async () => {
    const first = await renderLoaded()
    fireEvent.click(within(rowOf('Risk Auditor')).getByRole('button', { name: 'Edit Risk Auditor' }))
    assert.equal(screen.getByTestId('location').textContent, '/security/roles/auditor/edit')
    first.unmount()

    renderPage()
    await screen.findByText('Operations Admin')
    fireEvent.click(screen.getByRole('button', { name: 'Create Role' }))
    assert.equal(screen.getByTestId('location').textContent, '/security/roles/new')
  })

  test('shows and dismisses the query error without removing the page', async () => {
    server.failQueries = 1
    renderPage()

    await screen.findByText('Error loading data')
    assert.ok(screen.getByText('Roles service unavailable'))
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Roles & Permissions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    assert.ok(screen.queryByText('Error loading data') === null)
  })

  test('keeps both destructive confirmations, exact mutation variables, toast and refetch', async () => {
    await renderLoaded()
    const queriesBefore = server.queryCalls
    fireEvent.click(within(rowOf('Operations Admin')).getByRole('button', { name: 'Delete Operations Admin' }))

    const rowConfirm = confirmAt(0)
    assert.equal(rowConfirm.title, 'Delete Role')
    assert.equal(rowConfirm.confirmLabel, 'Delete')
    assert.equal(rowConfirm.cancelLabel, 'Cancel')
    assert.equal(rowConfirm.tone, 'danger')
    assert.match(renderToStaticMarkup(<>{rowConfirm.description}</>), /Are you sure you want to delete.*Operations Admin/)

    await act(async () => {
      await rowConfirm.onConfirm?.()
    })
    const finalConfirm = confirmAt(1)
    assert.equal(finalConfirm.confirmLabel, 'Yes, Delete')
    assert.match(renderToStaticMarkup(<>{finalConfirm.description}</>), /Users with this role will lose/)

    await act(async () => {
      await finalConfirm.onConfirm?.()
    })
    await waitFor(() => assert.deepEqual(server.mutations, [{ id: 'operations' }]))
    await waitFor(() => assert.deepEqual(feedback.success.mock.calls.at(-1), ['Role removed']))
    await waitFor(() => assert.ok(server.queryCalls > queriesBefore, 'roles refetched'))
  })

  test('reports a refused deletion and leaves an empty result without a pager', async () => {
    server.roles = []
    server.deleteReply = { success: false, message: 'System role cannot be deleted' }
    const emptyView = renderPage()
    await screen.findByText('No roles found')
    assert.ok(screen.queryByRole('navigation', { name: 'Pagination' }) === null)
    assert.equal(screen.getByRole('button', { name: 'Export Excel' }).hasAttribute('disabled'), true)
    emptyView.unmount()

    server.roles = [OPERATIONS]
    const view = renderPage()
    await screen.findByText('Operations Admin')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Operations Admin' }))
    await act(async () => {
      await (feedback.confirm.mock.calls.at(-1)?.[0] as ConfirmOptions).onConfirm?.()
    })
    await act(async () => {
      await (feedback.confirm.mock.calls.at(-1)?.[0] as ConfirmOptions).onConfirm?.()
    })
    await waitFor(() => assert.deepEqual(feedback.error.mock.calls.at(-1), ['System role cannot be deleted']))
    view.unmount()
  })
})
