import {
  cloneElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useMergeRefs,
  useRole,
  type Placement,
} from '@floating-ui/react'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import clsx from 'clsx'
import { Button } from './Button'
import { IconButton } from './IconButton'
import { getFloatingTheme, type FloatingTrigger } from './floating'
import { strokeFor } from './icons'
import { istToday } from './istDate'
import { MONTHS, WEEKDAYS, addDays, addMonths, clampDay, firstOfMonth, formatDayLabel, validDay, weekday } from './calendarDays'
import styles from './Calendar.module.css'

/* The kit's themed month calendar (kit p3 .cal), behind DateField, DateTimeField and the range panel.
 *
 * Days are `yyyy-MM-dd` strings, the same ones the native inputs carry, and the arithmetic here is
 * calendar arithmetic only (whole days on a UTC Date), so no zone is involved: "today" alone comes
 * from IST, through istToday(). It replaces the browser's own picker (page migration C, D1 reversed):
 * the native popup could not wear the kit's colours.
 *
 * Keyboard (WAI-ARIA date picker dialog pattern): the arrows move a day or a week, PageUp/PageDown a
 * month (with Shift, a year), Home/End the start/end of the Monday-first week, Enter/Space pick, and
 * Escape asks the owner to close. One day button is tabbable (roving tabindex); the month shown is
 * always the focused day's, so moving focus out of the month turns the page, and turning the page
 * moves the focused day with it. Focus never leaves [min, max]. */

export interface CalendarProps {
  /** Single mode: the chosen day, `yyyy-MM-dd` or ''. */
  value?: string
  /** Range mode: the two ends (`yyyy-MM-dd` or ''). Both are marked, and the days between are shaded. */
  start?: string
  end?: string
  /** A day was picked (click, Enter/Space, or Today). What it means is the owner's to decide. */
  onSelect: (day: string) => void
  /** Escape. The key stops here, so an enclosing Dialog or popover stays open. */
  onClose?: () => void
  /** Earliest and latest pickable day, `yyyy-MM-dd`. Days outside are disabled, Today too. */
  min?: string
  max?: string
  /** The day focus starts on. @default the value (range: start, then end), else today */
  defaultFocus?: string
  /** Put focus on the day when the calendar mounts (a popup does; an inline calendar need not). */
  autoFocus?: boolean
  /** The footer line. @default 'Dates in IST' */
  hint?: string
  /** Today as `yyyy-MM-dd`. @default istToday() */
  today?: string
  className?: string
}

