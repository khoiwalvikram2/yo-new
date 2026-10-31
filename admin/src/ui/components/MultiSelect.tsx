import {
  forwardRef,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useMergeRefs } from '@floating-ui/react'
import { IconChevronDown, IconX } from '@tabler/icons-react'
import clsx from 'clsx'
import { FieldShell, type FieldStatus } from './FieldShell'
import { ListboxPopup } from './ListboxPopup'
import { Spinner } from './Spinner'
import { strokeFor } from './icons'
import {
  edgeIndex,
  filterOptions,
  firstEnabledIndex,
  optionId,
  useControllableState,
  useListbox,
  type ListboxFilter,
  type ListboxOption,
} from './useListbox'
import styles from './Listbox.module.css'

const EMPTY: readonly string[] = []

/* A many-value picker: Combobox's input and list (aria-multiselectable) with the chosen values as
 * removable chips in the field. It replaces antd `Select mode="multiple"` (14 files). Choosing an option
 * toggles it and keeps the list open, and the typed search is cleared (antd's autoClearSearchValue).
 *
 * Keyboard, in addition to Combobox's (see Combobox.tsx):
 *   Enter            toggle the active option; the list stays open
 *   Backspace        with an empty input, remove the last chosen value
 *   Tab              close without toggling (unlike Combobox, and unlike antd: leaving the field must
 *                    never silently remove a chosen value)
 *   Tab / Shift+Tab  each chip's remove button ("Remove <label>") is a tab stop before the input
 * The chosen values are also read out as the input's description ("2 selected: A, B"), and each add or
 * removal is announced. */

export interface MultiSelectProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'children' | 'defaultValue' | 'onChange' | 'prefix' | 'role' | 'size' | 'type' | 'value'
  > {
  /** Always rendered as a <label>; `hideLabel` keeps it for assistive tech only. It also names the list. */
  label: string
  hideLabel?: boolean
  options: readonly ListboxOption[]
  /** Controlled values, in the order they were chosen. Omit it (and use defaultValue) for uncontrolled. */
  value?: readonly string[]
  defaultValue?: readonly string[]
  /** The new values and their options (a value no longer in `options` gets its last known option). */
  onChange?: (values: string[], options: ListboxOption[]) => void
  /** false: no typing; typeahead jumps by first letters. @default true */
  searchable?: boolean
  /** Typing makes the first match active, so Enter toggles it (antd `defaultActiveFirstOption`). @default true */
  autoHighlight?: boolean
  /** Replaces the default case-insensitive label match; `false` keeps every option (the server filters). */
  filter?: ListboxFilter | false
  /** Controlled input text. When set, the field never rewrites the text itself. */
  inputValue?: string
  /** Every edit of the text, '' when a search ends (antd `onSearch`, for server search). */
  onInputChange?: (text: string) => void
  /** @default false */
  loading?: boolean
  /** @default 'Loading…' */
  loadingText?: string
  /** @default 'No matches' */
  emptyText?: string
  /** A button that removes every value (antd `allowClear`). @default false */
  clearable?: boolean
  /** Chips shown before a "+N" summary (antd `maxTagCount` as a number). Default: every chip. */
  maxTagCount?: number
  /** md 36px, sm 30px (filter bars). @default 'md' */
  size?: 'sm' | 'md'
  help?: ReactNode
  error?: ReactNode
  status?: FieldStatus
  /** Class on the complete field. Use inputClassName for the native control. */
  className?: string
  inputClassName?: string
}

