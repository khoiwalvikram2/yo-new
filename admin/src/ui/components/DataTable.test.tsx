import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DataTable, type DataTableColumn, type DataTableSort } from './DataTable'
import styles from './DataTable.module.css'

interface Row {
  id: string
  name: string
  amount: number
}

const ROWS: Row[] = [
  { id: 'a', name: 'Alpha', amount: 999999999.01 },
  { id: 'b', name: 'Beta', amount: 25 },
]

const COLUMNS: DataTableColumn<Row>[] = [
  {
    key: 'name',
    header: 'Name',
    cell: (row) => row.name,
    sort: (a, b) => a.name.localeCompare(b.name),
  },
  {
    key: 'amount',
    header: 'Amount',
    cell: (row) => `₹${row.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
    align: 'right',
    emphasis: 'key',
    footer: 'Total',
  },
]

afterEach(cleanup)

describe('DataTable', () => {
  test('keeps native table semantics, its caption and long numeric content', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} label="Deposit requests" />)

    const table = screen.getByRole('table', { name: 'Deposit requests' })
    assert.ok(table)
    assert.deepEqual(
      within(table).getAllByRole('columnheader').map((head) => head.textContent),
      ['Name', 'Amount'],
    )
    assert.ok(within(table).getByText('₹99,99,99,999.01'))
    assert.ok(within(table).getByText('₹99,99,99,999.01').closest('td'))
  })

  test('retains headers for initial loading, empty and error states and retries in place', () => {
    const retry = vi.fn()
    const view = render(
      <DataTable
        columns={COLUMNS}
        rows={[]}
        rowKey={(row) => row.id}
        label="Deposits"
        state="loading"
      />,
    )

    assert.ok(screen.getByRole('columnheader', { name: 'Name' }))
    assert.ok(screen.getByRole('status').textContent?.includes('Loading Deposits'))
    assert.equal(screen.getByRole('table', { name: 'Deposits' }).getAttribute('aria-busy'), 'true')

    view.rerender(
      <DataTable columns={COLUMNS} rows={[]} rowKey={(row) => row.id} label="Deposits" />,
    )
    assert.ok(screen.getByRole('columnheader', { name: 'Name' }))
    assert.ok(screen.getByText('No data'))

    view.rerender(
      <DataTable
        columns={COLUMNS}
        rows={[]}
        rowKey={(row) => row.id}
        label="Deposits"
        state="error"
        error="Gateway unavailable"
        onRetry={retry}
      />,
    )
    assert.ok(screen.getByRole('columnheader', { name: 'Name' }))
    assert.ok(screen.getByText('Gateway unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    assert.equal(retry.mock.calls.length, 1)
  })

  test('keeps each state inside the box pinned to the scroller\'s visible part (wide tables, phones)', () => {
    // The state cell spans the whole table: in one wider than its scroller (/matka/live's Bet List, width
    // "wide") the centred "No bets match your filters" ran past the scroller's edge, and off-screen on a phone.
    const pinned = (node: HTMLElement) => {
      const box = node.closest(`.${styles.stateContent}`)
      assert.ok(box, 'the state is not inside the pinned box')
      assert.ok(box.parentElement?.classList.contains(styles.stateCell), 'the pinned box is not the cell\'s child')
    }
    const view = render(
      <DataTable columns={COLUMNS} rows={[]} rowKey={(row) => row.id} label="Bets" width="wide" state="loading" />,
    )
    pinned(screen.getByRole('status'))

    view.rerender(
      <DataTable columns={COLUMNS} rows={[]} rowKey={(row) => row.id} label="Bets" width="wide" empty={<p>No bets match your filters</p>} />,
    )
    pinned(screen.getByText('No bets match your filters'))

    view.rerender(
      <DataTable columns={COLUMNS} rows={[]} rowKey={(row) => row.id} label="Bets" width="wide" state="error" error="Gateway unavailable" />,
    )
    pinned(screen.getByText('Gateway unavailable'))
  })

  test('keeps old rows visible during a refetch or a partial error', () => {
    const view = render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        label="Deposits"
        state="loading"
      />,
    )

    assert.ok(screen.getByText('Alpha'))
    assert.ok(view.container.querySelector(`.${styles.loadingBar}`))
    assert.equal(screen.queryByRole('status'), null)

    view.rerender(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        label="Deposits"
        state="error"
        error="Refresh failed"
      />,
    )
    assert.ok(screen.getByText('Alpha'))
    assert.ok(screen.getByRole('alert').textContent?.includes('Refresh failed'))
  })

  test('cycles controlled sorting and locally applies a comparator', () => {
    function SortedTable() {
      const [sort, setSort] = useState<DataTableSort | null>(null)
      return (
        <DataTable
          columns={COLUMNS}
          rows={[ROWS[1], ROWS[0]]}
          rowKey={(row) => row.id}
          label="Deposits"
          sort={sort}
          onSortChange={setSort}
        />
      )
    }
    render(<SortedTable />)
    const sortButton = screen.getByRole('button', { name: 'Name' })
    const nameHead = screen.getByRole('columnheader', { name: 'Name' })

    fireEvent.click(sortButton)
    assert.equal(nameHead.getAttribute('aria-sort'), 'ascending')
    assert.deepEqual(screen.getAllByRole('row').slice(1, 3).map((row) => row.textContent?.includes('Alpha')), [true, false])

    fireEvent.click(sortButton)
    assert.equal(nameHead.getAttribute('aria-sort'), 'descending')
    assert.deepEqual(screen.getAllByRole('row').slice(1, 3).map((row) => row.textContent?.includes('Beta')), [true, false])

    fireEvent.click(sortButton)
    assert.equal(nameHead.getAttribute('aria-sort'), 'none')
  })

  test('does not reset a controlled page merely because sorting changes', () => {
    const pageChange = vi.fn()
    function PagedTable() {
      const [sort, setSort] = useState<DataTableSort | null>(null)
      return (
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          rowKey={(row) => row.id}
          label="Deposits"
          sort={sort}
          onSortChange={setSort}
          pagination={{
            current: 2,
            pageSize: 10,
            total: 25,
            onChange: pageChange,
            onPageSizeChange: vi.fn(),
          }}
        />
      )
    }
    render(<PagedTable />)
    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    assert.equal(pageChange.mock.calls.length, 0)
    assert.equal(screen.getByRole('button', { name: 'Page 2' }).getAttribute('aria-current'), 'page')
  })

  test('client pagination slices rows and politely announces the new page', async () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      id: String(index + 1),
      name: `Player ${index + 1}`,
      amount: index + 1,
    }))
    render(
      <DataTable
        columns={COLUMNS}
        rows={rows}
        rowKey={(row) => row.id}
        label="Players"
        pagination="client"
      />,
    )

    assert.ok(screen.getByText('Player 10'))
    assert.equal(screen.queryByText('Player 11'), null)
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    assert.ok(screen.getByText('Player 11'))
    await waitFor(() => assert.ok(screen.getByText('Page 2 of 2')))
  })

  test('selection preserves off-page keys and exposes a tri-state page checkbox', () => {
    function SelectableTable() {
      const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(['a', 'off-page']))
      return (
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          rowKey={(row) => row.id}
          label="Deposits"
          selection={{ selected, onChange: setSelected, label: (row) => row.name }}
          bulkActions={<button type="button">Approve selected</button>}
        />
      )
    }
    render(<SelectableTable />)
    const selectPage = screen.getByLabelText('Select all on this page') as HTMLInputElement
    assert.equal(selectPage.checked, false)
    assert.equal(selectPage.indeterminate, true)
    assert.ok(screen.getByText('2 selected'))

    fireEvent.click(screen.getByLabelText('Select Beta'))
    assert.equal(selectPage.checked, true)
    assert.ok(screen.getByText('3 selected'))

    fireEvent.click(selectPage)
    assert.equal(screen.getByText('1 selected').textContent, '1 selected')
  })

  test('a selected row carries data-selected, and follows its checkbox', () => {
    function SelectableTable() {
      const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(['a']))
      return (
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          rowKey={(row) => row.id}
          label="Deposits"
          selection={{ selected, onChange: setSelected, label: (row) => row.name }}
        />
      )
    }
    render(<SelectableTable />)
    const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLTableRowElement
    assert.equal(rowOf('Alpha').getAttribute('data-selected'), 'true')
    // absent, not "false", on an unselected row
    assert.equal(rowOf('Beta').hasAttribute('data-selected'), false)

    fireEvent.click(screen.getByLabelText('Select Beta'))
    fireEvent.click(screen.getByLabelText('Select Alpha'))
    assert.equal(rowOf('Beta').getAttribute('data-selected'), 'true')
    assert.equal(rowOf('Alpha').hasAttribute('data-selected'), false)
    // the head row is never flagged
    assert.equal(screen.getAllByRole('row')[0].hasAttribute('data-selected'), false)
  })

  test('rows of a table without selection carry no selection flag', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} label="Deposits" />)
    assert.equal(document.querySelectorAll('tr[data-selected]').length, 0)
  })

  test('a plain activatable row is one keyboard stop, while a row with a cell control is not', async () => {
    const activate = vi.fn()
    const view = render(
      <DataTable
        columns={COLUMNS}
        rows={[ROWS[0]]}
        rowKey={(row) => row.id}
        label="Deposits"
        onRowActivate={activate}
      />,
    )
    const plainRow = screen.getAllByRole('row')[1]
    await waitFor(() => assert.equal(plainRow.getAttribute('tabindex'), '0'))
    fireEvent.keyDown(plainRow, { key: 'Enter' })
    assert.equal(activate.mock.calls.length, 1)

    const interactiveColumns: DataTableColumn<Row>[] = [
      {
        key: 'name',
        header: 'Name',
        cell: (row) => <button type="button">Inspect {row.name}</button>,
      },
    ]
    view.rerender(
      <DataTable
        columns={interactiveColumns}
        rows={[ROWS[0]]}
        rowKey={(row) => row.id}
        label="Deposits"
        onRowActivate={activate}
      />,
    )
    const interactiveRow = screen.getAllByRole('row')[1]
    await waitFor(() => assert.equal(interactiveRow.getAttribute('tabindex'), null))
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Alpha' }))
    assert.equal(activate.mock.calls.length, 1)
    fireEvent.click(interactiveRow.querySelector('td') as HTMLElement)
    assert.equal(activate.mock.calls.length, 2)
  })

  test('expansion is controlled and connects its toggle to the detail row', () => {
    function ExpandableTable() {
      const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
      return (
        <DataTable
          columns={COLUMNS}
          rows={[ROWS[0]]}
          rowKey={(row) => row.id}
          label="Deposits"
          expandable={{
            expanded,
            onToggle: (key) => setExpanded((current) => current.has(key) ? new Set() : new Set([key])),
            render: (row) => <p>Details for {row.name}</p>,
          }}
        />
      )
    }
    render(<ExpandableTable />)
    const toggle = screen.getByRole('button', { name: 'Expand a' })
    assert.equal(toggle.getAttribute('aria-expanded'), 'false')
    fireEvent.click(toggle)
    const collapse = screen.getByRole('button', { name: 'Collapse a' })
    assert.equal(collapse.getAttribute('aria-expanded'), 'true')
    assert.equal(collapse.getAttribute('aria-controls'), screen.getByText('Details for Alpha').parentElement?.id)
  })

  test('row actions keep a primary control and an accessible menu', async () => {
    const archive = vi.fn()
    render(
      <DataTable
        columns={COLUMNS}
        rows={[ROWS[0]]}
        rowKey={(row) => row.id}
        label="Deposits"
        rowActions={() => ({
          primary: <button type="button">Review</button>,
          menu: [{ key: 'archive', label: 'Archive', onSelect: archive, tone: 'danger' }],
        })}
      />,
    )
    assert.ok(screen.getByRole('button', { name: 'Review' }))
    fireEvent.click(screen.getByRole('button', { name: 'More actions for a' }))
    const item = await screen.findByRole('menuitem', { name: 'Archive' })
    fireEvent.click(item)
    await waitFor(() => assert.equal(archive.mock.calls.length, 1))
  })
})
