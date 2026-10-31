/**
 * Tooltips, popovers and menus are portaled to <body>, so on their own they would take the theme of
 * <html>. getFloatingTheme reads the theme of the region the trigger sits in, so a layer opened inside
 * a forced-light region (LightRegion, an unmigrated <main>) renders light while the shell is dark.
 */
import { test, describe, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { getFloatingTheme } from './floating'

function mount(html: string): void {
  document.body.innerHTML = html
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id)
  assert.ok(element, `missing #${id}`)
  return element
}

describe('getFloatingTheme', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    delete document.documentElement.dataset.theme
  })

  test('returns the theme of the nearest ancestor that carries data-theme', () => {
    document.documentElement.dataset.theme = 'dark'
    mount('<div data-theme="light"><section><button id="trigger">Open</button></section></div>')
    assert.equal(getFloatingTheme(byId('trigger')), 'light')
  })

  test('leaves the portal theme unstamped so the <html> palette inherits live without a closer region', () => {
    document.documentElement.dataset.theme = 'dark'
    mount('<div><button id="trigger">Open</button></div>')
    assert.equal(getFloatingTheme(byId('trigger')), undefined)
    document.documentElement.dataset.theme = 'light'
    assert.equal(getFloatingTheme(byId('trigger')), undefined)
  })

  test('reads data-theme on the reference element itself', () => {
    mount('<div data-theme="light"><button id="trigger" data-theme="dark">Open</button></div>')
    assert.equal(getFloatingTheme(byId('trigger')), 'dark')
  })

  test('returns undefined when no ancestor carries a theme', () => {
    mount('<div><button id="trigger">Open</button></div>')
    assert.equal(getFloatingTheme(byId('trigger')), undefined)
  })

  test('returns undefined when the nearest theme value is not light or dark', () => {
    mount('<div data-theme="dark"><div data-theme="sepia"><button id="trigger">Open</button></div></div>')
    assert.equal(getFloatingTheme(byId('trigger')), undefined)
  })

  test('returns undefined for a null reference (trigger not mounted yet)', () => {
    assert.equal(getFloatingTheme(null), undefined)
  })
})
