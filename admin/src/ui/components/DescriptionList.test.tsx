import { createRef } from 'react'
import { afterEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, render, screen } from '@testing-library/react'
import { DescriptionList } from './DescriptionList'
import styles from './DescriptionList.module.css'

afterEach(cleanup)

describe('DescriptionList', () => {
  test('renders real dl, dt, and dd semantics in item order', () => {
    const { container } = render(
      <DescriptionList
        aria-label="Deposit request details"
        items={[
          { term: 'Request ID', value: 'DEP-1042' },
          { term: 'Amount', value: '₹12,345.67' },
        ]}
      />,
    )

    const list = container.querySelector('dl')
    assert.ok(list)
    assert.equal(screen.getAllByRole('term').length, 2)
    assert.equal(screen.getAllByRole('definition').length, 2)
    assert.deepEqual(
      Array.from(container.querySelectorAll('dt')).map((node) => node.textContent),
      ['Request ID', 'Amount'],
    )
    assert.deepEqual(
      Array.from(container.querySelectorAll('dd')).map((node) => node.textContent),
      ['DEP-1042', '₹12,345.67'],
    )
  })

  test('supports both approved label widths and a quiet note value', () => {
    const { container, rerender } = render(
      <DescriptionList
        labelWidth={96}
        items={[{ term: 'Status', value: 'Awaiting operator review', note: true }]}
      />,
    )
    const list = container.querySelector('dl') as HTMLElement
    const value = container.querySelector('dd') as HTMLElement
    assert.ok(list.classList.contains(styles.label96))
    assert.ok(value.classList.contains(styles.note))

    rerender(<DescriptionList labelWidth={116} items={[]} />)
    assert.ok((container.querySelector('dl') as HTMLElement).classList.contains(styles.label116))
  })

  test('Section supplies a semantic heading and groups optional content', () => {
    render(
      <DescriptionList.Section title="Request">
        <DescriptionList items={[{ term: 'Player', value: 'Aarav' }]} />
      </DescriptionList.Section>,
    )

    const heading = screen.getByRole('heading', { level: 3, name: 'Request' })
    assert.equal(heading.closest('section')?.querySelector('dl')?.tagName, 'DL')
  })

  test('forwards dl attributes, a caller class, and its ref', () => {
    const ref = createRef<HTMLDListElement>()
    render(
      <DescriptionList
        ref={ref}
        className="request-details"
        data-testid="details"
        items={[]}
      />,
    )
    const list = screen.getByTestId('details')
    assert.equal(ref.current, list)
    assert.ok(list.classList.contains('request-details'))
  })
})
