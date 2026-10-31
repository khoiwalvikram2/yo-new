import { afterEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EmptyState } from './EmptyState'
import styles from './EmptyState.module.css'

afterEach(cleanup)

describe('EmptyState', () => {
  test('renders its title as text without adding a heading', () => {
    render(<EmptyState title="No deposits found" />)
    const title = screen.getByText('No deposits found')
    assert.equal(title.tagName, 'P')
    assert.equal(screen.queryByRole('heading'), null)
  })

  test('renders an optional description', () => {
    render(
      <EmptyState
        title="No results"
        description={<span>Try changing or clearing the active filters.</span>}
      />,
    )
    assert.ok(screen.getByText('Try changing or clearing the active filters.'))
  })

  test('omits optional regions when no icon, description, or action is supplied', () => {
    const { container } = render(<EmptyState title="No data" />)
    assert.equal(container.querySelector(`.${styles.icon}`), null)
    assert.equal(container.querySelector(`.${styles.description}`), null)
    assert.equal(container.querySelector(`.${styles.action}`), null)
  })

  test('hides the decorative icon and applies the neutral tone by default', () => {
    const { container } = render(
      <EmptyState title="No data" icon={<svg data-testid="empty-glyph" />} />,
    )
    const root = container.firstElementChild as HTMLElement
    const icon = container.querySelector(`.${styles.icon}`)
    assert.ok(root.classList.contains(styles.neutral))
    assert.equal(icon?.getAttribute('aria-hidden'), 'true')
    assert.ok(icon?.querySelector('[data-testid="empty-glyph"]'))
  })

  test('supports the ok tone for a settled success state', () => {
    const { container } = render(
      <EmptyState title="Queue is clear" tone="ok" icon={<svg />} />,
    )
    assert.ok((container.firstElementChild as HTMLElement).classList.contains(styles.ok))
  })

  test('renders the caller action and leaves it operable', () => {
    let clicks = 0
    render(
      <EmptyState
        title="No matching events"
        action={
          <button type="button" onClick={() => { clicks += 1 }}>
            Clear filters
          </button>
        }
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    assert.equal(clicks, 1)
  })

  test('supports card and no-inset composition', () => {
    const { container, rerender } = render(<EmptyState title="No data" />)
    assert.ok((container.firstElementChild as HTMLElement).classList.contains(styles.card))

    rerender(<EmptyState title="No data" inset="none" />)
    const root = container.firstElementChild as HTMLElement
    assert.ok(root.classList.contains(styles.none))
    assert.equal(root.classList.contains(styles.card), false)
  })

  test('forwards div attributes and a caller class', () => {
    render(<EmptyState title="No data" className="table-empty" data-testid="empty-state" />)
    const root = screen.getByTestId('empty-state')
    assert.equal(root.tagName, 'DIV')
    assert.ok(root.classList.contains(styles.empty))
    assert.ok(root.classList.contains('table-empty'))
  })
})
