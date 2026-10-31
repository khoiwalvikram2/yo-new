import { forwardRef, useId, useRef, useState, type InputHTMLAttributes } from 'react'
import { IconCalendar } from '@tabler/icons-react'
import clsx from 'clsx'
import { CalendarPopover } from './Calendar'
import { strokeFor } from './icons'
import styles from './DateField.module.css'

/* A calendar day, carried as a plain `yyyy-MM-dd` string — what the native control reads and writes,
 * and what `istDate.ts` turns into the instants a query needs.
 *
 * The native input stays the real control: it is what typing, forms and tests drive. Its own picker
 * button is hidden, and the calendar icon in the field opens the kit's themed Calendar under it instead
 * (page migration C, D1 reversed: the browser's popup cannot wear the kit's colours). Picking a day
 * gives the page the same day string a typed date does. What the page still gives up is the antd
 * picker's "MMM D, YYYY" display — the browser shows the date in the user's locale order. */

/** A field that holds one end of a range (DateRangePanel). Its calendar shows and edits both ends. */
export interface DateFieldRange {
  /** Which end this field holds; its calendar starts by picking that end. */
  edge: 'start' | 'end'
  /** Both ends, `yyyy-MM-dd` or ''. */
  start: string
  end: string
  /**
   * A calendar pick changed the range; it comes back ordered (start before end, or the end cleared).
   * Picking the start keeps the calendar open for the end; picking the end closes it. Typing still goes
   * through the field's own onChange.
   */
  onChange: (start: string, end: string) => void
  /** Bounds for the whole range. The field's own min/max, which the other end may narrow, bind only typing. */
  min?: string
  max?: string
}

export interface DateFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'size'> {
  /** Always given; `hideLabel` keeps it for assistive tech only. */
  label: string
  hideLabel?: boolean
  /** `yyyy-MM-dd`, or '' for empty. */
  value: string
  onChange: (value: string) => void
  /** Earliest and latest selectable day, as `yyyy-MM-dd`. */
  min?: string
  max?: string
  /** @default 'md' */
  size?: 'md' | 'sm'
  /** A line under the field, e.g. what the range means. */
  help?: string
  /** A problem with the current value. Shown under the field and announced. */
  error?: string
  required?: boolean
  /** Makes the calendar a range picker for one end of a range. */
  range?: DateFieldRange
}

export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  {
    label,
    hideLabel = false,
    value,
    onChange,
    min,
    max,
    size = 'md',
    help,
    error,
    required,
    range,
    disabled,
    readOnly,
    className,
    id,
    ...rest
  },
  ref,
) {
  const generated = useId()
  const inputId = id ?? `date-${generated}`
  const labelId = `${inputId}-label`
  const helpId = help ? `${inputId}-help` : undefined
  const errorId = error ? `${inputId}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined

  const controlRef = useRef<HTMLSpanElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  // In range mode, which end the next pick sets; it starts at the field's own end each time it opens.
  const [phase, setPhase] = useState<'start' | 'end'>('start')
  const locked = Boolean(disabled || readOnly)
  const open = pickerOpen && !locked

  function openChange(next: boolean) {
    if (next && locked) return
    if (next) setPhase(range?.edge ?? 'start')
    setPickerOpen(next)
  }

  function pick(day: string) {
    if (!range) {
      onChange(day)
      setPickerOpen(false)
      return
    }
    const { start, end } = range
    if (phase === 'start') {
      range.onChange(day, end && end < day ? '' : end)
      setPhase('end')
      return
    }
    if (start && day < start) range.onChange(day, start)
    else range.onChange(start || day, day)
    setPickerOpen(false)
  }

  const calendar = range
    ? {
        start: range.start,
        end: range.end,
        min: range.min,
        max: range.max,
        defaultFocus: (phase === 'end' ? range.end : range.start) || range.start || range.end,
        hint: phase === 'start' ? 'Pick the start date' : 'Pick the end date',
      }
    : { value, min, max }

  return (
    <div className={clsx(styles.field, className)}>
      <label id={labelId} className={clsx(styles.label, hideLabel && styles.hiddenLabel)} htmlFor={inputId}>
        {label}
        {required ? (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <span ref={controlRef} className={styles.control}>
        <input
          {...rest}
          ref={ref}
          id={inputId}
          type="date"
          className={clsx(styles.input, size === 'sm' && styles.sm, error && styles.invalid)}
          value={value}
          min={min}
          max={max}
          required={required}
          disabled={disabled}
          readOnly={readOnly}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
        <CalendarPopover
          {...calendar}
          open={open}
          onOpenChange={openChange}
          onSelect={pick}
          anchorRef={controlRef}
          placement={range?.edge === 'end' ? 'bottom-end' : 'bottom-start'}
          trigger={
            <button
              type="button"
              className={styles.pick}
              aria-label="Choose date"
              aria-describedby={labelId}
              // Out of the tab order, like Select's themed list: pointer users get the picker, keyboard users keep typing in the native input (pages' tab orders stay as they were).
              tabIndex={-1}
              disabled={locked}
            >
              <IconCalendar size={16} stroke={strokeFor(16)} aria-hidden="true" />
            </button>
          }
        />
      </span>
      {help ? (
        <span className={styles.help} id={helpId}>
          {help}
        </span>
      ) : null}
      {error ? (
        <span className={styles.error} id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  )
})
