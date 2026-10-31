import { afterEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, render, screen } from '@testing-library/react'
import { Page } from './Page'
import styles from './Page.module.css'

afterEach(cleanup)

describe('Page', () => {
  test('is a plain content wrapper because AppShell owns the main landmark', () => {
    const { container } = render(
      <Page>
        <h1>Deposit Requests</h1>
      </Page>,
    )

    assert.equal(container.firstElementChild?.tagName, 'DIV')
    assert.equal(screen.queryByRole('main'), null)
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Deposit Requests' }))
  })

  test('uses the default content cap unless the page selects another width', () => {
    const { container, rerender } = render(<Page>Default</Page>)
    assert.ok(container.firstElementChild?.classList.contains(styles.page))
    assert.ok(container.firstElementChild?.classList.contains(styles.default))

    rerender(<Page maxWidth="wide">Wide</Page>)
    assert.ok(container.firstElementChild?.classList.contains(styles.wide))
    assert.equal(container.firstElementChild?.classList.contains(styles.default), false)

    rerender(<Page maxWidth="none">Uncapped</Page>)
    assert.ok(container.firstElementChild?.classList.contains(styles.none))
    assert.equal(container.firstElementChild?.classList.contains(styles.wide), false)
  })

  test('keeps a caller class without replacing the frame classes', () => {
    const { container } = render(<Page className="route-page">Content</Page>)
    const page = container.firstElementChild
    assert.ok(page?.classList.contains('route-page'))
    assert.ok(page?.classList.contains(styles.page))
  })
})
