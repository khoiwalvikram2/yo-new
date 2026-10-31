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
  type OpenEdge,
} from './useListbox'
import styles from './Listbox.module.css'

export type { ListboxFilter, ListboxOption } from './useListbox'

/* A single-value picker with a text input: the WAI-ARIA combobox pattern (APG "editable combobox with
 * list autocomplete"; "select-only" when `searchable={false}`). It replaces antd `Select showSearch`
 * (31 files) and `AutoComplete` (2 files). The list is the mockup's command-palette list (.pal-list,
 * .pal-i, .pal-none M:1187-1201) in a floating surface; the face is the kit field face (.searchfield
 * M:693-701).
 *
 * Keyboard (DOM focus stays in the input; the active option is aria-activedescendant):
 *   ArrowDown / ArrowUp   open (on the selected option, else the first / last); then move, wrapping
 *   Alt+ArrowUp           close
 *   Enter                 choose the active option and close (nothing active: just close); closed +
 *                         select-only: open
 *   Escape                close without choosing (the key does not reach an enclosing Dialog)
 *   Tab                   choose the active option if there is one, close, and move on (focus is not held)
 *   typing                searchable: filter, and with autoHighlight make the first match active;
 *                         select-only: typeahead
 *   Home / End            select-only: first / last option (searchable: the caret, as in any input)
 *   Space                 select-only: open, or choose the active option
 * Choosing the option that is already chosen closes the list and calls onSelect, never onChange (as antd). */

export interface ComboboxProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'children' | 'defaultValue' | 'onChange' | 'onSelect' | 'prefix' | 'role' | 'size' | 'type' | 'value'
  > {
  /** Always rendered as a <label>; `hideLabel` keeps it for assistive tech only. It also names the list. */
  label: string
  hideLabel?: boolean
  options: readonly ListboxOption[]
  /** Controlled value; `null` is "nothing chosen". Omit it (and use defaultValue) for an uncontrolled field. */
  value?: string | null
  defaultValue?: string | null
  /**
   * The value changed: the new value and its option (antd `labelInValue`); `null, null` when cleared.
   * Only on a real change, as antd: choosing the option that is already chosen does not call it.
   */
  onChange?: (value: string | null, option: ListboxOption | null) => void
  /** Every pick of an option, including the one already chosen (antd `onSelect`; AutoComplete picks). */
  onSelect?: (value: string, option: ListboxOption) => void
  /** false: a select-only combobox (no typing; typeahead jumps by first letters). @default true */
  searchable?: boolean
  /**
   * Typing makes the first match active, so Enter or Tab chooses it (antd `defaultActiveFirstOption`).
   * Off, no option is active until an arrow key or the pointer reaches one, so Enter keeps the typed text.
   * @default true, or false when `inputValue` is controlled (AutoComplete, as antd)
   */
  autoHighlight?: boolean
  /** Replaces the default case-insensitive label match; `false` keeps every option (the server filters). */
  filter?: ListboxFilter | false
  /** Controlled input text (AutoComplete). When set, the field never rewrites the text itself. */
  inputValue?: string
  /** Every edit of the text, '' when a search ends (antd `onSearch`, for server search). */
  onInputChange?: (text: string) => void
  /** Options are being fetched: a spinner in the field, the list is aria-busy. @default false */
  loading?: boolean
  /** @default 'Loading…' */
  loadingText?: string
  /** Shown (and announced) when no option is left (antd `notFoundContent`). @default 'No matches' */
  emptyText?: string
  /** A clear button while there is a value (antd `allowClear`). @default false */
  clearable?: boolean
  /** md 36px, sm 30px (filter bars). @default 'md' */
  size?: 'sm' | 'md'
  help?: ReactNode
  error?: ReactNode
  status?: FieldStatus
  /** Class on the complete field. Use inputClassName for the native control. */
  className?: string
  inputClassName?: string
}

