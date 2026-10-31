import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Pagination } from './Pagination'
import styles from './Pagination.module.css'

afterEach(cleanup)

function renderPagination(overrides: Partial<React.ComponentProps<typeof Pagination>> = {}) {
  const onChange = vi.fn()
  const onPageSizeChange = vi.fn()
  render(
    <Pagination
      current={2}
      pageSize={10}
      total={42}
      onChange={onChange}
      onPageSizeChange={onPageSizeChange}
      itemName="payments"
      {...overrides}
    />,
  )
  return { onChange, onPageSizeChange }
}

describe('Pagination', () => {
  test('renders a labelled nav, clamped range and exactly one current page', () => {
    renderPagination()
    const nav = screen.getByRole('navigation', { name: 'Pagination' })
    assert.match(nav.textContent ?? '', /Showing 11–20 of 42 payments/)
    assert.equal(nav.querySelector('[aria-live]'), null)
    const current = nav.querySelectorAll('[aria-current="page"]')
    assert.equal(current.length, 1)
    assert.equal(current[0].textContent, '2')
  })

  test('clamps a stale controlled page before deriving range or navigation', () => {
    renderPagination({ current: 99, total: 21 })
    assert.match(screen.getByRole('navigation', { name: 'Pagination' }).textContent ?? '', /Showing 21 of 21/)
    assert.equal(screen.getByRole('button', { name: 'Page 3' }).getAttribute('aria-current'), 'page')
    assert.equal((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled, true)
  })

  test('normalises negative totals and invalid paging inputs without negative ranges', () => {
    renderPagination({ current: -4, pageSize: 0, total: -100 })
    assert.match(screen.getByRole('navigation', { name: 'Pagination' }).textContent ?? '', /Showing 0 of 0 payments/)
    assert.equal(screen.getByRole('button', { name: 'Page 1' }).getAttribute('aria-current'), 'page')
    assert.equal((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled, true)
  })

  test('moves with labelled previous, next and numbered controls', () => {
    const { onChange } = renderPagination()
    screen.getByRole('button', { name: 'Previous page' }).click()
    screen.getByRole('button', { name: 'Page 4' }).click()
    screen.getByRole('button', { name: 'Next page' }).click()
    assert.deepEqual(onChange.mock.calls, [[1], [4], [3]])
  })

  test('disables movement past either boundary', () => {
    const { unmount } = render(<Pagination current={1} pageSize={10} total={40} onChange={() => {}} onPageSizeChange={() => {}} />)
    assert.equal((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled, true)
    unmount()
    render(<Pagination current={4} pageSize={10} total={40} onChange={() => {}} onPageSizeChange={() => {}} />)
    assert.equal((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled, true)
  })

  test('labels the native page-size select and returns to page one after a size change', () => {
    const { onChange, onPageSizeChange } = renderPagination({ pageSizeOptions: [10, 20, 50] })
    const select = screen.getByRole('combobox', { name: 'Rows per page:' }) as HTMLSelectElement
    assert.deepEqual([...select.options].map((option) => option.value), ['10', '20', '50'])
    fireEvent.change(select, { target: { value: '20' } })
    assert.deepEqual(onPageSizeChange.mock.calls, [[20]])
    assert.deepEqual(onChange.mock.calls, [[1]])
  })

  test('keeps a current page size available even when the options omit it', () => {
    renderPagination({ pageSize: 30, pageSizeOptions: [10, 50] })
    const select = screen.getByRole('combobox', { name: 'Rows per page:' }) as HTMLSelectElement
    assert.deepEqual([...select.options].map((option) => option.value), ['30', '10', '50'])
    assert.equal(select.value, '30')
  })

  test('uses a singular item name when exactly one result remains', () => {
    renderPagination({ current: 1, total: 1, itemName: 'entries' })
    const summary = screen.getByRole('navigation', { name: 'Pagination' }).querySelector('p')
    assert.ok(summary)
    assert.match(summary.textContent ?? '', /Showing 1 of 1 entry$/)
  })

  test('collapses a long page list with presentation-only ellipses', () => {
    const { container } = render(
      <Pagination current={8} pageSize={10} total={150} onChange={() => {}} onPageSizeChange={() => {}} />,
    )
    assert.ok(screen.getByRole('button', { name: 'Page 1' }))
    assert.ok(screen.getByRole('button', { name: 'Page 15' }))
    assert.equal(container.querySelectorAll('[aria-hidden="true"]').length >= 2, true)
    assert.equal(screen.queryByRole('button', { name: 'Page 4' }), null)
    assert.deepEqual([...container.querySelectorAll(`.${styles.ellipsis}`)].map(node => node.textContent?.trim()), ['…', '…'])
    assert.equal(container.textContent?.includes('\\u2026'), false)
  })

  test('supports keyboard activation through native buttons', () => {
    const { onChange } = renderPagination()
    const next = screen.getByRole('button', { name: 'Next page' })
    next.focus()
    fireEvent.click(next)
    assert.equal(document.activeElement, next)
    assert.deepEqual(onChange.mock.calls, [[3]])
  })

  test('supports an additive summary formatter with the clamped paging facts', () => {
    const formatSummary = vi.fn(({ start, end, total, current, pageCount }) => (
      <span>{start}-{end} of {total}; page {current}/{pageCount}</span>
    ))
    renderPagination({ current: 99, total: 21, formatSummary })

    assert.match(
      screen.getByRole('navigation', { name: 'Pagination' }).textContent ?? '',
      /21-21 of 21; page 3\/3/,
    )
    assert.deepEqual(formatSummary.mock.calls[0][0], {
      current: 3,
      pageSize: 10,
      pageCount: 3,
      start: 21,
      end: 21,
      total: 21,
      range: '21',
      itemName: 'payments',
    })
  })

  test('can visually hide the page-size label and format option text without losing its name', () => {
    renderPagination({
      pageSizeOptions: [10, 20, 50],
      hidePageSizeLabel: true,
      formatPageSizeOption: (option) => `${option} / page`,
    })

    const select = screen.getByRole('combobox', { name: 'Rows per page:' }) as HTMLSelectElement
    assert.deepEqual([...select.options].map((option) => option.text), [
      '10 / page',
      '20 / page',
      '50 / page',
    ])
    const label = document.querySelector(`label[for="${select.id}"]`)
    assert.ok(label)
    assert.equal(label.textContent?.trim(), 'Rows per page:')
    assert.match(label.className, /visuallyHidden/)
  })

  test('keeps the default surface and offers an embedded table-card variant', () => {
    const view = render(
      <Pagination
        current={1}
        pageSize={10}
        total={20}
        onChange={() => {}}
        onPageSizeChange={() => {}}
      />,
    )
    assert.equal(screen.getByRole('navigation', { name: 'Pagination' }).classList.contains(styles.embedded), false)

    view.rerender(
      <Pagination
        current={1}
        pageSize={10}
        total={20}
        onChange={() => {}}
        onPageSizeChange={() => {}}
        variant="embedded"
      />,
    )
    assert.equal(screen.getByRole('navigation', { name: 'Pagination' }).classList.contains(styles.embedded), true)
  })
})
