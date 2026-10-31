import { useEffect, useId, useState } from 'react'
import clsx from 'clsx'
import { Button } from './Button'
import { DateField } from './DateField'
import { isDayString } from './istDate'
import styles from './DateRangePanel.module.css'

/* The period panel: preset chips, a custom range when Custom is chosen, then Apply and Reset.
 *
 * It stages: nothing reaches the page until Apply, and closing the panel throws the staging away — a
 * host popover unmounts it. Apply cannot be pressed while a custom range is missing a date or ends
 * before it starts, and it says why, because a button that looks pressable and does nothing was the
 * defect this panel shipped with on the dashboard.
 *
 * Days are `yyyy-MM-dd` strings throughout (`istDate.ts` turns them into instants), so the panel needs
 * no date library of its own.
 *
 * The two custom fields share one range calendar: opened from Start it picks the start and stays open for
 * the end, opened from End it picks the end, and an end picked before the start swaps the two. A pick
 * stages Custom, like typing a date does, and still applies nothing until Apply. */

export interface DateRangePreset {
  value: string
  label: string
}

export type DateRangeApply =
  | { kind: 'preset'; preset: string }
  | { kind: 'custom'; from: string; to: string }

export interface DateRangePanelProps {
  presets: readonly DateRangePreset[]
  /** The preset in force, or `customValue` while a custom range is applied. */
  appliedPreset: string
  /** The applied range, as IST days; used to seed the custom fields. */
  appliedFrom?: string
  appliedTo?: string
  /** The preset value that means "a custom range". @default 'custom' */
  customValue?: string
  onApply: (payload: DateRangeApply) => void
  onReset: () => void
  /** Called after an Apply that applied something, and after Reset, so a host popover can close. */
  onDone?: () => void
  /** Bounds for the custom fields, as IST days. */
  min?: string
  max?: string
  className?: string
}

export function DateRangePanel({
  presets,
  appliedPreset,
  appliedFrom,
  appliedTo,
  customValue = 'custom',
  onApply,
  onReset,
  onDone,
  min,
  max,
  className,
}: DateRangePanelProps) {
  const [staged, setStaged] = useState(appliedPreset)
  const [from, setFrom] = useState(appliedFrom && isDayString(appliedFrom) ? appliedFrom : '')
  const [to, setTo] = useState(appliedTo && isDayString(appliedTo) ? appliedTo : '')
  const blockedId = useId()

  /* The applied period can change under the panel — the header's own segmented control writes it too —
     so the staging follows it. */
  useEffect(() => {
    setStaged(appliedPreset)
  }, [appliedPreset])

  const isCustom = staged === customValue
  const wholeRange = isDayString(from) && isDayString(to) && from <= to
  const blocked = isCustom && !wholeRange
  const blockedReason = !isCustom
    ? undefined
    : !from || !to
      ? 'Pick both dates'
      : from > to
        ? 'The end date is before the start'
        : undefined

  function apply() {
    if (isCustom) {
      if (!wholeRange) return
      onApply({ kind: 'custom', from, to })
    } else {
      onApply({ kind: 'preset', preset: staged })
    }
    onDone?.()
  }

  function pickRange(start: string, end: string) {
    setStaged(customValue)
    setFrom(start)
    setTo(end)
  }

  function reset() {
    onReset()
    setFrom('')
    setTo('')
    onDone?.()
  }

  return (
    <div className={clsx(styles.panel, className)}>
      <div className={styles.presets} role="group" aria-label="Period presets">
        {presets.map((preset) => (
          <button
            key={preset.value}
            type="button"
            className={styles.chip}
            aria-pressed={staged === preset.value}
            onClick={() => {
              setStaged(preset.value)
              if (preset.value === customValue) {
                /* seed the fields from the applied range, so Custom opens on what is in force */
                if (!from && appliedFrom && isDayString(appliedFrom)) setFrom(appliedFrom)
                if (!to && appliedTo && isDayString(appliedTo)) setTo(appliedTo)
              }
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {isCustom ? (
        <div className={styles.custom}>
          <DateField
            label="Start date"
            size="sm"
            value={from}
            onChange={setFrom}
            min={min}
            max={to || max}
            range={{ edge: 'start', start: from, end: to, onChange: pickRange, min, max }}
          />
          <DateField
            label="End date"
            size="sm"
            value={to}
            onChange={setTo}
            min={from || min}
            max={max}
            range={{ edge: 'end', start: from, end: to, onChange: pickRange, min, max }}
          />
        </div>
      ) : null}

      <div className={styles.actions}>
        {blocked && blockedReason ? (
          <span className={styles.blocked} id={blockedId}>
            {blockedReason}
          </span>
        ) : null}
        <Button size="sm" onClick={reset}>
          Reset
        </Button>
        <Button
          variant="primary"
          size="sm"
          aria-disabled={blocked || undefined}
          aria-describedby={blocked ? blockedId : undefined}
          onClick={apply}
        >
          Apply
        </Button>
      </div>
    </div>
  )
}