export const MultiSelect = forwardRef<HTMLInputElement, MultiSelectProps>(function MultiSelect(
  {
    label,
    hideLabel = false,
    options,
    value,
    defaultValue = EMPTY,
    onChange,
    searchable = true,
    autoHighlight = true,
    filter,
    inputValue,
    onInputChange,
    loading = false,
    loadingText = 'Loading…',
    emptyText = 'No matches',
    clearable = false,
    maxTagCount,
    size = 'md',
    help,
    error,
    status = 'default',
    className,
    inputClassName,
    id,
    name,
    placeholder,
    required,
    disabled,
    readOnly,
    onKeyDown,
    onClick,
    onBlur,
    'aria-describedby': describedBy,
    'aria-invalid': ariaInvalid,
    'aria-required': ariaRequired,
    ...rest
  },
  forwardedRef,
) {
  const generatedId = useId()
  const controlId = id ?? `multiselect-${generatedId}`
  const selectionId = `${controlId}-selection`
  const [values, setValues] = useControllableState<readonly string[]>(value, defaultValue)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [query, setQuery] = useState<string | null>(null)
  // Options chosen here, so chips keep their labels when a server search drops them from `options`.
  const [known, setKnown] = useState<ReadonlyMap<string, ListboxOption>>(() => new Map())
  const [announcement, setAnnouncement] = useState('')
  const faceRef = useRef<HTMLSpanElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const interactive = !disabled && !readOnly
  const searchText = inputValue !== undefined ? inputValue : query
  const visible = useMemo(
    () => filterOptions(options, searchable ? searchText : null, filter),
    [options, searchable, searchText, filter],
  )
  const active = activeIndex !== null && activeIndex < visible.length ? activeIndex : null
  const chosen = useMemo(() => new Set(values), [values])
  const optionFor = (optionValue: string): ListboxOption =>
    options.find((option) => option.value === optionValue) ??
    known.get(optionValue) ?? { value: optionValue, label: optionValue }
  const chosenOptions = values.map(optionFor)
  const text = inputValue !== undefined ? inputValue : (query ?? '')

  const dropQuery = () => {
    if (query === null) return
    setQuery(null)
    if (inputValue === undefined && query !== '') onInputChange?.('')
  }

  const commit = (next: string[], message: string) => {
    setValues(next)
    onChange?.(next, next.map(optionFor))
    setAnnouncement(message)
  }

  const remove = (optionValue: string) => {
    const option = optionFor(optionValue)
    commit(
      values.filter((v) => v !== optionValue),
      `Removed ${option.label}`,
    )
  }

  const toggle = (option: ListboxOption) => {
    if (option.disabled) return
    if (chosen.has(option.value)) {
      remove(option.value)
    } else {
      setKnown((previous) => new Map(previous).set(option.value, option))
      commit([...values, option.value], `Added ${option.label}`)
    }
    if (query !== null) {
      // The search is cleared after a choice, so the active option moves to its place in the full list.
      dropQuery()
      const index = filterOptions(options, inputValue ?? null, filter).findIndex((o) => o.value === option.value)
      setActiveIndex(index === -1 ? null : index)
    }
  }

  const openList = (index?: number | null) => {
    if (!interactive) return
    setOpen(true)
    setActiveIndex(index !== undefined ? index : null)
    setAnnouncement('')
  }

  const closeList = () => {
    setOpen(false)
    setActiveIndex(null)
    dropQuery()
  }

  const clearAll = () => {
    if (values.length > 0) commit([], 'All selections removed')
    if (inputValue !== undefined && inputValue !== '') onInputChange?.('')
    closeList()
    inputRef.current?.focus({ preventScroll: true })
  }

  const listbox = useListbox({
    open,
    onOpenChange: (next, edge) => (next ? openList(edgeIndex(visible, edge)) : closeList()),
    activeIndex: active,
    onNavigate: setActiveIndex,
    options: visible,
    typeahead: !searchable && interactive,
    onTypeaheadMatch: (index) => (open ? setActiveIndex(index) : openList(index)),
    faceRef,
  })
  const inputRefs = useMergeRefs([listbox.refs.setReference, inputRef, forwardedRef])
  const faceRefs = useMergeRefs<HTMLSpanElement>([faceRef, listbox.refs.setPositionReference])

  const toggleActive = () => {
    const option = active !== null ? visible[active] : undefined
    if (option) toggle(option)
    else closeList()
  }

  // floating-ui's own handlers run first and prevent the keys they use; only the caller's
  // preventDefault opts out of the field's keys (as in Combobox).
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const claimed = event.defaultPrevented
    onKeyDown?.(event)
    if ((!claimed && event.defaultPrevented) || !interactive) return
    switch (event.key) {
      case 'Enter':
        if (open) {
          event.preventDefault()
          toggleActive()
        } else if (!searchable) {
          event.preventDefault()
          openList(edgeIndex(visible, 'first'))
        }
        break
      case ' ':
        if (!searchable && !claimed && !listbox.context.dataRef.current.typing) {
          event.preventDefault()
          if (open) toggleActive()
          else openList(edgeIndex(visible, 'first'))
        }
        break
      case 'Backspace':
        if (text === '' && values.length > 0) remove(values[values.length - 1])
        break
      case 'Escape':
        if (open) {
          event.preventDefault()
          event.stopPropagation()
          closeList()
        }
        break
      case 'ArrowUp':
        if (open && event.altKey) {
          event.preventDefault()
          closeList()
        }
        break
      case 'Home':
      case 'End':
        if (open && !searchable) {
          event.preventDefault()
          const index = edgeIndex(visible, event.key === 'Home' ? 'first' : 'last')
          if (index !== null) setActiveIndex(index)
        }
        break
      case 'Tab':
        // Closes without toggling (see the header): focus moves on with the values as they are.
        if (open) closeList()
        break
    }
  }

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (!searchable || !interactive) return
    const typed = event.target.value
    setQuery(typed)
    onInputChange?.(typed)
    setAnnouncement('')
    setOpen(true)
    setActiveIndex(
      autoHighlight && typed.trim() !== '' ? firstEnabledIndex(filterOptions(options, typed, filter)) : null,
    )
  }

  const handleClick = (event: MouseEvent<HTMLInputElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || !interactive) return
    if (!open) openList()
    else if (!searchable) closeList()
  }

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    onBlur?.(event)
    if (open || query !== null) closeList()
  }

  const handleFaceMouseDown = (event: MouseEvent<HTMLSpanElement>) => {
    if (!interactive || event.button !== 0) return
    const target = event.target as HTMLElement
    if (target === inputRef.current || target.closest('button')) return
    event.preventDefault()
    inputRef.current?.focus({ preventScroll: true })
    if (open) closeList()
    else openList()
  }

  const hasError = error !== undefined && error !== null
  const effectiveStatus: FieldStatus = hasError ? 'error' : status
  const canClear = clearable && interactive && (values.length > 0 || (inputValue !== undefined && inputValue !== ''))
  const shownCount = maxTagCount === undefined ? values.length : Math.max(0, Math.floor(maxTagCount))
  const shownChips = chosenOptions.slice(0, shownCount)
  const hiddenChips = chosenOptions.slice(shownCount)
  const resultsText = !open
    ? ''
    : loading
      ? loadingText
      : visible.length === 0
        ? emptyText
        : searchText !== null && searchText.trim() !== ''
          ? `${visible.length} ${visible.length === 1 ? 'option' : 'options'} available`
          : ''
  const liveText = [announcement, resultsText].filter(Boolean).join('. ')

  const referenceProps = listbox.getReferenceProps({
    ...rest,
    onKeyDown: handleKeyDown,
    onClick: handleClick,
    onBlur: handleBlur,
    onChange: handleInput,
  })

  return (
    <FieldShell
      id={controlId}
      label={label}
      required={required}
      hideLabel={hideLabel}
      help={help}
      error={error}
      status={effectiveStatus}
      describedBy={[describedBy, values.length > 0 ? selectionId : undefined].filter(Boolean).join(' ') || undefined}
      className={className}
    >
      {(accessibility) => (
        <>
          <span
            ref={faceRefs}
            className={clsx(
              styles.field,
              styles.multi,
              size === 'sm' && styles.sm,
              effectiveStatus !== 'default' && styles[effectiveStatus],
              disabled && styles.disabled,
            )}
            onMouseDown={handleFaceMouseDown}
          >
            <span className={styles.values}>
              {shownChips.map((option) => (
                <span key={option.value} className={styles.chip}>
                  <span className={styles.chipLabel}>{option.label}</span>
                  {interactive ? (
                    <button
                      type="button"
                      className={styles.chipRemove}
                      aria-label={`Remove ${option.label}`}
                      onClick={() => {
                        remove(option.value)
                        inputRef.current?.focus({ preventScroll: true })
                      }}
                    >
                      <IconX size={12} stroke={strokeFor(12)} aria-hidden="true" />
                    </button>
                  ) : null}
                </span>
              ))}
              {hiddenChips.length > 0 ? (
                <span className={clsx(styles.chip, styles.more)} title={hiddenChips.map((o) => o.label).join(', ')}>
                  +{hiddenChips.length}
                  <span className={styles.visuallyHidden}> more selected</span>
                </span>
              ) : null}
              <input
                {...referenceProps}
                {...accessibility}
                ref={inputRefs}
                type="text"
                role="combobox"
                value={text}
                placeholder={values.length === 0 ? placeholder : undefined}
                disabled={disabled}
                readOnly={readOnly || !searchable}
                required={required && values.length === 0}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                aria-autocomplete={searchable ? 'list' : 'none'}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? listbox.listboxId : undefined}
                aria-activedescendant={open && active !== null ? optionId(listbox.listboxId, active) : undefined}
                aria-busy={loading || undefined}
                aria-invalid={accessibility['aria-invalid'] ?? ariaInvalid}
                aria-required={accessibility['aria-required'] ?? ariaRequired}
                className={clsx(styles.input, styles.multiInput, !searchable && styles.selectOnly, inputClassName)}
              />
            </span>
            {canClear ? (
              <button
                type="button"
                className={styles.clearButton}
                aria-label={`Clear ${label}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={clearAll}
              >
                <IconX size={14} stroke={strokeFor(14)} aria-hidden="true" />
              </button>
            ) : null}
            <span className={styles.affix} aria-hidden="true">
              {loading ? <Spinner size="sm" decorative /> : <IconChevronDown size={14} stroke={strokeFor(14)} />}
            </span>
          </span>
          {values.length > 0 ? (
            <span id={selectionId} className={styles.visuallyHidden}>
              {`${values.length} selected: ${chosenOptions.map((option) => option.label).join(', ')}`}
            </span>
          ) : null}
          <span className={styles.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">
            {liveText}
          </span>
          {name ? values.map((v) => <input key={v} type="hidden" name={name} value={v} />) : null}
          <ListboxPopup
            listbox={listbox}
            open={open}
            label={label}
            options={visible}
            activeIndex={active}
            isSelected={(option) => chosen.has(option.value)}
            multiple
            size={size}
            loading={loading}
            loadingText={loadingText}
            emptyText={emptyText}
            onPick={toggle}
          />
        </>
      )}
    </FieldShell>
  )
})
