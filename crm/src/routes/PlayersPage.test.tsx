import { test, describe, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, waitFor } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import { App as AntApp } from 'antd'
import { PlayersPage } from '@/routes/PlayersPage'
import { useAuth, type CrmMe, type CrmPermissionPair } from '@/state/auth'
import { PLAYERS, TAGS, SEGMENTS } from '@/lib/gql'

/**
 * Export is the button that turns a permission into a spreadsheet.
 *
 * `crm.players:export` exists precisely because reading the list on screen and
 * walking out with it are different acts — the server logs the second as PII
 * access and caps how much leaves at once. Offering the button to someone
 * without the permission produces a refusal they cannot explain; hiding it from
 * someone who has it silently removes the feature.
 *
 * The list itself has one property worth pinning too: an empty result must read
 * as "nobody matched", not as a screen that failed to load.
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

const player = {
  __typename: 'CrmPlayer',
  id: '1',
  name: 'Ravi Kumar',
  username: 'ravi',
  phone: '555',
  email: null,
  status: 'active',
  playerType: 'REGULAR',
  createdAt: new Date().toISOString(),
  lastLoginAt: null,
  cash: '100',
  bonus: '0',
  exposure: '0',
  bookId: null,
  bookName: null,
  ownerName: null,
  tags: [],
  noteCount: 0,
}

function mount(permissions: CrmPermissionPair[], items: unknown[] = [player]) {
  useAuth.setState({ token: 'tok', me: me(permissions), lastActivityAt: Date.now() })
  const mocks = [
    {
      request: {
        query: PLAYERS,
        // An untouched filter sends nulls, not empty strings: the page does
        // `search.trim() || null` so that a blank box means "no filter" rather
        // than "match the empty string".
        variables: {
          filter: {
            search: null,
            status: null,
            bookId: null,
            assignment: null,
            tagIds: null,
            tagMatch: null,
            hasNotes: null,
          },
          limit: 25,
          offset: 0,
        },
      },
      result: {
        data: { crmPlayers: { __typename: 'CrmPlayerPage', total: items.length, items } },
      },
      maxUsageCount: 10,
    },
    // The tag filter and the segment picker load alongside the list. Both are
    // unconditional reads, so without mocks every test here fails on a network
    // error rather than on what it is asserting.
    {
      request: { query: TAGS },
      result: { data: { crmTags: [] } },
      maxUsageCount: 10,
    },
    {
      request: { query: SEGMENTS },
      result: { data: { crmSegments: [] } },
      maxUsageCount: 10,
    },
  ]
  return render(
    <MockedProvider mocks={mocks}>
      <MemoryRouter>
        <AntApp>
          <PlayersPage />
        </AntApp>
      </MemoryRouter>
    </MockedProvider>
  )
}

beforeEach(() => {
  useAuth.setState({ token: null, me: null, lastActivityAt: Date.now() })
})

describe('the export button follows the permission', () => {
  test('is offered to someone who holds crm.players:export', async () => {
    mount([
      { domain: 'crm.players', actions: ['view', 'export'] },
    ])
    await waitFor(() => assert.ok(screen.getByText('Export CSV')))
  })

  test('is not offered to someone who only reads the list', async () => {
    mount([{ domain: 'crm.players', actions: ['view'] }])
    await waitFor(() => assert.ok(screen.getByText('Ravi Kumar')))
    assert.equal(
      screen.queryByText('Export CSV'),
      null,
      'export was offered without crm.players:export'
    )
  })

  test('a wildcard on the domain counts as holding it', async () => {
    mount([{ domain: 'crm.players', actions: ['*'] }])
    await waitFor(() => assert.ok(screen.getByText('Export CSV')))
  })
})

describe('the list', () => {
  test('shows the players it was given', async () => {
    mount([{ domain: 'crm.players', actions: ['view'] }])
    await waitFor(() => assert.ok(screen.getByText('Ravi Kumar')))
  })

  test('an empty result reads as nobody matching, not as a failure', async () => {
    mount([{ domain: 'crm.players', actions: ['view'] }], [])
    // antd renders its empty state in more than one place (table body and
    // placeholder), so count matches rather than demanding exactly one.
    await waitFor(() => {
      assert.ok(
        screen.getAllByText(/no data|no players|nothing/i).length > 0,
        'an empty list rendered nothing at all'
      )
    })
    assert.equal(screen.queryByText('Ravi Kumar'), null)
  })
})
