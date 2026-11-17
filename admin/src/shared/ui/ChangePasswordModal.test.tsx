/**
 * The Change Password dialog on the real kit Dialog, Form and PasswordField, against MockedProvider:
 * the exact admin and agent documents, their variables and the notification context; the legacy rules
 * and messages; the failed-submit summary and first-invalid focus; the success, false-success, GraphQL
 * error and network error paths; reset on every way out; single flight; and that no typed secret
 * reaches the markup, the console or storage. The auth store is a stub (isAgent, the session's token and
 * logout) and the kit toast is a spy. Every password is an obviously fake placeholder typed here.
 *
 * An admin's change ends every session of that admin on the server (users.token_version moves on), so a
 * successful one signs the panel out and asks for a sign-in with the new password; before, the next request
 * met a generic "Session ended". An agent's change leaves its session standing.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { ApolloLink, Observable } from '@apollo/client'
import { GraphQLError, parse, print, type DocumentNode } from 'graphql'
import { ChangePasswordModal } from './ChangePasswordModal'

const auth = vi.hoisted(() => ({ isAgent: false, token: 'session-token' as string | undefined, logout: vi.fn() }))
const feedback = vi.hoisted(() => ({ toast: vi.fn() }))
const apollo = vi.hoisted(() => ({
  mutations: [] as Array<{ mutation: DocumentNode; options: unknown }>,
}))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  return {
    ...actual,
    useMutation: (...args: Parameters<typeof actual.useMutation>) => {
      apollo.mutations.push({ mutation: args[0] as DocumentNode, options: args[1] })
      return actual.useMutation(...args)
    },
  }
})

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: <T,>(selector: (state: { isAgent: () => boolean; token?: string; logout: () => void }) => T) =>
    selector({ isAgent: () => auth.isAgent, token: auth.token, logout: auth.logout }),
}))

vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))

/* The two legacy documents, written out here as plain strings (not gql-tagged) so a change to the
   component's documents fails the match below. */
const ADMIN_DOCUMENT = parse(
  'mutation ChangeAdminPassword($currentPassword: String!, $newPassword: String!) {'
  + ' changeAdminPassword(currentPassword: $currentPassword, newPassword: $newPassword) { success message } }',
)
const AGENT_DOCUMENT = parse(
  'mutation ChangeAgentPassword($currentPassword: String!, $newPassword: String!) {'
  + ' agents { changeAgentPassword(currentPassword: $currentPassword, newPassword: $newPassword) { success message } } }',
)

const OLD = 'old-pass-1'
const NEW = 'New-pass-22'

interface Payload {
  success: boolean
  message: string | null
}

function adminMock(payload: Payload, counter?: { count: number }, delay?: number): MockedResponse {
  return {
    request: { query: ADMIN_DOCUMENT, variables: { currentPassword: OLD, newPassword: NEW } },
    delay,
    maxUsageCount: counter ? Number.POSITIVE_INFINITY : 1,
    result: () => {
      if (counter) counter.count += 1
      return { data: { changeAdminPassword: { __typename: 'PasswordChangeResult', ...payload } } }
    },
  }
}

function agentMock(payload: Payload, newPassword: string): MockedResponse {
  return {
    request: { query: AGENT_DOCUMENT, variables: { currentPassword: OLD, newPassword } },
    result: {
      data: {
        agents: {
          __typename: 'AgentMutations',
          changeAgentPassword: { __typename: 'PasswordChangeResult', ...payload },
        },
      },
    },
  }
}

function Harness({ onClose, initialOpen }: { onClose: () => void; initialOpen: boolean }) {
  const [open, setOpen] = useState(initialOpen)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open change password</button>
      <ChangePasswordModal
        open={open}
        onClose={() => {
          onClose()
          setOpen(false)
        }}
      />
    </>
  )
}

/** Where the panel is: the dialog opens over a shell page, and an admin's change sends it to /login. */
function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

