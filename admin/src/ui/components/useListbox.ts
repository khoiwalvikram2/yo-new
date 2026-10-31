import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
  useTypeahead,
} from '@floating-ui/react'
import { getFloatingTheme } from './floating'

/* Shared engine of the kit's Combobox and MultiSelect (page migration C, phase 5): the WAI-ARIA combobox
 * pattern on floating-ui. DOM focus never leaves the input; the active option is virtual and reaches
 * assistive tech through aria-activedescendant (useListNavigation virtual). Option filtering and the
 * controllable value live here too, so both components behave identically. */

export interface ListboxOption {
  value: string
  label: string
  /** Secondary text, shown after the label (the `.pal-i em` slot, M:1199). */
  description?: string
  disabled?: boolean
  /**
   * A heading the option is listed under (antd option groups). Consecutive options with the same group form
   * one `role="group"` named by its heading, so give them in group order. A heading is not an option:
   * navigation, typeahead and the filter never land on it, and a group whose options are all filtered out
   * disappears with them.
   */
  group?: string
}

/** Decides whether an option stays in the list for the typed query. */
export type ListboxFilter = (option: ListboxOption, query: string) => boolean

/** The default filter: a case-insensitive match anywhere in the label. An empty query keeps everything. */
export const matchesLabel: ListboxFilter = (option, query) => {
  const needle = query.trim().toLocaleLowerCase()
  return needle === '' || option.label.toLocaleLowerCase().includes(needle)
}

/** Applies a filter; `null` (not searching) and `filter === false` (the server filters) keep the list. */
export function filterOptions(
  options: readonly ListboxOption[],
  query: string | null,
  filter: ListboxFilter | false | undefined,
): readonly ListboxOption[] {
  if (query === null || filter === false) return options
  const keep = filter ?? matchesLabel
  return options.filter((option) => keep(option, query))
}

/** The first option a typed query should highlight, or null. */
export function firstEnabledIndex(options: readonly ListboxOption[]): number | null {
  const index = options.findIndex((option) => !option.disabled)
  return index === -1 ? null : index
}

/** The end of the list a key opened it at: ArrowDown the first option, ArrowUp the last, otherwise none. */
export type OpenEdge = 'first' | 'last' | null

/** The first or last enabled option, or null (no edge, or nothing enabled). */
export function edgeIndex(options: readonly ListboxOption[], edge: OpenEdge): number | null {
  if (edge === null) return null
  if (edge === 'first') return firstEnabledIndex(options)
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!options[index].disabled) return index
  }
  return null
}

/*
 * For a field that moves the active option with its own keys (Select, whose native <select> takes no
 * floating-ui props, and TimeField's clock button). Combobox and MultiSelect leave this to floating-ui.
 */

/**
 * The enabled option `delta` places on from `from`: ±1 for the arrows, ±10 for PageDown / PageUp. It stops
 * at the ends instead of wrapping, as a native <select> does. Nothing active yet: the first enabled option
 * going down, the last going up.
 */
export function stepIndex(options: readonly ListboxOption[], from: number | null, delta: number): number | null {
  if (from === null) return edgeIndex(options, delta > 0 ? 'first' : 'last')
  const direction = delta > 0 ? 1 : -1
  let target = from
  let remaining = Math.abs(delta)
  for (let index = from + direction; index >= 0 && index < options.length && remaining > 0; index += direction) {
    if (options[index].disabled) continue
    target = index
    remaining -= 1
  }
  return target
}

/**
 * Typeahead: the first enabled option whose label starts with `text` (any case), searching on from `from`
 * and wrapping. A repeated single character starts after `from`, so pressing it again cycles through the
 * options that start with it, as a native <select> does, unless an option starts with the whole repeated
 * string ("11" reaches 11:00 in a time list).
 */
export function typeaheadIndex(options: readonly ListboxOption[], from: number | null, text: string): number | null {
  const needle = text.toLocaleLowerCase()
  if (needle === '' || options.length === 0) return null
  const find = (prefix: string, start: number) => {
    for (let offset = 0; offset < options.length; offset += 1) {
      const index = (start + offset) % options.length
      const option = options[index]
      if (!option.disabled && option.label.toLocaleLowerCase().startsWith(prefix)) return index
    }
    return null
  }
  const repeated = [...needle].every((char) => char === needle[0])
  if (!repeated) return find(needle, from ?? 0)
  return (needle.length > 1 ? find(needle, from ?? 0) : null) ?? find(needle[0], from === null ? 0 : from + 1)
}

/** Typeahead keys typed within `timeout` ms of each other make one search string (floating-ui's 750 ms). */
export function useTypeaheadBuffer(timeout = 750) {
  const state = useRef({ text: '', at: 0 })
  return useMemo(
    () => ({
      /** Adds a key; returns the string typed so far. */
      push(char: string): string {
        const now = Date.now()
        const text = now - state.current.at < timeout ? state.current.text + char : char
        state.current = { text, at: now }
        return text
      },
      /** A string is still being typed, so Space belongs to it. */
      typing(): boolean {
        return state.current.text !== '' && Date.now() - state.current.at < timeout
      },
    }),
    [timeout],
  )
}

