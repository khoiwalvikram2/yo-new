/**
 * /config/crm-users against a mocked GraphQL server (MockedProvider): the exact documents and variables, the
 * route-only guard and the Super Admin's whitelabel picker, the seat allowance, loading, empty and switched
 * off, the row actions (status, remove with its confirmation) and the four dialogs, each mounted with the
 * record it edits. Typed passwords are placeholders and are checked never to reach the markup.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import type { ReactNode } from 'react'
import type { DocumentNode } from 'graphql'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import {
  CRM_WHITELABELS,
  WHITELABEL_CRM_CREATE_USER,
  WHITELABEL_CRM_DELETE_USER,
  WHITELABEL_CRM_RESET_PASSWORD,
  WHITELABEL_CRM_ROLES,
  WHITELABEL_CRM_SET_USER_ROLES,
  WHITELABEL_CRM_SET_USER_STATUS,
  WHITELABEL_CRM_UPDATE_USER,
  WHITELABEL_CRM_USERS,
} from '@/lib/graphql/crm'
import type { ConfirmOptions } from '@/ui/components/confirm'
import CrmUsersPage from './CrmUsersPage'

const feedback = vi.hoisted(() => ({ toast: vi.fn(), confirm: vi.fn(), rbac: vi.fn() }))

vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))
vi.mock('@/ui/components/confirm', () => ({ confirm: feedback.confirm }))
vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ children }: { children: ReactNode }) => {
    feedback.rbac()
    return <>{children}</>
  },
}))

interface User {
  id: string
  name: string
  username: string | null
  email: string | null
  phone: string | null
  status: string
  requirePasswordReset: boolean
  lastLoginAt: string | null
  lastSeenAt: string | null
  createdAt: string
  roleNames: string[]
  roleIds: string[]
}

type Vars = Record<string, unknown>

interface ServerState {
  enabled: boolean
  seatLimit: number
  seatsUsed: number
  canChooseTenant: boolean
  users: User[]
  userQueries: Vars[]
  roleQueries: Vars[]
  whitelabelQueries: number
  calls: Record<string, Vars[]>
  results: Record<string, { ok: boolean; error: string | null } | Error>
}

let server: ServerState

const PASSWORD = 'placeholder-pw-2'

const ASHA: User = {
  id: 'u1',
  name: 'Asha Menon',
  username: 'asha',
  email: null,
  phone: '9876543210',
  status: 'ACTIVE',
  requirePasswordReset: true,
  lastLoginAt: null,
  lastSeenAt: '2026-10-04T09:48:00.000Z',
  createdAt: '2026-09-01T10:00:00.000Z',
  roleNames: ['Retention'],
  roleIds: ['r2'],
}

const VIVEK: User = {
  id: 'u2',
  name: 'Vivek T.',
  username: null,
  email: 'vivek@floxi.example',
  phone: null,
  status: 'SUSPENDED',
  requirePasswordReset: false,
  lastLoginAt: null,
  lastSeenAt: null,
  createdAt: '2026-09-02T10:00:00.000Z',
  roleNames: [],
  roleIds: [],
}

function usersMock(): MockedResponse {
  return {
    request: { query: WHITELABEL_CRM_USERS },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Vars) => {
      server.userQueries.push(variables)
      return {
        data: {
          whitelabelCrmUsers: {
            __typename: 'WhitelabelCrmUsersPage',
            tenant: (variables.tenant as string | null) ?? 'floxi',
            enabled: server.enabled,
            seatLimit: server.seatLimit,
            seatsUsed: server.seatsUsed,
            canChooseTenant: server.canChooseTenant,
            users: server.users.map((user) => ({ __typename: 'CrmUser', ...user })),
          },
        },
      }
    },
  }
}

function rolesMock(): MockedResponse {
  return {
    request: { query: WHITELABEL_CRM_ROLES },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Vars) => {
      server.roleQueries.push(variables)
      return {
        data: {
          whitelabelCrmRoles: [
            { __typename: 'CrmRole', id: 'r1', name: 'Administrator', description: null, isSystem: true },
            { __typename: 'CrmRole', id: 'r2', name: 'Retention', description: null, isSystem: false },
            { __typename: 'CrmRole', id: 'r3', name: 'VIP', description: null, isSystem: false },
          ],
        },
      }
    },
  }
}

function whitelabelsMock(): MockedResponse {
  return {
    request: { query: CRM_WHITELABELS },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => {
      server.whitelabelQueries += 1
      return {
        data: {
          crmWhitelabels: [
            { __typename: 'CrmWhitelabel', tenant: 'floxi', name: 'Floxi Gaming', domain: null, enabled: true, seatLimit: 5, seatsUsed: 2 },
            { __typename: 'CrmWhitelabel', tenant: 'nova', name: 'Nova Play', domain: null, enabled: true, seatLimit: 3, seatsUsed: 0 },
          ],
        },
      }
    },
  }
}

function mutationMock(query: DocumentNode, key: string): MockedResponse {
  return {
    request: { query },
    variableMatcher: (variables) => {
      ;(server.calls[key] ??= []).push(variables as Vars)
      return true
    },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => {
      const outcome = server.results[key] ?? { ok: true, error: null }
      if (outcome instanceof Error) return { errors: [{ message: outcome.message }] }
      return { data: { [key]: { __typename: 'CrmResult', ...outcome } } }
    },
  }
}

function mocks(): MockedResponse[] {
  return [
    usersMock(),
    rolesMock(),
    whitelabelsMock(),
    mutationMock(WHITELABEL_CRM_CREATE_USER, 'whitelabelCrmCreateUser'),
    mutationMock(WHITELABEL_CRM_UPDATE_USER, 'whitelabelCrmUpdateUser'),
    mutationMock(WHITELABEL_CRM_SET_USER_STATUS, 'whitelabelCrmSetUserStatus'),
    mutationMock(WHITELABEL_CRM_RESET_PASSWORD, 'whitelabelCrmResetPassword'),
    mutationMock(WHITELABEL_CRM_SET_USER_ROLES, 'whitelabelCrmSetUserRoles'),
    mutationMock(WHITELABEL_CRM_DELETE_USER, 'whitelabelCrmDeleteUser'),
  ]
}

function renderPage() {
  return render(
    <MockedProvider mocks={mocks()}>
      <MemoryRouter>
        <PageEyebrowProvider value="System">
          <CrmUsersPage />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

async function loaded() {
  await screen.findByText('Asha Menon')
}

function rowOf(text: string): HTMLElement {
  return screen.getByText(text).closest('tr') as HTMLElement
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement
}

function lastToast() {
  return feedback.toast.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
}

async function openDialog(trigger: string, title: string) {
  fireEvent.click(button(trigger))
  return screen.findByRole('dialog', { name: title })
}

async function chooseOption(dialog: HTMLElement, label: string) {
  fireEvent.keyDown(within(dialog).getByRole('combobox', { name: 'Roles' }), { key: 'ArrowDown' })
  await screen.findByRole('listbox')
  fireEvent.click(screen.getByRole('option', { name: label }))
}

beforeEach(() => {
  server = {
    enabled: true,
    seatLimit: 5,
    seatsUsed: 2,
    canChooseTenant: false,
    users: [{ ...ASHA }, { ...VIVEK }],
    userQueries: [],
    roleQueries: [],
    whitelabelQueries: 0,
    calls: {},
    results: {},
  }
  feedback.toast.mockReset()
  feedback.confirm.mockReset()
  feedback.confirm.mockResolvedValue(false)
  feedback.rbac.mockReset()
})

describe('CrmUsersPage', () => {
  test('loads the users with the legacy copy, cells, seat allowance and actions, behind the route guard only', async () => {
    renderPage()
    assert.ok(screen.getByText('Loading CRM users'))
    assert.equal(button('New CRM user').disabled, true, 'nothing can be created before the answer')
    assert.equal(screen.queryByText('The CRM is switched off for this whitelabel'), null, 'no switched-off flash while loading')
    await loaded()

    assert.deepStrictEqual(server.userQueries, [{ tenant: null }])
    await waitFor(() => assert.deepStrictEqual(server.roleQueries, [{ tenant: null }]))
    assert.equal(server.whitelabelQueries, 0, 'only a Super Admin reads the whitelabel list')
    assert.equal(feedback.rbac.mock.calls.length, 0, 'the page adds no RBACGuard; the route guard is adminRoute')
    assert.equal(screen.queryByRole('combobox', { name: 'Whitelabel' }), null)

    assert.ok(screen.getByRole('heading', { level: 1, name: 'CRM Users' }))
    assert.ok(screen.queryByText('System') === null)
    assert.ok(screen.queryByText(
        'Logins for the CRM at crm.<your domain>. These are separate accounts from the admin panel — a CRM user cannot sign in here, and an admin cannot sign in there.',
      ) === null)
    assert.ok(screen.getByRole('heading', { level: 2, name: 'CRM Users' }))
    assert.ok(screen.getByText('2 of 5 seats used'))
    assert.ok(screen.queryByText('Every seat is taken. A Super Admin can raise the allowance.') === null)
    assert.equal(button('New CRM user').disabled, false)
    assert.deepStrictEqual(
      screen.getAllByRole('columnheader').map((cell) => cell.textContent),
      ['User', 'Roles', 'Status', 'Last seen', 'Actions'],
    )

    const asha = rowOf('Asha Menon')
    assert.ok(within(asha).getByText('asha'))
    assert.ok(within(asha).getByText('Retention'))
    assert.ok(within(asha).getByText('ACTIVE'))
    assert.ok(within(asha).getByText('must change password'))
    assert.ok(
      within(asha).getByText(
        new Date('2026-10-04T09:48:00.000Z').toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
      ),
    )
    for (const name of ['Edit Asha Menon', 'Roles for Asha Menon', 'Reset password for Asha Menon', 'Suspend Asha Menon', 'Remove Asha Menon']) {
      assert.equal(within(asha).getByRole('button', { name }).hasAttribute('disabled'), false, name)
    }

    const vivek = rowOf('Vivek T.')
    assert.ok(within(vivek).getByText('None'), 'no roles')
    assert.ok(within(vivek).getByText('SUSPENDED'))
    assert.equal(within(vivek).queryByText('must change password'), null)
    assert.ok(within(vivek).getByRole('button', { name: 'Reinstate Vivek T.' }))
    assert.equal(within(vivek).getAllByText('—').length, 2, 'no username and never seen')
  })

  test('empty, full and switched off', async () => {
    server.users = []
    server.seatsUsed = 5
    const { unmount } = renderPage()
    await screen.findByText('No CRM users yet. The first one you create can sign in immediately.')
    assert.ok(screen.getByText('5 of 5 seats used'))
    assert.ok(screen.getByText('Every seat is taken. A Super Admin can raise the allowance.'))
    assert.equal(button('New CRM user').disabled, true)
    unmount()

    server.users = [{ ...ASHA }]
    server.enabled = false
    server.roleQueries = []
    renderPage()
    await screen.findByText('The CRM is switched off for this whitelabel')
    assert.ok(
      screen.getByText(
        /Existing users are listed below but nothing can be changed\. Only a Super Admin can switch the CRM on,\s+from Config → CRM Access\./,
      ),
    )
    assert.ok(screen.queryByText(/seats used/) === null)
    assert.equal(button('New CRM user').disabled, true)
    for (const name of ['Edit Asha Menon', 'Roles for Asha Menon', 'Reset password for Asha Menon', 'Suspend Asha Menon', 'Remove Asha Menon']) {
      assert.equal(button(name).disabled, true, name)
    }
    assert.deepStrictEqual(server.roleQueries, [], 'roles are not read while the CRM is off')
  })

  test('a Super Admin picks the whitelabel; the users and roles follow it', async () => {
    server.canChooseTenant = true
    renderPage()
    await loaded()
    const picker = (await screen.findByRole('combobox', { name: 'Whitelabel' })) as HTMLSelectElement
    await waitFor(() => assert.equal(within(picker).getAllByRole('option').length, 3))
    assert.deepStrictEqual(
      within(picker).getAllByRole('option').map((option) => option.textContent),
      ['Whitelabel', 'Floxi Gaming', 'Nova Play'],
    )
    assert.equal(picker.value, '')
    fireEvent.change(picker, { target: { value: 'nova' } })
    await waitFor(() => assert.deepStrictEqual(server.userQueries.at(-1), { tenant: 'nova' }))
    await waitFor(() => assert.deepStrictEqual(server.roleQueries.at(-1), { tenant: 'nova' }))
    assert.equal(server.whitelabelQueries, 1)
  })

  test('Suspend sends the next status and reports with the legacy toast, then reloads', async () => {
    renderPage()
    await loaded()
    fireEvent.click(button('Suspend Asha Menon'))
    await waitFor(() => assert.equal(server.calls.whitelabelCrmSetUserStatus?.length, 1))
    assert.deepStrictEqual(server.calls.whitelabelCrmSetUserStatus?.[0], { tenant: null, id: 'u1', status: 'SUSPENDED' })
    await waitFor(() => assert.deepStrictEqual(lastToast(), { title: 'Saved', message: 'Status changed', tone: 'ok', duration: 4500 }))
    await waitFor(() => assert.equal(server.userQueries.length, 2))

    fireEvent.click(button('Reinstate Vivek T.'))
    await waitFor(() => assert.equal(server.calls.whitelabelCrmSetUserStatus?.length, 2))
    assert.deepStrictEqual(server.calls.whitelabelCrmSetUserStatus?.[1], { tenant: null, id: 'u2', status: 'ACTIVE' })
  })

  test('Remove asks with the legacy copy and removes only when confirmed', async () => {
    renderPage()
    await loaded()
    fireEvent.click(button('Remove Asha Menon'))
    await waitFor(() => assert.equal(feedback.confirm.mock.calls.length, 1))
    const options = feedback.confirm.mock.calls[0]?.[0] as ConfirmOptions
    assert.deepStrictEqual(
      { title: options.title, description: options.description, confirmLabel: options.confirmLabel, cancelLabel: options.cancelLabel, tone: options.tone },
      {
        title: 'Remove this CRM user?',
        description:
          'Suspending is usually what you want. Removing takes their name off the record of every player whose contact details they read — that trail cannot be restored.',
        confirmLabel: 'Remove',
        cancelLabel: 'Cancel',
        tone: 'danger',
      },
    )
    assert.equal(server.calls.whitelabelCrmDeleteUser, undefined, 'a cancelled confirmation sends nothing')

    feedback.confirm.mockImplementation(async (confirmOptions: ConfirmOptions) => {
      await confirmOptions.onConfirm?.()
      return true
    })
    fireEvent.click(button('Remove Asha Menon'))
    await waitFor(() => assert.equal(server.calls.whitelabelCrmDeleteUser?.length, 1))
    assert.deepStrictEqual(server.calls.whitelabelCrmDeleteUser?.[0], { tenant: null, id: 'u1' })
    await waitFor(() => assert.deepStrictEqual(lastToast(), { title: 'Saved', message: 'User removed', tone: 'ok', duration: 4500 }))
  })

  test('New CRM user: the legacy rules block the send; the exact input creates it, toasts and closes', async () => {
    renderPage()
    await loaded()
    const dialog = await openDialog('New CRM user', 'New CRM user')
    assert.ok(within(dialog).getByText(/They sign in at the CRM, not here\./))
    const name = within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    await waitFor(() => assert.ok(document.activeElement === name, 'focus starts in Name'))
    assert.equal(name.getAttribute('placeholder'), 'Asha Menon')
    const username = within(dialog).getByRole('textbox', { name: 'Username' }) as HTMLInputElement
    assert.equal(username.getAttribute('placeholder'), 'asha')
    assert.equal(username.getAttribute('autocomplete'), 'off')
    const password = within(dialog).getByLabelText('Password') as HTMLInputElement
    assert.equal(password.type, 'password')
    assert.equal(password.getAttribute('autocomplete'), 'new-password')
    assert.ok(within(dialog).getByText('Without a role they can sign in and do nothing.'))

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await within(dialog).findByText('Please enter Name')
    assert.ok(within(dialog).getByText('Please enter Username'))
    assert.ok(within(dialog).getByText('At least 10 characters'))
    assert.equal(server.calls.whitelabelCrmCreateUser, undefined)

    fireEvent.change(name, { target: { value: 'Ritu M.' } })
    fireEvent.change(username, { target: { value: 'ritu' } })
    fireEvent.change(password, { target: { value: PASSWORD } })
    await chooseOption(dialog, 'Retention')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => assert.equal(server.calls.whitelabelCrmCreateUser?.length, 1))
    const sent = server.calls.whitelabelCrmCreateUser?.[0] as { tenant: null; input: Record<string, unknown> }
    assert.equal(sent.tenant, null)
    assert.deepStrictEqual(Object.keys(sent.input), ['name', 'username', 'password', 'roleIds'])
    assert.equal(sent.input.name, 'Ritu M.')
    assert.equal(sent.input.username, 'ritu')
    assert.equal(sent.input.password === PASSWORD, true)
    assert.deepStrictEqual(sent.input.roleIds, ['r2'])
    await waitFor(() => assert.deepStrictEqual(lastToast(), { title: 'Saved', message: 'CRM user created', tone: 'ok', duration: 4500 }))
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null, 'the dialog closed'))
    await waitFor(() => assert.equal(server.userQueries.length, 2))
    assert.equal(document.body.innerHTML.includes(PASSWORD), false)
  })

  test('New CRM user: a refused create stays open with its values; a thrown one shows its message in the dialog', async () => {
    server.results.whitelabelCrmCreateUser = { ok: false, error: 'No seats left' }
    renderPage()
    await loaded()
    const dialog = await openDialog('New CRM user', 'New CRM user')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'Ritu M.' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Username' }), { target: { value: 'ritu' } })
    fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: PASSWORD } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Email' }), { target: { value: 'ritu@floxi.example' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => assert.deepStrictEqual(lastToast(), { title: 'Failed', message: 'No seats left', tone: 'error', duration: 4500 }))
    assert.equal((server.calls.whitelabelCrmCreateUser?.[0]?.input as Record<string, unknown>).email, 'ritu@floxi.example')
    assert.deepStrictEqual((server.calls.whitelabelCrmCreateUser?.[0]?.input as Record<string, unknown>).roleIds, [])
    assert.ok(screen.getByRole('dialog', { name: 'New CRM user' }))
    assert.equal((within(dialog).getByRole('textbox', { name: 'Username' }) as HTMLInputElement).value, 'ritu')

    server.results.whitelabelCrmCreateUser = new Error('Username is taken')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await within(dialog).findByText('Username is taken')
    assert.ok(screen.getByRole('dialog', { name: 'New CRM user' }))
  })

  test('Edit opens with the record already in the form and sends id, name, email and phone', async () => {
    renderPage()
    await loaded()
    const dialog = await openDialog('Edit Asha Menon', 'Edit Asha Menon')
    const name = within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    assert.equal(name.value, 'Asha Menon', 'the first render already holds the record')
    assert.equal((within(dialog).getByRole('textbox', { name: 'Email' }) as HTMLInputElement).value, '')
    assert.equal((within(dialog).getByRole('textbox', { name: 'Phone' }) as HTMLInputElement).value, '9876543210')

    fireEvent.change(name, { target: { value: '' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await within(dialog).findByText('Please enter Name')
    assert.equal(server.calls.whitelabelCrmUpdateUser, undefined)

    fireEvent.change(name, { target: { value: 'Asha M.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => assert.equal(server.calls.whitelabelCrmUpdateUser?.length, 1))
    assert.deepStrictEqual(server.calls.whitelabelCrmUpdateUser?.[0], {
      tenant: null,
      input: { id: 'u1', name: 'Asha M.', email: null, phone: '9876543210' },
    })
    await waitFor(() => assert.deepStrictEqual(lastToast(), { title: 'Saved', message: 'Saved', tone: 'ok', duration: 4500 }))
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null, 'the dialog closed'))
  })

  test('Reset password: one message for a short password, then the exact variables; the next opening is empty', async () => {
    renderPage()
    await loaded()
    let dialog = await openDialog('Reset password for Asha Menon', 'Reset password for Asha Menon')
    assert.ok(within(dialog).getByText(/so a password you send over chat cannot stay in use\./))
    let password = within(dialog).getByLabelText('New password') as HTMLInputElement
    await waitFor(() => assert.ok(document.activeElement === password, 'focus starts in New password'))
    assert.equal(password.getAttribute('autocomplete'), 'new-password')
    fireEvent.change(password, { target: { value: 'short' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }))
    await within(dialog).findByText('At least 10 characters')
    assert.equal(server.calls.whitelabelCrmResetPassword, undefined)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null, 'the dialog closed'))
    dialog = await openDialog('Reset password for Asha Menon', 'Reset password for Asha Menon')
    password = within(dialog).getByLabelText('New password') as HTMLInputElement
    assert.equal(password.value, '', 'a typed password does not survive Cancel')

    fireEvent.change(password, { target: { value: PASSWORD } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }))
    await waitFor(() => assert.equal(server.calls.whitelabelCrmResetPassword?.length, 1))
    const sent = server.calls.whitelabelCrmResetPassword?.[0] as Vars
    assert.deepStrictEqual(Object.keys(sent), ['tenant', 'id', 'newPassword'])
    assert.equal(sent.tenant, null)
    assert.equal(sent.id, 'u1')
    assert.equal(sent.newPassword === PASSWORD, true)
    await waitFor(() => assert.deepStrictEqual(lastToast(), { title: 'Saved', message: 'Password reset', tone: 'ok', duration: 4500 }))
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null, 'the dialog closed'))
    assert.equal(document.body.innerHTML.includes(PASSWORD), false)
  })

  test('Roles opens with the user roles chosen, marks the system role, and sends the new list', async () => {
    renderPage()
    await loaded()
    await waitFor(() => assert.equal(server.roleQueries.length, 1))
    const dialog = await openDialog('Roles for Asha Menon', 'Roles for Asha Menon')
    assert.ok(within(dialog).getByRole('button', { name: 'Remove Retention' }), 'the record roles are chosen at first render')
    fireEvent.keyDown(within(dialog).getByRole('combobox', { name: 'Roles' }), { key: 'ArrowDown' })
    await screen.findByRole('listbox')
    assert.deepStrictEqual(
      screen.getAllByRole('option').map((option) => option.textContent),
      ['Administrator (full access)', 'Retention', 'VIP'],
    )
    fireEvent.click(screen.getByRole('option', { name: 'VIP' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Retention' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => assert.equal(server.calls.whitelabelCrmSetUserRoles?.length, 1))
    assert.deepStrictEqual(server.calls.whitelabelCrmSetUserRoles?.[0], { tenant: null, id: 'u1', roleIds: ['r3'] })
    await waitFor(() => assert.deepStrictEqual(lastToast(), { title: 'Saved', message: 'Roles updated', tone: 'ok', duration: 4500 }))
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null, 'the dialog closed'))
  })
})