export function Calendar({
  value,
  start,
  end,
  onSelect,
  onClose,
  min: minProp,
  max: maxProp,
  defaultFocus,
  autoFocus = false,
  hint = 'Dates in IST',
  today: todayProp,
  className,
}: CalendarProps) {
  const today = validDay(todayProp) ?? istToday()
  const min = validDay(minProp)
  const max = validDay(maxProp)
  const chosen = [validDay(value), validDay(start), validDay(end)].filter((day): day is string => Boolean(day))
  const rangeFrom = validDay(start)
  const rangeTo = validDay(end)

  const [focused, setFocused] = useState(() =>
    clampDay(validDay(defaultFocus) ?? validDay(value) ?? rangeFrom ?? rangeTo ?? today, min, max),
  )
  const gridRef = useRef<HTMLDivElement>(null)
  const focusPending = useRef(autoFocus)

  /* Keyboard moves and the first paint of a popup put DOM focus on the focused day; the month buttons
     move only the tabbable day, so a second press of "Next month" still finds its button. */
  useEffect(() => {
    if (!focusPending.current) return
    focusPending.current = false
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus({ preventScroll: true })
  }, [focused])

  const blocked = (day: string) => Boolean((min && day < min) || (max && day > max))
  const monthStart = firstOfMonth(focused)
  const [year, month] = monthStart.split('-').map(Number)
  const title = `${MONTHS[month - 1]} ${year}`
  const gridStart = addDays(monthStart, -weekday(monthStart))
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
  const canPrev = !min || addDays(monthStart, -1) >= min
  const canNext = !max || addMonths(monthStart, 1) <= max

  function move(next: string, withFocus: boolean) {
    focusPending.current = withFocus
    setFocused(clampDay(next, min, max))
  }

  function pick(day: string) {
    if (blocked(day)) return
    setFocused(day)
    onSelect(day)
  }

  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const day = (event.target as HTMLElement).closest<HTMLElement>('[data-day]')?.dataset.day
    if (!day) return
    let next: string
    switch (event.key) {
      case 'ArrowLeft':
        next = addDays(day, -1)
        break
      case 'ArrowRight':
        next = addDays(day, 1)
        break
      case 'ArrowUp':
        next = addDays(day, -7)
        break
      case 'ArrowDown':
        next = addDays(day, 7)
        break
      case 'PageUp':
        next = addMonths(day, event.shiftKey ? -12 : -1)
        break
      case 'PageDown':
        next = addMonths(day, event.shiftKey ? 12 : 1)
        break
      case 'Home':
        next = addDays(day, -weekday(day))
        break
      case 'End':
        next = addDays(day, 6 - weekday(day))
        break
      case 'Enter':
      case ' ':
        // handled here rather than by the button's own activation, which a range pick that keeps the
        // calendar open would otherwise repeat on Space's keyup
        event.preventDefault()
        pick(day)
        return
      default:
        return
    }
    event.preventDefault()
    move(next, true)
  }

  return (
    <div
      className={clsx(styles.calendar, className)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !onClose) return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
    >
      <div className={styles.head}>
        <IconButton
          size="sm"
          label="Previous month"
          icon={<IconChevronLeft size={16} stroke={strokeFor(16)} />}
          aria-disabled={!canPrev || undefined}
          onClick={() => move(addMonths(focused, -1), false)}
        />
        <div className={styles.title} aria-live="polite">
          {title}
        </div>
        <IconButton
          size="sm"
          label="Next month"
          icon={<IconChevronRight size={16} stroke={strokeFor(16)} />}
          aria-disabled={!canNext || undefined}
          onClick={() => move(addMonths(focused, 1), false)}
        />
      </div>

      <div
        ref={gridRef}
        className={styles.grid}
        role="group"
        aria-label={title}
        onKeyDown={onGridKeyDown}
        onKeyUp={(event) => {
          if (event.key === ' ') event.preventDefault()
        }}
      >
        {WEEKDAYS.map((name) => (
          <span key={name} className={styles.dow} aria-hidden="true">
            {name}
          </span>
        ))}
        {days.map((day) => {
          const isToday = day === today
          const selected = chosen.includes(day)
          const inRange = Boolean(rangeFrom && rangeTo && day > rangeFrom && day < rangeTo)
          return (
            <button
              key={day}
              type="button"
              data-day={day}
              tabIndex={day === focused ? 0 : -1}
              disabled={blocked(day)}
              aria-label={isToday ? `${formatDayLabel(day)}, today` : formatDayLabel(day)}
              aria-pressed={selected || undefined}
              className={clsx(
                styles.day,
                day.slice(0, 7) !== monthStart.slice(0, 7) && styles.isOut,
                isToday && styles.isToday,
                inRange && styles.isIn,
                selected && styles.isSel,
              )}
              onClick={() => pick(day)}
            >
              {Number(day.slice(8))}
            </button>
          )
        })}
      </div>

      <div className={styles.foot}>
        <span className={styles.hint} aria-live="polite">
          {hint}
        </span>
        <Button variant="link" size="sm" className={styles.todayButton} disabled={blocked(today)} onClick={() => pick(today)}>
          Today
        </Button>
      </div>
    </div>
  )
}

export interface CalendarPopoverProps extends Omit<CalendarProps, 'onClose' | 'autoFocus' | 'className'> {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The button that opens it (forwards its ref, spreads props). It gets the dialog wiring
   *  (aria-haspopup, aria-expanded), and focus returns to it when the calendar closes. */
  trigger: FloatingTrigger
  /** The element the popup lines up under, e.g. the whole field rather than its icon button. */
  anchorRef?: RefObject<HTMLElement | null>
  /** @default 'bottom-start' */
  placement?: Placement
  /** Names the dialog. @default 'Choose a date' */
  label?: string
  /** Extra class on the popup surface. */
  className?: string
}

/**
 * The calendar in a non-modal popup dialog, on Popover's floating-ui mechanics: portalled with the
 * trigger region's data-theme, flipped and shifted at the viewport edges, and kept on its anchor by
 * autoUpdate while the page scrolls. A press outside closes it; Escape is the calendar's, so the key can
 * be stopped before an enclosing Dialog sees it (useListbox does the same for the list fields).
 */
export function CalendarPopover({
  open,
  onOpenChange,
  trigger,
  anchorRef,
  placement = 'bottom-start',
  label = 'Choose a date',
  className,
  ...calendar
}: CalendarPopoverProps) {
  const { refs, floatingStyles, context } = useFloating<HTMLElement>({
    open,
    onOpenChange,
    placement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
  })

  // The trigger stays the interaction reference (focus returns to it); the anchor only positions.
  useLayoutEffect(() => {
    if (anchorRef?.current) refs.setPositionReference(anchorRef.current)
  }, [anchorRef, refs, open])

  const click = useClick(context)
  const dismiss = useDismiss(context, { escapeKey: false })
  const role = useRole(context, { role: 'dialog' })
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role])

  const triggerRef = useMergeRefs([refs.setReference, trigger.ref])
  const theme = getFloatingTheme(context.elements.domReference)

  return (
    <>
      {cloneElement(trigger, getReferenceProps({ ...trigger.props, ref: triggerRef }))}
      {open && (
        <FloatingPortal>
          {/* initialFocus -1: the calendar focuses its own day, which the focus manager cannot know */}
          <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className={clsx(styles.popover, className)}
              data-theme={theme}
              {...getFloatingProps({ 'aria-label': label })}
            >
              <Calendar {...calendar} autoFocus onClose={() => onOpenChange(false)} />
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  )
}
