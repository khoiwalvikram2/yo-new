/**
 * Kbd renders the small "key" glyphs used for shortcut hints — the topbar search trigger's "⌘ K"
 * (T35) is its only consumer today. It must render a real <kbd> element (not a <span>), because the
 * module CSS gives that real element an explicit font-family and inline-flex box; a caller composing
 * a hint out of several parts (e.g. "⌘" and "K") must see them joined in the rendered text; and it
 * must forward className and other HTML attributes so a caller can add its own attributes without an
 * extra wrapper element.
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen } from '@testing-library/react'
import { Kbd } from './Kbd'
import styles from './Kbd.module.css'

describe('Kbd', () => {
  test('renders a real <kbd> element with the kit class', () => {
    render(<Kbd>K</Kbd>)
    const el = screen.getByText('K')
    assert.equal(el.tagName, 'KBD')
    assert.ok(el.className.includes(styles.kbd))
  })

  test('renders its children verbatim, including several nodes', () => {
    render(
      <Kbd data-testid="hint">
        <span>⌘</span> K
      </Kbd>,
    )
    const el = screen.getByTestId('hint')
    assert.equal(el.textContent, '⌘ K')
  })

  test('forwards className and other HTML attributes', () => {
    render(
      <Kbd className="extra" aria-hidden="true" title="Command K">
        ⌘ K
      </Kbd>,
    )
    const el = screen.getByTitle('Command K')
    assert.ok(el.classList.contains('extra'))
    assert.ok(el.classList.contains(styles.kbd))
    assert.equal(el.getAttribute('aria-hidden'), 'true')
  })
})
