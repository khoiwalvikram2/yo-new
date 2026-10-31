import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react'
import { IconFilter, IconX } from '@tabler/icons-react'
import clsx from 'clsx'
import styles from './FilterChips.module.css'

export interface FilterChip {
  key: string
  label: string
  value?: string | number
  onRemove: () => void
  /** Overrides the accessible suffix after "Remove" when label/value are not descriptive enough. */
  removeLabel?: string
}

export interface FilterChipsProps {
  chips: readonly FilterChip[]
  onClearAll?: () => void
  /** Receives focus when removal leaves no chip. Usually the Filters trigger or search field. */
  fallbackFocusRef?: RefObject<HTMLElement | null>
  label?: string
  className?: string
}

type PendingFocus =
  | { kind: 'chip'; removedKey: string; index: number }
  | { kind: 'all' }

function accessibleChipName(chip: FilterChip): string {
  if (chip.removeLabel) return chip.removeLabel
  return chip.value === undefined ? chip.label : `${chip.label}: ${chip.value}`
}

/** Removable active filters. Each pill is the removal button, so keyboard and pointer users share one target. */
export function FilterChips({
  chips,
  onClearAll,
  fallbackFocusRef,
  label = 'Active filters',
  className,
}: FilterChipsProps) {
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>())
  const pendingFocus = useRef<PendingFocus | null>(null)

  useLayoutEffect(() => {
    const pending = pendingFocus.current
    if (!pending) return

    if (pending.kind === 'chip') {
      if (chips.some((chip) => chip.key === pending.removedKey)) return
      pendingFocus.current = null
      const target = chips[pending.index] ?? chips[pending.index - 1]
      if (target) {
        buttonRefs.current.get(target.key)?.focus()
        return
      }
      fallbackFocusRef?.current?.focus()
      return
    }

    if (chips.length > 0) return
    pendingFocus.current = null
    fallbackFocusRef?.current?.focus()
  }, [chips, fallbackFocusRef])

  const removeChip = (chip: FilterChip, index: number) => {
    pendingFocus.current = { kind: 'chip', removedKey: chip.key, index }
    chip.onRemove()
  }

  const removeWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, chip: FilterChip, index: number) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    event.preventDefault()
    removeChip(chip, index)
  }

  if (chips.length === 0) return null

  return (
    <div className={clsx(styles.root, className)} aria-label={label}>
      <span className={styles.title}>
        <IconFilter size={13} stroke={1.75} aria-hidden="true" />
        Active
      </span>
      <span className={styles.divider} aria-hidden="true" />
      <ul className={styles.list}>
        {chips.map((chip, index) => (
          <li key={chip.key} className={styles.item}>
            <button
              ref={(node) => {
                if (node) buttonRefs.current.set(chip.key, node)
                else buttonRefs.current.delete(chip.key)
              }}
              type="button"
              className={styles.chipButton}
              aria-label={`Remove ${accessibleChipName(chip)}`}
              onClick={() => removeChip(chip, index)}
              onKeyDown={(event) => removeWithKeyboard(event, chip, index)}
            >
              <span className={styles.chipLabel}>{chip.label}</span>
              {chip.value !== undefined ? <span className={styles.chipValue}>{chip.value}</span> : null}
              <IconX className={styles.removeIcon} size={13} stroke={1.8} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {onClearAll && chips.length > 1 ? (
        <>
          <span className={styles.divider} aria-hidden="true" />
          <button
            type="button"
            className={styles.clearAll}
            onClick={() => {
              pendingFocus.current = { kind: 'all' }
              onClearAll()
            }}
          >
            Clear all
          </button>
        </>
      ) : null}
    </div>
  )
}
