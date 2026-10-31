import { createRef } from 'react'
import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Table, TBody, TD, TFoot, TH, THead, TR } from './Table'
import styles from './Table.module.css'

function AmountTable({ width = 'default', inset = false }: { width?: 'default' | 'wide' | 'narrow' | 'fill'; inset?: boolean }) {
  return (
    <Table caption="Settlement ledger" width={width} inset={inset}>
      <THead>
        <TR>
          <TH>Reference</TH>
          <TH align="right">Amount</TH>
          <TH align="center" sticky="end">
            Actions
          </TH>
        </TR>
      </THead>
      <TBody>
        <TR>
          <TD emphasis="id">DEP-20261003-000000000001</TD>
          <TD align="right" emphasis="key" tone="pos">
            ₹9,99,99,999.99
          </TD>
          <TD align="center" sticky="end">
            Review
          </TD>
        </TR>
      </TBody>
      <TFoot>
        <TR>
          <TD>Total</TD>
          <TD align="right">₹9,99,99,999.99</TD>
          <TD sticky="end" />
        </TR>
      </TFoot>
    </Table>
  )
}

describe('Table primitives', () => {
  test('keep native table sections, a hidden caption, scoped headers and exact long INR text', () => {
    render(<AmountTable />)

    const table = screen.getByRole('table', { name: 'Settlement ledger' })
    assert.equal(table.tagName, 'TABLE')
    assert.equal(table.querySelectorAll('thead').length, 1)
    assert.equal(table.querySelectorAll('tbody').length, 1)
    assert.equal(table.querySelectorAll('tfoot').length, 1)

    const caption = table.querySelector('caption')
    assert.ok(caption)
    assert.equal(caption.textContent, 'Settlement ledger')
    assert.ok(caption.classList.contains(styles.visuallyHidden))

    const headers = screen.getAllByRole('columnheader')
    assert.equal(headers.length, 3)
    assert.deepEqual(headers.map((header) => header.getAttribute('scope')), ['col', 'col', 'col'])
    assert.equal(screen.getAllByText('₹9,99,99,999.99').length, 2)
  })

  test('can take its accessible name from visible text instead of rendering a caption', () => {
    render(
      <section>
        <h2 id="pending-heading">Pending requests</h2>
        <Table aria-labelledby="pending-heading" hideCaption={false}>
          <TBody>
            <TR>
              <TD>DR-42</TD>
            </TR>
          </TBody>
        </Table>
      </section>,
    )

    const table = screen.getByRole('table', { name: 'Pending requests' })
    assert.equal(table.getAttribute('aria-labelledby'), 'pending-heading')
    assert.equal(table.querySelector('caption'), null)
  })

  test('can render a visible native caption', () => {
    render(
      <Table caption="Exposure by market" hideCaption={false}>
        <TBody>
          <TR>
            <TD>Cricket</TD>
          </TR>
        </TBody>
      </Table>,
    )

    const caption = screen.getByText('Exposure by market')
    assert.equal(caption.tagName, 'CAPTION')
    assert.ok(caption.classList.contains(styles.caption))
    assert.equal(caption.classList.contains(styles.visuallyHidden), false)
  })

  test('maps width, inset, alignment, emphasis, tone and sticky-end variants to primitive classes', () => {
    const { container, rerender } = render(<AmountTable width="wide" inset />)
    const table = screen.getByRole('table', { name: 'Settlement ledger' })
    assert.ok(table.classList.contains(styles.wide))
    assert.ok(table.classList.contains(styles.inset))

    const amount = screen.getAllByText('₹9,99,99,999.99')[0]
    assert.ok(amount)
    assert.ok(amount.classList.contains(styles.right))
    assert.ok(amount.classList.contains(styles.key))
    assert.ok(amount.classList.contains(styles.pos))

    const actionHeader = screen.getByRole('columnheader', { name: 'Actions' })
    assert.ok(actionHeader.classList.contains(styles.center))
    assert.ok(actionHeader.classList.contains(styles.stickyEnd))
    assert.ok(screen.getByText('Review').classList.contains(styles.stickyEnd))

    rerender(<AmountTable width="narrow" />)
    assert.ok(screen.getByRole('table', { name: 'Settlement ledger' }).classList.contains(styles.narrow))
    assert.equal(container.querySelectorAll('table').length, 1)
  })

  test('keeps the no-overflow wrapper out of the tab order', () => {
    render(<AmountTable />)
    const table = screen.getByRole('table', { name: 'Settlement ledger' })
    const wrapper = table.parentElement
    assert.ok(wrapper)
    assert.equal(wrapper.dataset.overflow, 'false')
    assert.equal(wrapper.dataset.overflowStart, 'true')
    assert.equal(wrapper.dataset.overflowEnd, 'true')
    assert.equal(wrapper.getAttribute('tabindex'), null)
    assert.equal(wrapper.getAttribute('role'), null)
  })

  test('TR onActivate supplies click, Enter and Space activation with an inset focus target', () => {
    let activations = 0
    render(
      <table>
        <tbody>
          <TR onActivate={() => (activations += 1)} open>
            <TD>Open details</TD>
          </TR>
        </tbody>
      </table>,
    )

    const row = screen.getByRole('row')
    assert.equal(row.tabIndex, 0)
    assert.ok(row.classList.contains(styles.interactive))
    assert.ok(row.classList.contains(styles.open))
    assert.equal(row.dataset.state, 'open')

    fireEvent.click(row)
    fireEvent.keyDown(row, { key: 'Enter' })
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    row.dispatchEvent(space)

    assert.equal(activations, 3)
    assert.equal(space.defaultPrevented, true)
  })

  test('preserves native row handlers/tabIndex and lets preventDefault cancel convenience activation', () => {
    let activations = 0
    let clicks = 0
    let keys = 0
    render(
      <table>
        <tbody>
          <TR
            tabIndex={-1}
            onActivate={() => (activations += 1)}
            onClick={(event) => {
              clicks += 1
              event.preventDefault()
            }}
            onKeyDown={(event) => {
              keys += 1
              event.preventDefault()
            }}
          >
            <TD>Controlled row</TD>
          </TR>
        </tbody>
      </table>,
    )

    const row = screen.getByRole('row')
    assert.equal(row.tabIndex, -1)
    fireEvent.click(row)
    fireEvent.keyDown(row, { key: 'Enter' })
    assert.equal(clicks, 1)
    assert.equal(keys, 1)
    assert.equal(activations, 0)
  })

  test('forwards refs through every semantic primitive and passes native attributes through', () => {
    const tableRef = createRef<HTMLTableElement>()
    const headRef = createRef<HTMLTableSectionElement>()
    const bodyRef = createRef<HTMLTableSectionElement>()
    const footRef = createRef<HTMLTableSectionElement>()
    const rowRef = createRef<HTMLTableRowElement>()
    const headerRef = createRef<HTMLTableCellElement>()
    const cellRef = createRef<HTMLTableCellElement>()

    render(
      <Table ref={tableRef} caption="Ref ledger" data-table-kind="ledger">
        <THead ref={headRef}>
          <TR>
            <TH ref={headerRef} scope="rowgroup">
              Header
            </TH>
          </TR>
        </THead>
        <TBody ref={bodyRef}>
          <TR ref={rowRef} aria-label="Ref row">
            <TD ref={cellRef} colSpan={2}>
              Value
            </TD>
          </TR>
        </TBody>
        <TFoot ref={footRef} />
      </Table>,
    )

    assert.equal(tableRef.current?.tagName, 'TABLE')
    assert.equal(tableRef.current?.dataset.tableKind, 'ledger')
    assert.equal(headRef.current?.tagName, 'THEAD')
    assert.equal(bodyRef.current?.tagName, 'TBODY')
    assert.equal(footRef.current?.tagName, 'TFOOT')
    assert.equal(rowRef.current, screen.getByRole('row', { name: 'Ref row' }))
    assert.equal(headerRef.current?.getAttribute('scope'), 'rowgroup')
    assert.equal(cellRef.current?.colSpan, 2)
  })
})
