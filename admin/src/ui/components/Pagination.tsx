import { useEffect, useId, type ChangeEvent, type ReactNode } from 'react'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import clsx from 'clsx'
import styles from './Pagination.module.css'

export interface PaginationProps {
  /** One-based controlled page number. Out-of-range values are rendered at the nearest valid page. */
  current: number
  pageSize: number
  total: number
  /** Server lists opt in to settled-page reconciliation; never clamp a request in flight. */
  loading?: boolean
  onChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  /** Plural display name, as in the legacy TablePagination. @default 'items' */
  itemName?: string
  /** @default [10, 25, 50, 100] */
  pageSizeOptions?: readonly number[]
  /** Replaces the default "Showing x–y of z items" contents without changing range calculation. */
  formatSummary?: (summary: PaginationSummary) => ReactNode
  /** Keeps the native select labelled while visually hiding its label. @default false */
  hidePageSizeLabel?: boolean
  /** Formats the visible text of each native page-size option. */
  formatPageSizeOption?: (pageSize: number) => ReactNode
  /** Removes the top divider and closing inset when a table Card already owns them. @default 'default' */
  variant?: 'default' | 'embedded'
  className?: string
}

export interface PaginationSummary {
  current: number
  pageSize: number
  pageCount: number
  start: number
  end: number
  total: number
  range: string
  itemName: string
}

type PageItem = number | 'ellipsis'

function positiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function normaliseOptions(options: readonly number[], currentSize: number): number[] {
  const result: number[] = []
  for (const option of options) {
    const value = positiveInteger(option, 0)
    if (value > 0 && !result.includes(value)) result.push(value)
  }
  if (!result.includes(currentSize)) result.unshift(currentSize)
  return result
}

function pageItems(current: number, pageCount: number): PageItem[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1)

  const pages = new Set([1, pageCount, current - 1, current, current + 1])
  if (current <= 4) [2, 3, 4].forEach((page) => pages.add(page))
  if (current >= pageCount - 3) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((page) => pages.add(page))

  const ordered = [...pages].filter((page) => page >= 1 && page <= pageCount).sort((a, b) => a - b)
  const items: PageItem[] = []
  ordered.forEach((page, index) => {
    if (index > 0 && page - ordered[index - 1] > 1) items.push('ellipsis')
    items.push(page)
  })
  return items
}

function singularItemName(itemName: string): string {
  if (itemName.endsWith('ies')) return `${itemName.slice(0, -3)}y`
  if (itemName.endsWith('ses')) return itemName.slice(0, -2)
  if (itemName.endsWith('s') && !itemName.endsWith('ss')) return itemName.slice(0, -1)
  return itemName
}

/**
 * Native, controlled pagination. Its prop names intentionally match shared/ui/TablePagination so a
 * migrated page can move without translating pagination state (design phase 2, BEYOND-MOCKUP).
 */
export function Pagination({
  current,
  pageSize,
  total,
  loading,
  onChange,
  onPageSizeChange,
  itemName = 'items',
  pageSizeOptions = [10, 25, 50, 100],
  formatSummary,
  hidePageSizeLabel = false,
  formatPageSizeOption = (option) => option,
  variant = 'default',
  className,
}: PaginationProps) {
  const generatedId = useId()
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
  const firstOption = pageSizeOptions.find((option) => Number.isFinite(option) && option > 0) ?? 10
  const safePageSize = positiveInteger(pageSize, positiveInteger(firstOption, 10))
  const pageCount = Math.max(1, Math.ceil(safeTotal / safePageSize))
  const safeCurrent = Math.min(Math.max(positiveInteger(current, 1), 1), pageCount)
  const start = safeTotal === 0 ? 0 : (safeCurrent - 1) * safePageSize + 1
  const end = safeTotal === 0 ? 0 : Math.min(safeCurrent * safePageSize, safeTotal)
  const range = start === end ? String(start) : `${start}\u2013${end}`
  const options = normaliseOptions(pageSizeOptions, safePageSize)
  useEffect(() => {
    if (loading === false && current !== safeCurrent) onChange(safeCurrent)
  }, [loading, current, safeCurrent, onChange])
  const name = safeTotal === 1 ? singularItemName(itemName) : itemName
  const summary = {
    current: safeCurrent,
    pageSize: safePageSize,
    pageCount,
    start,
    end,
    total: safeTotal,
    range,
    itemName: name,
  } satisfies PaginationSummary
  let ellipsisIndex = 0

  const goTo = (page: number) => onChange(Math.min(Math.max(page, 1), pageCount))

  return (
    <nav
      className={clsx(styles.pagination, variant === 'embedded' && styles.embedded, className)}
      aria-label="Pagination"
    >
      <p className={styles.summary}>
        {formatSummary ? (
          formatSummary(summary)
        ) : (
          <>Showing <strong>{range}</strong> of <strong>{safeTotal.toLocaleString()}</strong> {name}</>
        )}
      </p>

      <div className={styles.controls}>
        <label
          className={clsx(styles.sizeLabel, hidePageSizeLabel && styles.visuallyHidden)}
          htmlFor={`page-size-${generatedId}`}
        >
          Rows per page:
        </label>
        <select
          id={`page-size-${generatedId}`}
          className={styles.sizeSelect}
          value={String(safePageSize)}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => {
            const nextSize = Number(event.target.value)
            if (nextSize === safePageSize) return
            onPageSizeChange(nextSize)
            onChange(1)
          }}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {formatPageSizeOption(option)}
            </option>
          ))}
        </select>

        <span className={styles.divider} aria-hidden="true" />

        <div className={styles.pages}>
          <button
            type="button"
            className={styles.arrowButton}
            aria-label="Previous page"
            disabled={safeCurrent === 1}
            onClick={() => goTo(safeCurrent - 1)}
          >
            <IconChevronLeft size={15} stroke={1.75} aria-hidden="true" />
          </button>

          {pageItems(safeCurrent, pageCount).map((item) => {
            if (item === 'ellipsis') {
              ellipsisIndex += 1
              return (
                <span key={`ellipsis-${ellipsisIndex}`} className={styles.ellipsis} aria-hidden="true">
                  …
                </span>
              )
            }
            return (
              <button
                key={item}
                type="button"
                className={clsx(styles.pageButton, item === safeCurrent && styles.current)}
                aria-label={`Page ${item}`}
                aria-current={item === safeCurrent ? 'page' : undefined}
                onClick={() => goTo(item)}
              >
                {item}
              </button>
            )
          })}

          <button
            type="button"
            className={styles.arrowButton}
            aria-label="Next page"
            disabled={safeCurrent === pageCount}
            onClick={() => goTo(safeCurrent + 1)}
          >
            <IconChevronRight size={15} stroke={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>
    </nav>
  )
}