/**
 * Keeps the active option scrolled into view, including the chosen one when the list first renders (a
 * FloatingPortal mounts a commit after `open`, so this waits for the floating element). A move made by the
 * pointer (`movedByPointer`, which the field sets in its onNavigate) is not followed, so the list never
 * shifts under the mouse.
 */
export function useRevealActive(
  listbox: ListboxController,
  open: boolean,
  activeIndex: number | null,
  movedByPointer: MutableRefObject<boolean>,
) {
  const floating = listbox.context.elements.floating
  const { listRef } = listbox
  useLayoutEffect(() => {
    if (!open || activeIndex === null || !floating || movedByPointer.current) return
    listRef.current[activeIndex]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [listRef, open, activeIndex, floating, movedByPointer])
}

function openEdge(event: Event | undefined): OpenEdge {
  const key = event !== undefined && 'key' in event ? event.key : undefined
  return key === 'ArrowDown' ? 'first' : key === 'ArrowUp' ? 'last' : null
}

/** The DOM id of the option at an index; aria-activedescendant points at it. */
export function optionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`
}

/** Controlled when `value` is defined, otherwise internal state seeded from `defaultValue`. */
export function useControllableState<T>(value: T | undefined, defaultValue: T): [T, (next: T) => void] {
  const [inner, setInner] = useState(defaultValue)
  const controlled = value !== undefined
  const set = useCallback(
    (next: T) => {
      if (!controlled) setInner(next)
    },
    [controlled],
  )
  return [controlled ? (value as T) : inner, set]
}

export interface UseListboxOptions {
  open: boolean
  /** `edge` says where a key that opened the list points (the field decides the starting option). */
  onOpenChange: (open: boolean, edge: OpenEdge) => void
  /** Index into the visible options. */
  activeIndex: number | null
  onNavigate: (index: number | null) => void
  /** The visible options, in order; drives typeahead and the disabled indices. */
  options: readonly ListboxOption[]
  /** Typeahead jumps to an option by its first letters; only for a field that is not searchable. */
  typeahead: boolean
  onTypeaheadMatch: (index: number) => void
  /** The field face: the list is positioned under it and presses inside it are not outside presses. */
  faceRef: MutableRefObject<HTMLElement | null>
}

export function useListbox({
  open,
  onOpenChange,
  activeIndex,
  onNavigate,
  options,
  typeahead,
  onTypeaheadMatch,
  faceRef,
}: UseListboxOptions) {
  const listboxId = `listbox-${useId()}`
  const listRef = useRef<Array<HTMLElement | null>>([])
  const labelsRef = useRef<Array<string | null>>([])
  labelsRef.current = options.map((option) => (option.disabled ? null : option.label))

  const { refs, floatingStyles, context } = useFloating<HTMLInputElement>({
    open,
    onOpenChange: (next, event) => onOpenChange(next, openEdge(event)),
    placement: 'bottom-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      // The list is at least as wide as the field it belongs to. This min-width is floating-ui geometry
      // written next to the position; CSS cannot know the field's width. It is the one inline style other
      // than the position, disclosed in records/task-300.md for an explicit kit-rule exception.
      size({
        padding: 8,
        apply({ rects, elements }) {
          elements.floating.style.minWidth = `${rects.reference.width}px`
        },
      }),
    ],
  })

  const role = useRole(context, { role: 'listbox' })
  const dismiss = useDismiss(context, {
    // Escape is handled by the field, so it can stop the key reaching an enclosing Dialog.
    escapeKey: false,
    outsidePress: (event) => {
      const face = faceRef.current
      return !(face && event.target instanceof Node && face.contains(event.target))
    },
  })
  const navigation = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate,
    virtual: true,
    loop: true,
    // The field alone picks the option a list opens on. floating-ui's own pick remembers the last
    // navigation key even while closed (Enter or Space count), so an Enter in a closed AutoComplete
    // followed by typing would otherwise open with its first suggestion active.
    focusItemOnOpen: false,
    // From the data, not the DOM, so navigation is right even before the options have rendered.
    disabledIndices: (index) => options[index] === undefined || options[index].disabled === true,
  })
  const typeaheadProps = useTypeahead(context, {
    listRef: labelsRef,
    activeIndex,
    onMatch: onTypeaheadMatch,
    enabled: typeahead,
  })
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    role,
    dismiss,
    navigation,
    typeaheadProps,
  ])

  return {
    listboxId,
    listRef,
    refs,
    floatingStyles,
    context,
    getReferenceProps,
    getFloatingProps,
    getItemProps,
    theme: getFloatingTheme(context.elements.domReference),
  }
}

export type ListboxController = ReturnType<typeof useListbox>
