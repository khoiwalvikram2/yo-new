/**
 * /security/roles/new and /security/roles/:id/edit against a mocked GraphQL server (MockedProvider +
 * MemoryRouter): the route guard and the page's own write check (and the requests they prevent), the
 * permission list, the name rules, the exact create and update inputs, every outcome toast and navigation,
 * the edit form that first appears already holding the role, and the load-error states.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { GraphQLError } from 'graphql'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import {
  CREATE_RBAC_ROLE_MUTATION,
  PERMISSIONS_QUERY,
  ROLE_QUERY,
  UPDATE_RBAC_ROLE_MUTATION,
} from '@/lib/graphql/roles'
import CreateEditRolePage from './CreateEditRolePage'

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const auth = vi.hoisted(() => ({ permissions: [] as Array<{ domain: string; actions: string[] }> }))

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ permissions: auth.permissions, isAgent: () => false, agent: undefined }),
}))
vi.mock('@/shared/services/notification', () => ({
  notify: { success: feedback.success, error: feedback.error },
}))

const EDITOR = [{ domain: 'security.roles', actions: ['view', 'create', 'update'] }]

const SERVER_PERMISSIONS = [
  { domain: 'players.list', actions: ['view', 'export'] },
  { domain: 'roles', actions: ['read'] },
  { domain: 'security.roles', actions: ['view', 'create', 'update', 'delete'] },
  { domain: 'players.list', actions: ['export', 'delete'] },
]

const STORED_ROLE = {
  __typename: 'Role',
  id: 'r7',
  name: 'Support Admin',
  tenant: null,
  permissions: [
    { __typename: 'Permission', domain: 'players.list', actions: ['view'] },
    { __typename: 'Permission', domain: 'roles', actions: ['read'] },
  ],
  updatedAt: '2026-09-01T10:00:00.000Z',
}

interface ServerState {
  roleQueries: number
  permissionQueries: number
  creates: Array<Record<string, unknown>>
  updates: Array<Record<string, unknown>>
  reply: { success: boolean; message: string | null }
  role: typeof STORED_ROLE | null
  roleError: string | null
  permissionsError: string | null
}

let server: ServerState

function permissionsMock(): MockedResponse {
  return {
    request: { query: PERMISSIONS_QUERY },
    maxUsageCount: Number.POSITIVE_INFINITY,
    delay: 5,
    result: () => {
      server.permissionQueries += 1
      if (server.permissionsError) return { errors: [new GraphQLError(server.permissionsError)] }
      return {
        data: {
          permissions: SERVER_PERMISSIONS.map((p) => ({ __typename: 'Permission', ...p })),
        },
      }
    },
  }
}

function roleMock(id = 'r7'): MockedResponse {
  return {
    request: { query: ROLE_QUERY, variables: { id } },
    maxUsageCount: Number.POSITIVE_INFINITY,
    delay: 5,
    result: () => {
      server.roleQueries += 1
      if (server.roleError) return { errors: [new GraphQLError(server.roleError)] }
      return { data: { role: server.role } }
    },
  }
}

function mutationReply(field: 'createRBACRole' | 'updateRBACRole', input: Record<string, unknown>) {
  return {
    data: {
      [field]: {
        __typename: 'RoleMutationResponse',
        success: server.reply.success,
        message: server.reply.message,
        role: server.reply.success
          ? {
              __typename: 'Role',
              id: String(input.id ?? 'r-new'),
              name: String(input.name),
              tenant: null,
              permissions: (input.permissions as Array<{ domain: string; actions: string[] }>).map((p) => ({
                __typename: 'Permission',
                ...p,
              })),
              updatedAt: '2026-10-07T09:00:00.000Z',
            }
          : null,
      },
    },
  }
}

function createMock(): MockedResponse {
  return {
    request: { query: CREATE_RBAC_ROLE_MUTATION },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Record<string, unknown>) => {
      const input = variables.input as Record<string, unknown>
      server.creates.push(input)
      return mutationReply('createRBACRole', input)
    },
  }
}

function updateMock(): MockedResponse {
  return {
    request: { query: UPDATE_RBAC_ROLE_MUTATION },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Record<string, unknown>) => {
      const input = variables.input as Record<string, unknown>
      server.updates.push(input)
      return mutationReply('updateRBACRole', input)
    },
  }
}

function failingCreateMock(): MockedResponse {
  return {
    request: { query: CREATE_RBAC_ROLE_MUTATION },
    variableMatcher: (variables) => {
      server.creates.push((variables as { input: Record<string, unknown> }).input)
      return true
    },
    error: new Error('Network down'),
  }
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function renderAt(path: string, mocks: MockedResponse[] = [permissionsMock(), roleMock(), createMock(), updateMock()]) {
  return render(
    <MockedProvider mocks={mocks}>
      <MemoryRouter initialEntries={[path]}>
        <PageEyebrowProvider value="System">
          <Routes>
            <Route path="/security/roles/new" element={<CreateEditRolePage />} />
            <Route path="/security/roles/:id/edit" element={<CreateEditRolePage />} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

function nameField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: /^Role Name/ }) as HTMLInputElement
}

function submitForm() {
  fireEvent.submit(nameField().closest('form') as HTMLFormElement)
}

async function settle(ms = 30) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

beforeEach(() => {
  server = {
    roleQueries: 0,
    permissionQueries: 0,
    creates: [],
    updates: [],
    reply: { success: true, message: null },
    role: STORED_ROLE,
    roleError: null,
    permissionsError: null,
  }
  auth.permissions = EDITOR
  feedback.success.mockReset()
  feedback.error.mockReset()
})

describe('CreateEditRolePage guards', () => {
  test('a caller with none of view, create or update gets the route guard and no request', async () => {
    auth.permissions = [{ domain: 'players.list', actions: ['view'] }]
    renderAt('/security/roles/new')
    assert.ok(screen.getByText('Access denied'))
    await settle()
    assert.equal(server.permissionQueries, 0)
  })

  test('a view-only caller passes the route guard but gets the legacy denial, before any request', async () => {
    auth.permissions = [{ domain: 'security.roles', actions: ['view'] }]
    renderAt('/security/roles/r7/edit')
    assert.ok(screen.getByText('Access Denied'))
    assert.ok(screen.getByText("You don't have permission to create or edit roles. Please contact your administrator."))
    await settle()
    assert.equal(server.permissionQueries, 0)
    assert.equal(server.roleQueries, 0)
    assert.equal(screen.queryByRole('textbox'), null)
  })

  test('update alone, or the flat roles:write grant, may open the editor', async () => {
    auth.permissions = [{ domain: 'security.roles', actions: ['update'] }]
    const first = renderAt('/security/roles/new')
    assert.ok(await screen.findByRole('heading', { level: 1, name: 'Create Role' }))
    first.unmount()

    auth.permissions = [{ domain: 'roles', actions: ['read', 'write'] }]
    renderAt('/security/roles/new')
    assert.ok(await screen.findByRole('heading', { level: 1, name: 'Create Role' }))
  })
})

describe('creating a role', () => {
  test('shows the legacy header, fields and footer, and the permission list once it loads', async () => {
    renderAt('/security/roles/new')
    assert.ok(screen.queryByText('System') === null)
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Create Role' }))
    assert.ok(screen.queryByText('Set up a new role with comprehensive permissions') === null)
    assert.equal(screen.getByRole('link', { name: 'Back to Roles' }).getAttribute('href'), '/security/roles')
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Basic Information' }))
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Role Permissions' }))
    assert.ok(screen.getByText('Configure granular access for each module'))
    assert.equal(nameField().value, '')
    assert.equal(nameField().getAttribute('placeholder'), 'e.g., Support Admin, Content Manager, Marketing Viewer')
    assert.equal(nameField().getAttribute('aria-required'), 'true')
    assert.ok(screen.getByText('Required fields'))
    assert.ok(screen.getByText('Loading permissions'))
    assert.equal(server.roleQueries, 0, 'no role is read when creating')

    await screen.findByRole('tablist', { name: 'Permission categories' })
    assert.deepEqual(
      screen.getAllByRole('tab').map((tab) => tab.textContent),
      ['Players, 0 of 3 selected', 'Security, 0 of 4 selected'],
    )
    assert.ok(screen.getByRole('button', { name: 'Create Role' }))
  })

  test('the name rules block the save with the legacy messages and focus the field', async () => {
    renderAt('/security/roles/new')
    await screen.findByRole('tablist')

    submitForm()
    assert.ok(await screen.findByText('Please enter role name'))
    await waitFor(() => assert.equal(document.activeElement, nameField()))

    fireEvent.change(nameField(), { target: { value: 'a' } })
    submitForm()
    assert.ok(await screen.findByText('Role name must be at least 2 characters'))

    fireEvent.change(nameField(), { target: { value: 'x'.repeat(65) } })
    submitForm()
    assert.ok(await screen.findByText('Role name must not exceed 64 characters'))
    await settle()
    assert.equal(server.creates.length, 0)
  })

  test('saves the exact create input, toasts and returns to the list', async () => {
    server.reply = { success: true, message: 'Role created' }
    renderAt('/security/roles/new')
    await screen.findByRole('tablist')

    fireEvent.change(nameField(), { target: { value: ' Content Manager ' } })
    fireEvent.click(within(screen.getByRole('group', { name: 'List' })).getByRole('checkbox', { name: 'delete' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'List' })).getByRole('checkbox', { name: 'view' }))
    fireEvent.click(screen.getByRole('tab', { name: /^Security/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Grant All Roles' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Role' }))

    await waitFor(() => assert.equal(server.creates.length, 1))
    assert.deepEqual(server.creates[0], {
      name: ' Content Manager ',
      permissions: [
        { domain: 'players.list', actions: ['delete', 'view'] },
        { domain: 'security.roles', actions: ['view', 'create', 'update', 'delete'] },
      ],
    })
    assert.deepEqual(Object.keys(server.creates[0]), ['name', 'permissions'])
    await waitFor(() => assert.deepEqual(feedback.success.mock.calls, [['Role created']]))
    assert.equal((await screen.findByTestId('location')).textContent, '/security/roles')
  })

  test('a refused create keeps the page and toasts the fallback; a failed request toasts its error', async () => {
    server.reply = { success: false, message: null }
    const first = renderAt('/security/roles/new')
    await screen.findByRole('tablist')
    fireEvent.change(nameField(), { target: { value: 'Ops' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Role' }))
    await waitFor(() => assert.deepEqual(feedback.error.mock.calls, [['Failed to create role']]))
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Create Role' }))
    assert.equal(screen.queryByTestId('location'), null)
    first.unmount()

    feedback.error.mockReset()
    renderAt('/security/roles/new', [permissionsMock(), failingCreateMock()])
    await screen.findByRole('tablist')
    fireEvent.change(nameField(), { target: { value: 'Ops' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Role' }))
    await waitFor(() => assert.deepEqual(feedback.error.mock.calls, [['Network down']]))
  })

  test('Cancel returns to the list without saving', async () => {
    renderAt('/security/roles/new')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    assert.equal((await screen.findByTestId('location')).textContent, '/security/roles')
    assert.equal(server.creates.length, 0)
  })
})

describe('editing a role', () => {
  test('loads the role first, and the form first appears already holding it', async () => {
    renderAt('/security/roles/r7/edit')
    assert.ok(screen.getByText('Loading role'))
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Edit Role' }))
    assert.equal(screen.queryByRole('textbox'), null)

    const field = (await screen.findByRole('textbox', { name: /^Role Name/ })) as HTMLInputElement
    assert.equal(field.value, 'Support Admin')
    assert.ok(screen.queryByText('Update role permissions and settings') === null)
    assert.equal(server.roleQueries, 1)

    await screen.findByRole('tablist')
    assert.equal(
      (within(screen.getByRole('group', { name: 'List' })).getByRole('checkbox', { name: 'view' }) as HTMLInputElement).checked,
      true,
    )
    assert.ok(screen.getByRole('button', { name: 'Update Role' }))
  })

  test('saves the exact update input, keeping entries the picker does not show, without typenames', async () => {
    renderAt('/security/roles/r7/edit')
    await screen.findByRole('tablist')
    fireEvent.change(nameField(), { target: { value: 'Support Lead' } })
    fireEvent.click(within(screen.getByRole('group', { name: 'List' })).getByRole('checkbox', { name: 'export' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update Role' }))

    await waitFor(() => assert.equal(server.updates.length, 1))
    assert.deepEqual(server.updates[0], {
      id: 'r7',
      name: 'Support Lead',
      permissions: [
        { domain: 'players.list', actions: ['view', 'export'] },
        { domain: 'roles', actions: ['read'] },
      ],
    })
    assert.deepEqual(Object.keys(server.updates[0]), ['id', 'name', 'permissions'])
    assert.equal(server.creates.length, 0)
    await waitFor(() => assert.deepEqual(feedback.success.mock.calls, [['Role updated successfully!']]))
    assert.equal((await screen.findByTestId('location')).textContent, '/security/roles')
  })

  test('a refused update toasts the server message and stays', async () => {
    server.reply = { success: false, message: 'Role name already exists' }
    renderAt('/security/roles/r7/edit')
    await screen.findByRole('tablist')
    fireEvent.click(screen.getByRole('button', { name: 'Update Role' }))
    await waitFor(() => assert.deepEqual(feedback.error.mock.calls, [['Role name already exists']]))
    assert.equal(nameField().value, 'Support Admin')
  })

  test('a role that cannot be loaded shows the legacy error with a way back', async () => {
    server.roleError = 'Role not found'
    server.role = null
    renderAt('/security/roles/r7/edit')
    assert.ok(await screen.findByText('Error Loading Role'))
    assert.ok(screen.getByText('Role not found'))
    assert.equal(screen.getByRole('link', { name: 'Back to Roles' }).getAttribute('href'), '/security/roles')
    assert.equal(screen.queryByRole('textbox'), null)
  })

  test('a role the server does not return opens an empty form, as before', async () => {
    server.role = null
    renderAt('/security/roles/r7/edit')
    const field = (await screen.findByRole('textbox', { name: /^Role Name/ })) as HTMLInputElement
    assert.equal(field.value, '')
  })

  test('a failed permission list shows the closable load error and keeps the form', async () => {
    server.permissionsError = 'Permissions unavailable'
    renderAt('/security/roles/r7/edit')
    assert.ok(await screen.findByText('Permissions unavailable'))
    assert.ok(screen.getByText('Error loading data'))
    assert.equal(nameField().value, 'Support Admin')
    fireEvent.click(screen.getByRole('button', { name: 'Close error message' }))
    assert.ok(screen.queryByText('Permissions unavailable') === null)
  })
})

