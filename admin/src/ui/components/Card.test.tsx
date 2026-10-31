import { afterEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, render, screen } from '@testing-library/react'
import { Card } from './Card'
import styles from './Card.module.css'

afterEach(cleanup)

describe('Card', () => {
  test('labels each card with a unique useId-backed heading id', () => {
    render(
      <>
        <Card title="Exposure">First</Card>
        <Card title="Exposure">Second</Card>
      </>,
    )

    const headings = screen.getAllByRole('heading', { level: 2, name: 'Exposure' })
    const regions = screen.getAllByRole('region', { name: 'Exposure' })

    assert.equal(headings.length, 2)
    assert.equal(regions.length, 2)
    assert.ok(headings[0]?.id)
    assert.ok(headings[1]?.id)
    assert.notEqual(headings[0]?.id, headings[1]?.id)
    assert.equal(regions[0]?.getAttribute('aria-labelledby'), headings[0]?.id)
    assert.equal(regions[1]?.getAttribute('aria-labelledby'), headings[1]?.id)
  })

  test('supports an h3, subtitle, tools and visible live marker', () => {
    render(
      <Card
        title="Realtime snapshot"
        sub="Updated just now"
        headingLevel={3}
        live
        tools={<button type="button">Refresh</button>}
      >
        Four live figures
      </Card>,
    )

    assert.ok(screen.getByRole('heading', { level: 3, name: 'Realtime snapshot' }))
    assert.ok(screen.getByText('Updated just now'))
    assert.ok(screen.getByText('Live'))
    assert.ok(screen.getByRole('button', { name: 'Refresh' }))
    assert.equal(screen.getByText('Live').querySelector('[aria-hidden="true"]') !== null, true)
  })

  test('maps every body mode to its fixed inset class', () => {
    const { container, rerender } = render(
      <Card title="Rows" body="padded">
        Body
      </Card>,
    )
    const body = () => container.querySelector(`.${styles.body}`) as HTMLElement

    assert.ok(body().classList.contains(styles.padded))

    rerender(
      <Card title="Rows" body="flush">
        Body
      </Card>,
    )
    assert.ok(body().classList.contains(styles.flush))

    rerender(
      <Card title="Rows" body="table">
        Body
      </Card>,
    )
    assert.ok(body().classList.contains(styles.table))
  })

  test('omits the whole head when there is no title and can render as a div', () => {
    const { container } = render(
      <Card as="div" sub="Not rendered" tools={<button type="button">Not rendered</button>} data-testid="card">
        Plain content
      </Card>,
    )

    const card = screen.getByTestId('card')
    assert.equal(card.tagName, 'DIV')
    assert.equal(card.hasAttribute('aria-labelledby'), false)
    assert.equal(screen.queryByText('Not rendered'), null)
    assert.equal(container.querySelectorAll(`.${styles.card}`).length, 1)
    assert.ok(screen.getByText('Plain content'))
  })
})
