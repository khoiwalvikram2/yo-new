/**
 * The theme is a device preference, not session data. authStore.logout() clears every other
 * localStorage key (the auth session, saved views, director mode) so a fresh sign-in starts
 * clean, but it must not wipe a saved theme choice — otherwise the first-frame script in
 * index.html would flip back to light on the very next reload even though nothing else about
 * the device changed (decision 13).
 */
import { test, describe, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { useAuthStore } from './authStore'

describe('authStore logout keeps the saved theme', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test('keeps theme-mode and clears unrelated keys', () => {
    const seededTheme = '{"state":{"mode":"dark"},"version":0}'
    localStorage.setItem('theme-mode', seededTheme)
    localStorage.setItem('sidebar-storage', '{"state":{"favorites":["/players"]},"version":0}')
    localStorage.setItem('DIRECTOR_MODE', 'true')

    useAuthStore.getState().logout()

    assert.equal(localStorage.getItem('theme-mode'), seededTheme)
    assert.equal(localStorage.getItem('sidebar-storage'), null)
    assert.equal(localStorage.getItem('DIRECTOR_MODE'), null)
  })

  test('theme-mode stays null when nothing was stored', () => {
    useAuthStore.getState().logout()

    assert.equal(localStorage.getItem('theme-mode'), null)
  })
})
