/**
 * Badge renders nothing at 0 so a consumer can mount it unconditionally (Rail, panel rows, the
 * notification bell), and its two tones are selected by class name only: the kit sets no position
 * or box-shadow so callers layer those on for the rail ring and the bell dot (S "Component kit").
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { Badge } from './Badge'
import styles from './Badge.module.css'

describe('Badge', () => {
  test('renders nothing at 0', () => {
    const { container } = render(<Badge count={0} />)
    assert.equal(container.firstChild, null)
  })

  test('renders nothing for a negative count', () => {
    const { container } = render(<Badge count={-1} />)
    assert.equal(container.firstChild, null)
  })

  test('renders the count as text', () => {
    const { getByText } = render(<Badge count={5} />)
    assert.ok(getByText('5'))
  })

  test('renders 99+ above the default max', () => {
    const { getByText } = render(<Badge count={140} />)
    assert.ok(getByText('99+'))
  })

  test('renders a custom max', () => {
    const { getByText } = render(<Badge count={12} max={9} />)
    assert.ok(getByText('9+'))
  })

  test('defaults to the soft tone', () => {
    const { getByText } = render(<Badge count={3} />)
    assert.ok(getByText('3').className.includes(styles.soft))
  })

  test('applies the solid tone', () => {
    const { getByText } = render(<Badge count={3} tone="solid" />)
    assert.ok(getByText('3').className.includes(styles.solid))
  })

  test('forwards className and other span props', () => {
    const { getByText } = render(
      <Badge count={3} className="extra" aria-hidden="true" data-testid="badge" />,
    )
    const el = getByText('3')
    assert.ok(el.className.includes('extra'))
    assert.ok(el.className.includes(styles.badge))
    assert.equal(el.getAttribute('aria-hidden'), 'true')
    assert.equal(el.getAttribute('data-testid'), 'badge')
  })
})
