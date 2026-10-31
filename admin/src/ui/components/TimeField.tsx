import {
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useMergeRefs } from '@floating-ui/react'
import { IconClock } from '@tabler/icons-react'
import clsx from 'clsx'
import { FieldShell, type FieldStatus } from './FieldShell'
import { ListboxPopup } from './ListboxPopup'
import { strokeFor } from './icons'
import { isWholeMinuteStep } from './istDate'
import {
  edgeIndex,
  stepIndex,
  typeaheadIndex,
  useListbox,
  useRevealActive,
  useTypeaheadBuffer,
  type ListboxOption,
} from './useListbox'
import styles from './TextField.module.css'
import timeStyles from './TimeField.module.css'
import { isTimeString, timeOptions } from './timeOptions'

/* A time of day, carried as a plain 24-hour `HH:mm` string — what the native `<input type="time">`
 * reads and writes with a whole-minute step. It replaces antd `TimePicker format="HH:mm"` (page
 * migration C, D1: native inputs in kit field chrome). Like DateTimeField it wears TextField's face
 * and FieldShell's label/help/error wiring; the native input stays the control (typing, its keyboard
 * model and its locale display, 12- or 24-hour).
 *
 * The browser's picker indicator is hidden; a clock button in the face opens the kit list (ListboxPopup)
 * of times instead: every `step` when that is coarser than a minute, else every 30 minutes, within
 * min..max, the current value ticked. Keys on the button: ArrowDown / ArrowUp open; while open they move
 * (stopping at the ends), PageDown / PageUp move ten, Home / End, Enter or Space choose, Escape closes (not
 * reaching an enclosing Dialog), Tab closes, digits jump by typeahead. A pick emits `HH:mm` through
 * onChange, as typing does. */

function wholeMinuteStep(step: number): number {
  if (!isWholeMinuteStep(step)) {
    throw new RangeError('TimeField step must be a positive whole-minute increment in seconds')
  }
  return step
}

export interface TimeFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'defaultValue' | 'max' | 'min' | 'onChange' | 'size' | 'step' | 'type' | 'value'
  > {
  /** Always rendered as a <label>; `hideLabel` keeps it for assistive tech only. */
  label: string
  /** Controlled `HH:mm`, or '' for empty. Omit it (and use defaultValue) for an uncontrolled field. */
  value?: string
  defaultValue?: string
  /** Receives `HH:mm` or ''. A value carrying seconds is never emitted. */
  onChange?: (value: string) => void
  /** Earliest and latest time, as `HH:mm`. */
  min?: string
  max?: string
  /** Whole-minute increment in seconds (60, 300, 900, ...); `minuteStep={5}` is `step={300}`. @default 60 */
  step?: number
  /** md 36px, sm 30px. @default 'md' */
  size?: 'sm' | 'md'
  help?: ReactNode
  error?: ReactNode
  hideLabel?: boolean
  status?: FieldStatus
  /** Class on the complete field; inputClassName targets the native control. */
  className?: string
  inputClassName?: string
}

