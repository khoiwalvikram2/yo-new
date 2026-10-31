import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { useMergeRefs } from '@floating-ui/react'
import { IconChevronDown, IconSearch } from '@tabler/icons-react'
import clsx from 'clsx'
import { ListboxPopup } from './ListboxPopup'
import { Spinner } from './Spinner'
import { strokeFor } from './icons'
import {
  edgeIndex,
  filterOptions,
  firstEnabledIndex,
  optionId,
  stepIndex,
  typeaheadIndex,
  useListbox,
  useRevealActive,
  useTypeaheadBuffer,
  type ListboxOption,
} from './useListbox'
import styles from './Select.module.css'

/* A native <select> in kit field chrome, with a themed list for the mouse. The <select> stays the real
 * control: its value and change event, the label/help/error wiring, the keyboard model and what a screen
 * reader hears are the browser's, and pages and tests drive it with change events. Only a mouse or pen
 * press is taken over: it is kept from opening the browser's grey popup and opens the kit list
 * (ListboxPopup, as Combobox's) under the field instead. Touch keeps the native picker phones draw.
 *
 * While the themed list is open (DOM focus on the select, or on the list's search box when there are more
 * than SEARCH_THRESHOLD options; the active option is virtual):
 *   ArrowDown / ArrowUp   move, skipping disabled options and stopping at the ends, as a native select
 *   PageDown / PageUp     move ten;  Home / End  first / last option;  Alt+ArrowUp  close
 *   Enter                 choose the active option and close (nothing active: just close)
 *   Space                 on the select, outside a typeahead string: as Enter
 *   Escape                close without choosing (the key does not reach an enclosing Dialog)
 *   Tab                   close; focus moves on from the select
 *   letters               on the select: typeahead; in the search box: filter, first match active
 * Every key it handles is prevented, so the native select never changes underneath the open list. */

/** More options than this get a search box at the top of the themed list. */
const SEARCH_THRESHOLD = 6

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  /** Secondary text at the end of the row in the themed list, e.g. a count. The native option shows the label only. */
  description?: string
  /**
   * A heading the option is listed under: consecutive options with the same group form one <optgroup> in the
   * native select and one headed group in the themed list, so give them in group order.
   */
  group?: string
}

/** md 36px, sm 30px (T46, T47). */
export type SelectSize = 'sm' | 'md'
export type SelectLayout = 'inline' | 'stacked'

export interface SelectProps
  extends Omit<
    SelectHTMLAttributes<HTMLSelectElement>,
    'value' | 'defaultValue' | 'onChange' | 'children' | 'size' | 'multiple'
  > {
  /** Always rendered as a <label>; visually hidden with hideLabel. */
  label: string
  options: readonly SelectOption[]
  /** Controlled. '' selects the placeholder (when one is given). */
  value: string
  /** Receives the chosen option's value. Never called with '' when a placeholder is set. */
  onChange: (value: string) => void
  /** Renders <option value="" disabled> first, e.g. "Select Whitelabel" for the Super Admin select (T46). */
  placeholder?: string
  /** @default false */
  hideLabel?: boolean
  /** Replaces the native `size` (visible rows) attribute. @default 'md' */
  size?: SelectSize
  /** Disables the select and swaps the chevron for a spinner (antd Select `loading`). @default false */
  loading?: boolean
  /** Keeps the established topbar layout by default; forms opt into a full-width label above the control. */
  layout?: SelectLayout
  /** Supporting text linked to the native select. */
  help?: ReactNode
  /** Visible alert text linked to the native select. */
  error?: ReactNode
  /** Class on the root (label + field); set width here. */
  className?: string
}

