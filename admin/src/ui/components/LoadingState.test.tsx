/**
 * A waiting region must say so once, and reserve the height its content will take, so the page does
 * not jump when the data lands. The ring is decorative: if it also carried the name, a screen reader
 * would hear "Loading" twice.
 */
import { test, describe, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, cleanup } from '@testing-library/react'
import { LoadingState } from './LoadingState'
import styles from './LoadingState.module.css'

afterEach(cleanup)

describe('LoadingState', () => {
  test('is one status region named Loading', () => {
    render(<LoadingState />)
    const status = screen.getByRole('status')
    assert.equal(status.textContent, 'Loading')
    // the ring is hidden from assistive tech, so the name is not announced twice
    assert.equal(status.querySelectorAll('[aria-hidden="true"]').length, 1)
    assert.equal(screen.queryAllByRole('img').length, 0)
  })

  test('announces the caller text', () => {
    // A status region is announced by its contents, not by an accessible name, so the label is the
    // region's text.
    render(<LoadingState label="Loading deposit requests" />)
    assert.equal(screen.getByRole('status').textContent, 'Loading deposit requests')
  })

  test('reserves the table height by default and the small height on request', () => {
    const { rerender } = render(<LoadingState />)
    assert.ok(screen.getByRole('status').classList.contains(styles.md))
    rerender(<LoadingState minHeight={192} />)
    assert.ok(screen.getByRole('status').classList.contains(styles.sm))
  })

  test('reserves the exact height of the content it stands in for, bounded and overriding minHeight', () => {
    const { rerender } = render(<LoadingState height={250} minHeight={192} />)
    let status = screen.getByRole('status')
    assert.ok(status.classList.contains(styles.exact))
    assert.equal(status.classList.contains(styles.sm), false)
    assert.equal(status.style.getPropertyValue('--loading-height'), '250px')

    rerender(<LoadingState height={2} />)
    status = screen.getByRole('status')
    assert.equal(status.style.getPropertyValue('--loading-height'), '24px')

    rerender(<LoadingState height={Number.NaN} />)
    status = screen.getByRole('status')
    assert.ok(status.classList.contains(styles.md))
    assert.equal(status.style.getPropertyValue('--loading-height'), '')
  })

  test('fills its column instead of reserving a height when asked', () => {
    render(<LoadingState fill />)
    const status = screen.getByRole('status')
    assert.ok(status.classList.contains(styles.fill))
    assert.equal(status.classList.contains(styles.md), false)
  })
})
