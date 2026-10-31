import { test, describe, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import { App as AntApp } from 'antd'
import { testCache } from '@/test-utils'
import { DeskSettingsPage } from '@/routes/DeskSettingsPage'
import { DESK_CALENDAR, SET_DESK_CALENDAR } from '@/lib/gql'
import { useAuth, type CrmMe, type CrmPermissionPair } from '@/state/auth'

/**
 * The desk calendar screen.
 *
 * Its job is to make four numbers legible and to send them back unchanged.
 * Three things here are only visible from the browser side:
 *
 *   - a view-only holder must see the hours and be offered no way to change
 *     them, because the permission split is the whole reason `view` exists
 *     separately from `manage`;
 *   - the summary line has to turn `{540, 1260, [1..6]}` into something a
 *     person reads at a glance, and midnight is where that rendering breaks —
 *     minute 1440 formatted as a clock time reads as 00:00, which is the
 *     opposite of what it means;
 *   - a close time of 00:00 has to be *sent* as 1440, or a desk that runs to
 *     midnight is stored as a desk that is never open, which silently stops
 *     every escalation.
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

const VIEW: CrmPermissionPair[] = [{ domain: 'crm.settings', actions: ['view'] }]
const MANAGE: CrmPermissionPair[] = [{ domain: 'crm.settings', actions: ['view', 'manage'] }]

function calendar(over: Partial<Record<string, unknown>> = {}) {
  return {
    __typename: 'CrmDeskCalendar',
    timezone: 'Asia/Kolkata',
    openMinute: 540,
    closeMinute: 1260,
    days: [1, 2, 3, 4, 5, 6],
    isOpenNow: true,
    ...over,
  }
}

const readMock = (cal = calendar()) => ({
  request: { query: DESK_CALENDAR },
  result: { data: { crmDeskCalendar: cal } },
})

function mount(permissions: CrmPermissionPair[], mocks: unknown[]) {
  useAuth.setState({ token: 'tok', me: me(permissions), lastActivityAt: Date.now() })
  return render(
    <MockedProvider mocks={mocks as never} cache={testCache()}>
      <MemoryRouter>
        <AntApp>
          <DeskSettingsPage />
        </AntApp>
      </MemoryRouter>
    </MockedProvider>
  )
}

beforeEach(() => {
  useAuth.setState({ token: null, me: null, lastActivityAt: Date.now() })
})

describe('the desk calendar screen', () => {
  test('states the hours in a sentence rather than four separate fields', async () => {
    mount(MANAGE, [readMock()])
    await waitFor(() => {
      // "Mon–Sat" rather than six checkboxes read back one at a time.
      assert.ok(screen.getByText(/Mon–Sat/), 'the working week was not summarised')
      assert.ok(screen.getByText(/09:00–21:00/), 'the hours were not summarised')
      assert.ok(screen.getByText(/Asia\/Kolkata/), 'the zone was not named')
    })
  })

  test('renders a close of midnight as 24:00, not 00:00', async () => {
    // 1440 through a clock formatter reads as 00:00, which says the desk shuts
    // the moment it opens.
    mount(MANAGE, [readMock(calendar({ openMinute: 540, closeMinute: 1440 }))])
    await waitFor(() => {
      assert.ok(screen.getByText(/09:00–24:00/), 'midnight was rendered as the start of the day')
    })
  })

  test('says whether the desk is open now, answered in the desk’s own zone', async () => {
    mount(MANAGE, [readMock(calendar({ isOpenNow: false }))])
    await waitFor(() => {
      assert.ok(screen.getByText(/closed now/i), 'the current state was not shown')
    })
  })

  test('offers no way to save on view alone', async () => {
    mount(VIEW, [readMock()])
    await waitFor(() => {
      assert.ok(screen.getByText(/Mon–Sat/), 'the page never loaded')
    })
    assert.equal(
      screen.queryByRole('button', { name: /save desk calendar/i }),
      null,
      'a view-only holder was offered a save button'
    )
    assert.ok(
      screen.getByText(/can see the desk calendar but not change it/i),
      'the screen did not explain why there is nothing to press'
    )
  })

  test('offers the save control with manage, and sends the values it was shown', async () => {
    let sent: Record<string, unknown> | null = null
    const write = {
      request: {
        query: SET_DESK_CALENDAR,
        variables: { timezone: 'Asia/Kolkata', openMinute: 540, closeMinute: 1260, days: [1, 2, 3, 4, 5, 6] },
      },
      result: () => {
        sent = { timezone: 'Asia/Kolkata', openMinute: 540, closeMinute: 1260, days: [1, 2, 3, 4, 5, 6] }
        return { data: { crmSetDeskCalendar: { __typename: 'CrmMutationResult', ok: true, error: null } } }
      },
    }

    mount(MANAGE, [readMock(), write, readMock()])

    const save = await waitFor(() => {
      const b = screen.getByRole('button', { name: /save desk calendar/i })
      assert.ok(b)
      return b
    })
    fireEvent.click(save)

    await waitFor(() => {
      assert.ok(sent, 'the mutation was never sent')
    })
  })

  test('sends a midnight close as 1440, not as minute zero', async () => {
    // The one transformation this screen makes. Getting it wrong stores a desk
    // that is never open, which stops every escalation and reports nothing.
    let sentClose: number | null = null
    const write = {
      request: {
        query: SET_DESK_CALENDAR,
        variables: { timezone: 'Asia/Kolkata', openMinute: 540, closeMinute: 1440, days: [1, 2, 3, 4, 5, 6] },
      },
      result: () => {
        sentClose = 1440
        return { data: { crmSetDeskCalendar: { __typename: 'CrmMutationResult', ok: true, error: null } } }
      },
    }

    mount(MANAGE, [readMock(calendar({ closeMinute: 1440 })), write, readMock(calendar({ closeMinute: 1440 }))])

    const save = await waitFor(() => screen.getByRole('button', { name: /save desk calendar/i }))
    fireEvent.click(save)

    await waitFor(() => {
      assert.equal(sentClose, 1440, 'midnight was sent as minute zero')
    })
  })

  test('shows the server’s refusal rather than reporting success', async () => {
    const write = {
      request: {
        query: SET_DESK_CALENDAR,
        variables: { timezone: 'Asia/Kolkata', openMinute: 540, closeMinute: 1260, days: [1, 2, 3, 4, 5, 6] },
      },
      result: {
        data: {
          crmSetDeskCalendar: {
            __typename: 'CrmMutationResult',
            ok: false,
            error: 'The desk must open before it closes',
          },
        },
      },
    }

    mount(MANAGE, [readMock(), write])

    const save = await waitFor(() => screen.getByRole('button', { name: /save desk calendar/i }))
    fireEvent.click(save)

    await waitFor(() => {
      assert.ok(
        screen.getByText(/must open before it closes/i),
        'a refused save did not say why'
      )
    })
  })
})
