/**
 * themeStore is the single source of truth for light/dark mode: it persists the choice under
 * `theme-mode`, in the exact `{ state, version }` shape zustand's persist middleware writes, and
 * it sets <html data-theme> on every change and on rehydration so CSS token blocks keyed on
 * [data-theme] repaint. If any of this drifts, the first-frame script in index.html (which parses
 * the same storage key) and the CSS tokens (keyed on data-theme) silently stop matching.
 *
 * 'system' is a stored mode but never a stamped one: data-theme only ever carries the RESOLVED
 * palette ('light' or 'dark'), so the tests below separate what is stored from what is stamped.
 */
import { test, beforeEach, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { useThemeStore, resolveTheme, startSystemThemeSync, THEME_STORAGE_KEY, DEFAULT_THEME_MODE } from './themeStore'

const ORIGINAL_MATCH_MEDIA = window.matchMedia

/** Replaces window.matchMedia outright; vitest's restoreMocks does not cover plain assignment. */
function setMatchMedia(value: unknown): void {
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value })
}

/** A stub whose `matches` is true only for the prefers-dark query. */
function matchMediaReporting(dark: boolean) {
  return (query: string) => ({
    matches: dark && query === '(prefers-color-scheme: dark)',
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

beforeEach(() => {
  useThemeStore.setState({ mode: 'light' })
  localStorage.clear()
})

afterEach(() => {
  setMatchMedia(ORIGINAL_MATCH_MEDIA)
})

test('defaults to light', () => {
  assert.equal(useThemeStore.getState().mode, DEFAULT_THEME_MODE)
})

test('toggle flips the mode and sets data-theme', () => {
  useThemeStore.getState().toggle()
  assert.equal(useThemeStore.getState().mode, 'dark')
  assert.equal(document.documentElement.dataset.theme, 'dark')
})

test('persists the exact zustand persist shape', () => {
  useThemeStore.getState().setMode('dark')
  assert.equal(localStorage.getItem(THEME_STORAGE_KEY), '{"state":{"mode":"dark"},"version":0}')
})

test('rehydration applies data-theme from the seeded storage value', async () => {
  localStorage.setItem(THEME_STORAGE_KEY, '{"state":{"mode":"dark"},"version":0}')
  await useThemeStore.persist.rehydrate()
  assert.equal(document.documentElement.dataset.theme, 'dark')
})

test('toggle cycles light -> dark -> system -> light', () => {
  const { toggle } = useThemeStore.getState()

  toggle()
  assert.equal(useThemeStore.getState().mode, 'dark')
  toggle()
  assert.equal(useThemeStore.getState().mode, 'system')
  toggle()
  assert.equal(useThemeStore.getState().mode, 'light')
})

test("mode 'system' stamps the OS palette while the stored mode stays 'system'", () => {
  setMatchMedia(matchMediaReporting(true))

  useThemeStore.getState().setMode('system')

  assert.equal(document.documentElement.dataset.theme, 'dark')
  assert.equal(useThemeStore.getState().mode, 'system')
  assert.equal(localStorage.getItem(THEME_STORAGE_KEY), '{"state":{"mode":"system"},"version":0}')
})

test("mode 'system' stamps light when the OS does not ask for dark", () => {
  setMatchMedia(matchMediaReporting(false))

  useThemeStore.getState().setMode('system')

  assert.equal(document.documentElement.dataset.theme, 'light')
  assert.equal(useThemeStore.getState().mode, 'system')
})

test('resolveTheme falls back to light where matchMedia is unavailable', () => {
  setMatchMedia(undefined)

  assert.equal(resolveTheme('system'), 'light')
  assert.equal(resolveTheme('dark'), 'dark')
  assert.equal(resolveTheme('light'), 'light')
})

test('unexpected runtime modes resolve to the first-frame light fallback rather than the OS palette', () => {
  setMatchMedia(matchMediaReporting(true))
  for (const mode of ['sepia', '', null, undefined, 7, false, {}, []]) assert.equal(resolveTheme(mode), 'light')
  assert.equal(resolveTheme('system'), 'dark')
})

test('unknown, wrong-type, missing and null persisted modes hydrate to light and preserve store methods', async () => {
  setMatchMedia(matchMediaReporting(true))
  const methods = { setMode: useThemeStore.getState().setMode, toggle: useThemeStore.getState().toggle }
  for (const savedState of [{ mode: 'sepia', toggle: 'corrupt method', setMode: null }, { mode: 7 }, { mode: false }, { mode: null }, { mode: {} }, { mode: [] }, {}, null, 'dark']) {
    useThemeStore.getState().setMode('dark')
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ state: savedState, version: 0 }))
    await useThemeStore.persist.rehydrate()
    assert.equal(useThemeStore.getState().mode, 'light')
    assert.equal(document.documentElement.dataset.theme, 'light')
    assert.equal(useThemeStore.getState().setMode, methods.setMode)
    assert.equal(useThemeStore.getState().toggle, methods.toggle)
  }
})

