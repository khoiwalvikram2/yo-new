/**
 * The profile menu is how every admin and agent changes their password and signs out, so it must work
 * for keyboard and screen-reader users. Below 768px its visible name and role are hidden by CSS
 * (decision 1), so the trigger's aria-label must still name the user, the role and the menu. The avatar
 * must stay silent, or the initials are read after the name. The menu must offer exactly Change Password
 * and Sign out, and each item must call its own callback: calling the wrong one would sign a user out
 * who only wanted a new password.
 */
import { test, describe, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { ProfileMenuView } from './ProfileMenuView'

const ADMIN_TRIGGER_NAME = 'Rahul S., Administrator. Account menu.'

function renderView(userName = 'Rahul S.', userRole = 'Administrator') {
  const onChangePassword = vi.fn()
  const onSignOut = vi.fn()
  render(
    <ProfileMenuView
      userName={userName}
      userRole={userRole}
      onChangePassword={onChangePassword}
      onSignOut={onSignOut}
    />,
  )
  const trigger = screen.getByRole('button', { name: `${userName}, ${userRole}. Account menu.` })
  return { trigger, onChangePassword, onSignOut }
}

describe('ProfileMenuView', () => {
  test('the trigger is named by the user, the role and "Account menu", and hides its avatar and chevron', () => {
    const { trigger } = renderView()

    assert.equal(trigger.tagName, 'BUTTON')
    assert.equal(trigger.getAttribute('type'), 'button')
    assert.equal(trigger.getAttribute('aria-label'), ADMIN_TRIGGER_NAME)
    assert.equal(trigger.getAttribute('aria-haspopup'), 'menu')
    assert.equal(trigger.getAttribute('aria-expanded'), 'false')

    const avatar = trigger.firstElementChild
    assert.ok(avatar, 'the trigger starts with the avatar')
    assert.equal(avatar.textContent, 'RS')
    assert.equal(avatar.getAttribute('aria-hidden'), 'true')

    const name = screen.getByText('Rahul S.')
    const role = screen.getByText('Administrator')
    assert.ok(trigger.contains(name))
    assert.ok(trigger.contains(role))

    const chevron = trigger.querySelector('svg.tabler-icon-chevron-down')
    assert.ok(chevron, 'the trigger shows a chevron')
    assert.equal(chevron.getAttribute('width'), '15')
    assert.equal(chevron.getAttribute('stroke-width'), '1.75')
    assert.notEqual(chevron.closest('[aria-hidden="true"]'), null)

    assert.equal(screen.queryByRole('menu'), null)
  })

  test('an agent sees the agent name, the Agent role and decision-14 initials', () => {
    const { trigger } = renderView('agent77', 'Agent')

    assert.equal(trigger.getAttribute('aria-label'), 'agent77, Agent. Account menu.')
    assert.equal(trigger.firstElementChild?.textContent, 'A7')
    assert.ok(trigger.contains(screen.getByText('Agent')))
  })

  test('clicking the trigger opens a menu labelled by the trigger: Change Password, a separator, Sign out', async () => {
    const { trigger } = renderView()

    fireEvent.click(trigger)

    const menu = await screen.findByRole('menu')
    assert.equal(trigger.getAttribute('aria-expanded'), 'true')
    assert.ok(trigger.id, 'the trigger has an id for aria-labelledby')
    assert.equal(menu.getAttribute('aria-labelledby'), trigger.id)

    const changePassword = screen.getByRole('menuitem', { name: 'Change Password' })
    const signOut = screen.getByRole('menuitem', { name: 'Sign out' })
    assert.deepEqual(screen.getAllByRole('menuitem'), [changePassword, signOut])
    assert.ok(menu.contains(screen.getByRole('separator')))

    const keyIcon = changePassword.querySelector('svg.tabler-icon-key')
    assert.ok(keyIcon, 'Change Password shows the key icon')
    assert.equal(keyIcon.getAttribute('width'), '15')
    assert.equal(keyIcon.getAttribute('stroke-width'), '1.75')

    const logoutIcon = signOut.querySelector('svg.tabler-icon-logout')
    assert.ok(logoutIcon, 'Sign out shows the logout icon')
    assert.equal(logoutIcon.getAttribute('width'), '15')
    assert.equal(logoutIcon.getAttribute('stroke-width'), '1.75')
  })

  test('Change Password calls onChangePassword only, and the menu closes', async () => {
    const { trigger, onChangePassword, onSignOut } = renderView()

    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Change Password' }))

    assert.equal(onChangePassword.mock.calls.length, 1)
    assert.equal(onSignOut.mock.calls.length, 0)
    await waitFor(() => assert.ok(!screen.queryByRole('menu')))
    assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  })

  test('Sign out calls onSignOut only, and the menu closes', async () => {
    const { trigger, onChangePassword, onSignOut } = renderView()

    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

    assert.equal(onSignOut.mock.calls.length, 1)
    assert.equal(onChangePassword.mock.calls.length, 0)
    await waitFor(() => assert.ok(!screen.queryByRole('menu')))
    assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  })

  test('keyboard: ArrowDown opens on Change Password, Escape closes and returns focus to the trigger', async () => {
    const { trigger, onChangePassword, onSignOut } = renderView()

    act(() => {
      trigger.focus()
    })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })

    const changePassword = await screen.findByRole('menuitem', { name: 'Change Password' })
    // assert.ok, not assert.equal: node:assert's AssertionError eagerly builds a diff of both
    // operands on failure, and diffing a live jsdom Element is pathologically expensive — under
    // waitFor's retries (and any real machine contention) this turns a cheap boolean check into a
    // multi-second-or-worse operation, up to a full test timeout under heavy parallel test load.
    await waitFor(() => assert.ok(document.activeElement === changePassword))

    fireEvent.keyDown(changePassword, { key: 'ArrowDown' })
    const signOut = screen.getByRole('menuitem', { name: 'Sign out' })
    await waitFor(() => assert.ok(document.activeElement === signOut))

    fireEvent.keyDown(signOut, { key: 'Escape' })
    await waitFor(() => assert.ok(!screen.queryByRole('menu')))
    await waitFor(() => assert.ok(document.activeElement === trigger))

    assert.equal(onChangePassword.mock.calls.length, 0)
    assert.equal(onSignOut.mock.calls.length, 0)
  })
})
