/**
 * /config/crm-access against a mocked GraphQL server (MockedProvider): the exact documents and variables, the
 * route-only guard (no in-page permission gate, as before), the drafts and their Save, the 0-500 seat clamp,
 * the toasts and refetch, loading, empty and error, and the first-administrator dialog. The typed password is a
 * placeholder and is checked never to reach the markup.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { CRM_CREATE_FIRST_ADMIN, CRM_WHITELABELS, SET_CRM_WHITELABEL_SETTINGS } from '@/lib/graphql/crm'
import CrmAccessPage from './CrmAccessPage'

const feedback = vi.hoisted(() => ({ toast: vi.fn(), rbac: vi.fn() }))

vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))
vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ children }: { children: ReactNode }) => {
    feedback.rbac()
    return <>{children}</>
  },
}))

interface Row {
  tenant: string
  name: string
  domain: string | null
  enabled: boolean
  seatLimit: number
  seatsUsed: number
}

interface ServerState {
  rows: Row[]
  queries: number
  saves: Array<Record<string, unknown>>
  creates: Array<Record<string, unknown>>
  createResult: { ok: boolean; error: string | null }
}

let server: ServerState

const PASSWORD = 'placeholder-pw-1'

function queryMock(): MockedResponse {
  return {
    request: { query: CRM_WHITELABELS },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => {
      server.queries += 1
      return { data: { crmWhitelabels: server.rows.map((row) => ({ __typename: 'CrmWhitelabel', ...row })) } }
    },
  }
}

function saveMock(): MockedResponse {
  return {
    request: { query: SET_CRM_WHITELABEL_SETTINGS },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Record<string, unknown>) => {
      server.saves.push(variables)
      const row = server.rows.find((candidate) => candidate.tenant === variables.tenant) as Row
      Object.assign(row, { enabled: variables.enabled, seatLimit: variables.seatLimit })
      return {
        data: {
          setCrmWhitelabelSettings: {
            __typename: 'CrmWhitelabelSettings',
            tenant: row.tenant,
            enabled: row.enabled,
            seatLimit: row.seatLimit,
            seatsUsed: row.seatsUsed,
            sessionIdleMinutes: null,
            enforceIpAllowlist: null,
            updatedAt: '2026-10-07T10:00:00.000Z',
          },
        },
      }
    },
  }
}

function failingSaveMock(): MockedResponse {
  return {
    request: { query: SET_CRM_WHITELABEL_SETTINGS },
    variableMatcher: (variables) => {
      server.saves.push(variables as Record<string, unknown>)
      return true
    },
    error: new Error('Seat limit refused'),
  }
}

function createMock(): MockedResponse {
  return {
    request: { query: CRM_CREATE_FIRST_ADMIN },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Record<string, unknown>) => {
      server.creates.push(variables)
      return { data: { crmCreateFirstAdmin: { __typename: 'CrmResult', ...server.createResult } } }
    },
  }
}

function renderPage(mocks: MockedResponse[] = [queryMock(), saveMock(), createMock()]) {
  return render(
    <MockedProvider mocks={mocks}>
      <MemoryRouter>
        <PageEyebrowProvider value="System">
          <CrmAccessPage />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

async function loaded() {
  await screen.findByRole('switch', { name: 'CRM for Floxi Gaming' })
}

function rowOf(text: string): HTMLElement {
  return screen.getByText(text).closest('tr') as HTMLElement
}

function seats(name: string): HTMLInputElement {
  return screen.getByRole('textbox', { name: `Seats for ${name}` }) as HTMLInputElement
}

function typeSeats(name: string, value: string) {
  const input = seats(name)
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

function lastToast() {
  return feedback.toast.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
}

beforeEach(() => {
  server = {
    rows: [
      { tenant: 'floxi', name: 'Floxi Gaming', domain: 'https://floxi.example', enabled: true, seatLimit: 5, seatsUsed: 2 },
      { tenant: 'acme', name: 'Acme Bets', domain: null, enabled: false, seatLimit: 0, seatsUsed: 0 },
      { tenant: 'nova', name: 'Nova Play', domain: 'nova.example', enabled: true, seatLimit: 3, seatsUsed: 0 },
    ],
    queries: 0,
    saves: [],
    creates: [],
    createResult: { ok: true, error: null },
  }
  feedback.toast.mockReset()
  feedback.rbac.mockReset()
})

describe('CrmAccessPage', () => {
  test('loads every whitelabel with the legacy copy, cells and states, and no in-page permission gate', async () => {
    renderPage()
    assert.ok(screen.getByText('Loading CRM access by whitelabel'))
    await loaded()

    assert.equal(server.queries, 1)
    assert.equal(feedback.rbac.mock.calls.length, 0, 'the page adds no RBACGuard; the route guard is adminRoute')
    assert.ok(screen.getByRole('heading', { level: 1, name: 'CRM Access' }))
    assert.ok(screen.queryByText('System') === null)
    assert.doesNotMatch(document.body.textContent ?? '', /Which whitelabels have a CRM at crm\.<their-domain>, and how\s+many people each may put on it\./)
    assert.ok(screen.getByText('Both gates start closed'))
    assert.ok(screen.getByText(/A whitelabel with no allowance here has no CRM: its crm\. address refuses every sign-in\./))
    assert.ok(screen.getByRole('heading', { level: 2, name: 'CRM Access' }))
    assert.deepStrictEqual(
      screen.getAllByRole('columnheader').map((cell) => cell.textContent),
      ['Whitelabel', 'CRM', 'Seats', 'In use', 'Actions'],
    )

    const floxi = rowOf('Floxi Gaming')
    assert.ok(within(floxi).getByText('crm.floxi.example'))
    assert.equal(within(floxi).getByRole('switch', { name: 'CRM for Floxi Gaming' }).getAttribute('aria-checked'), 'true')
    assert.ok(within(floxi).getByText('On'))
    assert.equal(seats('Floxi Gaming').value, '5')
    assert.equal(seats('Floxi Gaming').disabled, false)
    assert.match(seats('Floxi Gaming').getAttribute('aria-describedby') ?? '', /\S/)
    assert.ok(screen.getByText('Seats can be set from 0 to 500.'))
    assert.ok(within(floxi).getByText('2 of 5'))
    assert.equal((within(floxi).getByRole('button', { name: 'Save Floxi Gaming' }) as HTMLButtonElement).disabled, true)
    assert.equal(within(floxi).queryByRole('button', { name: /Create first administrator/ }), null)

    const acme = rowOf('Acme Bets')
    assert.ok(within(acme).getByText('acme'), 'no domain shows the tenant')
    assert.ok(within(acme).getByText('Off'))
    assert.equal(seats('Acme Bets').disabled, true)
    assert.ok(within(acme).getByText('—'))

    const nova = rowOf('Nova Play')
    assert.ok(within(nova).getByText('crm.nova.example'))
    assert.ok(within(nova).getByText('0 of 3'))
    assert.ok(within(nova).getByRole('button', { name: 'Create first administrator for Nova Play' }))
  })

  test('says so when there is no whitelabel, and shows a load failure above the table', async () => {
    server.rows = []
    const { unmount } = renderPage()
    await waitFor(() => assert.ok(screen.getByText('No data')))
    unmount()

    renderPage([{ request: { query: CRM_WHITELABELS }, error: new Error('Super Admin only') }])
    await screen.findByText('Could not load CRM access')
    assert.ok(screen.getByText('Super Admin only'))
    assert.ok(screen.getByText('No data'))
  })

  test('an edited row saves its draft with the exact variables, toasts, clears the draft and refetches', async () => {
    renderPage()
    await loaded()
    const floxi = rowOf('Floxi Gaming')
    const save = within(floxi).getByRole('button', { name: 'Save Floxi Gaming' }) as HTMLButtonElement

    typeSeats('Floxi Gaming', '12')
    assert.equal(save.disabled, false)
    assert.ok(within(floxi).getByText('2 of 12'), 'In use follows the draft limit')
    fireEvent.click(save)

    await waitFor(() => assert.equal(server.saves.length, 1))
    assert.deepStrictEqual(server.saves[0], { tenant: 'floxi', enabled: true, seatLimit: 12 })
    await waitFor(() =>
      assert.deepStrictEqual(lastToast(), {
        title: 'Saved',
        message: 'floxi may have up to 12 CRM users.',
        tone: 'ok',
        duration: 4500,
      }),
    )
    await waitFor(() => assert.equal(server.queries, 2))
    await waitFor(() => assert.equal((within(rowOf('Floxi Gaming')).getByRole('button', { name: 'Save Floxi Gaming' }) as HTMLButtonElement).disabled, true))
    assert.equal(seats('Floxi Gaming').value, '12')
  })

  test('switching a row off disables its seats and saves enabled false with the stored limit', async () => {
    renderPage()
    await loaded()
    fireEvent.click(screen.getByRole('switch', { name: 'CRM for Floxi Gaming' }))
    assert.equal(seats('Floxi Gaming').disabled, true)
    assert.ok(within(rowOf('Floxi Gaming')).getByText('Off'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Floxi Gaming' }))
    await waitFor(() => assert.equal(server.saves.length, 1))
    assert.deepStrictEqual(server.saves[0], { tenant: 'floxi', enabled: false, seatLimit: 5 })
    await waitFor(() => assert.equal(lastToast()?.message, 'The CRM is switched off for floxi.'))
  })

  test('seats: out-of-range entries clamp to 0-500 on blur, and a cleared field means 0', async () => {
    renderPage()
    await loaded()
    typeSeats('Floxi Gaming', '600')
    await waitFor(() => assert.equal(seats('Floxi Gaming').value, '500'))
    typeSeats('Floxi Gaming', '-4')
    await waitFor(() => assert.equal(seats('Floxi Gaming').value, '0'))
    typeSeats('Floxi Gaming', '')
    await waitFor(() => assert.equal(seats('Floxi Gaming').value, '0'))
    typeSeats('Floxi Gaming', '900')
    fireEvent.click(screen.getByRole('button', { name: 'Save Floxi Gaming' }))
    await waitFor(() => assert.equal(server.saves.length, 1))
    assert.deepStrictEqual(server.saves[0], { tenant: 'floxi', enabled: true, seatLimit: 500 })
  })

  test('seats stay within 0-500 while typing and with the arrow keys; a step at a bound changes nothing', async () => {
    server.rows[2] = { ...server.rows[2], seatLimit: 500 }
    renderPage()
    await loaded()
    const field = seats('Floxi Gaming')
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '600' } })
    assert.equal(field.value, '500', 'clamped while typing')
    assert.ok(within(rowOf('Floxi Gaming')).getByText('2 of 500'), 'the In use pill never shows 600')
    fireEvent.keyDown(field, { key: 'ArrowUp' })
    assert.equal(field.value, '500')
    assert.ok(within(rowOf('Floxi Gaming')).getByText('2 of 500'))
    fireEvent.keyDown(field, { key: 'ArrowDown', shiftKey: true })
    assert.equal(field.value, '490', 'the kit field takes an in-range step')
    fireEvent.keyDown(field, { key: 'ArrowUp', shiftKey: true })
    fireEvent.keyDown(field, { key: 'ArrowUp', shiftKey: true })
    assert.equal(field.value, '500', 'Shift+ArrowUp stops at 500')
    fireEvent.change(field, { target: { value: '0' } })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'ArrowDown', shiftKey: true })
    assert.equal(field.value, '0', 'ArrowDown stops at 0')
    assert.ok(within(rowOf('Floxi Gaming')).getByText('2 of 0'))
    fireEvent.blur(field)
    assert.equal(field.value, '0')

    // A row stored at 500: neither ArrowUp nor a typed 600 edits it, so its Save stays off.
    const nova = seats('Nova Play')
    fireEvent.keyDown(nova, { key: 'ArrowUp' })
    fireEvent.focus(nova)
    fireEvent.change(nova, { target: { value: '600' } })
    fireEvent.blur(nova)
    assert.equal(nova.value, '500')
    assert.equal((screen.getByRole('button', { name: 'Save Nova Play' }) as HTMLButtonElement).disabled, true)
    assert.ok(within(rowOf('Nova Play')).getByText('0 of 500'))
  })

  test('a failed save toasts the error and keeps the draft', async () => {
    renderPage([queryMock(), failingSaveMock(), createMock()])
    await loaded()
    typeSeats('Floxi Gaming', '7')
    fireEvent.click(screen.getByRole('button', { name: 'Save Floxi Gaming' }))
    await waitFor(() =>
      assert.deepStrictEqual(lastToast(), { title: 'Could not save', message: 'Seat limit refused', tone: 'error', duration: 4500 }),
    )
    assert.deepStrictEqual(server.saves[0], { tenant: 'floxi', enabled: true, seatLimit: 7 })
    assert.equal(seats('Floxi Gaming').value, '7')
    assert.equal((screen.getByRole('button', { name: 'Save Floxi Gaming' }) as HTMLButtonElement).disabled, false)
    assert.equal(server.queries, 1)
  })

  test('first administrator: required rules block the send, then the exact variables create it and close', async () => {
    renderPage()
    await loaded()
    const opener = screen.getByRole('button', { name: 'Create first administrator for Nova Play' })
    fireEvent.click(opener)

    const dialog = await screen.findByRole('dialog', { name: 'First CRM administrator for Nova Play' })
    assert.match(dialog.getAttribute('aria-describedby') ?? '', /\S/)
    assert.ok(within(dialog).getByText(/This account can create the whitelabel's other CRM users/))
    const name = within(dialog).getByRole('textbox', { name: 'Full name' }) as HTMLInputElement
    await waitFor(() => assert.ok(document.activeElement === name, 'focus starts in Full name'))
    const username = within(dialog).getByRole('textbox', { name: 'Username' }) as HTMLInputElement
    const password = within(dialog).getByLabelText('Temporary password') as HTMLInputElement
    const email = within(dialog).getByRole('textbox', { name: 'Email' }) as HTMLInputElement
    assert.equal(username.getAttribute('autocomplete'), 'off')
    assert.equal(password.type, 'password')
    assert.equal(password.getAttribute('autocomplete'), 'new-password')
    assert.equal(email.type, 'email')
    assert.equal(name.getAttribute('aria-required'), 'true')
    assert.ok(within(dialog).getByText('They will be asked to choose their own on first sign-in.'))

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await within(dialog).findByText('Please enter Full name')
    assert.ok(within(dialog).getByText('Please enter Username'))
    assert.ok(within(dialog).getByText('Please enter Temporary password'))
    assert.equal(server.creates.length, 0)

    fireEvent.change(name, { target: { value: 'Asha Menon' } })
    fireEvent.change(username, { target: { value: 'asha' } })
    fireEvent.change(password, { target: { value: 'short' } })
    fireEvent.blur(password)
    await within(dialog).findByText('At least 10 characters')
    fireEvent.change(password, { target: { value: PASSWORD } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => assert.equal(server.creates.length, 1))
    assert.deepStrictEqual(Object.keys(server.creates[0] ?? {}), ['tenant', 'name', 'username', 'password'])
    assert.equal(server.creates[0]?.tenant, 'nova')
    assert.equal(server.creates[0]?.name, 'Asha Menon')
    assert.equal(server.creates[0]?.username, 'asha')
    assert.equal(server.creates[0]?.password === PASSWORD, true)
    await waitFor(() =>
      assert.deepStrictEqual(lastToast(), {
        title: 'Administrator created',
        message: 'They can sign in at the CRM and will set their own password.',
        tone: 'ok',
        duration: 4500,
      }),
    )
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null, 'the dialog closed'))
    await waitFor(() => assert.equal(server.queries, 2))
    assert.equal(document.body.innerHTML.includes(PASSWORD), false, 'the password never reaches the markup')
  })

  test('first administrator: a refused create keeps the dialog with its values; Cancel closes and the next opening is empty', async () => {
    server.createResult = { ok: false, error: 'Username already taken' }
    renderPage()
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Create first administrator for Nova Play' }))
    const dialog = await screen.findByRole('dialog', { name: 'First CRM administrator for Nova Play' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Full name' }), { target: { value: 'Asha Menon' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Username' }), { target: { value: 'asha' } })
    fireEvent.change(within(dialog).getByLabelText('Temporary password'), { target: { value: PASSWORD } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Email' }), { target: { value: 'asha@nova.example' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      assert.deepStrictEqual(lastToast(), { title: 'Failed', message: 'Username already taken', tone: 'error', duration: 4500 }),
    )
    assert.equal(server.creates[0]?.email, 'asha@nova.example')
    assert.ok(screen.getByRole('dialog', { name: 'First CRM administrator for Nova Play' }))
    assert.equal((within(dialog).getByRole('textbox', { name: 'Username' }) as HTMLInputElement).value, 'asha')
    assert.equal(server.queries, 1)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null, 'the dialog closed'))
    fireEvent.click(screen.getByRole('button', { name: 'Create first administrator for Nova Play' }))
    const again = await screen.findByRole('dialog', { name: 'First CRM administrator for Nova Play' })
    assert.equal((within(again).getByRole('textbox', { name: 'Username' }) as HTMLInputElement).value, '')
    assert.equal((within(again).getByLabelText('Temporary password') as HTMLInputElement).value, '')
  })
})