/** The native options, each run of consecutive options sharing a group inside one <optgroup>. */
function nativeOptions(options: readonly SelectOption[]): ReactNode[] {
  const rows: ReactNode[] = []
  const option = (item: SelectOption) => (
    <option key={item.value} value={item.value} disabled={item.disabled}>
      {item.label}
    </option>
  )
  for (let index = 0; index < options.length; ) {
    const group = options[index].group
    if (!group) {
      rows.push(option(options[index]))
      index += 1
      continue
    }
    const start = index
    const members: ReactNode[] = []
    while (index < options.length && options[index].group === group) {
      members.push(option(options[index]))
      index += 1
    }
    rows.push(
      <optgroup key={`group:${start}`} label={group}>
        {members}
      </optgroup>,
    )
  }
  return rows
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    options,
    value,
    onChange,
    placeholder,
    hideLabel = false,
    size = 'md',
    loading = false,
    layout = 'inline',
    help,
    error,
    disabled,
    required,
    id,
    className,
    onPointerDown,
    onMouseDown,
    onKeyDown,
    onBlur,
    'aria-describedby': describedBy,
    'aria-invalid': ariaInvalid,
    'aria-required': ariaRequired,
    ...rest
  },
  ref,
) {
  const autoId = useId()
  const selectId = id ?? autoId
  const helpId = help !== undefined && help !== null ? `${selectId}-help` : undefined
  const errorId = error !== undefined && error !== null ? `${selectId}-error` : undefined
  const descriptionIds = [describedBy, helpId, errorId].filter(Boolean).join(' ') || undefined
  const invalid = error !== undefined && error !== null

  const interactive = !disabled && !loading
  const searchable = options.length > SEARCH_THRESHOLD
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const faceRef = useRef<HTMLSpanElement | null>(null)
  const selectRef = useRef<HTMLSelectElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  // The press that opened or closed the themed list: its compatibility mousedown must not open the native one.
  const pressTakenRef = useRef(false)
  // floating-ui moves the active option only on hover here; such a move is not scrolled to.
  const movedByPointerRef = useRef(false)
  const typeahead = useTypeaheadBuffer()

  const shown = open && interactive
  const visible = searchable ? filterOptions(options, query, undefined) : options
  const active = activeIndex !== null && activeIndex < visible.length ? activeIndex : null

  // A select that turns disabled or starts loading drops its list.
  useEffect(() => {
    if (interactive) return
    setOpen(false)
    setActiveIndex(null)
    setQuery('')
  }, [interactive])

  const moveTo = (index: number | null) => {
    movedByPointerRef.current = false
    if (index !== null) setActiveIndex(index)
  }

  // The list opens on the chosen option, else on the first enabled one.
  const openList = () => {
    const chosen = options.findIndex((option) => option.value === value && !option.disabled)
    movedByPointerRef.current = false
    setQuery('')
    setActiveIndex(chosen >= 0 ? chosen : firstEnabledIndex(options))
    setOpen(true)
  }

  const closeList = (refocus: boolean) => {
    // Focus goes back before the search box unmounts; a removed focused element would leave it on <body>.
    if (refocus) selectRef.current?.focus({ preventScroll: true })
    setOpen(false)
    setActiveIndex(null)
    setQuery('')
  }

  const choose = (option: ListboxOption) => {
    if (option.disabled) return
    closeList(true)
    // As the native select: no change event for the option it already shows, and never '' under a placeholder.
    if (option.value === value || (option.value === '' && placeholder !== undefined)) return
    onChange(option.value)
  }

  const commitActive = () => {
    const option = active !== null ? visible[active] : undefined
    if (option) choose(option)
    else closeList(true)
  }

  const listbox = useListbox({
    open: shown,
    onOpenChange: (next) => {
      if (!next) closeList(false)
    },
    activeIndex: active,
    onNavigate: (index) => {
      movedByPointerRef.current = true
      setActiveIndex(index)
    },
    options: visible,
    typeahead: false,
    onTypeaheadMatch: () => undefined,
    faceRef,
  })
  useRevealActive(listbox, shown, active, movedByPointerRef)
  const selectRefs = useMergeRefs([selectRef, ref])
  // The list is placed under, and kept as wide as, the whole field face; the native select takes no
  // floating-ui props, so it gains no popup semantics while the list is closed. (The cast only widens the
  // element type useListbox declares for Combobox's input.)
  const faceRefs = useMergeRefs<HTMLSpanElement>([
    faceRef,
    listbox.refs.setReference as (node: HTMLElement | null) => void,
  ])

  // The keys of the open list, from the select or from the search box.
  const handleListKey = (event: KeyboardEvent<HTMLElement>, inSearch: boolean) => {
    const claim = () => {
      event.preventDefault()
      // From the search box the key would bubble on to floating-ui's own handler on the list surface.
      event.stopPropagation()
    }
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        claim()
        if (event.altKey) {
          if (event.key === 'ArrowUp') closeList(true)
        } else {
          moveTo(stepIndex(visible, active, event.key === 'ArrowDown' ? 1 : -1))
        }
        break
      case 'PageDown':
      case 'PageUp':
        claim()
        moveTo(stepIndex(visible, active, event.key === 'PageDown' ? 10 : -10))
        break
      case 'Home':
      case 'End':
        claim()
        moveTo(edgeIndex(visible, event.key === 'Home' ? 'first' : 'last'))
        break
      case 'Enter':
        claim()
        commitActive()
        break
      case 'Escape':
        claim()
        closeList(true)
        break
      case 'Tab':
        // Not prevented: with focus back on the select, the browser moves it on from there.
        closeList(true)
        break
      case 'ArrowLeft':
      case 'ArrowRight':
        // Some browsers step a closed select's value with these; the search box keeps them for its caret.
        if (!inSearch) claim()
        break
      default:
        if (inSearch || event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) break
        claim()
        if (event.key === ' ' && !typeahead.typing()) commitActive()
        else moveTo(typeaheadIndex(visible, active, typeahead.push(event.key)))
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLSelectElement>) => {
    onKeyDown?.(event)
    if (shown && !event.defaultPrevented) handleListKey(event, false)
  }

  // A mouse or pen press opens (or closes) the themed list in place of the native popup; touch is left alone.
  const handlePointerDown = (event: PointerEvent<HTMLSelectElement>) => {
    onPointerDown?.(event)
    pressTakenRef.current = false
    if (event.defaultPrevented || !interactive || event.button !== 0) return
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return
    event.preventDefault()
    pressTakenRef.current = true
    if (shown) {
      closeList(true)
      return
    }
    event.currentTarget.focus({ preventScroll: true })
    openList()
  }

  // A cancelled pointerdown already suppresses this event in browsers that follow Pointer Events; this
  // covers the ones that still send it.
  const handleMouseDown = (event: MouseEvent<HTMLSelectElement>) => {
    onMouseDown?.(event)
    if (!pressTakenRef.current) return
    pressTakenRef.current = false
    event.preventDefault()
  }

  // Focus leaving both the field and the list closes it; moving between the select and the search box does not.
  const closeOnFocusOut = (event: FocusEvent<HTMLElement>) => {
    if (!open) return
    const next = event.relatedTarget
    if (
      next instanceof Node &&
      (next === searchRef.current || faceRef.current?.contains(next) || listbox.refs.floating.current?.contains(next))
    ) {
      return
    }
    closeList(false)
  }

  const handleBlur = (event: FocusEvent<HTMLSelectElement>) => {
    onBlur?.(event)
    closeOnFocusOut(event)
  }

  const handleSearch = (event: ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value
    movedByPointerRef.current = false
    setQuery(text)
    setActiveIndex(firstEnabledIndex(filterOptions(options, text, undefined)))
  }

  // The search box takes focus as it mounts. FloatingPortal renders it a commit after the list opens, so an
  // effect here would run before it exists; the stable callback runs once per mount.
  const attachSearch = useCallback((node: HTMLInputElement | null) => {
    searchRef.current = node
    node?.focus({ preventScroll: true })
  }, [])

  // The list surface keeps every press from moving focus; inside the search box a press may place the caret.
  const handleSearchPress = (event: MouseEvent<HTMLSpanElement>) => {
    event.stopPropagation()
    if (event.target === searchRef.current) return
    event.preventDefault()
    searchRef.current?.focus({ preventScroll: true })
  }

  const search = searchable ? (
    <span className={styles.search} onMouseDown={handleSearchPress}>
      <IconSearch className={styles.searchIcon} size={15} stroke={strokeFor(15)} aria-hidden="true" />
      <input
        ref={attachSearch}
        type="text"
        className={styles.searchInput}
        value={query}
        placeholder="Search"
        aria-label={`Search ${label}`}
        aria-autocomplete="list"
        aria-controls={listbox.listboxId}
        aria-activedescendant={active !== null ? optionId(listbox.listboxId, active) : undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={handleSearch}
        onKeyDown={(event) => handleListKey(event, true)}
        onBlur={closeOnFocusOut}
      />
    </span>
  ) : undefined

  return (
    <span className={clsx(styles.root, styles[layout], invalid && styles.error, className)}>
      <label htmlFor={selectId} className={hideLabel ? styles.visuallyHidden : styles.label}>
        {label}
        {required ? (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <span className={styles.control}>
        <span ref={faceRefs} className={clsx(styles.field, styles[size], shown && styles.open)}>
          <select
            {...rest}
            ref={selectRefs}
            id={selectId}
            value={value}
            disabled={disabled || loading}
            required={required}
            aria-required={required ? true : ariaRequired}
            aria-invalid={invalid ? true : ariaInvalid}
            aria-describedby={descriptionIds}
            aria-busy={loading ? true : undefined}
            // Popup state only while the themed list is open; closed, the select is exactly the native one.
            aria-expanded={shown ? true : undefined}
            aria-controls={shown ? listbox.listboxId : undefined}
            aria-activedescendant={
              shown && !searchable && active !== null ? optionId(listbox.listboxId, active) : undefined
            }
            className={styles.select}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              const next = event.target.value
              if (next === '' && placeholder !== undefined) return
              onChange(next)
            }}
            onPointerDown={handlePointerDown}
            onMouseDown={handleMouseDown}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
          >
            {placeholder !== undefined && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {nativeOptions(options)}
          </select>
          <span className={styles.chevron} aria-hidden="true">
            {loading ? <Spinner size="sm" decorative /> : <IconChevronDown size={14} stroke={1.75} />}
          </span>
        </span>
        {help !== undefined && help !== null ? (
          <span className={styles.help} id={helpId}>
            {help}
          </span>
        ) : null}
        {error !== undefined && error !== null ? (
          <span className={styles.errorText} id={errorId} role="alert">
            {error}
          </span>
        ) : null}
        <ListboxPopup
          listbox={listbox}
          open={shown}
          label={label}
          options={visible}
          activeIndex={active}
          isSelected={(option) => option.value === value}
          size={size}
          loading={false}
          loadingText=""
          emptyText="No matches"
          onPick={choose}
          header={search}
        />
      </span>
    </span>
  )
})
