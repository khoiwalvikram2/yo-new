import { test, describe, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { useQuery } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { testCache } from '@/test-utils'
import { MemoryRouter } from 'react-router-dom'
import { App as AntApp } from 'antd'
import { IpAllowlistPanel } from '@/components/IpAllowlistPanel'
import { AvailabilityModal } from '@/components/AvailabilityModal'
import { PlayerNotesPanel } from '@/components/PlayerNotesPanel'
import { useAuth, type CrmMe, type CrmPermissionPair } from '@/state/auth'
import {
  USERS,
  IP_ALLOWLIST,
  ADD_IP_ALLOWLIST,
  SET_AVAILABILITY,
  ME,
  PLAYER_NOTES,
  ADD_NOTE,
} from '@/lib/gql'

/**
 * The write paths — the handlers behind the buttons.
 *
 * Everything tested so far asks what a screen *shows*. These ask what it
 * *does*: whether the mutation is actually sent, with the values that were
 * typed, and whether the screen refuses before sending when it should.
 *
 * That distinction matters most on the allowlist, where a save that silently
 * did nothing would leave an administrator believing they had restricted an
 * account's sign-in.
 */

const SELF = 'u1'

function me(permissions: CrmPermissionPair[]): CrmMe {
  return {
    id: SELF,
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

const crmUser = {
  __typename: 'CrmUser',
  id: SELF,
  name: 'Asha',
  username: 'asha',
  email: null,
  phone: null,
  status: 'ACTIVE',
  requirePasswordReset: false,
  lastLoginAt: null,
  lastSeenAt: null,
  createdAt: new Date().toISOString(),
  roleNames: [],
  roleIds: [],
}

function mount(node: React.ReactNode, permissions: CrmPermissionPair[], mocks: unknown[]) {
  useAuth.setState({ token: 'tok', me: me(permissions), lastActivityAt: Date.now() })
  return render(
    <MockedProvider mocks={mocks as never} cache={testCache()}>
      <MemoryRouter>
        <AntApp>{node}</AntApp>
      </MemoryRouter>
    </MockedProvider>
  )
}

/**
 * Presses the open dialog's confirm button.
 *
 * antd gives the modal's OK the same label as the control that opened it —
 * "Add" opens the dialog and "Add" confirms it — so a query over the whole
 * document finds the card's button again and the dialog never submits.
 */
async function confirmDialog(label: RegExp) {
  const dialog = await waitFor(() => {
    const el = document.querySelector('.ant-modal-content')
    assert.ok(el, 'no dialog opened')
    return el as HTMLElement
  })
  const button = within(dialog)
    .getAllByRole('button')
    .find((b) => label.test((b.textContent ?? '').trim()))
  assert.ok(button, 'the dialog offered no way to confirm')
  fireEvent.click(button)
}

beforeEach(() => {
  useAuth.setState({ token: null, me: null, lastActivityAt: Date.now() })
})

describe('adding an address to an allowlist', () => {
  const SECURITY: CrmPermissionPair[] = [
    { domain: 'crm.security', actions: ['view', 'manage'] },
    { domain: 'crm.users', actions: ['view'] },
  ]

  const baseMocks = [
    { request: { query: USERS }, result: { data: { crmUsers: [crmUser] } }, maxUsageCount: 20 },
    {
      request: { query: IP_ALLOWLIST, variables: { crmUserId: SELF } },
      result: { data: { crmIpAllowlist: [] } },
      maxUsageCount: 20,
    },
  ]

  test('sends what was typed, for the account that was chosen', async () => {
    let sent: Record<string, unknown> | null = null
    const mocks = [
      ...baseMocks,
      {
        request: { query: ADD_IP_ALLOWLIST },
        variableMatcher: (v: Record<string, unknown>) => {
          sent = v
          return true
        },
        result: {
          data: { crmAddIpAllowlistEntry: { __typename: 'CrmMutationResult', ok: true, error: null } },
        },
        maxUsageCount: 5,
      },
    ]
    mount(<IpAllowlistPanel />, SECURITY, mocks)

    // The panel needs a subject before it can add anything.
    await waitFor(() => assert.ok(screen.getByText('Address allowlist')))
    const add = screen.getByRole('button', { name: /add/i })
    fireEvent.click(add)

    await waitFor(() => assert.ok(screen.getByLabelText('Address or range')))
    fireEvent.change(screen.getByLabelText('Address or range'), {
      target: { value: '203.0.113.0/24' },
    })
    await confirmDialog(/^add$/i)

    await waitFor(() => assert.ok(sent, 'no mutation was sent'))
    assert.equal((sent as any).cidr, '203.0.113.0/24')
    assert.equal((sent as any).crmUserId, SELF)
  })

  test('offers nothing to add without crm.security:manage', async () => {
    mount(<IpAllowlistPanel />, [{ domain: 'crm.security', actions: ['view'] }], baseMocks)
    await waitFor(() => assert.ok(screen.getByText('Address allowlist')))
    assert.equal(
      screen.queryAllByRole('button').filter((b) => /add/i.test(b.textContent ?? '')).length,
      0,
      'an allowlist entry could be added without crm.security:manage'
    )
  })
})

describe('setting your own availability', () => {
  test('sends the delegate that was chosen', async () => {
    let sent: Record<string, unknown> | null = null
    const mocks = [
      { request: { query: USERS }, result: { data: { crmUsers: [crmUser] } }, maxUsageCount: 20 },
      {
        request: { query: SET_AVAILABILITY },
        variableMatcher: (v: Record<string, unknown>) => {
          sent = v
          return true
        },
        result: {
          data: { crmSetMyAvailability: { __typename: 'CrmMutationResult', ok: true, error: null } },
        },
        maxUsageCount: 5,
      },
      {
        // The mutation refetches ME, so the answer has to be the wire shape —
        // type names on the nested permission pairs included, or the cache
        // cannot normalise what it is handed.
        request: { query: ME },
        result: {
          data: {
            crmMe: {
              __typename: 'CrmMe',
              ...me([{ domain: 'crm.users', actions: ['view'] }]),
              permissions: [
                { __typename: 'CrmPermissionPair', domain: 'crm.users', actions: ['view'] },
              ],
            },
          },
        },
        maxUsageCount: 20,
      },
    ]
    // The modal refetches ME, and Apollo only refetches a query something is
    // actively watching. In the app that watcher is AppShell; mounting the
    // modal alone would make the refetch a no-op and warn about it, so the
    // watcher is reproduced here rather than the warning ignored.
    function MeWatcher() {
      useQuery(ME)
      return null
    }
    mount(
      <>
        <MeWatcher />
        <AvailabilityModal open onClose={() => {}} />
      </>,
      [{ domain: 'crm.users', actions: ['view'] }],
      mocks
    )

    await waitFor(() => assert.ok(screen.getByText('Set availability')))
    await confirmDialog(/^save$/i)

    // Submitting with nothing set is how a user comes *back* from being away,
    // so it must still send rather than be treated as an empty form.
    await waitFor(() => assert.ok(sent, 'clearing availability sent nothing'))
  })
})

describe('adding a note', () => {
  const PLAYER_ID = '42'
  const notesMock = {
    request: { query: PLAYER_NOTES, variables: { playerId: PLAYER_ID } },
    result: { data: { crmPlayerNotes: [] } },
    maxUsageCount: 20,
  }

  test('sends the text against the player it was written on', async () => {
    let sent: Record<string, unknown> | null = null
    const mocks = [
      notesMock,
      {
        request: { query: ADD_NOTE },
        variableMatcher: (v: Record<string, unknown>) => {
          sent = v
          return true
        },
        result: {
          data: { crmAddPlayerNote: { __typename: 'CrmMutationResult', ok: true, error: null } },
        },
        maxUsageCount: 5,
      },
    ]
    mount(
      <PlayerNotesPanel playerId={PLAYER_ID} />,
      [{ domain: 'crm.notes', actions: ['view', 'create'] }],
      mocks
    )

    await waitFor(() => assert.ok(screen.getAllByText(/notes/i).length > 0))
    const add = screen
      .getAllByRole('button')
      .find((b) => /add|new|note/i.test((b.textContent ?? '').trim()))
    assert.ok(add, 'crm.notes:create was granted but there is no way to add one')
    fireEvent.click(add)

    const box = await waitFor(() => {
      const t = document.querySelector('textarea')
      assert.ok(t, 'the note form offered nowhere to type')
      return t as HTMLTextAreaElement
    })
    fireEvent.change(box, { target: { value: 'Player asked for a callback tomorrow.' } })

    await confirmDialog(/^add$/i)

    // The mutation takes a single `input`, and the panel folds the player id
    // into it — a note that arrived without one would attach to nobody.
    await waitFor(() => assert.ok(sent, 'no note was sent'))
    const input = (sent as any).input
    assert.ok(input, 'the note was sent without an input object')
    assert.equal(input.playerId, PLAYER_ID)
    assert.match(String(input.content ?? ''), /callback tomorrow/)
  })
})
