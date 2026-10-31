import { describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { DrillDownTable, type DrillDownColumn } from './DrillDownTable'

interface Row extends Record<string, unknown> {
  id: string
  name: string
  stats: { stakes: number }
}

const ROWS: Row[] = Array.from({ length: 45 }, (_, i) => ({
  id: `r${i + 1}`,
  name: `Sport ${i + 1}`,
  stats: { stakes: (i + 1) * 10 },
}))

const COLUMNS: DrillDownColumn<Row>[] = [
  { title: 'Sport', dataIndex: 'name', key: 'name' },
  {
    title: 'Stakes',
    dataIndex: ['stats', 'stakes'],
    key: 'stakes',
    align: 'right',
    render: (value: number, record, index) => `${record.id}:${value}:${index}`,
  },
]

function bodyRows(table: HTMLElement): string[][] {
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).queryAllByRole('cell').map((cell) => cell.textContent ?? ''))
}

describe('DrillDownTable', () => {
  test('columns read dataIndex or render; 20 rows a page with the legacy total line', () => {
    render(<DrillDownTable data={ROWS} columns={COLUMNS} loading={false} rowKey="id" />)
    const table = screen.getByRole('table', { name: 'Drill-down results' })
    assert.deepEqual(
      within(table).getAllByRole('columnheader').map((th) => th.textContent),
      ['Sport', 'Stakes'],
    )
    const rows = bodyRows(table)
    assert.equal(rows.length, 20)
    assert.deepEqual(rows[0], ['Sport 1', 'r1:10:0'])
    assert.ok(screen.getByText('Total 45 items'))
    assert.ok(screen.getByRole('navigation', { name: 'Pagination' }))
  })

  test('a column with no dataIndex hands render the record, as antd did (legacy `(record) => …` columns)', () => {
    const columns: DrillDownColumn<Row>[] = [
      { title: 'Sport', key: 'sport', render: (record: Row) => `${record.name} (${record.id})` },
      { title: 'Blank', key: 'blank' },
      { title: 'Stakes', dataIndex: ['stats', 'stakes'], key: 'stakes' },
    ]
    render(<DrillDownTable data={ROWS.slice(0, 2)} columns={columns} loading={false} rowKey="id" pagination={false} />)
    assert.deepEqual(bodyRows(screen.getByRole('table')), [
      ['Sport 1 (r1)', '', '10'],
      ['Sport 2 (r2)', '', '20'],
    ])
  })

  test('paging moves the slice and hands render a page-relative index, as antd did', () => {
    render(<DrillDownTable data={ROWS} columns={COLUMNS} loading={false} rowKey={(r) => r.id} />)
    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }))
    const rows = bodyRows(screen.getByRole('table'))
    assert.equal(rows.length, 5)
    assert.deepEqual(rows[0], ['Sport 41', 'r41:410:0'])
  })

  test('a page-size choice takes effect and returns to page 1', () => {
    const onChange = vi.fn()
    render(<DrillDownTable data={ROWS} columns={COLUMNS} loading={false} rowKey="id" pagination={{ onChange }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    assert.deepEqual(onChange.mock.calls.at(-1), [2, 20])
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '50' } })
    assert.deepEqual(onChange.mock.calls.at(-1), [1, 50])
    assert.equal(bodyRows(screen.getByRole('table')).length, 45)
  })

  test('pagination false shows every row; a server total shows the rows as given', () => {
    const { unmount } = render(<DrillDownTable data={ROWS} columns={COLUMNS} loading={false} rowKey="id" pagination={false} />)
    assert.equal(bodyRows(screen.getByRole('table')).length, 45)
    assert.equal(screen.queryByRole('navigation', { name: 'Pagination' }), null)
    unmount()

    render(
      <DrillDownTable data={ROWS.slice(0, 20)} columns={COLUMNS} loading={false} rowKey="id" pagination={{ current: 2, total: 200 }} />,
    )
    const rows = bodyRows(screen.getByRole('table'))
    assert.equal(rows.length, 20)
    assert.deepEqual(rows[0], ['Sport 1', 'r1:10:0'])
    assert.ok(screen.getByText('Total 200 items'))
    assert.equal(screen.getByRole('button', { name: 'Page 2' }).getAttribute('aria-current'), 'page')
  })

  test('a row opens on click, and on Enter when it holds no control of its own', () => {
    const onRowClick = vi.fn()
    render(<DrillDownTable data={ROWS.slice(0, 2)} columns={COLUMNS} loading={false} rowKey="id" onRowClick={onRowClick} />)
    const row = screen.getByRole('row', { name: /Sport 2/ })
    fireEvent.click(within(row).getByText('Sport 2'))
    assert.equal(onRowClick.mock.calls.length, 1, 'one click opens the row once')
    assert.equal(onRowClick.mock.calls[0][0], ROWS[1])
    assert.equal(row.getAttribute('tabindex'), '0')
    fireEvent.keyDown(row, { key: 'Enter' })
    assert.equal(onRowClick.mock.calls.length, 2)
    assert.equal(onRowClick.mock.calls[1][0], ROWS[1])
    fireEvent.click(screen.getByRole('button', { name: 'Page 1' }))
    assert.equal(onRowClick.mock.calls.length, 2, 'the pager is not a row')
  })

  test('rows expand through a labelled button that reports and controls its region', () => {
    const onRowClick = vi.fn()
    render(
      <DrillDownTable
        data={ROWS.slice(0, 2)}
        columns={COLUMNS}
        loading={false}
        rowKey="id"
        onRowClick={onRowClick}
        expandable
        expandedRowRender={(record) => <p>Leagues of {record.name}</p>}
      />,
    )
    const expander = screen.getByRole('button', { name: 'Expand r1' })
    assert.equal(expander.getAttribute('aria-expanded'), 'false')
    assert.equal(screen.queryByText('Leagues of Sport 1'), null)
    fireEvent.click(expander)
    const collapse = screen.getByRole('button', { name: 'Collapse r1' })
    assert.equal(collapse.getAttribute('aria-expanded'), 'true')
    const region = document.getElementById(collapse.getAttribute('aria-controls') ?? '')
    assert.ok(region)
    assert.equal(region.textContent, 'Leagues of Sport 1')
    fireEvent.click(region)
    fireEvent.click(screen.getByText('Sport 2'))
    assert.deepEqual(onRowClick.mock.calls.map((call) => call[0]), [ROWS[1]], 'neither the expander nor the expansion opens a row')
    fireEvent.click(collapse)
    assert.equal(screen.queryByText('Leagues of Sport 1'), null)
  })

  test('expandable without a renderer adds no expander, as before', () => {
    render(<DrillDownTable data={ROWS.slice(0, 1)} columns={COLUMNS} loading={false} rowKey="id" expandable />)
    assert.equal(screen.queryByRole('button', { name: /Expand/ }), null)
  })

  test('loading before data announces itself; an empty result says No data', () => {
    const { rerender } = render(<DrillDownTable data={[]} columns={COLUMNS} loading rowKey="id" label="Sports" />)
    assert.equal(screen.getByRole('status').textContent, 'Loading Sports')
    assert.equal(screen.getByRole('table', { name: 'Sports' }).getAttribute('aria-busy'), 'true')
    rerender(<DrillDownTable data={[]} columns={COLUMNS} loading={false} rowKey="id" label="Sports" />)
    assert.ok(screen.getByText('No data'))
  })
})
