import { test, describe, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, waitFor } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import { App as AntApp } from 'antd'
import { TagsPage } from '@/routes/TagsPage'
import { RolesPage } from '@/routes/RolesPage'
import { UsersPage } from '@/routes/UsersPage'
import { BooksPage } from '@/routes/BooksPage'
import { useAuth, type CrmMe, type CrmPermissionPair } from '@/state/auth'
import { TAGS, TAG_LIMIT, ROLES, PERMISSION_CATALOG, USERS, BOOKS } from '@/lib/gql'

/**
 * The administrative screens, and the one property they share.
 *
 * Each is reachable on a `view` permission and mutates on a `manage` one. The
 * failure that matters is the same on all four: offering a write control to
 * someone holding only `view`. The server refuses them, so nothing breaks —
 * they simply click, get an error they cannot act on, and learn to distrust the
 * screen. The reverse, hiding a control from someone who holds `manage`,
 * removes a capability with no message at all.
 *
 * Neither shows up in a typecheck, in the GraphQL verifier, or in any backend
 * test, because both render perfectly well.
 */

function me(permissions: CrmPermissionPair[]): CrmMe {
  return {
    id: 'u1',
    name: 'Asha',
    email: null,
    status: 'ACTIVE',
    requirePasswordReset: false,
    tenant: 'acme',
    whitelabelName: 'Acme Casino',
    permissions,
    bookIds: [],
    canViewAllPlayers: false,
    sessionIdleMinutes: 60,
    outOfOfficeUntil: null,
    delegateTo: null,
  }
}

const tag = {
  __typename: 'CrmTag',
  id: 't1',
  name: 'High roller',
  colour: '#3b82f6',
  description: null,
  isArchived: false,
  playerCount: 4,
}
const role = {
  __typename: 'CrmRole',
  id: 'r1',
  name: 'Agent',
  description: null,
  isSystem: false,
  userCount: 2,
  permissions: [
    { __typename: 'CrmPermission', domain: 'crm.players', action: 'view', label: 'View players', description: null },
  ],
}
const systemRole = { ...role, id: 'r0', name: 'CRM Administrator', isSystem: true, userCount: 1 }
const user = {
  __typename: 'CrmUser',
  id: 'u9',
  name: 'Bob',
  username: 'bob',
  email: null,
  phone: null,
  status: 'ACTIVE',
  requirePasswordReset: false,
  lastLoginAt: null,
  lastSeenAt: null,
  createdAt: new Date().toISOString(),
  roleNames: ['Agent'],
  roleIds: ['r1'],
}
const book = {
  __typename: 'CrmBook',
  id: 'b1',
  name: 'Book A',
  description: null,
  memberCount: 2,
  playerCount: 7,
  createdAt: new Date().toISOString(),
}

const M = {
  tags: {
    request: { query: TAGS, variables: { includeArchived: true } },
    result: { data: { crmTags: [tag] } },
    maxUsageCount: 10,
  },
  tagsNoArchive: {
    request: { query: TAGS, variables: { includeArchived: false } },
    result: { data: { crmTags: [tag] } },
    maxUsageCount: 10,
  },
  tagLimit: {
    request: { query: TAG_LIMIT },
    result: { data: { crmTagLimit: { __typename: 'CrmTagLimit', used: 1, limit: 50 } } },
    maxUsageCount: 10,
  },
  roles: {
    request: { query: ROLES },
    result: { data: { crmRoles: [role, systemRole] } },
    maxUsageCount: 10,
  },
  catalog: {
    request: { query: PERMISSION_CATALOG },
    result: {
      data: {
        // Every field the document selects, including the `domain` repeated on
        // each action — a mock that omits one makes Apollo warn and hands the
        // component an object the server would never send.
        crmPermissionCatalog: [
          {
            __typename: 'CrmPermissionGroup',
            domain: 'crm.players',
            label: 'Players',
            description: null,
            actions: [
              {
                __typename: 'CrmPermission',
                domain: 'crm.players',
                action: 'view',
                label: 'View players',
                description: null,
              },
            ],
          },
        ],
      },
    },
    maxUsageCount: 10,
  },
  users: { request: { query: USERS }, result: { data: { crmUsers: [user] } }, maxUsageCount: 10 },
  books: { request: { query: BOOKS }, result: { data: { crmBooks: [book] } }, maxUsageCount: 10 },
}

function mount(node: React.ReactNode, permissions: CrmPermissionPair[], mocks: unknown[]) {
  useAuth.setState({ token: 'tok', me: me(permissions), lastActivityAt: Date.now() })
  return render(
    <MockedProvider mocks={mocks as never}>
      <MemoryRouter>
        <AntApp>{node}</AntApp>
      </MemoryRouter>
    </MockedProvider>
  )
}

