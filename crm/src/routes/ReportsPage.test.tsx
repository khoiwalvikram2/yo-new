import { test, describe, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, waitFor } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import { App as AntApp } from 'antd'
import { ReportsPage } from '@/routes/ReportsPage'
import { DESK_REPORT } from '@/lib/gql'
import { useAuth, type CrmMe, type CrmPermissionPair } from '@/state/auth'

/**
 * The reports screen renders numbers a supervisor acts on, so the tests pin the
 * renderings that change what a person concludes:
 *
 *   - minutes become "2h 12m", because 132 raw minutes reads as nothing;
 *   - a reach rate over zero attempts is "—", not NaN% or 0% — no attempts is
 *     not the same claim as none connecting;
 *   - the scope line says whose numbers these are, because the same page shows
 *     one book to one reader and the whitelabel to another.
 */

function me(permissions: CrmPermissionPair[], canViewAllPlayers = false): CrmMe {
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
    canViewAllPlayers,
    sessionIdleMinutes: 60,
    outOfOfficeUntil: null,
    delegateTo: null,
  }
}

const REPORT: CrmPermissionPair[] = [{ domain: 'crm.reports', actions: ['view'] }]

const report = (over: Record<string, unknown> = {}) => ({
  __typename: 'CrmDeskReport',
  from: new Date().toISOString(),
  to: new Date().toISOString(),
  tasks: {
    __typename: 'CrmReportTasks',
    created: 12,
    completed: 9,
    breached: 2,
    openNow: 5,
    avgMinutesToClose: 132,
    avgMinutesToAcknowledge: 30,
    byDay: [
      { __typename: 'CrmReportTaskDay', date: '2026-09-01', created: 6, completed: 4 },
      { __typename: 'CrmReportTaskDay', date: '2026-09-02', created: 6, completed: 5 },
    ],
  },
  contacts: {
    __typename: 'CrmReportContacts',
    attempts: 10,
    connected: 4,
    byChannel: [
      { __typename: 'CrmReportChannelRow', channel: 'call', attempts: 7, connected: 4 },
      { __typename: 'CrmReportChannelRow', channel: 'sms', attempts: 3, connected: 0 },
    ],
  },
  agents: [
    {
      __typename: 'CrmReportAgentRow',
      crmUserId: 'a1',
      name: 'Asha',
      tasksCompleted: 9,
      tasksBreached: 2,
      contactAttempts: 10,
      contactsConnected: 4,
      notesWritten: 3,
    },
  ],
  rg: { __typename: 'CrmReportRg', flagsRaised: 1, flagsLifted: 0, blocksActiveNow: 1 },
  ...over,
})

/** Matches whatever range the picker defaulted to — the variables are dates computed at render. */
const reportMock = (payload = report()) => ({
  request: { query: DESK_REPORT },
  variableMatcher: () => true,
  result: { data: { crmDeskReport: payload } },
  maxUsageCount: 5,
})

function mount(permissions: CrmPermissionPair[], mocks: unknown[], canViewAll = false) {
  useAuth.setState({ token: 'tok', me: me(permissions, canViewAll), lastActivityAt: Date.now() })
  return render(
    <MockedProvider mocks={mocks as never} addTypename>
      <MemoryRouter>
        <AntApp>
          <ReportsPage />
        </AntApp>
      </MemoryRouter>
    </MockedProvider>
  )
}

beforeEach(() => {
  useAuth.setState({ token: null, me: null, lastActivityAt: Date.now() })
})

describe('the reports screen', () => {
  test('shows the period’s numbers', async () => {
    mount(REPORT, [reportMock()])
    await waitFor(() => {
      assert.ok(screen.getByText('12'), 'created count missing')
      assert.ok(screen.getByText('Breached'))
      assert.ok(screen.getByText('Asha'), 'the per-person table is empty')
    })
  })

  test('renders minutes as hours once they pass an hour', async () => {
    mount(REPORT, [reportMock()])
    await waitFor(() => {
      // 132 minutes → 2h 12m. "132" as a headline number reads as nothing.
      assert.ok(screen.getByText('2h 12m'), 'avg close time was left in raw minutes')
      assert.ok(screen.getByText('30m'), 'sub-hour values should stay in minutes')
    })
  })

  test('a reach rate over zero attempts is em-dash, not a percentage', async () => {
    mount(REPORT, [
      reportMock(
        report({
          contacts: {
            __typename: 'CrmReportContacts',
            attempts: 0,
            connected: 0,
            byChannel: [],
          },
        })
      ),
    ])
    await waitFor(() => {
      // "Reach rate" appears in the contacts card and the per-person table.
      assert.ok(screen.getAllByText('Reach rate').length >= 1)
      assert.ok(screen.getAllByText('—').length > 0, 'zero attempts should read as —')
    })
    assert.equal(screen.queryByText(/NaN/), null, 'a NaN reached the screen')
  })

  test('says whose numbers these are', async () => {
    const { unmount } = mount(REPORT, [reportMock()], false)
    await waitFor(() => assert.ok(screen.getByText(/your books/i)))
    unmount()

    mount(REPORT, [reportMock()], true)
    await waitFor(() => assert.ok(screen.getByText(/whole whitelabel/i)))
  })

  test('draws one pair of bars per day', async () => {
    mount(REPORT, [reportMock()])
    await waitFor(() => {
      assert.equal(screen.getAllByTestId('bar-created').length, 2)
      assert.equal(screen.getAllByTestId('bar-completed').length, 2)
    })
  })
})
