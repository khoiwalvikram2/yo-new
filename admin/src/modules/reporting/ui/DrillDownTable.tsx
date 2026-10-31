import { useMemo, useRef, useState, type Key, type MouseEvent, type ReactNode } from 'react'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import {
  DRILL_DOWN_PAGE_SIZE,
  DRILL_DOWN_PAGE_SIZES,
  cellValue,
  drillDownSummary,
  pageRows,
  plainCell,
  resolveRowKey,
  type DataIndex,
} from './drillDownModel'
import styles from './DrillDownTable.module.css'

/**
 * The antd column fields the drill-down tables used, without antd. A legacy `ColumnsType<T>` built
 * from these fields type-checks here unchanged; Tailwind classes in a column must go when its page
 * migrates, so `className` is accepted and not applied.
 */
export interface DrillDownColumn<T> {
  title?: ReactNode
  /** As antd: a key or a path; left out (or '') the cell value handed to render is the record itself. */
  dataIndex?: DataIndex
  key?: Key
  // antd hands render the raw cell value, whatever the record holds there
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render?: (value: any, record: T, index: number) => ReactNode
  align?: 'left' | 'right' | 'center'
  width?: number | string
  className?: string
}

/** The antd pagination fields the legacy table read. */
export interface DrillDownPagination {
  current?: number
  pageSize?: number
  total?: number
  showSizeChanger?: boolean
  pageSizeOptions?: readonly (number | string)[]
  showTotal?: (total: number, range: [number, number]) => ReactNode
  onChange?: (page: number, pageSize: number) => void
}

export interface DrillDownTableProps<T> {
  data: T[]
  columns: DrillDownColumn<T>[]
  loading: boolean
  onRowClick?: (record: T) => void
  rowKey: string | ((record: T) => string)
  expandable?: boolean
  expandedRowRender?: (record: T) => ReactNode
  pagination?: false | DrillDownPagination
  /** BEYOND the legacy props: the table's accessible name. @default 'Drill-down results' */
  label?: string
}

/** What a click inside a row may land on that is a control of its own, not the row. */
const CONTROLS = 'a[href], button, input, select, textarea, [contenteditable="true"]'

function columnKey<T>(column: DrillDownColumn<T>, index: number): string {
  if (column.key !== undefined && column.key !== null) return String(column.key)
  const path = Array.isArray(column.dataIndex) ? column.dataIndex.join('.') : String(column.dataIndex ?? '')
  // a column with no dataIndex (or an empty one) reads the whole record; it is keyed by position
  return path !== '' ? path : `column-${index}`
}

/**
 * The drill-down reports' table on the kit DataTable: rows open on click (and Enter or Space on a row
 * with no control of its own), rows expand through a labelled button with aria-expanded, and the
 * table pages 20 rows at a time with "Total N items", as the legacy antd table did. Same props as
 * components/DrillDownTable.tsx.
 */
