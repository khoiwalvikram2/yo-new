import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowsSort,
  IconChevronDown,
  IconChevronRight,
  IconDots,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { Button } from './Button'
import { Checkbox } from './Checkbox'
import { EmptyState } from './EmptyState'
import { IconButton } from './IconButton'
import { LoadingState } from './LoadingState'
import { Menu, MenuItem, type MenuItemSpec } from './Menu'
import { Pagination, type PaginationProps } from './Pagination'
import {
  Table,
  TBody,
  TD,
  TFoot,
  TH,
  THead,
  TR,
  type TableWidth,
} from './Table'
import styles from './DataTable.module.css'

export type DataTableSortDirection = 'asc' | 'desc'

export interface DataTableSort {
  key: string
  dir: DataTableSortDirection
}

export interface DataTableColumn<T> {
  key: string
  header: ReactNode
  cell: (row: T, index: number) => ReactNode
  align?: 'left' | 'right' | 'center'
  emphasis?: 'key' | 'dim' | 'id'
  width?: number | string
  minWidth?: number
  /** `true` delegates sorting to the owner; a comparator sorts the rows in this component. */
  sort?: true | ((a: T, b: T) => number)
  sticky?: 'end'
  hidden?: boolean
  footer?: ReactNode
}

export interface DataTableSelection<T> {
  selected: ReadonlySet<string>
  onChange: (next: Set<string>) => void
  label?: (row: T) => string
}

export interface DataTableExpandable<T> {
  render: (row: T) => ReactNode
  expanded: ReadonlySet<string>
  onToggle: (key: string) => void
}

export interface DataTableRowActions {
  primary?: ReactNode
  menu?: readonly MenuItemSpec[]
}

export interface DataTableProps<T> {
  columns: readonly DataTableColumn<T>[]
  rows: readonly T[]
  rowKey: (row: T) => string
  /** Accessible table/region name. */
  label: string
  state?: 'ready' | 'loading' | 'error'
  error?: ReactNode
  onRetry?: () => void
  empty?: ReactNode
  sort?: DataTableSort | null
  onSortChange?: (sort: DataTableSort | null) => void
  pagination?: PaginationProps | 'client' | false
  selection?: DataTableSelection<T>
  bulkActions?: ReactNode
  onRowActivate?: (row: T) => void
  openRowKey?: string
  expandable?: DataTableExpandable<T>
  rowActions?: (row: T) => DataTableRowActions
  density?: 'default' | 'compact'
  width?: TableWidth
  toolbar?: ReactNode
  className?: string
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
}

function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, Math.trunc(page) || 1), pageCount(total, pageSize))
}

function headerText(column: DataTableColumn<unknown>): string {
  if (typeof column.header === 'string' || typeof column.header === 'number') {
    return String(column.header)
  }
  return column.key
}

function columnStyle<T>(column: DataTableColumn<T>): CSSProperties | undefined {
  if (column.width === undefined && column.minWidth === undefined) return undefined
  return {
    width: typeof column.width === 'number' ? `${column.width}px` : column.width,
    minWidth: column.minWidth === undefined ? undefined : `${column.minWidth}px`,
  }
}

interface ActivatableRowProps {
  activate?: () => void
  open: boolean
  /** Its select checkbox is checked: `data-selected` lets the skin tint the row without reading the box. */
  selected?: boolean
  children: ReactNode
}

/**
 * A row remains clickable from a plain cell, but becomes a keyboard stop only when none of its
 * cells already contains a focusable control. That prevents a row and every control inside it
 * from becoming duplicate stops in the same table record.
 */
function ActivatableRow({ activate, open, selected = false, children }: ActivatableRowProps) {
  const ref = useRef<HTMLTableRowElement>(null)
  const [hasFocusableCell, setHasFocusableCell] = useState(true)

  useLayoutEffect(() => {
    const next = Boolean(ref.current?.querySelector(FOCUSABLE))
    setHasFocusableCell((current) => (current === next ? current : next))
  }, [children])

  const keyboardActive = Boolean(activate) && !hasFocusableCell

  const activateFromClick = (event: MouseEvent<HTMLTableRowElement>) => {
    if (!activate) return
    const target = event.target
    if (target instanceof Element && target.closest(FOCUSABLE)) return
    activate()
  }

  const activateFromKeyboard = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (!keyboardActive || event.target !== event.currentTarget) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    activate?.()
  }

  return (
    <TR
      ref={ref}
      interactive={Boolean(activate)}
      open={open}
      data-selected={selected ? 'true' : undefined}
      tabIndex={keyboardActive ? 0 : undefined}
      onClick={activateFromClick}
      onKeyDown={activateFromKeyboard}
    >
      {children}
    </TR>
  )
}