test('corrupt saved JSON restores a safe light store and palette without breaking the next theme cycle', async () => {
  setMatchMedia(matchMediaReporting(true))
  useThemeStore.getState().setMode('dark')
  localStorage.setItem(THEME_STORAGE_KEY, '{broken-theme-json')
  await useThemeStore.persist.rehydrate()
  assert.equal(useThemeStore.getState().mode, 'light')
  assert.equal(document.documentElement.dataset.theme, 'light')
  useThemeStore.getState().toggle()
  assert.equal(useThemeStore.getState().mode, 'dark')
  assert.equal(document.documentElement.dataset.theme, 'dark')
})

test('missing saved state and wrong-type JSON payloads also restore the safe light preference', async () => {
  setMatchMedia(matchMediaReporting(true))
  for (const raw of ['{}', 'null', '7', '"dark"', '[]']) {
    useThemeStore.getState().setMode('dark')
    localStorage.setItem(THEME_STORAGE_KEY, raw)
    await useThemeStore.persist.rehydrate()
    assert.equal(useThemeStore.getState().mode, 'light')
    assert.equal(document.documentElement.dataset.theme, 'light')
  }
})

test('sanitized hydration keeps valid light/dark/system modes and their original OS resolution', async () => {
  setMatchMedia(matchMediaReporting(true))
  for (const mode of ['light', 'dark', 'system'] as const) {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ state: { mode }, version: 0 }))
    await useThemeStore.persist.rehydrate()
    assert.equal(useThemeStore.getState().mode, mode)
    assert.equal(document.documentElement.dataset.theme, mode === 'light' ? 'light' : 'dark')
  }
})

test('OS changes still synchronize only system mode and unsubscribe cleanly after sanitization', () => {
  let dark = false
  const listeners = new Set<() => void>()
  setMatchMedia(() => ({
    get matches() { return dark },
    addEventListener: (event: string, listener: () => void) => { assert.equal(event, 'change'); listeners.add(listener) },
    removeEventListener: (event: string, listener: () => void) => { assert.equal(event, 'change'); listeners.delete(listener) },
  }))
  const stop = startSystemThemeSync()
  useThemeStore.getState().setMode('system')
  assert.equal(document.documentElement.dataset.theme, 'light')
  dark = true; listeners.forEach(listener => listener())
  assert.equal(document.documentElement.dataset.theme, 'dark')
  useThemeStore.getState().setMode('light')
  listeners.forEach(listener => listener())
  assert.equal(document.documentElement.dataset.theme, 'light')
  useThemeStore.getState().setMode('dark')
  dark = false; listeners.forEach(listener => listener())
  assert.equal(document.documentElement.dataset.theme, 'dark')
  stop(); assert.equal(listeners.size, 0)
})
