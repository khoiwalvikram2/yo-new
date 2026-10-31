import assert from 'node:assert/strict'
import { afterEach, test, vi } from 'vitest'
import { showBlankScreenRecovery } from './blankScreenRecovery'

afterEach(() => { document.getElementById('admin-blank-recovery')?.remove(); localStorage.removeItem('auth-storage'); localStorage.removeItem('ui-storage'); localStorage.removeItem('theme-mode'); vi.restoreAllMocks() })
test('startup recovery is a single theme-inheriting accessible surface without inline HTML handlers', () => {
  showBlankScreenRecovery(vi.fn()); showBlankScreenRecovery(vi.fn())
  const recovery = document.getElementById('admin-blank-recovery')!
  assert.equal(document.querySelectorAll('#admin-blank-recovery').length, 1)
  assert.equal(recovery.getAttribute('role'), 'alert'); assert.equal(recovery.getAttribute('data-theme'), null)
  assert.equal(recovery.querySelector('h1')?.textContent, 'App didn’t load')
  assert.equal(recovery.querySelectorAll('[style],[onclick]').length, 0)
  assert.equal(recovery.querySelectorAll('button[type="button"]').length, 2)
})
test('refresh does not clear state; explicit clear preserves theme while removing the original recovery keys', () => {
  localStorage.setItem('auth-storage', 'session'); localStorage.setItem('ui-storage', 'layout'); localStorage.setItem('theme-mode', 'dark')
  const reload = vi.fn(); showBlankScreenRecovery(reload)
  document.querySelector<HTMLButtonElement>('#admin-blank-recovery button')!.click()
  assert.equal(reload.mock.calls.length, 1); assert.equal(localStorage.getItem('auth-storage'), 'session')
  document.getElementById('admin-blank-clear')!.click()
  assert.equal(reload.mock.calls.length, 2); assert.equal(localStorage.getItem('auth-storage'), null); assert.equal(localStorage.getItem('ui-storage'), null)
  assert.equal(localStorage.getItem('theme-mode'), 'dark')
})
