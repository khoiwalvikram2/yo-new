/**
 * B009: a token that runs out signs the panel out through the session guard (api.ts sessionGuardLink ->
 * authSecurity.handleSessionTimeout -> secureLogout). That toasted "Your session has expired", then cleared this tab's
 * sessionStorage and reloaded /login, and the reload dropped the toast: the sign-in page gave no reason. The reason is
 * now recorded after the clear and before the reload, for the sign-in page to show (signOutReason.ts, LoginPage).
 *
 * The tests run in order: the timeout's guard and the reload flag are per document, as in the browser.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), warning: vi.fn(), info: vi.fn() }))
// The server-side logout: refused here, as it is for an expired token; the sign-out goes on without it.
vi.mock('../core/api', () => ({ apolloClient: { mutate: mocks.mutate } }))
vi.mock('../services/notification', () => ({
  messageService: { warning: mocks.warning, info: mocks.info, error: vi.fn(), success: vi.fn() },
}))

import { authSecurity } from './auth'
import { useAuthStore } from '../core/authStore'
import { clearSignOutReason, readSignOutNotice } from '../core/signOutReason'

beforeEach(() => {
  mocks.mutate.mockReset().mockRejectedValue(new Error('Session expired'))
  mocks.warning.mockReset()
  mocks.info.mockReset()
  sessionStorage.clear()
  useAuthStore.setState({ token: 'x.eyJleHAiOjF9.y', user: { id: '2', name: 'Admin' } as never })
  vi.spyOn(console, 'error').mockImplementation(() => {}) // jsdom cannot navigate to /login
})

describe('the sign-in page learns why the panel signed out', () => {
  test('a sign-out on purpose records no reason', async () => {
    await authSecurity.secureLogout()
    assert.equal(useAuthStore.getState().token, undefined, 'the session was not ended')
    assert.equal(readSignOutNotice(), null, 'no forced-sign-out notice for a sign-out on purpose')
  })

  test('a token that ran out leaves "Session expired" for the reloaded sign-in page', async () => {
    sessionStorage.setItem('gw-unrelated-tab-state', 'x')
    authSecurity.handleSessionTimeout()
    assert.equal(mocks.warning.mock.calls.length, 1, 'the toast before the reload is still raised')
    await vi.waitFor(() => assert.equal(readSignOutNotice()?.title, 'Session expired'))
    assert.match(String(readSignOutNotice()?.text), /Your session has expired/)
    assert.equal(useAuthStore.getState().token, undefined, 'the session was not ended')
    assert.equal(sessionStorage.getItem('gw-unrelated-tab-state'), null, 'the tab is still cleared; the reason is recorded after it')
    // The route guard shows this document's own sign-in page before the reload lands; it must not use the reason up.
    clearSignOutReason()
    assert.equal(readSignOutNotice()?.title, 'Session expired', 'the sign-in page shown before the reload used up the reason')
  })

  test('only the first of many expired requests signs out', async () => {
    authSecurity.handleSessionTimeout()
    authSecurity.handleSessionTimeout()
    assert.equal(mocks.warning.mock.calls.length, 0, 'the sign-out above already started the reload')
  })
})