function renderMenuItems(items: readonly MenuItemSpec[]) {
  return items.map(({ key, label, ...item }) => (
    <MenuItem key={key} {...item}>
      {label}
    </MenuItem>
  ))
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  label,
  state = 'ready',
  error,
  onRetry,
  empty,
  sort = null,
  onSortChange,
  pagination = false,
  selection,
  bulkActions,
  onRowActivate,
  openRowKey,
  expandable,
  rowActions,
  density = 'default',
  width = 'default',
  toolbar,
  className,
}: DataTableProps<T>) {
  const instanceId = useId().replace(/:/g, '')
  const [clientPage, setClientPage] = useState(1)
  const [clientPageSize, setClientPageSize] = useState(10)
  const [announcement, setAnnouncement] = useState('')
  const previousPage = useRef<number | null>(null)
  const previousSort = useRef<string | null>(null)

  const visibleColumns = useMemo(() => columns.filter((column) => !column.hidden), [columns])
  const activeColumn = sort ? visibleColumns.find((column) => column.key === sort.key) : undefined

  const sortedRows = useMemo(() => {
    const comparator = activeColumn?.sort
    if (!sort || typeof comparator !== 'function') return [...rows]
    const direction = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => direction * comparator(a, b))
  }, [activeColumn, rows, sort])

  const clientTotal = sortedRows.length
  const clientCurrent = clampPage(clientPage, clientTotal, clientPageSize)
  const controlledCurrent =
    pagination !== false && pagination !== 'client'
      ? clampPage(pagination.current, pagination.total, pagination.pageSize)
      : 1
  const currentPage = pagination === 'client' ? clientCurrent : controlledCurrent
  const currentPageSize =
    pagination === 'client'
      ? clientPageSize
      : pagination === false
        ? Math.max(1, sortedRows.length)
        : pagination.pageSize
  const total = pagination === 'client' ? clientTotal : pagination === false ? sortedRows.length : pagination.total

  // Reconcile the owner's page after a settled filter/refresh shrinks the dataset.
  // Clamping only the visible number leaves the parent's rows sliced at an invalid old offset.
  useEffect(() => {
    if (state !== 'ready' || pagination === false) return
    if (pagination === 'client') {
      if (clientPage !== clientCurrent) setClientPage(clientCurrent)
    } else if (pagination.current !== controlledCurrent) {
      pagination.onChange(controlledCurrent)
    }
  }, [state, pagination, clientPage, clientCurrent, controlledCurrent])

  const displayedRows = useMemo(() => {
    if (pagination !== 'client') return sortedRows
    const start = (clientCurrent - 1) * clientPageSize
    return sortedRows.slice(start, start + clientPageSize)
  }, [clientCurrent, clientPageSize, pagination, sortedRows])

  useEffect(() => {
    if (pagination === false) return
    if (previousPage.current === null) {
      previousPage.current = currentPage
      return
    }
    if (previousPage.current === currentPage) return
    previousPage.current = currentPage
    setAnnouncement(`Page ${currentPage} of ${pageCount(total, currentPageSize)}`)
  }, [currentPage, currentPageSize, pagination, total])

  useEffect(() => {
    const signature = sort ? `${sort.key}:${sort.dir}` : 'none'
    if (previousSort.current === null) {
      previousSort.current = signature
      return
    }
    if (previousSort.current === signature) return
    previousSort.current = signature
    if (!sort) {
      setAnnouncement('Sorting cleared')
      return
    }
    const column = visibleColumns.find((candidate) => candidate.key === sort.key)
    setAnnouncement(
      `Sorted by ${column ? headerText(column as DataTableColumn<unknown>) : sort.key}, ${
        sort.dir === 'asc' ? 'ascending' : 'descending'
      }`,
    )
  }, [sort, visibleColumns])

  const firstIndex =
    pagination === false ? 0 : Math.max(0, (currentPage - 1) * Math.max(1, currentPageSize))
  const featureColumnCount = Number(Boolean(selection)) + Number(Boolean(expandable)) + Number(Boolean(rowActions))
  const columnCount = Math.max(1, visibleColumns.length + featureColumnCount)
  const hasFooter = visibleColumns.some((column) => column.footer !== undefined)
  const isInitialLoading = state === 'loading' && rows.length === 0
  const isInitialError = state === 'error' && rows.length === 0
  const isEmpty = state === 'ready' && displayedRows.length === 0
  const isRefetching = state === 'loading' && rows.length > 0
  const hasStaleError = state === 'error' && rows.length > 0

  const pageKeys = displayedRows.map(rowKey)
  const selectedOnPage = selection
    ? pageKeys.reduce((count, key) => count + Number(selection.selected.has(key)), 0)
    : 0
  const allOnPage = pageKeys.length > 0 && selectedOnPage === pageKeys.length
  const someOnPage = selectedOnPage > 0 && !allOnPage

  const togglePageSelection = (checked: boolean) => {
    if (!selection) return
    const next = new Set(selection.selected)
    for (const key of pageKeys) {
      if (checked) next.add(key)
      else next.delete(key)
    }
    selection.onChange(next)
  }

  const changeSort = (column: DataTableColumn<T>) => {
    if (!column.sort || !onSortChange) return
    const next =
      sort?.key !== column.key
        ? { key: column.key, dir: 'asc' as const }
        : sort.dir === 'asc'
          ? { key: column.key, dir: 'desc' as const }
          : null
    onSortChange(next)
  }

  const clientPagination: PaginationProps = {
    current: clientCurrent,
    pageSize: clientPageSize,
    total: clientTotal,
    onChange: setClientPage,
    onPageSizeChange: (next) => {
      setClientPageSize(next)
      setClientPage(1)
    },
  }

  const paginationProps = pagination === 'client' ? clientPagination : pagination

  return (
    <div className={clsx(styles.root, density === 'compact' && styles.compact, className)}>
      {toolbar ? <div className={styles.toolbar}>{toolbar}</div> : null}
      {selection && selection.selected.size > 0 && bulkActions ? (
        <div className={styles.bulk}>
          <span>{selection.selected.size.toLocaleString()} selected</span>
          <div className={styles.bulkActions}>{bulkActions}</div>
        </div>
      ) : null}
      {hasStaleError ? (
        <div className={styles.staleError} role="alert">
          <div className={styles.errorMessage}>
            {error ?? 'The latest data could not be loaded. Showing the previous rows.'}
          </div>
          {onRetry ? (
            <Button size="sm" variant="danger" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className={styles.region}>
        {isRefetching ? <div className={styles.loadingBar} aria-hidden="true" /> : null}
        <Table caption={label} width={width} aria-busy={state === 'loading'}>
          <THead>
            <TR>
              {selection ? (
                <TH align="center" className={styles.selectCell}>
                  <Checkbox
                    checked={allOnPage}
                    indeterminate={someOnPage}
                    onChange={togglePageSelection}
                    label="Select all on this page"
                    hideLabel
                    disabled={pageKeys.length === 0}
                  />
                </TH>
              ) : null}
              {expandable ? <TH className={styles.expandCell}><span className={styles.srOnly}>Expand</span></TH> : null}
              {visibleColumns.map((column) => {
                const active = sort?.key === column.key
                const ariaSort = column.sort
                  ? active
                    ? sort?.dir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                  : undefined
                return (
                  <TH
                    key={column.key}
                    align={column.align}
                    sticky={column.sticky}
                    aria-sort={ariaSort}
                    style={columnStyle(column)}
                  >
                    {column.sort ? (
                      <button
                        type="button"
                        className={styles.sortButton}
                        onClick={() => changeSort(column)}
                        disabled={!onSortChange}
                      >
                        <span>{column.header}</span>
                        <span className={clsx(styles.sortIcon, active && styles.sortActive)} aria-hidden="true">
                          {!active ? (
                            <IconArrowsSort size={12} stroke={1.75} />
                          ) : sort?.dir === 'asc' ? (
                            <IconArrowUp size={12} stroke={1.75} />
                          ) : (
                            <IconArrowDown size={12} stroke={1.75} />
                          )}
                        </span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </TH>
                )
              })}
              {rowActions ? (
                <TH align="right" sticky="end">
                  <span className={styles.srOnly}>Actions</span>
                </TH>
              ) : null}
            </TR>
          </THead>
          <TBody>
            {isInitialLoading || isInitialError || isEmpty ? (
              <TR>
                <TD colSpan={columnCount} className={styles.stateCell}>
                  {isInitialLoading ? (
                    <LoadingState label={`Loading ${label}`} minHeight={192} />
                  ) : isInitialError ? (
                    <div className={styles.errorState}>
                      <div className={styles.errorMessage}>{error ?? 'Unable to load data.'}</div>
                      {onRetry ? (
                        <Button size="sm" variant="danger" onClick={onRetry}>
                          Retry
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    empty ?? <EmptyState title="No data" />
                  )}
                </TD>
              </TR>
            ) : (
              displayedRows.map((row, pageIndex) => {
                const key = rowKey(row)
                const rowIndex = firstIndex + pageIndex
                const expanded = Boolean(expandable?.expanded.has(key))
                const expansionId = `${instanceId}-expanded-${pageIndex}`
                const actions = rowActions?.(row)
                const selected = Boolean(selection?.selected.has(key))
                return (
                  <Fragment key={key}>
                    <ActivatableRow
                      open={openRowKey === key}
                      selected={selected}
                      activate={onRowActivate ? () => onRowActivate(row) : undefined}
                    >
                      {selection ? (
                        <TD align="center" className={styles.selectCell}>
                          <Checkbox
                            checked={selected}
                            onChange={(checked) => {
                              const next = new Set(selection.selected)
                              if (checked) next.add(key)
                              else next.delete(key)
                              selection.onChange(next)
                            }}
                            label={`Select ${selection.label?.(row) ?? key}`}
                            hideLabel
                          />
                        </TD>
                      ) : null}
                      {expandable ? (
                        <TD className={styles.expandCell}>
                          <IconButton
                            size="sm"
                            label={`${expanded ? 'Collapse' : 'Expand'} ${key}`}
                            icon={
                              expanded ? (
                                <IconChevronDown size={14} stroke={1.75} />
                              ) : (
                                <IconChevronRight size={14} stroke={1.75} />
                              )
                            }
                            aria-expanded={expanded}
                            aria-controls={expansionId}
                            onClick={() => expandable.onToggle(key)}
                          />
                        </TD>
                      ) : null}
                      {visibleColumns.map((column) => (
                        <TD
                          key={column.key}
                          align={column.align}
                          emphasis={column.emphasis}
                          sticky={column.sticky}
                          style={columnStyle(column)}
                        >
                          {column.cell(row, rowIndex)}
                        </TD>
                      ))}
                      {rowActions ? (
                        <TD align="right" sticky="end">
                          <div className={styles.actions}>
                            {actions?.primary}
                            {actions?.menu?.length ? (
                              <Menu
                                trigger={
                                  <IconButton
                                    size="sm"
                                    label={`More actions for ${key}`}
                                    icon={<IconDots size={15} stroke={1.75} />}
                                  />
                                }
                              >
                                {renderMenuItems(actions.menu)}
                              </Menu>
                            ) : null}
                          </div>
                        </TD>
                      ) : null}
                    </ActivatableRow>
                    {expanded && expandable ? (
                      <TR>
                        <TD colSpan={columnCount} className={styles.expandedCell}>
                          <div id={expansionId}>{expandable.render(row)}</div>
                        </TD>
                      </TR>
                    ) : null}
                  </Fragment>
                )
              })
            )}
          </TBody>
          {hasFooter ? (
            <TFoot>
              <TR>
                {selection ? <TD /> : null}
                {expandable ? <TD /> : null}
                {visibleColumns.map((column) => (
                  <TD
                    key={column.key}
                    align={column.align}
                    emphasis={column.emphasis}
                    sticky={column.sticky}
                    style={columnStyle(column)}
                  >
                    {column.footer}
                  </TD>
                ))}
                {rowActions ? <TD sticky="end" /> : null}
              </TR>
            </TFoot>
          ) : null}
        </Table>
      </div>
      {paginationProps !== false ? <Pagination {...paginationProps} /> : null}
      <div className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </div>
  )
}