export const Combobox = forwardRef<HTMLInputElement, ComboboxProps>(function Combobox(
  {
    label,
    hideLabel = false,
    options,
    value,
    defaultValue = null,
    onChange,
    onSelect,
    searchable = true,
    autoHighlight,
    filter,
    inputValue,
    onInputChange,
    loading = false,
    loadingText = 'Loading…',
    emptyText = 'No matches',
    clearable = false,
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
  const controlId = id ?? `combobox-${generatedId}`
  const [current, setCurrent] = useControllableState<string | null>(value, defaultValue)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  // What the user has typed since the list opened; null while the input shows the chosen label.
  const [query, setQuery] = useState<string | null>(null)
  // The last option chosen here, so its label survives a server search that drops it from `options`.
  const [picked, setPicked] = useState<ListboxOption | null>(null)
  const faceRef = useRef<HTMLSpanElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const interactive = !disabled && !readOnly
  const highlightFirst = autoHighlight ?? inputValue === undefined
  const searchText = inputValue !== undefined ? inputValue : query
  const visible = useMemo(
    () => filterOptions(options, searchable ? searchText : null, filter),
    [options, searchable, searchText, filter],
  )
  const active = activeIndex !== null && activeIndex < visible.length ? activeIndex : null
  const selectedOption =
    current === null
      ? null
      : (options.find((option) => option.value === current) ?? (picked?.value === current ? picked : null))
  const displayText =
    inputValue !== undefined ? inputValue : query !== null ? query : (selectedOption?.label ?? current ?? '')
  const selectedVisibleIndex = current === null ? -1 : visible.findIndex((option) => option.value === current)

  const dropQuery = () => {
    if (query === null) return
    setQuery(null)
    if (inputValue === undefined && query !== '') onInputChange?.('')
  }

  // Where the list opens: on the chosen option, else at the edge the opening key points to, else nowhere.
  const startIndex = (edge: OpenEdge) => (selectedVisibleIndex >= 0 ? selectedVisibleIndex : edgeIndex(visible, edge))

  const openList = (index: number | null = startIndex(null)) => {
    if (!interactive) return
    setOpen(true)
    setActiveIndex(index)
  }

  const closeList = () => {
    setOpen(false)
    setActiveIndex(null)
    dropQuery()
  }

  const choose = (option: ListboxOption) => {
    if (option.disabled) return
    setPicked(option)
    // antd (rc-select triggerChange) reports a change only when the value differs; a page's onChange may
    // reset filters or paging, so re-choosing the chosen option must stay a no-op for it.
    if (option.value !== current) {
      setCurrent(option.value)
      onChange?.(option.value, option)
    }
    onSelect?.(option.value, option)
    closeList()
  }

  const clear = () => {
    if (current !== null) {
      setPicked(null)
      setCurrent(null)
      onChange?.(null, null)
    }
    if (inputValue !== undefined && inputValue !== '') onInputChange?.('')
    closeList()
    inputRef.current?.focus({ preventScroll: true })
  }

  const listbox = useListbox({
    open,
    onOpenChange: (next, edge) => (next ? openList(startIndex(edge)) : closeList()),
    activeIndex: active,
    onNavigate: setActiveIndex,
    options: visible,
    typeahead: !searchable && interactive,
    onTypeaheadMatch: (index) => (open ? setActiveIndex(index) : openList(index)),
    faceRef,
  })
  const inputRefs = useMergeRefs([listbox.refs.setReference, inputRef, forwardedRef])
  const faceRefs = useMergeRefs<HTMLSpanElement>([faceRef, listbox.refs.setPositionReference])

  const commitActive = () => {
    const option = active !== null ? visible[active] : undefined
    if (option) choose(option)
    else closeList()
  }

  // floating-ui's own handlers (navigation, typeahead) run before this one, and they prevent the default
  // of the keys they use; only a preventDefault by the caller's onKeyDown opts out of the field's keys.
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const claimed = event.defaultPrevented
    onKeyDown?.(event)
    if ((!claimed && event.defaultPrevented) || !interactive) return
    switch (event.key) {
      case 'Enter':
        if (open) {
          event.preventDefault()
          commitActive()
        } else if (!searchable) {
          event.preventDefault()
          openList(startIndex('first'))
        }
        break
      case ' ':
        // While a typeahead string is being typed, Space is part of it (useTypeahead claimed it).
        if (!searchable && !claimed && !listbox.context.dataRef.current.typing) {
          event.preventDefault()
          if (open) commitActive()
          else openList(startIndex('first'))
        }
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
        // antd and APG's select-only combobox take the active option on Tab; the default is kept, so
        // focus still moves on. Nothing active (no arrow key, no autoHighlight match): just close.
        if (open) commitActive()
        break
    }
  }

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (!searchable || !interactive) return
    const text = event.target.value
    setQuery(text)
    onInputChange?.(text)
    setOpen(true)
    setActiveIndex(
      highlightFirst && text.trim() !== '' ? firstEnabledIndex(filterOptions(options, text, filter)) : null,
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
    // Presses on the list never move focus, so a blur always means the user left the field.
    if (open || query !== null) closeList()
  }

  // A press on the face around the input (padding, chevron) focuses the input and toggles the list.
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
  const canClear = clearable && interactive && (current !== null || (inputValue !== undefined && inputValue !== ''))
  const statusText = !open
    ? ''
    : loading
      ? loadingText
      : visible.length === 0
        ? emptyText
        : searchText !== null && searchText.trim() !== ''
          ? `${visible.length} ${visible.length === 1 ? 'option' : 'options'} available`
          : ''

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
            onMouseDown={handleFaceMouseDown}
          >
            <input
              {...referenceProps}
              {...accessibility}
              ref={inputRefs}
              type="text"
              role="combobox"
              value={displayText}
              placeholder={placeholder}
              disabled={disabled}
              readOnly={readOnly || !searchable}
              required={required}
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
              className={clsx(styles.input, !searchable && styles.selectOnly, inputClassName)}
            />
            {canClear ? (
              <button
                type="button"
                className={styles.clearButton}
                aria-label={`Clear ${label}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={clear}
              >
                <IconX size={14} stroke={strokeFor(14)} aria-hidden="true" />
              </button>
            ) : null}
            <span className={styles.affix} aria-hidden="true">
              {loading ? <Spinner size="sm" decorative /> : <IconChevronDown size={14} stroke={strokeFor(14)} />}
            </span>
          </span>
          <span className={styles.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">
            {statusText}
          </span>
          {name ? <input type="hidden" name={name} value={current ?? ''} /> : null}
          <ListboxPopup
            listbox={listbox}
            open={open}
            label={label}
            options={visible}
            activeIndex={active}
            isSelected={(option) => option.value === current}
            size={size}
            loading={loading}
            loadingText={loadingText}
            emptyText={emptyText}
            onPick={choose}
          />
        </>
      )}
    </FieldShell>
  )
})
