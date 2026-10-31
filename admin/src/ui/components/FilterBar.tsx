import {
  Children,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { IconAdjustmentsHorizontal, IconX } from '@tabler/icons-react'
import clsx from 'clsx'
import { Badge } from './Badge'
import { Button } from './Button'
import { IconButton } from './IconButton'
import { FilterSheetContext } from './filterSheetContext'
import { Popover } from './Popover'
import { strokeFor } from './icons'
import styles from './FilterBar.module.css'

const COLLAPSE_WIDTH = 1024
const FOCUSABLE = [
  'button:not(:disabled):not([aria-disabled="true"])',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export interface FilterBarProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'role'> {
  activeCount: number
  variant?: 'default' | 'panel'
  onClearAll: () => void
  search?: ReactNode
  children?: ReactNode
  /** Names this search landmark and the compact dialog. @default 'Filters' */
  label?: string
  /** A result count at the right end, e.g. <><b>6</b> of <b>18</b> requests</>. Stays in the bar when the
   *  controls collapse into the Filters popover. */
  summary?: ReactNode
}

function focusableIn(scope: HTMLElement): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((node) => node.isConnected)
}

export function FilterBar({
  activeCount,
  variant = 'default',
  onClearAll,
  search,
  children,
  label = 'Filters',
  summary,
  className,
  onFocusCapture,
  ...rest
}: FilterBarProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const count = Number.isFinite(activeCount) ? Math.max(0, Math.trunc(activeCount)) : 0
  const previousCountRef = useRef(count)
  const lastFocusedRef = useRef<HTMLElement | null>(null)
  const focusScopeRef = useRef<HTMLElement | null>(null)
  const focusIndexRef = useRef(-1)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return

    const update = (width: number) => {
      // jsdom and a temporarily detached tree report zero; retain the wide default until measured.
      if (width > 0) setCompact(width < COLLAPSE_WIDTH)
    }
    const measure = () => update(root.getBoundingClientRect().width)
    measure()

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) update(entry.contentRect.width)
    })
    observer.observe(root)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  useLayoutEffect(() => {
    if (!compact) setPopoverOpen(false)
  }, [compact])

  useLayoutEffect(() => {
    const previousCount = previousCountRef.current
    previousCountRef.current = count
    if (count >= previousCount) return

    const lastFocused = lastFocusedRef.current
    if (!lastFocused || lastFocused.isConnected) return

    const rememberedScope = focusScopeRef.current
    const root = rootRef.current
    const scope = rememberedScope?.isConnected ? rememberedScope : root
    const options = scope ? focusableIn(scope) : []
    const candidate = options[Math.min(Math.max(0, focusIndexRef.current), options.length - 1)]
      ?? root?.querySelector<HTMLElement>(`.${styles.search} ${FOCUSABLE}`)
      ?? root
    candidate?.focus({ preventScroll: true })
  }, [count])

  const rememberFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    onFocusCapture?.(event)
    if (event.defaultPrevented) return
    const focused = event.target
    if (!(focused instanceof HTMLElement)) return
    const scope = focused.closest<HTMLElement>('[role="dialog"]') ?? rootRef.current
    lastFocusedRef.current = focused
    focusScopeRef.current = scope
    focusIndexRef.current = scope ? focusableIn(scope).indexOf(focused) : -1
  }, [onFocusCapture])

  const clear = (
    <Button variant="link" size="sm" className={styles.clear} onClick={onClearAll} data-filter-clear>
      Clear all
    </Button>
  )

  // A bar with only a search has nothing to fold away: it never turns into an empty Filters popover.
  const hasControls = Children.toArray(children).length > 0

  const controls = compact && hasControls ? (
    <div className={styles.compact}>
      <Popover
        open={popoverOpen}
        onOpenChange={setPopoverOpen}
        label={label}
        placement="bottom-end"
        className={styles.popover}
        trigger={
          <Button
            size="sm"
            icon={<IconAdjustmentsHorizontal size={15} stroke={strokeFor(15)} />}
            className={styles.filterTrigger}
            // Every folded bar reads "Filters" on screen; its name stays the bar's own label (it contains the word).
            aria-label={label}
          >
            Filters
            {count > 0 ? <Badge count={count} tone="solid" aria-hidden="true" /> : null}
          </Button>
        }
      >
        {/* data-filter-popover: filter controls may lay themselves out for this sheet (e.g. show their
            caption), since the bar's inline labels do not come along. */}
        <div className={styles.popoverBody} data-filter-popover="">
          <div className={styles.popoverHead} data-ui-radius="panel-head">
            <span className={styles.popoverTitle}>Filters</span>
            {count > 0 ? <span className={styles.popoverCount}>{count} applied</span> : null}
            <IconButton size="sm" className={styles.popoverClose} label="Close filters"
              icon={<IconX size={16} stroke={strokeFor(16)} />} onClick={() => setPopoverOpen(false)} />
          </div>
          <div className={styles.popoverControls}>
            <FilterSheetContext.Provider value={true}>{children}</FilterSheetContext.Provider>
          </div>
          <div className={styles.popoverFoot}>
            {count > 0 ? clear : <span className={styles.popoverHint}>No filters applied</span>}
            <Button size="sm" variant="primary" onClick={() => setPopoverOpen(false)}>Done</Button>
          </div>
        </div>
      </Popover>
    </div>
  ) : (
    <>
      <div className={styles.controls}>{children}</div>
      {count > 0 ? clear : null}
    </>
  )

  return (
    <div className={styles.container}>
      <div
        {...rest}
        ref={rootRef}
        role="search"
        aria-label={label}
        tabIndex={-1}
        className={clsx(styles.bar, variant === 'panel' && styles.panel, className)}
        onFocusCapture={rememberFocus}
      >
        {search ? <div className={styles.search}>{search}</div> : null}
        {controls}
        {summary !== undefined && summary !== null ? <div className={styles.summary}>{summary}</div> : null}
        <span className={styles.status} role="status" aria-live="polite">
          {count === 1 ? '1 filter applied' : `${count} filters applied`}
        </span>
      </div>
    </div>
  )
}