/** Any control that would start a write. */
function writeControls(): HTMLElement[] {
  return screen.queryAllByRole('button').filter((b) => /new|add|create|edit|delete|archive|merge|reset|remove/i.test(b.textContent ?? ''))
}

beforeEach(() => {
  useAuth.setState({ token: null, me: null, lastActivityAt: Date.now() })
})

describe('tags', () => {
  const mocks = [M.tags, M.tagsNoArchive, M.tagLimit]

  test('shows the tags and what they cost against the cap', async () => {
    mount(<TagsPage />, [{ domain: 'crm.tags', actions: ['apply', 'manage'] }], mocks)
    await waitFor(() => assert.ok(screen.getByText('High roller')))
    // The cap is the point of the screen: tags are cheap to make and the list
    // becomes useless past a few dozen.
    assert.ok(screen.getByText(/50/))
  })

  test('offers no write control to someone who can only apply them', async () => {
    mount(<TagsPage />, [{ domain: 'crm.tags', actions: ['apply'] }], mocks)
    await waitFor(() => assert.ok(screen.getByText('High roller')))
    assert.deepEqual(
      writeControls().map((b) => b.textContent),
      [],
      'a tag write control was offered without crm.tags:manage'
    )
  })

  test('offers them to someone who can manage them', async () => {
    mount(<TagsPage />, [{ domain: 'crm.tags', actions: ['apply', 'manage'] }], mocks)
    await waitFor(() => assert.ok(screen.getByText('High roller')))
    assert.ok(writeControls().length > 0, 'crm.tags:manage was granted but nothing can be done')
  })
})

describe('roles', () => {
  const mocks = [M.roles, M.catalog]

  test('marks a built-in role as built in', async () => {
    // A system role cannot be deleted; saying so on the row saves the discovery
    // by failed attempt.
    mount(<RolesPage />, [{ domain: 'crm.roles', actions: ['view', 'manage'] }], mocks)
    await waitFor(() => assert.ok(screen.getByText('CRM Administrator')))
    assert.ok(screen.getByText(/system|built.?in/i))
  })

  test('offers no write control on view alone', async () => {
    mount(<RolesPage />, [{ domain: 'crm.roles', actions: ['view'] }], mocks)
    await waitFor(() => assert.ok(screen.getByText('Agent')))
    assert.deepEqual(writeControls().map((b) => b.textContent), [])
  })

  test('offers them with manage', async () => {
    mount(<RolesPage />, [{ domain: 'crm.roles', actions: ['view', 'manage'] }], mocks)
    await waitFor(() => assert.ok(screen.getByText('Agent')))
    assert.ok(writeControls().length > 0)
  })
})

describe('CRM users', () => {
  const mocks = [M.users, M.roles]

  test('lists a user with the roles they hold', async () => {
    mount(
      <UsersPage />,
      [
        { domain: 'crm.users', actions: ['view', 'manage'] },
        { domain: 'crm.roles', actions: ['view'] },
      ],
      mocks
    )
    await waitFor(() => assert.ok(screen.getByText('Bob')))
    assert.ok(screen.getByText('Agent'))
  })

  test('offers no write control on view alone', async () => {
    mount(<UsersPage />, [{ domain: 'crm.users', actions: ['view'] }], mocks)
    await waitFor(() => assert.ok(screen.getByText('Bob')))
    assert.deepEqual(
      writeControls().map((b) => b.textContent),
      [],
      'a user could be created or reset without crm.users:manage'
    )
  })

  test('offers them with manage', async () => {
    mount(
      <UsersPage />,
      [
        { domain: 'crm.users', actions: ['view', 'manage'] },
        { domain: 'crm.roles', actions: ['view'] },
      ],
      mocks
    )
    await waitFor(() => assert.ok(screen.getByText('Bob')))
    assert.ok(writeControls().length > 0)
  })
})

describe('books', () => {
  const mocks = [M.books, M.users]

  test('shows how much each book carries', async () => {
    // Player and member counts are what make a book safe or unsafe to delete.
    mount(<BooksPage />, [{ domain: 'crm.books', actions: ['view', 'manage'] }], mocks)
    await waitFor(() => assert.ok(screen.getByText('Book A')))
    assert.ok(screen.getByText('7'))
  })

  test('offers no write control on view alone', async () => {
    mount(<BooksPage />, [{ domain: 'crm.books', actions: ['view'] }], mocks)
    await waitFor(() => assert.ok(screen.getByText('Book A')))
    assert.deepEqual(writeControls().map((b) => b.textContent), [])
  })

  test('offers them with manage', async () => {
    mount(<BooksPage />, [{ domain: 'crm.books', actions: ['view', 'manage'] }], mocks)
    await waitFor(() => assert.ok(screen.getByText('Book A')))
    assert.ok(writeControls().length > 0)
  })
})
