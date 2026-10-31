/**
 * Spinner is the loading state inside Button, Select, the wallet trigger and the topbar popovers.
 * On its own it must have an accessible name. Inside a control that already sets aria-busy it must be
 * hidden, so a screen reader does not hear "Loading" twice.
 */
import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen } from '@testing-library/react'
import { Spinner } from './Spinner'

describe('Spinner', () => {
  test('is an image named "Loading" by default', () => {
    render(<Spinner />)
    const spinner = screen.getByRole('img', { name: 'Loading' })
    assert.equal(spinner.tagName, 'SPAN')
    assert.equal(spinner.getAttribute('aria-hidden'), null)
  })

  test('uses the label as its accessible name', () => {
    render(<Spinner size="sm" label="Loading balance" />)
    const spinner = screen.getByRole('img', { name: 'Loading balance' })
    assert.equal(spinner.getAttribute('aria-label'), 'Loading balance')
  })

  test('a decorative spinner is hidden from assistive tech and has no role or name', () => {
    const { container } = render(<Spinner decorative label="Ignored" />)
    assert.equal(screen.queryByRole('img', { hidden: true }), null)
    const span = container.querySelector('span')
    assert.ok(span)
    assert.equal(span.getAttribute('aria-hidden'), 'true')
    assert.equal(span.getAttribute('role'), null)
    assert.equal(span.getAttribute('aria-label'), null)
  })

  test('passes className and other span attributes through', () => {
    render(<Spinner size="md" className="extra" id="wallet-spinner" title="Fetching" />)
    const spinner = screen.getByRole('img', { name: 'Loading' })
    assert.ok(spinner.classList.contains('extra'))
    assert.equal(spinner.id, 'wallet-spinner')
    assert.equal(spinner.getAttribute('title'), 'Fetching')
  })
})