export const TimeField = forwardRef<HTMLInputElement, TimeFieldProps>(function TimeField(
  {
    label,
    value,
    defaultValue,
    onChange,
    min,
    max,
    step = 60,
    size = 'md',
    help,
    error,
    hideLabel = false,
    status = 'default',
    className,
    inputClassName,
    id,
    required,
    disabled,
    readOnly,
    'aria-describedby': describedBy,
    'aria-invalid': ariaInvalid,
    'aria-required': ariaRequired,
    ...rest
  },
  ref,
) {
  const generatedId = useId()
  const controlId = id ?? `time-${generatedId}`
  const hasError = error !== undefined && error !== null
  const effectiveStatus: FieldStatus = hasError ? 'error' : status
  const nativeStep = wholeMinuteStep(step)
  const valueProps = value !== undefined ? { value } : { defaultValue }

  const interactive = !disabled && !readOnly
  const times = useMemo(() => timeOptions(nativeStep, min, max), [nativeStep, min, max])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  // The input's value when the list opened: the ticked option, and what a pick is compared with.
  const [openedOn, setOpenedOn] = useState('')
  const faceRef = useRef<HTMLSpanElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // floating-ui moves the active option only on hover here; such a move is not scrolled to.
  const movedByPointerRef = useRef(false)
  // Space chose a time on keydown; the button's own Space activation (on keyup) must not reopen the list.
  const spacePickedRef = useRef(false)
  const typeahead = useTypeaheadBuffer()

  const shown = open && interactive
  const active = activeIndex !== null && activeIndex < times.length ? activeIndex : null

  useEffect(() => {
    if (interactive) return
    setOpen(false)
    setActiveIndex(null)
  }, [interactive])

  const moveTo = (index: number | null) => {
    movedByPointerRef.current = false
    if (index !== null) setActiveIndex(index)
  }

  // Opens on the current time; a time off the list's grid opens on the next listed one (past the last
  // listed time, on the last).
  const openList = () => {
    const current = value ?? inputRef.current?.value ?? ''
    const exact = times.findIndex((option) => option.value === current)
    const timed = isTimeString(current)
    const next = exact >= 0 ? exact : timed ? times.findIndex((option) => option.value > current) : -1
    movedByPointerRef.current = false
    setOpenedOn(current)
    setActiveIndex(next >= 0 ? next : edgeIndex(times, timed ? 'last' : 'first'))
    setOpen(true)
  }

  const closeList = () => {
    setOpen(false)
    setActiveIndex(null)
  }

  const pick = (option: ListboxOption) => {
    closeList()
    if (option.value === openedOn) return
    // Uncontrolled, the native input holds the value; controlled, the page's onChange sets it.
    if (value === undefined && inputRef.current) inputRef.current.value = option.value
    onChange?.(option.value)
  }

  const commitActive = () => {
    const option = active !== null ? times[active] : undefined
    if (option) pick(option)
    else closeList()
  }

  const listbox = useListbox({
    open: shown,
    onOpenChange: (next) => {
      if (!next) closeList()
    },
    activeIndex: active,
    onNavigate: (index) => {
      movedByPointerRef.current = true
      setActiveIndex(index)
    },
    options: times,
    typeahead: false,
    onTypeaheadMatch: () => undefined,
    faceRef,
  })
  useRevealActive(listbox, shown, active, movedByPointerRef)
  const inputRefs = useMergeRefs([inputRef, ref])
  // The list sits under the whole face, and a press anywhere in the face is not an outside press. (The
  // cast only widens the element type useListbox declares for Combobox's input.)
  const faceRefs = useMergeRefs<HTMLSpanElement>([
    faceRef,
    listbox.refs.setReference as (node: HTMLElement | null) => void,
  ])

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!interactive) return
    if (!shown) {
      // As on a menu button; Enter and Space are left to the button's click.
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        openList()
      }
      return
    }
    const claim = () => {
      event.preventDefault()
      event.stopPropagation()
    }
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        claim()
        if (event.altKey) {
          if (event.key === 'ArrowUp') closeList()
        } else {
          moveTo(stepIndex(times, active, event.key === 'ArrowDown' ? 1 : -1))
        }
        break
      case 'PageDown':
      case 'PageUp':
        claim()
        moveTo(stepIndex(times, active, event.key === 'PageDown' ? 10 : -10))
        break
      case 'Home':
      case 'End':
        claim()
        moveTo(edgeIndex(times, event.key === 'Home' ? 'first' : 'last'))
        break
      case 'Enter':
        claim()
        commitActive()
        break
      case 'Escape':
        claim()
        closeList()
        break
      case 'Tab':
        closeList()
        break
      default:
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) break
        claim()
        if (event.key === ' ' && !typeahead.typing()) {
          spacePickedRef.current = true
          commitActive()
        } else {
          moveTo(typeaheadIndex(times, active, typeahead.push(event.key)))
        }
    }
  }

  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== ' ' || !spacePickedRef.current) return
    spacePickedRef.current = false
    event.preventDefault()
  }

  // Presses on the list never move focus, so a blur means the user left for the input or elsewhere.
  const handleBlur = (event: FocusEvent<HTMLButtonElement>) => {
    if (!open) return
    const next = event.relatedTarget
    if (next instanceof Node && listbox.refs.floating.current?.contains(next)) return
    closeList()
  }

  return (
    <FieldShell
      id={controlId}
      label={label}
      required={required}
      hideLabel={hideLabel}
      help={help}
      error={error}
      status={effectiveStatus}
      describedBy={describedBy}
      className={className}
    >
      {(accessibility) => (
        <>
          <span
            ref={faceRefs}
            className={clsx(
              styles.field,
              size === 'sm' && styles.sm,
              effectiveStatus !== 'default' && styles[effectiveStatus],
              disabled && styles.disabled,
            )}
          >
            <input
              {...rest}
              {...accessibility}
              {...valueProps}
              ref={inputRefs}
              type="time"
              min={min}
              max={max}
              step={nativeStep}
              required={required}
              disabled={disabled}
              readOnly={readOnly}
              aria-invalid={accessibility['aria-invalid'] ?? ariaInvalid}
              aria-required={accessibility['aria-required'] ?? ariaRequired}
              className={clsx(styles.input, timeStyles.input, inputClassName)}
              onChange={(event) => {
                const next = event.target.value
                if (next === '' || isTimeString(next)) onChange?.(next)
              }}
            />
            {/* The name stays generic: the field's label would make getByLabelText(label) find two controls. */}
            <button
              type="button"
              className={timeStyles.clock}
              aria-label="Choose a time"
              // Out of the tab order, like Select's themed list: pointer users get the picker, keyboard users keep typing in the native input (pages' tab orders stay as they were).
              tabIndex={-1}
              aria-haspopup="listbox"
              aria-expanded={shown}
              aria-controls={shown ? listbox.listboxId : undefined}
              disabled={!interactive}
              onClick={() => (shown ? closeList() : openList())}
              onKeyDown={handleKeyDown}
              onKeyUp={handleKeyUp}
              onBlur={handleBlur}
            >
              <IconClock size={16} stroke={strokeFor(16)} aria-hidden="true" />
            </button>
          </span>
          <ListboxPopup
            listbox={listbox}
            open={shown}
            label={label}
            options={times}
            activeIndex={active}
            isSelected={(option) => option.value === openedOn}
            size={size}
            loading={false}
            loadingText=""
            emptyText="No times in range"
            onPick={pick}
          />
        </>
      )}
    </FieldShell>
  )
})
