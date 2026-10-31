import { test, describe, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, waitFor } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import { App as AntApp } from 'antd'
import { PlayerSafetyPanel } from '@/components/PlayerSafetyPanel'
import { PlayerNotesPanel } from '@/components/PlayerNotesPanel'
import { PlayerContactPanel } from '@/components/PlayerContactPanel'
import { useAuth, type CrmMe, type CrmPermissionPair } from '@/state/auth'
import { RG_FLAGS, CONSENTS, CONSENT_HISTORY, PLAYER_NOTES, CONTACT_ATTEMPTS } from '@/lib/gql'

/**
 * The three panels that hold everything sensitive about a player.
 *
 * Safety carries the gambling-harm record, notes carry whatever an agent has
 * written down, contact carries who called and what came of it. All three are
 * gated separately, and each gate is the difference between an agent seeing
 * something they are entitled to and seeing someone's harm history because a
 * `can()` call was dropped in a refactor.
 *
 * `crm.rg:view` and `crm.rg:flag` are deliberately distinct: reading that a
 * player has self-excluded and being able to impose an exclusion are not the
 * same authority, and the panel must not collapse them.
 */

const PLAYER_ID = '42'

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

const flag = {
  __typename: 'CrmRgFlag',
  id: 'f1',
  flagType: 'SELF_EXCLUSION',
  status: 'ACTIVE',
  initiatedBy: 'player',
  blocksPlay: true,
  startsAt: new Date().toISOString(),
  minTermEndsAt: null,
  endsAt: null,
  balanceAtBlock: null,
  reason: 'Player asked to be excluded',
  raisedBy: 'u1',
  raisedAt: new Date().toISOString(),
  liftedBy: null,
  liftedAt: null,
  liftReason: null,
}

const consent = {
  __typename: 'CrmConsent',
  channel: 'EMAIL',
  purpose: 'MARKETING',
  state: 'WITHDRAWN',
  stateSince: new Date().toISOString(),
  grantedAt: null,
  source: 'ADMIN',
  evidenceRef: null,
}

const note = {
  __typename: 'CrmPlayerNote',
  id: 'n1',
  content: 'Called about the withdrawal delay.',
  category: 'GENERAL',
  labels: [],
  isPinned: false,
  visibility: 'TEAM',
  authorKind: 'CRM_USER',
  createdBy: 'Asha',
  createdAt: new Date().toISOString(),
}

const attempt = {
  __typename: 'CrmContactAttempt',
  id: 'c1',
  channel: 'PHONE',
  direction: 'OUTBOUND',
  outcome: 'NO_ANSWER',
  notes: null,
  byName: 'Asha',
  occurredAt: new Date().toISOString(),
}

