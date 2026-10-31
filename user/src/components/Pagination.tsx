import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import './pagination.css'

type PaginationProps = {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

export default function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const canPrev = page > 1
  const canNext = page < totalPages
  const startItem = total === 0 ? 0 : (page - 1) * pageSize + 1
  const endItem = Math.min(page * pageSize, total)

  const goTo = (p: number) => {
    const next = Math.min(Math.max(1, p), totalPages)
    if (next !== page) onPageChange(next)
  }

  const windowSize = 5
  const half = Math.floor(windowSize / 2)
  let start = Math.max(1, page - half)
  const end = Math.min(totalPages, start + windowSize - 1)
  start = Math.max(1, end - windowSize + 1)
  const pages: number[] = []
  for (let i = start; i <= end; i++) pages.push(i)

  if (totalPages <= 1 && total <= pageSize) {
    return (
      <div className={`nova-pager is-single${total === 0 ? ' is-empty' : ''}`}>
        <span className="nova-pager-count">
          {total === 0 ? '0 results' : `${startItem}–${endItem} of ${total}`}
        </span>
      </div>
    )
  }

  return (
    <nav
      className="nova-pager"
      aria-label="Pagination"
    >
      <div className="nova-pager-bar">
        {/* Row 1: Results summary */}
        <div className="nova-pager-summary">
          <p className="nova-pager-count">
            <span className="is-strong">{startItem}</span>
            <span>–</span>
            <span className="is-strong">{endItem}</span>
            <span>of</span>
            <span className="is-total">{total}</span>
            <span className="nova-pager-word">results</span>
          </p>
          <p className="nova-pager-page">
            Page <span className="is-strong">{page}</span> of {totalPages}
          </p>
        </div>

        {/* Row 2: Controls */}
        <div className="nova-pager-controls">
          {/* First – hidden on small */}
          <button
            type="button"
            onClick={() => goTo(1)}
            disabled={!canPrev}
            className="nova-pager-btn is-nav is-edge"
            aria-label="First page"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>

          {/* Previous */}
          <button
            type="button"
            onClick={() => goTo(page - 1)}
            disabled={!canPrev}
            className="nova-pager-btn is-nav"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {/* Page numbers / Mobile label */}
          <div className="nova-pager-pages">
            {/* Mobile: only "Page 2 of 5" text (no number buttons) */}
            <div className="nova-pager-mobile">
              <span className="is-strong">{page}</span>
              <span>/</span>
              <span className="is-strong">{totalPages}</span>
            </div>

            {/* Tablet+: number buttons */}
            <div className="nova-pager-numbers">
              {start > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => goTo(1)}
                    className={`nova-pager-btn${page === 1 ? ' is-current' : ''}`}
                  >
                    1
                  </button>
                  {start > 2 && (
                    <span className="nova-pager-ellipsis">…</span>
                  )}
                </>
              )}
              {pages.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => goTo(p)}
                  className={`nova-pager-btn${p === page ? ' is-current' : ''}`}
                  aria-current={p === page ? 'page' : undefined}
                >
                  {p}
                </button>
              ))}
              {end < totalPages && (
                <>
                  {end < totalPages - 1 && (
                    <span className="nova-pager-ellipsis">…</span>
                  )}
                  <button
                    type="button"
                    onClick={() => goTo(totalPages)}
                    className={`nova-pager-btn${page === totalPages ? ' is-current' : ''}`}
                  >
                    {totalPages}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Next */}
          <button
            type="button"
            onClick={() => goTo(page + 1)}
            disabled={!canNext}
            className="nova-pager-btn is-nav"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          {/* Last – hidden on small */}
          <button
            type="button"
            onClick={() => goTo(totalPages)}
            disabled={!canNext}
            className="nova-pager-btn is-nav is-edge"
            aria-label="Last page"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </nav>
  )
}
