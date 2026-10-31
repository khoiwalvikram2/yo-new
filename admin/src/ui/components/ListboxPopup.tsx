import type { ReactNode } from 'react'
import { FloatingPortal } from '@floating-ui/react'
import { IconCheck } from '@tabler/icons-react'
import clsx from 'clsx'
import { strokeFor } from './icons'
import { Spinner } from './Spinner'
import { optionId, type ListboxController, type ListboxOption } from './useListbox'
import styles from './Listbox.module.css'

export interface ListboxPopupProps {
  listbox: ListboxController
  open: boolean
  /** The field's label; names the listbox. */
  label: string
  /** The visible (already filtered) options. */
  options: readonly ListboxOption[]
  activeIndex: number | null
  isSelected: (option: ListboxOption) => boolean
  multiple?: boolean
  size: 'sm' | 'md'
  loading: boolean
  loadingText: string
  emptyText: string
  onPick: (option: ListboxOption) => void
  /** Shown above the options and outside the listbox (Select's search box); the options scroll under it. */
  header?: ReactNode
}

/**
 * The portalled list surface shared by Combobox, MultiSelect, Select's themed list and TimeField's time
 * list. Options are never focused: the field keeps DOM focus and points at the active option with
 * aria-activedescendant. A press anywhere on the surface is kept from moving focus, so choosing an option
 * never blurs the field.
 *
 * Options with a `group` are wrapped, run by run, in a `role="group"` labelled by a heading row (the APG
 * "listbox with grouped options" structure). Headings are not in the navigation list, so the arrows and
 * typeahead skip them; option indices and ids stay those of the flat list.
 */
export function ListboxPopup({
  listbox,
  open,
  label,
  options,
  activeIndex,
  isSelected,
  multiple = false,
  size,
  loading,
  loadingText,
  emptyText,
  onPick,
  header,
}: ListboxPopupProps) {
  if (!open) return null
  const { refs, floatingStyles, getFloatingProps, getItemProps, listRef, listboxId, theme } = listbox
  // Entries past the visible list would count as items for the navigation bounds.
  listRef.current.length = options.length
  const message = options.length > 0 ? null : loading ? loadingText : emptyText
  const tick = <IconCheck size={14} stroke={strokeFor(14)} />

  const renderOption = (option: ListboxOption, index: number) => {
    const selected = isSelected(option)
    return (
      <div
        key={`option:${option.value}`}
        ref={(node) => {
          listRef.current[index] = node
        }}
        role="option"
        id={optionId(listboxId, index)}
        aria-selected={selected}
        aria-disabled={option.disabled || undefined}
        className={clsx(
          styles.option,
          index === activeIndex && styles.active,
          selected && styles.selected,
          option.disabled && styles.optionDisabled,
        )}
        {...getItemProps({
          onClick: () => {
            if (!option.disabled) onPick(option)
          },
        })}
      >
        {multiple ? (
          <span className={clsx(styles.check, styles.box)} aria-hidden="true">
            {selected ? tick : null}
          </span>
        ) : null}
        <span className={styles.optionLabel}>{option.label}</span>
        {option.description ? <span className={styles.optionDescription}>{option.description}</span> : null}
        {!multiple ? (
          <span className={styles.check} aria-hidden="true">
            {selected ? tick : null}
          </span>
        ) : null}
      </div>
    )
  }

  // Ungrouped options sit directly in the listbox; each run of consecutive options sharing a group is one
  // role="group". An option value may repeat across groups (a recent search that is also a domain).
  const rows: ReactNode[] = []
  for (let index = 0; index < options.length; ) {
    const group = options[index].group
    if (!group) {
      rows.push(renderOption(options[index], index))
      index += 1
      continue
    }
    const start = index
    const members: ReactNode[] = []
    while (index < options.length && options[index].group === group) {
      members.push(renderOption(options[index], index))
      index += 1
    }
    const headingId = `${listboxId}-group-${start}`
    rows.push(
      <div key={`group:${start}`} role="group" aria-labelledby={headingId} className={styles.group}>
        <div role="presentation" id={headingId} className={styles.groupLabel}>
          {group}
        </div>
        {members}
      </div>,
    )
  }

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className={clsx(styles.surface, size === 'sm' && styles.surfaceSm, header != null && styles.withHeader)}
        data-theme={theme}
        {...getFloatingProps({ onMouseDown: (event) => event.preventDefault() })}
        // The surface is a plain container: the role, the id and the orientation belong to the listbox. The
        // field that owns DOM focus carries aria-activedescendant (floating-ui puts it here when the
        // reference is not a text input, as Select's field face is not).
        id={undefined}
        role={undefined}
        aria-orientation={undefined}
        aria-activedescendant={undefined}
        tabIndex={undefined}
      >
        {header != null ? <div className={styles.header}>{header}</div> : null}
        <div
          role="listbox"
          id={listboxId}
          aria-label={label}
          aria-multiselectable={multiple || undefined}
          aria-busy={loading || undefined}
          className={styles.list}
        >
          {rows}
        </div>
        {message !== null ? (
          <div className={styles.none}>
            {loading ? <Spinner size="sm" decorative /> : null}
            <span>{message}</span>
          </div>
        ) : null}
      </div>
    </FloatingPortal>
  )
}