function renderDialog(mocks: MockedResponse[] = [], initialOpen = true, link?: ApolloLink) {
  const onClose = vi.fn()
  render(
    <MockedProvider mocks={mocks} link={link}>
      <MemoryRouter initialEntries={['/players/search']}>
        <Harness onClose={onClose} initialOpen={initialOpen} />
        <LocationProbe />
      </MemoryRouter>
    </MockedProvider>,
  )
  return { onClose }
}

const currentPath = () => screen.getByTestId('location').textContent

const dialog = () => screen.getByRole('dialog', { name: 'Change Password' })
const input = (label: string) => within(dialog()).getByLabelText(label) as HTMLInputElement
const submitButton = () => within(dialog()).getByRole('button', { name: 'Update Password' })

function type(label: string, value: string) {
  fireEvent.change(input(label), { target: { value } })
}

function fillValid(newPassword = NEW) {
  type('Current Password', OLD)
  type('New Password', newPassword)
  type('Confirm New Password', newPassword)
}

async function submit() {
  await act(async () => {
    fireEvent.click(submitButton())
  })
}

async function reopen() {
  await waitFor(() => assertAbsent(screen.queryByRole('dialog'), 'the dialog'))
  fireEvent.click(screen.getByRole('button', { name: 'Open change password' }))
  await screen.findByRole('dialog', { name: 'Change Password' })
}

/* Elements are compared by identity: a node:assert diff of a jsdom element inside waitFor exhausts
   the worker (Task 027's lesson). */
