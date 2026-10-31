/**
 * Proves the Vitest + jsdom environment for admin/ actually works before any
 * shell or kit test relies on it: jsdom's globals are present, the stubs
 * vitest.setup.ts installs are usable, and its per-test reset (localStorage,
 * <html data-theme>) really runs between tests instead of leaking state.
 */
import { test, describe } from 'vitest'
import assert from 'node:assert/strict'

describe('testEnvironment', () => {
  test('jsdom is active and the setup stubs are usable', () => {
    assert.equal(typeof window, 'object')
    window.localStorage.setItem('test-environment-probe', 'value')
    assert.equal(window.localStorage.getItem('test-environment-probe'), 'value')
    const mql = window.matchMedia('(min-width: 1280px)')
    assert.equal(mql.matches, false)
    const observer = new ResizeObserver(() => {})
    assert.equal(typeof observer.observe, 'function')
    document.documentElement.dataset.theme = 'dark'
    assert.equal(document.documentElement.dataset.theme, 'dark')
  })

  test('vitest.setup.ts resets localStorage and data-theme between tests', () => {
    assert.equal(window.localStorage.getItem('test-environment-probe'), null)
    assert.equal(document.documentElement.dataset.theme, undefined)
  })
})
