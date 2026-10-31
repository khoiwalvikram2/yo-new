import { afterEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, render, screen } from '@testing-library/react'
import { Skeleton } from './Skeleton'
import styles from './Skeleton.module.css'

afterEach(cleanup)

describe('Skeleton', () => {
  test('is decorative while its owner carries the busy state', () => {
    const { container } = render(
      <section aria-busy="true" aria-label="Account summary">
        <Skeleton data-testid="skeleton" />
      </section>,
    )

    const owner = screen.getByRole('region', { name: 'Account summary' })
    const skeleton = screen.getByTestId('skeleton')
    assert.equal(owner.getAttribute('aria-busy'), 'true')
    assert.equal(skeleton.getAttribute('aria-hidden'), 'true')
    assert.equal(skeleton.hasAttribute('aria-busy'), false)
    assert.equal(container.querySelector('[role="status"]'), null)
  })

  test('renders the requested line count and fixed token radius', () => {
    const { container } = render(<Skeleton lines={3} radius="pill" />)
    const skeleton = container.firstElementChild as HTMLElement

    assert.equal(skeleton.querySelectorAll(`.${styles.line}`).length, 3)
    assert.ok(skeleton.classList.contains(styles.pill))
  })

  test('uses constrained numeric dimensions instead of accepting a caller style', () => {
    render(<Skeleton data-testid="skeleton" width={240} height={18} />)
    const skeleton = screen.getByTestId('skeleton')

    assert.equal(skeleton.style.getPropertyValue('--skeleton-width'), '240px')
    assert.equal(skeleton.style.getPropertyValue('--skeleton-height'), '18px')
  })

  test('supports full width and bounds malformed runtime values', () => {
    const { rerender } = render(
      <Skeleton data-testid="skeleton" width="full" lines={99} height={Number.POSITIVE_INFINITY} />,
    )
    const skeleton = screen.getByTestId('skeleton')

    assert.equal(skeleton.style.getPropertyValue('--skeleton-width'), '100%')
    assert.equal(skeleton.style.getPropertyValue('--skeleton-height'), '12px')
    assert.equal(skeleton.querySelectorAll(`.${styles.line}`).length, 12)

    rerender(<Skeleton data-testid="skeleton" lines={0} width={0} height={-4} />)
    assert.equal(skeleton.querySelectorAll(`.${styles.line}`).length, 1)
    assert.equal(skeleton.style.getPropertyValue('--skeleton-width'), '1px')
    assert.equal(skeleton.style.getPropertyValue('--skeleton-height'), '1px')
  })
})
