/**
 * IconButton is the icon-only kit control used as the trigger for Tooltip/Popover/Menu across the
 * topbar (bell, theme toggle, burger, saved-view star). This proves the required `label` becomes
 * `aria-label` (so the icon itself can stay aria-hidden), that `aria-disabled` — not native
 * `disabled` — swallows clicks so a Tooltip can still reach the trigger, that the ref forwards to
 * the real `<button>` node for floating-ui, and that the overlay slot (a Badge or dot) renders
 * after the icon.
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { createRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { IconButton } from './IconButton'
import styles from './IconButton.module.css'

describe('IconButton', () => {
  test('the required label becomes aria-label and the icon is aria-hidden', () => {
    render(<IconButton label="Notifications" icon={<span data-testid="glyph">*</span>} />)
    const button = screen.getByRole('button', { name: 'Notifications' })
    assert.equal(button.getAttribute('aria-label'), 'Notifications')
    const glyph = screen.getByTestId('glyph')
    assert.equal(glyph.parentElement?.getAttribute('aria-hidden'), 'true')
  })

  test('defaults to type="button" and size "md"', () => {
    render(<IconButton label="Close" icon={<span />} />)
    const button = screen.getByRole('button', { name: 'Close' })
    assert.equal(button.getAttribute('type'), 'button')
    assert.equal(button.className.includes(styles.md), true)
  })

  test('size="sm" applies the sm class instead of md', () => {
    render(<IconButton label="Close" icon={<span />} size="sm" />)
    const button = screen.getByRole('button', { name: 'Close' })
    assert.equal(button.className.includes(styles.sm), true)
    assert.equal(button.className.includes(styles.md), false)
  })

  test('a normal click runs onClick', () => {
    let clicked = 0
    render(<IconButton label="Close" icon={<span />} onClick={() => { clicked += 1 }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    assert.equal(clicked, 1)
  })

  test('aria-disabled is reflected on the button and swallows the click', () => {
    let clicked = 0
    render(
      <IconButton
        label="Close"
        icon={<span />}
        aria-disabled="true"
        onClick={() => { clicked += 1 }}
      />,
    )
    const button = screen.getByRole('button', { name: 'Close' })
    assert.equal(button.getAttribute('aria-disabled'), 'true')
    fireEvent.click(button)
    assert.equal(clicked, 0)
  })

  test('forwards the ref to the underlying button element', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<IconButton ref={ref} label="Close" icon={<span />} />)
    assert.equal(ref.current instanceof HTMLButtonElement, true)
  })

  test('renders the overlay slot after the icon', () => {
    render(
      <IconButton label="Notifications, 3 unread" icon={<span data-testid="glyph" />}>
        <span data-testid="overlay">3</span>
      </IconButton>,
    )
    const button = screen.getByRole('button', { name: 'Notifications, 3 unread' })
    const glyph = screen.getByTestId('glyph')
    const overlay = screen.getByTestId('overlay')
    assert.equal(button.contains(glyph.parentElement), true)
    assert.equal(button.lastElementChild, overlay)
  })

  /* Page migration (C) W0: the card head needs the bordered tile (M:888-894), which brings its own box. */
  test('the bordered variant replaces the size box', () => {
    render(<IconButton variant="bordered" label="More" icon={<span />} />)
    const button = screen.getByRole('button', { name: 'More' })
    assert.ok(button.classList.contains(styles.bordered))
    assert.equal(button.classList.contains(styles.md), false)
  })
})
