/**
 * The search field is always visible in the new topbar and is the pointer way into GlobalSearch. It is a
 * plain button that looks like a field, so a screen reader must hear one clear name ("Open search"). The
 * placeholder text, the decorative magnifier and the "⌘ K" glyphs must not be read as well. Both
 * placeholder lengths are rendered because CSS picks one by viewport width; the test checks the markup,
 * never computed CSS.
 */
import { test, describe, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, fireEvent } from '@testing-library/react'
import { SearchTrigger } from './SearchTrigger'

describe('SearchTrigger', () => {
  test('is a type="button" named "Open search" that calls onOpen once, with no arguments, on click', () => {
    const onOpen = vi.fn()
    render(<SearchTrigger onOpen={onOpen} />)

    const button = screen.getByRole('button', { name: 'Open search' })
    assert.equal(button.getAttribute('type'), 'button')
    assert.equal(button.getAttribute('aria-haspopup'), 'dialog')

    fireEvent.click(button)
    assert.deepEqual(onOpen.mock.calls, [[]])
  })

  test('renders both placeholder lengths inside the button', () => {
    render(<SearchTrigger onOpen={() => {}} />)
    const button = screen.getByRole('button', { name: 'Open search' })

    const long = screen.getByText('Search players, transactions, or reports...')
    const short = screen.getByText('Search...')
    assert.ok(button.contains(long))
    assert.ok(button.contains(short))
    assert.notEqual(long, short)
  })

  test('shows the ⌘ K hint as a <kbd> hidden from assistive technology', () => {
    render(<SearchTrigger onOpen={() => {}} />)
    const button = screen.getByRole('button', { name: 'Open search' })

    const hints = button.querySelectorAll('kbd')
    assert.equal(hints.length, 1)
    assert.equal(hints[0].textContent, '⌘ K')
    assert.equal(hints[0].getAttribute('aria-hidden'), 'true')
  })

  test('the magnifier icon sits inside an aria-hidden wrapper', () => {
    render(<SearchTrigger onOpen={() => {}} />)
    const button = screen.getByRole('button', { name: 'Open search' })

    const icons = button.querySelectorAll('svg')
    assert.equal(icons.length, 1)
    const wrapper = icons[0].closest('[aria-hidden="true"]')
    assert.ok(wrapper)
    assert.notEqual(wrapper, button)
    assert.ok(button.contains(wrapper))
    assert.equal(button.getAttribute('aria-hidden'), null)
  })
})