function assertAbsent(element: Element | null, what: string) {
  assert.ok(element === null, `${what} should be absent`)
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function lastMutation() {
  return apollo.mutations[apollo.mutations.length - 1]
}

function assertCleared() {
  for (const label of ['Current Password', 'New Password', 'Confirm New Password']) {
    assert.equal(input(label).value, '', `${label} is cleared`)
  }
  assertAbsent(within(dialog()).queryByText('Password Requirements:'), 'the checklist')
}

beforeEach(() => {
  auth.isAgent = false
  auth.token = 'session-token'
  auth.logout.mockReset()
  apollo.mutations.length = 0
  feedback.toast.mockReset()
})

describe('ChangePasswordModal', () => {
  test('renders nothing while closed, then a labelled dialog with three labelled password fields', async () => {
    renderDialog([], false)
    assertAbsent(screen.queryByRole('dialog'), 'the dialog')

    fireEvent.click(screen.getByRole('button', { name: 'Open change password' }))
    const opened = await screen.findByRole('dialog', { name: 'Change Password' })
    assert.ok(within(opened).getByText('Update your account password for better security'))
    assert.equal(within(opened).getByRole('heading', { level: 2 }).textContent, 'Change Password')

    const expected = [
      ['Current Password', 'current-password', 'Enter your current password'],
      ['New Password', 'new-password', 'Enter new password (min 8 characters)'],
      ['Confirm New Password', 'new-password', 'Re-enter your new password'],
    ] as const
    for (const [label, autoComplete, placeholder] of expected) {
      const field = input(label)
      assert.equal(field.type, 'password')
      assert.equal(field.autocomplete, autoComplete)
      assert.equal(field.placeholder, placeholder)
      assert.equal(field.getAttribute('aria-required'), 'true')
      assert.equal(field.required, false)
    }
    // Required marks stay hidden, as the legacy form's requiredMark={false} had them.
    assert.equal(opened.textContent?.includes('*'), false)

    const toggles = within(opened).getAllByRole('button', { name: 'Show password' })
    assert.deepEqual(
      toggles.map((toggle) => toggle.getAttribute('aria-controls')),
      expected.map(([label]) => input(label).id),
    )
    fireEvent.click(toggles[1])
    assert.equal(toggles[1].getAttribute('aria-pressed'), 'true')
    assert.equal(input('New Password').type, 'text')
    fireEvent.click(toggles[1])
    assert.equal(input('New Password').type, 'password')

    // The footer submit names its form, and focus starts in Current Password.
    const form = opened.querySelector('form') as HTMLFormElement
    assert.ok((submitButton() as HTMLButtonElement).form === form)
    assert.equal(submitButton().getAttribute('type'), 'submit')
    await waitFor(() => assert.ok(document.activeElement === input('Current Password')))

    const mutation = lastMutation()
    assert.ok(mutation)
    assert.equal(print(mutation.mutation), print(ADMIN_DOCUMENT))
    assert.deepEqual(mutation.options, { context: { uiToast: 'notification' } })
  })

  test('a failed submit shows the legacy messages and the summary, focuses the first invalid field and sends nothing', async () => {
    renderDialog()
    await screen.findByRole('dialog', { name: 'Change Password' })
    await submit()

    await waitFor(() => assert.ok(within(dialog()).getByText('Please enter your current password')))
    assert.ok(within(dialog()).getByText('Please enter a new password'))
    assert.ok(within(dialog()).getByText('Please confirm your new password'))
    assert.ok(within(dialog()).getByText('Password not changed'))
    assert.ok(within(dialog()).getByText('Fix 3 highlighted fields and submit again.'))
    assert.ok(within(dialog()).getByText('3 form errors found.'))
    for (const label of ['Current Password', 'New Password', 'Confirm New Password']) {
      assert.equal(input(label).getAttribute('aria-invalid'), 'true')
    }
    await waitFor(() => assert.ok(document.activeElement === input('Current Password')))
    assert.equal(feedback.toast.mock.calls.length, 0)

    // The summary follows the remaining errors.
    type('Current Password', OLD)
    await waitFor(() => assert.ok(within(dialog()).getByText('Fix 2 highlighted fields and submit again.')))
    await submit()
    await waitFor(() => assert.ok(document.activeElement === input('New Password')))
  })

  test('checks the length and the confirmation, and re-validates Confirm when New Password changes', async () => {
    renderDialog()
    await screen.findByRole('dialog', { name: 'Change Password' })

    type('New Password', 'abc')
    fireEvent.blur(input('New Password'))
    await waitFor(() => assert.ok(within(dialog()).getByText('Password must be at least 8 characters')))

    const checklist = within(dialog()).getByText('Password Requirements:').parentElement as HTMLElement
    assert.ok(input('New Password').getAttribute('aria-describedby')?.split(' ').includes(checklist.id))
    assert.deepEqual(
      within(checklist).getAllByRole('listitem').map((item) => item.textContent),
      [
        'At least 8 characters, not met',
        'One uppercase letter, not met',
        'One lowercase letter, met',
        'One number, not met',
      ],
    )

    type('New Password', NEW)
    await waitFor(() => assertAbsent(within(dialog()).queryByText('Password must be at least 8 characters'), 'the length error'))
    assert.deepEqual(
      within(checklist).getAllByRole('listitem').map((item) => item.textContent),
      [
        'At least 8 characters, met',
        'One uppercase letter, met',
        'One lowercase letter, met',
        'One number, met',
      ],
    )

    type('Confirm New Password', 'New-pass-2')
    fireEvent.blur(input('Confirm New Password'))
    await waitFor(() => assert.ok(within(dialog()).getByText('Passwords do not match')))

    // Matching New Password to Confirm clears it; changing New Password away brings it back.
    type('New Password', 'New-pass-2')
    await waitFor(() => assertAbsent(within(dialog()).queryByText('Passwords do not match'), 'the mismatch error'))
    type('New Password', 'New-pass-3')
    await waitFor(() => assert.ok(within(dialog()).getByText('Passwords do not match')))

    // Clearing New Password hides the checklist again.
    type('New Password', '')
    await waitFor(() => assertAbsent(within(dialog()).queryByText('Password Requirements:'), 'the checklist'))
  })

  test('with New Password and Confirm both in error, New Password\'s own error follows each keystroke', async () => {
    renderDialog()
    await screen.findByRole('dialog', { name: 'Change Password' })

    type('New Password', 'abc')
    fireEvent.blur(input('New Password'))
    await waitFor(() => assert.ok(within(dialog()).getByText('Password must be at least 8 characters')))
    type('Confirm New Password', 'abc')
    type('New Password', 'abcd')
    await waitFor(() => assert.ok(within(dialog()).getByText('Passwords do not match')))
    assert.ok(within(dialog()).getByText('Password must be at least 8 characters'))

    // Both fields show an error: reaching the minimum clears the length error while Confirm still mismatches.
    type('New Password', 'abcdefgh')
    await waitFor(() => assertAbsent(
      within(dialog()).queryByText('Password must be at least 8 characters'),
      'the length error',
    ))
    assert.equal(input('New Password').getAttribute('aria-invalid'), null)
    assert.ok(within(dialog()).getByText('Passwords do not match'))

    // Only Confirm in error: New Password is still re-checked on change (useForm does so once any field shows one).
    type('New Password', 'abcdefg')
    await waitFor(() => assert.ok(within(dialog()).getByText('Password must be at least 8 characters')))
    assert.ok(within(dialog()).getByText('Passwords do not match'))
  })

  test('the summary belongs to the opening it was raised in: Cancel and success both start the next one clean', async () => {
    renderDialog([adminMock({ success: true, message: 'Password updated' })])
    await screen.findByRole('dialog', { name: 'Change Password' })
    await submit()
    await waitFor(() => assert.ok(within(dialog()).getByText('Password not changed')))

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    await reopen()
    assertAbsent(within(dialog()).queryByText('Password not changed'), 'the summary after Cancel')
    fireEvent.blur(input('New Password'))
    await waitFor(() => assert.ok(within(dialog()).getByText('Please enter a new password')))
    assertAbsent(within(dialog()).queryByText('Password not changed'), 'the summary for a blur error')

    // A failed submit in this opening shows it again; a success then closes and resets it.
    await submit()
    await waitFor(() => assert.ok(within(dialog()).getByText('Fix 3 highlighted fields and submit again.')))
    fillValid()
    await waitFor(() => assertAbsent(within(dialog()).queryByText('Password not changed'), 'the summary once fixed'))
    await submit()
    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))

    await reopen()
    fireEvent.blur(input('Current Password'))
    await waitFor(() => assert.ok(within(dialog()).getByText('Please enter your current password')))
    assertAbsent(within(dialog()).queryByText('Password not changed'), 'the summary after a success')
  })

  test('admin success sends the exact variables, closes, clears the fields, signs out and asks for a sign-in', async () => {
    const { onClose } = renderDialog([adminMock({ success: true, message: 'Password updated' })])
    await screen.findByRole('dialog', { name: 'Change Password' })
    assert.equal(currentPath(), '/players/search')
    fillValid()
    await submit()

    await waitFor(() => assert.equal(onClose.mock.calls.length, 1))
    // The change ended this session on the server: the panel signs out at once and says what comes next.
    assert.equal(auth.logout.mock.calls.length, 1)
    assert.equal(currentPath(), '/login')
    assert.deepEqual(feedback.toast.mock.calls, [[{
      title: 'Password Changed Successfully',
      message: 'Sign in with your new password.',
      tone: 'ok',
      duration: 4500,
    }]])

    await reopen()
    assertCleared()
  })

  test('at sign-in (Reset Password pending) it sends the sign-in token, says why, and has no session to end', async () => {
    auth.token = undefined // the sign-in page keeps no session while the change is pending
    const order: string[] = []
    const onChanged = vi.fn(() => order.push('changed'))
    const onClose = vi.fn(() => order.push('closed'))
    render(
      <MockedProvider mocks={[adminMock({ success: true, message: 'Password changed successfully' })]}>
        <MemoryRouter initialEntries={['/login']}>
          <ChangePasswordModal open sessionToken="sign-in-token" onChanged={onChanged} onClose={onClose} />
          <LocationProbe />
        </MemoryRouter>
      </MockedProvider>,
    )
    await screen.findByRole('dialog', { name: 'Change Password' })
    assert.ok(within(dialog()).getByText('Your administrator asked you to choose a new password before you continue.'))
    // The admin document, with the sign-in token on the request (the auth link adds none: nobody is signed in).
    assert.equal(print(lastMutation().mutation), print(ADMIN_DOCUMENT))
    assert.deepEqual(lastMutation().options, {
      context: { uiToast: 'notification', headers: { authorization: 'Bearer sign-in-token' } },
    })

    fillValid()
    await submit()

    await waitFor(() => assert.deepEqual(order, ['changed', 'closed']))
    assert.equal(auth.logout.mock.calls.length, 0)
    assert.equal(currentPath(), '/login')
    assert.deepEqual(feedback.toast.mock.calls, [[{
      title: 'Password Changed Successfully',
      message: 'Sign in with your new password.',
      tone: 'ok',
      duration: 4500,
    }]])
  })

  test('a sign-in change is an admin change even if an agent session lingers in the store', async () => {
    auth.isAgent = true
    render(
      <MockedProvider mocks={[]}>
        <MemoryRouter initialEntries={['/login']}>
          <ChangePasswordModal open sessionToken="sign-in-token" onClose={() => {}} />
        </MemoryRouter>
      </MockedProvider>,
    )
    await screen.findByRole('dialog', { name: 'Change Password' })
    assert.equal(print(lastMutation().mutation), print(ADMIN_DOCUMENT))
    assert.equal(input('New Password').placeholder, 'Enter new password (min 8 characters)')
  })

  test('a failed admin change keeps the session', async () => {
    renderDialog([{ request: { query: ADMIN_DOCUMENT, variables: { currentPassword: OLD, newPassword: NEW } }, result: { errors: [new GraphQLError('Current password is incorrect')] } }])
    await screen.findByRole('dialog', { name: 'Change Password' })
    fillValid()
    await submit()

    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.equal(auth.logout.mock.calls.length, 0)
    assert.equal(currentPath(), '/players/search')
  })

  test('agent: the nested agent mutation, a 6-character minimum and the fallback success copy', async () => {
    auth.isAgent = true
    const { onClose } = renderDialog([agentMock({ success: true, message: null }, 'Agent-77')])
    await screen.findByRole('dialog', { name: 'Change Password' })
    assert.equal(input('New Password').placeholder, 'Enter new password (min 6 characters)')
    assert.equal(print(lastMutation().mutation), print(AGENT_DOCUMENT))

    type('Current Password', OLD)
    type('New Password', 'abcde')
    fireEvent.blur(input('New Password'))
    await waitFor(() => assert.ok(within(dialog()).getByText('Password must be at least 6 characters')))
    assert.ok(within(dialog()).getByText('At least 6 characters'))

    type('New Password', 'Agent-77')
    type('Confirm New Password', 'Agent-77')
    await submit()

    await waitFor(() => assert.equal(onClose.mock.calls.length, 1))
    assert.deepEqual(feedback.toast.mock.calls, [[{
      title: 'Password Changed Successfully',
      message: 'Your password has been updated successfully',
      tone: 'ok',
      duration: 4500,
    }]])
    // An agent's change leaves its session standing.
    assert.equal(auth.logout.mock.calls.length, 0)
    assert.equal(currentPath(), '/players/search')
  })

  test('a false success keeps the dialog open with the typed values and raises nothing here', async () => {
    const counter = { count: 0 }
    const { onClose } = renderDialog([adminMock({ success: false, message: 'Current password is incorrect' }, counter)])
    await screen.findByRole('dialog', { name: 'Change Password' })
    fillValid()
    await submit()

    await waitFor(() => assert.equal(counter.count, 1))
    await waitFor(() => assert.equal(submitButton().getAttribute('aria-busy'), null))
    assert.equal(onClose.mock.calls.length, 0)
    assert.equal(feedback.toast.mock.calls.length, 0)
    assert.equal(input('Current Password').value, OLD)
    assert.equal(input('Confirm New Password').value, NEW)
  })

  test('a GraphQL error is reported with its message; a network error stays silent; both leave the dialog open', async () => {
    const variables = { currentPassword: OLD, newPassword: NEW }
    const { onClose } = renderDialog([
      { request: { query: ADMIN_DOCUMENT, variables }, result: { errors: [new GraphQLError('Current password is incorrect')] } },
      { request: { query: ADMIN_DOCUMENT, variables }, error: new Error('Failed to fetch') },
    ])
    await screen.findByRole('dialog', { name: 'Change Password' })
    fillValid()
    await submit()

    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.deepEqual(feedback.toast.mock.calls[0], [{
      title: 'Password Change Failed',
      message: 'Current password is incorrect',
      tone: 'error',
      duration: 4500,
    }])

    await waitFor(() => assert.equal(submitButton().getAttribute('aria-busy'), null))
    await submit()
    await waitFor(() => assert.equal(submitButton().getAttribute('aria-busy'), null))
    assert.equal(feedback.toast.mock.calls.length, 1)
    assert.equal(onClose.mock.calls.length, 0)
    assert.equal(input('Current Password').value, OLD)
  })

  test('Cancel, Escape and the close button each clear the fields and call onClose', async () => {
    const { onClose } = renderDialog()
    await screen.findByRole('dialog', { name: 'Change Password' })

    fillValid()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    await reopen()
    assertCleared()

    fillValid()
    fireEvent.keyDown(dialog(), { key: 'Escape' })
    await reopen()
    assertCleared()

    type('New Password', 'abc')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close dialog' }))
    await reopen()
    assertCleared()
    assert.equal(onClose.mock.calls.length, 3)
  })

  test('the submit is single flight: Update Password is busy while the mutation runs', async () => {
    const counter = { count: 0 }
    let release: (() => void) | undefined
    // Hold the network response through every busy/single-flight assertion. A
    // short timer can close the dialog during a loaded full-suite run.
    const link = new ApolloLink((operation) => new Observable((observer) => {
      counter.count += 1
      assert.equal(operation.operationName, 'ChangeAdminPassword')
      assert.deepEqual(operation.variables, { currentPassword: OLD, newPassword: NEW })
      release = () => {
        observer.next({ data: { changeAdminPassword: { __typename: 'PasswordChangeResult', success: true, message: 'Password updated' } } })
        observer.complete()
      }
      return () => { release = undefined }
    }))
    const { onClose } = renderDialog([], true, link)
    await screen.findByRole('dialog', { name: 'Change Password' })
    fillValid()
    await submit()

    await waitFor(() => assert.equal(submitButton().getAttribute('aria-busy'), 'true'))
    await submit()
    fireEvent.submit(dialog().querySelector('form') as HTMLFormElement)

    assert.equal(counter.count, 1)
    assert.equal(onClose.mock.calls.length, 0)
    assert.ok(release)
    await act(async () => { release!() })

    await waitFor(() => assert.equal(onClose.mock.calls.length, 1))
    assert.equal(counter.count, 1)
    assert.equal(feedback.toast.mock.calls.length, 1)
  })

  test('no typed secret reaches the markup, the console or storage', async () => {
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    )
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem')
    const { onClose } = renderDialog([adminMock({ success: true, message: 'Password updated' })])
    await screen.findByRole('dialog', { name: 'Change Password' })
    fillValid()

    for (const label of ['Current Password', 'New Password', 'Confirm New Password']) {
      assert.equal(input(label).getAttribute('value'), null)
    }
    assert.equal(document.body.innerHTML.includes(OLD), false)
    assert.equal(document.body.innerHTML.includes(NEW), false)

    await submit()
    await waitFor(() => assert.equal(onClose.mock.calls.length, 1))

    const written = [
      ...consoleSpies.flatMap((spy) => spy.mock.calls.flat()),
      ...storageSpy.mock.calls.flat(),
    ].map(asText)
    assert.equal(written.some((value) => value.includes(OLD) || value.includes(NEW)), false)
  })
})
