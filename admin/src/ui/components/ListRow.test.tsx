import { afterEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, render, screen } from '@testing-library/react'
import { ListRow, type ListRowHue } from './ListRow'
import styles from './ListRow.module.css'

afterEach(cleanup)

const decorativeIcon = (
  <svg role="img" aria-label="Decorative alert icon">
    <circle cx="5" cy="5" r="5" />
  </svg>
)

describe('ListRow', () => {
  test('renders a feed row as a list item with truthful visible content', () => {
    render(
      <ul aria-label="Activity">
        <ListRow
          variant="feed"
          icon={decorativeIcon}
          title={<span>Deposit request</span>}
          sub="UTR 123456"
          age="2 min ago"
          hue={6}
        />
      </ul>,
    )

    const list = screen.getByRole('list', { name: 'Activity' })
    const row = screen.getByRole('listitem')
    assert.equal(row.tagName, 'LI')
    assert.equal(list.firstElementChild, row)
    assert.ok(screen.getByText('Deposit request'))
    assert.ok(screen.getByText('UTR 123456'))
    assert.ok(screen.getByText('2 min ago'))
    assert.equal(screen.queryByRole('img', { name: 'Decorative alert icon' }), null)
    assert.equal(row.querySelector(`.${styles.tile}`)?.getAttribute('aria-hidden'), 'true')
    assert.ok(row.querySelector(`.${styles.tile}`)?.classList.contains(styles.hue6))
  })

  test('renders a stat row as a list item without changing its label, qualifier or value', () => {
    render(
      <ul aria-label="Snapshot">
        <ListRow
          variant="stat"
          icon={decorativeIcon}
          label="Available credit"
          sub="Lifetime value"
          value={'\u20b912,34,567.89'}
          data-row-id="credit"
        />
      </ul>,
    )

    const row = screen.getByRole('listitem')
    assert.equal(row.tagName, 'LI')
    assert.equal(row.getAttribute('data-row-id'), 'credit')
    assert.ok(screen.getByText('Available credit'))
    assert.ok(screen.getByText('Lifetime value'))
    assert.ok(screen.getByText('\u20b912,34,567.89'))
    assert.equal(screen.queryByRole('img', { name: 'Decorative alert icon' }), null)
    assert.ok(row.querySelector(`.${styles.tile}`)?.classList.contains(styles.statTile))
  })

  test('retains presentational values such as numeric zero', () => {
    render(
      <ul>
        <ListRow variant="stat" icon={decorativeIcon} label="Requests" sub={0} value={0} />
      </ul>,
    )

    assert.equal(screen.getAllByText('0').length, 2)
  })

  test('maps every feed hue onto the decorative tile only', () => {
    const hues: ListRowHue[] = [1, 2, 3, 4, 5, 6]
    const { container } = render(
      <ul>
        {hues.map((hue) => (
          <ListRow key={hue} variant="feed" icon={decorativeIcon} title={`Row ${hue}`} age="now" hue={hue} />
        ))}
      </ul>,
    )

    const rows = container.querySelectorAll('li')
    hues.forEach((hue, index) => {
      const tile = rows[index]?.querySelector(`.${styles.tile}`)
      assert.ok(tile?.classList.contains(styles[`hue${hue}`]))
      assert.equal(rows[index]?.classList.contains(styles[`hue${hue}`]), false)
    })
  })
})
