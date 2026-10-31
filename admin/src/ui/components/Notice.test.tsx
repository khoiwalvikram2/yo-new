/**
 * The notice replaces antd's Alert on every migrated surface, including the access-denied state 82
 * pages render. What matters: the text carries the meaning (the glyph is decorative), and it stays
 * silent unless the caller asks for an announcement — a notice that is already on the page when it
 * renders must not interrupt a screen reader.
 */
import { test, describe, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, cleanup } from '@testing-library/react'
import { Notice } from './Notice'
import styles from './Notice.module.css'

afterEach(cleanup)

describe('Notice', () => {
  test('renders its title and message as text', () => {
    render(
      <Notice title="Access denied">You don&apos;t have permission to view this section.</Notice>
    )
    assert.ok(screen.getByText('Access denied'))
    assert.ok(screen.getByText("You don't have permission to view this section."))
  })

  test('is silent by default and speaks only when asked', () => {
    const { rerender } = render(<Notice title="Platform-wide view">Aggregated across whitelabels.</Notice>)
    assert.equal(screen.queryByRole('status'), null)
    assert.equal(screen.queryByRole('alert'), null)

    rerender(<Notice live="polite">Saved.</Notice>)
    assert.ok(screen.getByRole('status'))

    rerender(<Notice tone="error" live="assertive">Failed to load.</Notice>)
    assert.ok(screen.getByRole('alert'))
  })

  test('hides the glyph from assistive tech', () => {
    const { container } = render(
      <Notice tone="warn" icon={<svg data-testid="glyph" />}>
        Check the filters.
      </Notice>
    )
    const glyph = container.querySelector('[aria-hidden="true"]')
    assert.ok(glyph)
    assert.ok(glyph?.querySelector('[data-testid="glyph"]'))
  })

  test('carries the tone and the layout as classes', () => {
    const { container, rerender } = render(<Notice tone="error">Gone wrong.</Notice>)
    const notice = container.firstElementChild as HTMLElement
    assert.ok(notice.classList.contains(styles.error))
    assert.equal(notice.classList.contains(styles.strip), false)

    rerender(
      <Notice tone="warn" layout="strip">
        A new version is ready.
      </Notice>
    )
    const strip = container.firstElementChild as HTMLElement
    assert.ok(strip.classList.contains(styles.warn))
    assert.ok(strip.classList.contains(styles.strip))
  })

  test('renders an action at the end of the row', () => {
    render(
      <Notice title="Access denied" action={<button type="button">Go to home</button>}>
        No permission.
      </Notice>
    )
    assert.ok(screen.getByRole('button', { name: 'Go to home' }))
  })
})
