import { test, describe, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import { App as AntApp } from 'antd'
import { PlayerDsarPanel } from '@/components/PlayerDsarPanel'
import { DSAR_ERASE } from '@/lib/gql'
import { useAuth, type CrmMe, type CrmPermissionPair } from '@/state/auth'

/**
 * The DSAR card.
 *
 * Its most important behaviour is absence: for anyone without a `crm.dsar`
 * permission the card must not exist at all — a data-request control on every
 * player page normalises pressing it. And the erase dialog must not arm until
 * a request reference is typed, because the server will refuse a reference-less
 * erasure and the refusal should never be how someone learns the rule.
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

function mount(permissions: CrmPermissionPair[], mocks: unknown[] = []) {
  useAuth.setState({ token: 'tok', me: me(permissions), lastActivityAt: Date.now() })
  return render(
    <MockedProvider mocks={mocks as never}>
      <MemoryRouter>
        <AntApp>
          <PlayerDsarPanel playerId="42" />
        </AntApp>
      </MemoryRouter>
    </MockedProvider>
  )
}

beforeEach(() => {
  useAuth.setState({ token: null, me: null, lastActivityAt: Date.now() })
})

describe('the data requests card', () => {
  test('does not exist for someone without a crm.dsar permission', () => {
    mount([
      { domain: 'crm.players', actions: ['view', 'view_all'] },
      { domain: 'crm.tasks', actions: ['view', 'manage'] },
    ])
    assert.equal(screen.queryByText('Data requests'), null, 'the card rendered without the permission')
  })

  test('offers export and erase separately, by their own actions', async () => {
    const { unmount } = mount([{ domain: 'crm.dsar', actions: ['export'] }])
    await waitFor(() => assert.ok(screen.getByText(/export their data/i)))
    assert.equal(screen.queryByText(/erase free text/i), null, 'erase offered on export alone')
    unmount()

    mount([{ domain: 'crm.dsar', actions: ['erase'] }])
    await waitFor(() => assert.ok(screen.getByText(/erase free text/i)))
    assert.equal(screen.queryByText(/export their data/i), null, 'export offered on erase alone')
  })

  test('the erase button stays disarmed until a request reference is typed', async () => {
    mount([{ domain: 'crm.dsar', actions: ['erase'] }])
    fireEvent.click(await waitFor(() => screen.getByText(/erase free text/i)))

    const dialog = await waitFor(() => {
      const el = document.querySelector('.ant-modal-content')
      assert.ok(el, 'no dialog opened')
      return el as HTMLElement
    })
    const eraseBtn = within(dialog)
      .getAllByRole('button')
      .find((b) => /^erase$/i.test((b.textContent ?? '').trim()))
    assert.ok(eraseBtn, 'no erase confirmation button')
    assert.equal((eraseBtn as HTMLButtonElement).disabled, true, 'erase armed with no reference')

    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'DSAR-2026-014' } })
    await waitFor(() => assert.equal((eraseBtn as HTMLButtonElement).disabled, false))
  })

  test('sends the reference with the erasure, and reports the counts back', async () => {
    let sent: Record<string, unknown> | null = null
    const erase = {
      request: { query: DSAR_ERASE, variables: { playerId: '42', reason: 'DSAR-2026-014' } },
      result: () => {
        sent = { playerId: '42', reason: 'DSAR-2026-014' }
        return {
          data: {
            crmDsarErase: {
              __typename: 'CrmDsarEraseResult',
              ok: true,
              error: null,
              notesRedacted: 3,
              contactNotesCleared: 1,
              tasksRedacted: 2,
            },
          },
        }
      },
    }

    mount([{ domain: 'crm.dsar', actions: ['erase'] }], [erase])
    fireEvent.click(await waitFor(() => screen.getByText(/erase free text/i)))
    const dialog = await waitFor(() => {
      const el = document.querySelector('.ant-modal-content')
      assert.ok(el)
      return el as HTMLElement
    })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'DSAR-2026-014' } })
    const eraseBtn = within(dialog)
      .getAllByRole('button')
      .find((b) => /^erase$/i.test((b.textContent ?? '').trim()))
    await waitFor(() => assert.equal((eraseBtn as HTMLButtonElement).disabled, false))
    fireEvent.click(eraseBtn!)

    await waitFor(() => {
      assert.ok(sent, 'the erasure was never sent')
      assert.ok(screen.getByText(/3 note/i), 'the counts were not reported back')
    })
  })
})
