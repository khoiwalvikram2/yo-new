import { test, describe, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, waitFor } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { App as AntApp } from 'antd'
import { PlayerDetailPage } from '@/routes/PlayerDetailPage'
import { useAuth, type CrmMe, type CrmPermissionPair } from '@/state/auth'
import {
  PLAYER,
  PLAYER_TIMELINE,
  RG_FLAGS,
  CONSENTS,
  CONSENT_HISTORY,
  PLAYER_NOTES,
  CONTACT_ATTEMPTS,
} from '@/lib/gql'

/**
 * Player 360, and the one thing it must refuse to reveal.
 *
 * `crmPlayer` returns null for a player who does not exist *and* for one who
 * exists in another agent's books, deliberately: an error that distinguished
 * the two would turn the screen into an oracle for "is this person a customer
 * here", which is exactly the question the book scoping exists to refuse.
 *
 * So the page must say the same thing in both cases, and must not leak the id
 * back either. Everything else here is ordinary: the profile renders, and the
 * flags that change what an agent may do to an account are visible rather than
 * buried.
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

function player(over: Record<string, unknown> = {}) {
  return {
    __typename: 'CrmPlayer',
    id: PLAYER_ID,
    name: 'Ravi Kumar',
    username: 'ravi',
    phone: '555-0100',
    email: null,
    status: 'active',
    playerType: 'REGULAR',
    createdAt: new Date('2025-01-05').toISOString(),
    lastLoginAt: null,
    cash: '1200',
    bonus: '0',
    exposure: '0',
    referralBalance: '0',
    bookId: 'b1',
    bookName: 'Book A',
    ownerName: 'Asha',
    riskType: null,
    remark: null,
    withdrawalLock: false,
    bonusAllowed: true,
    sportsBetAllowed: true,
    casinoBetAllowed: true,
    matkaBetAllowed: true,
    creditLimit: '0',
    creditUsed: '0',
    totalDeposits: '5000',
    depositCount: 3,
    totalWithdrawals: '1000',
    withdrawalCount: 1,
    totalStake: '8000',
    betCount: 42,
    firstBetAt: new Date('2025-01-06').toISOString(),
    lastBetAt: new Date('2025-02-01').toISOString(),
    ...over,
  }
}

/** The panels the page composes each query on mount; answer them all. */
const panelMocks = [
  {
    request: { query: RG_FLAGS, variables: { playerId: PLAYER_ID } },
    result: { data: { crmPlayerRgFlags: [] } },
    maxUsageCount: 20,
  },
  {
    request: { query: CONSENTS, variables: { playerId: PLAYER_ID } },
    result: { data: { crmPlayerConsents: [] } },
    maxUsageCount: 20,
  },
  {
    request: { query: CONSENT_HISTORY, variables: { playerId: PLAYER_ID, limit: 100 } },
    result: { data: { crmPlayerConsentHistory: [] } },
    maxUsageCount: 20,
  },
  {
    request: { query: PLAYER_NOTES, variables: { playerId: PLAYER_ID } },
    result: { data: { crmPlayerNotes: [] } },
    maxUsageCount: 20,
  },
  {
    request: { query: CONTACT_ATTEMPTS, variables: { playerId: PLAYER_ID } },
    result: { data: { crmContactAttempts: [] } },
    maxUsageCount: 20,
  },
]

const timelineMock = {
  request: {
    query: PLAYER_TIMELINE,
    variables: { playerId: PLAYER_ID, limit: 25, sources: null },
  },
  result: {
    data: {
      crmPlayerTimeline: {
        __typename: 'CrmTimelinePage',
        nextCursor: null,
        entries: [],
      },
    },
  },
  maxUsageCount: 20,
}

function mount(playerResult: unknown, permissions: CrmPermissionPair[] = []) {
  useAuth.setState({ token: 'tok', me: me(permissions), lastActivityAt: Date.now() })
  const mocks = [
    {
      request: { query: PLAYER, variables: { id: PLAYER_ID } },
      result: { data: { crmPlayer: playerResult } },
      maxUsageCount: 20,
    },
    timelineMock,
    ...panelMocks,
  ]
  return render(
    <MockedProvider mocks={mocks as never}>
      <MemoryRouter initialEntries={[`/players/${PLAYER_ID}`]}>
        <AntApp>
          <Routes>
            <Route path="/players/:id" element={<PlayerDetailPage />} />
            <Route path="/players" element={<div>players list</div>} />
          </Routes>
        </AntApp>
      </MemoryRouter>
    </MockedProvider>
  )
}

beforeEach(() => {
  useAuth.setState({ token: null, me: null, lastActivityAt: Date.now() })
})

describe('a player outside your books', () => {
  test('is indistinguishable from one who does not exist', async () => {
    // The server answers null to both. If the screen said "not in your books"
    // for one and "no such player" for the other, book scoping would leak the
    // existence of every customer in the whitelabel.
    mount(null)
    await waitFor(() => assert.ok(screen.getByText('Player not available')))
    assert.ok(screen.getByText(/not in your books, or does not exist/i))
  })

  test('does not echo the id back', async () => {
    mount(null)
    await waitFor(() => assert.ok(screen.getByText('Player not available')))
    assert.equal(screen.queryByText(new RegExp(`#${PLAYER_ID}\\b`)), null)
  })

  test('offers a way back rather than a dead end', async () => {
    mount(null)
    await waitFor(() => assert.ok(screen.getByRole('button', { name: /back to players/i })))
  })
})

describe('a player you can reach', () => {
  test('shows the profile', async () => {
    mount(player())
    await waitFor(() => assert.ok(screen.getByText('Ravi Kumar')))
    assert.ok(screen.getByText('ravi'))
    assert.ok(screen.getByText('555-0100'))
  })

  test('names the book they sit in, which is why you can see them', async () => {
    mount(player())
    await waitFor(() => assert.ok(screen.getAllByText(/Book A/).length > 0))
  })

  test('an absent field reads as absent rather than as blank', async () => {
    // A missing email rendered as nothing looks like a layout fault; an em dash
    // says the record is empty.
    mount(player({ email: null, lastLoginAt: null }))
    await waitFor(() => assert.ok(screen.getByText('Ravi Kumar')))
    assert.ok(screen.getAllByText('—').length > 0)
  })
})

describe('flags that change what may be done to the account', () => {
  test('a withdrawal lock is shown, not buried', async () => {
    // An agent who does not know withdrawals are locked will promise a payout
    // that cannot happen.
    mount(player({ withdrawalLock: true }))
    await waitFor(() => assert.ok(screen.getByText('Withdrawals locked')))
  })

  test('and is absent when there is no lock', async () => {
    mount(player({ withdrawalLock: false }))
    await waitFor(() => assert.ok(screen.getByText('Ravi Kumar')))
    assert.equal(screen.queryByText('Withdrawals locked'), null)
  })
})

describe('the panels it composes', () => {
  test('mounts safety, contact and notes together', async () => {
    // Player 360 is the point: the three sit on one screen so an agent does not
    // have to remember to look at the safety record before calling someone.
    mount(player(), [
      { domain: 'crm.rg', actions: ['view'] },
      { domain: 'crm.consent', actions: ['view'] },
      { domain: 'crm.notes', actions: ['view'] },
      { domain: 'crm.players', actions: ['view'] },
    ])
    await waitFor(() => assert.ok(screen.getByText('Ravi Kumar')))
    assert.ok(screen.getAllByText(/safety|responsible/i).length > 0)
    assert.ok(screen.getByText('Contact'))
    assert.ok(screen.getAllByText(/notes/i).length > 0)
  })
})