const M = {
  rg: {
    request: { query: RG_FLAGS, variables: { playerId: PLAYER_ID } },
    result: { data: { crmPlayerRgFlags: [flag] } },
    maxUsageCount: 20,
  },
  rgEmpty: {
    request: { query: RG_FLAGS, variables: { playerId: PLAYER_ID } },
    result: { data: { crmPlayerRgFlags: [] } },
    maxUsageCount: 20,
  },
  consents: {
    request: { query: CONSENTS, variables: { playerId: PLAYER_ID } },
    result: { data: { crmPlayerConsents: [consent] } },
    maxUsageCount: 20,
  },
  history: {
    request: { query: CONSENT_HISTORY, variables: { playerId: PLAYER_ID, limit: 100 } },
    result: { data: { crmPlayerConsentHistory: [] } },
    maxUsageCount: 20,
  },
  notes: {
    request: { query: PLAYER_NOTES, variables: { playerId: PLAYER_ID } },
    result: { data: { crmPlayerNotes: [note] } },
    maxUsageCount: 20,
  },
  contact: {
    request: { query: CONTACT_ATTEMPTS, variables: { playerId: PLAYER_ID } },
    result: { data: { crmContactAttempts: [attempt] } },
    maxUsageCount: 20,
  },
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

/**
 * Any control that would start a write. The contact panel's is labelled "Log",
 * which reads as a noun and is easy to miss when adding to this list.
 */
const writeControls = () =>
  screen
    .queryAllByRole('button')
    .filter((b) => /add|new|raise|lift|flag|delete|record|pin|^log$/i.test((b.textContent ?? '').trim()))

beforeEach(() => {
  useAuth.setState({ token: null, me: null, lastActivityAt: Date.now() })
})

describe('the safety panel', () => {
  const mocks = [M.rg, M.consents, M.history]

  test('shows an active self-exclusion to someone allowed to see it', async () => {
    mount(<PlayerSafetyPanel playerId={PLAYER_ID} />, [
      { domain: 'crm.rg', actions: ['view'] },
      { domain: 'crm.consent', actions: ['view'] },
    ], mocks)
    await waitFor(() => assert.ok(screen.getAllByText(/self.?exclusion/i).length > 0))
  })

  test('reading a flag does not come with the power to raise one', async () => {
    // crm.rg:view and crm.rg:flag are separate grants. Collapsing them would let
    // anyone who can read a harm record impose one.
    mount(<PlayerSafetyPanel playerId={PLAYER_ID} />, [
      { domain: 'crm.rg', actions: ['view'] },
    ], mocks)
    await waitFor(() => assert.ok(screen.getAllByText(/self.?exclusion/i).length > 0))
    assert.deepEqual(
      writeControls().map((b) => b.textContent),
      [],
      'a responsible-gambling control was offered on view alone'
    )
  })

  test('offers the controls to someone who may flag', async () => {
    mount(<PlayerSafetyPanel playerId={PLAYER_ID} />, [
      { domain: 'crm.rg', actions: ['view', 'flag'] },
    ], mocks)
    await waitFor(() => assert.ok(screen.getAllByText(/self.?exclusion/i).length > 0))
    assert.ok(writeControls().length > 0, 'crm.rg:flag was granted but nothing can be raised')
  })

  test('a player with no flags is shown as such, not as a blank panel', async () => {
    mount(<PlayerSafetyPanel playerId={PLAYER_ID} />, [
      { domain: 'crm.rg', actions: ['view'] },
      { domain: 'crm.consent', actions: ['view'] },
    ], [M.rgEmpty, M.consents, M.history])
    await waitFor(() =>
      assert.ok(screen.getAllByText(/no |none|nothing|empty/i).length > 0, 'an empty safety panel said nothing')
    )
  })

  test('a withdrawn consent is visible, because it decides whether anyone may write', async () => {
    mount(<PlayerSafetyPanel playerId={PLAYER_ID} />, [
      { domain: 'crm.rg', actions: ['view'] },
      { domain: 'crm.consent', actions: ['view'] },
    ], mocks)
    await waitFor(() => assert.ok(screen.getAllByText(/withdrawn/i).length > 0))
  })
})

describe('the notes panel', () => {
  test('shows what an agent wrote', async () => {
    mount(<PlayerNotesPanel playerId={PLAYER_ID} />, [{ domain: 'crm.notes', actions: ['view'] }], [M.notes])
    await waitFor(() => assert.ok(screen.getByText('Called about the withdrawal delay.')))
  })

  test('offers no way to add one without crm.notes:create', async () => {
    mount(<PlayerNotesPanel playerId={PLAYER_ID} />, [{ domain: 'crm.notes', actions: ['view'] }], [M.notes])
    await waitFor(() => assert.ok(screen.getByText('Called about the withdrawal delay.')))
    assert.deepEqual(writeControls().map((b) => b.textContent), [])
  })

  test('offers it with create', async () => {
    mount(
      <PlayerNotesPanel playerId={PLAYER_ID} />,
      [{ domain: 'crm.notes', actions: ['view', 'create'] }],
      [M.notes]
    )
    await waitFor(() => assert.ok(screen.getByText('Called about the withdrawal delay.')))
    assert.ok(writeControls().length > 0)
  })
})

describe('the contact panel', () => {
  const mocks = [M.contact, M.consents]

  test('shows the attempt and what came of it', async () => {
    mount(
      <PlayerContactPanel playerId={PLAYER_ID} />,
      [
        { domain: 'crm.players', actions: ['view'] },
        { domain: 'crm.consent', actions: ['view'] },
      ],
      mocks
    )
    // The outcome is the point: "we called" without "nobody answered" is not a
    // contact history, it is a call log.
    await waitFor(() => assert.ok(screen.getAllByText(/no answer|NO_ANSWER/i).length > 0))
  })

  test('offers no way to record one without crm.tasks:manage', async () => {
    mount(
      <PlayerContactPanel playerId={PLAYER_ID} />,
      [{ domain: 'crm.players', actions: ['view'] }],
      mocks
    )
    await waitFor(() => assert.ok(screen.getAllByText(/no answer|NO_ANSWER/i).length > 0))
    assert.deepEqual(
      writeControls().map((b) => b.textContent),
      [],
      'a contact attempt could be recorded without crm.tasks:manage'
    )
  })

  test('offers it with crm.tasks:manage', async () => {
    mount(
      <PlayerContactPanel playerId={PLAYER_ID} />,
      [
        { domain: 'crm.players', actions: ['view'] },
        { domain: 'crm.tasks', actions: ['manage'] },
      ],
      mocks
    )
    await waitFor(() => assert.ok(screen.getAllByText(/no answer|NO_ANSWER/i).length > 0))
    assert.ok(writeControls().length > 0)
  })
})