// The legacy constraint, kept so every row type a page passes today still type-checks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function DrillDownTable<T extends Record<string, any>>({
  data,
  columns,
  loading,
  onRowClick,
  rowKey,
  expandable,
  expandedRowRender,
  pagination,
  label = 'Drill-down results',
}: DrillDownTableProps<T>) {
  const paged = pagination !== false
  const config = paged ? { pageSize: DRILL_DOWN_PAGE_SIZE, showSizeChanger: true, ...pagination } : undefined
  const [innerPage, setInnerPage] = useState(1)
  const [innerPageSize, setInnerPageSize] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const rootRef = useRef<HTMLDivElement>(null)
  const activatedRef = useRef(false)
  const pendingSizeRef = useRef<number | null>(null)

  const pageSize = innerPageSize ?? config?.pageSize ?? DRILL_DOWN_PAGE_SIZE
  const total = config?.total ?? data.length
  const maxPage = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  const current = Math.min(config?.current ?? innerPage, maxPage)
  const rows = paged ? pageRows(data, current, pageSize, config?.total) : data
  const firstIndex = paged ? (current - 1) * pageSize : 0

  const keyOf = (row: T) => resolveRowKey(rowKey, row)

  const tableColumns = useMemo<DataTableColumn<T>[]>(
    () =>
      columns.map((column, index) => ({
        key: columnKey(column, index),
        header: column.title ?? '',
        align: column.align,
        width: column.width,
        cell: (row: T, rowIndex: number) => {
          const value = cellValue(row, column.dataIndex)
          return column.render ? column.render(value, row, rowIndex - firstIndex) : plainCell(value)
        },
      })),
    [columns, firstIndex],
  )

  const sizeOptions = config?.showSizeChanger === false
    ? [pageSize]
    : (config?.pageSizeOptions ?? DRILL_DOWN_PAGE_SIZES).map(Number).filter((n) => Number.isFinite(n) && n > 0)

  const changePage = (page: number, size: number) => {
    setInnerPage(page)
    config?.onChange?.(page, size)
  }

  const hasExpansion = Boolean(expandable && expandedRowRender)

  /** The data row a body <tr> of this table draws (not a nested table's, not an expansion row). */
  const rowOf = (tr: HTMLTableRowElement): T | undefined => {
    const table = rootRef.current?.querySelector('table')
    const body = tr.parentElement
    if (!table || tr.closest('table') !== table || !body || body.tagName !== 'TBODY') return undefined
    const drawn = Array.from(body.children)
    let position = 0
    for (const row of rows) {
      if (drawn[position] === tr) return row
      position += 1
      if (hasExpansion && expanded.has(keyOf(row))) position += 1
    }
    return undefined
  }

  /*
   * The kit DataTable activates a row from a click only when the click is not inside a focusable
   * element, and it tests that with closest(), which also matches the row itself once the row is a
   * keyboard stop (tabindex 0) — so a mouse click on a row with no control of its own never reaches
   * onRowActivate there (reported as a kit gap; kit files are not edited by a page task). The legacy
   * table opened rows on click, so the click is handled here, once: activatedRef records whether the
   * kit already activated the row during this click, so a fixed kit does not open it twice. Keyboard
   * activation (Enter or Space on the focused row) stays the kit's.
   */
  const activateFromClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onRowClick || activatedRef.current) return
    const target = event.target
    if (!(target instanceof Element)) return
    const tr = target.closest('tr')
    if (!tr) return
    const control = target.closest(CONTROLS)
    if (control && tr.contains(control)) return
    const row = rowOf(tr)
    if (row !== undefined) onRowClick(row)
  }

  return (
    // The wrapper only delegates row clicks (see activateFromClick); the rows carry the keyboard model.
    <div
      ref={rootRef}
      className={styles.root}
      onClickCapture={() => {
        activatedRef.current = false
      }}
      onClick={activateFromClick}
    >
      <DataTable<T>
        columns={tableColumns}
        rows={rows}
        rowKey={keyOf}
        label={label}
        state={loading ? 'loading' : 'ready'}
        onRowActivate={
          onRowClick
            ? (row) => {
                activatedRef.current = true
                onRowClick(row)
              }
            : undefined
        }
        expandable={
          expandable && expandedRowRender
            ? {
                render: expandedRowRender,
                expanded,
                onToggle: (key) =>
                  setExpanded((previous) => {
                    const next = new Set(previous)
                    if (next.has(key)) next.delete(key)
                    else next.add(key)
                    return next
                  }),
              }
            : undefined
        }
        pagination={
          paged
            ? {
                current,
                pageSize,
                total,
                // the kit reports a size change as onPageSizeChange(size) followed by onChange(1)
                onChange: (page) => {
                  const size = pendingSizeRef.current ?? pageSize
                  pendingSizeRef.current = null
                  changePage(page, size)
                },
                onPageSizeChange: (size) => {
                  pendingSizeRef.current = size
                  setInnerPageSize(size)
                },
                pageSizeOptions: sizeOptions,
                formatSummary: (summary) =>
                  config?.showTotal
                    ? config.showTotal(summary.total, [summary.start, summary.end])
                    : drillDownSummary(summary.total),
              }
            : false
        }
      />
    </div>
  )
}
