/**
 * The meter is the one place a fill width is set inline, so pages never have to (inline styles are
 * banned outright in the payments and players routes). It must clamp whatever a page hands it — a
 * share computed from a zero total, a limit already passed — and it must stay silent when the figure
 * is already printed beside it.
 */
import { test, describe, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, cleanup } from '@testing-library/react'
import { Meter } from './Meter'
import styles from './Meter.module.css'

afterEach(cleanup)

const fillOf = (container: HTMLElement) => container.querySelector('span') as HTMLElement

describe('Meter', () => {
  test('draws the value as the fill width', () => {
    const { container } = render(<Meter value={38} />)
    assert.equal(fillOf(container).style.width, '38%')
  })

  test('clamps out-of-range and non-finite values', () => {
    const { container, rerender } = render(<Meter value={140} />)
    assert.equal(fillOf(container).style.width, '100%')
    rerender(<Meter value={-12} />)
    assert.equal(fillOf(container).style.width, '0%')
    rerender(<Meter value={Number.NaN} />)
    assert.equal(fillOf(container).style.width, '0%')
  })

  test('is decorative unless it is labelled', () => {
    const { container, rerender } = render(<Meter value={50} />)
    assert.equal(container.firstElementChild?.getAttribute('aria-hidden'), 'true')
    assert.equal(screen.queryByRole('meter'), null)

    rerender(<Meter value={50} label="Credit used" />)
    const meter = screen.getByRole('meter', { name: 'Credit used' })
    assert.equal(meter.getAttribute('aria-valuenow'), '50')
    assert.equal(meter.getAttribute('aria-valuetext'), '50%')
  })

  test('takes a caller value text', () => {
    render(<Meter value={72.4} label="Credit used" valueText="72% of ₹5,00,000" />)
    const meter = screen.getByRole('meter')
    assert.equal(meter.getAttribute('aria-valuetext'), '72% of ₹5,00,000')
    assert.equal(meter.getAttribute('aria-valuenow'), '72')
  })

  test('carries the tone on the fill', () => {
    const { container } = render(<Meter value={95} tone="neg" />)
    assert.ok(fillOf(container).classList.contains(styles.neg))
  })
})
