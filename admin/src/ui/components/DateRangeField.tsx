import { useMemo, useState } from 'react'
import { IconCalendar } from '@tabler/icons-react'
import clsx from 'clsx'
import { Button, type ButtonSize } from './Button'
import {
  DateRangePanel,
  type DateRangePanelProps,
} from './DateRangePanel'
import { Popover } from './Popover'
import { strokeFor } from './icons'
import styles from './DateRangeField.module.css'

export interface DateRangeFieldProps
  extends Omit<DateRangePanelProps, 'className' | 'onDone'> {
  /** Names the trigger and its popover. @default 'Period' */
  label?: string
  /** Visible text for the controlled value. By default it is derived from the preset or custom days. */
  valueLabel?: string
  /** @default 'sm' */
  size?: Extract<ButtonSize, 'sm' | 'md'>
  disabled?: boolean
  className?: string
  panelClassName?: string
}

function derivedValueLabel({
  presets,
  appliedPreset,
  appliedFrom,
  appliedTo,
  customValue = 'custom',
}: Pick<
  DateRangeFieldProps,
  'presets' | 'appliedPreset' | 'appliedFrom' | 'appliedTo' | 'customValue'
>): string {
  if (appliedPreset === customValue && appliedFrom && appliedTo) {
    return `${appliedFrom} – ${appliedTo}`
  }
  return presets.find((preset) => preset.value === appliedPreset)?.label ?? appliedPreset
}

/**
 * Controlled period field. DateRangePanel owns only a temporary draft; the applied preset/range
 * always comes back through props. Closing without Apply therefore discards the draft.
 */
export function DateRangeField({
  label = 'Period',
  valueLabel,
  size = 'sm',
  disabled = false,
  className,
  panelClassName,
  presets,
  appliedPreset,
  appliedFrom,
  appliedTo,
  customValue,
  onApply,
  onReset,
  min,
  max,
}: DateRangeFieldProps) {
  const [open, setOpen] = useState(false)
  const currentLabel = useMemo(
    () => valueLabel ?? derivedValueLabel({ presets, appliedPreset, appliedFrom, appliedTo, customValue }),
    [valueLabel, presets, appliedPreset, appliedFrom, appliedTo, customValue],
  )

  return (
    <span className={clsx(styles.field, className)} data-caption={label}>
      <Popover
        open={open}
        onOpenChange={setOpen}
        placement="bottom-end"
        label={label}
        trigger={
          <Button
            variant="pill"
            size={size}
            disabled={disabled}
            className={styles.trigger}
            icon={<IconCalendar size={16} stroke={strokeFor(16)} />}
            aria-label={`${label}: ${currentLabel}`}
          >
            {currentLabel}
          </Button>
        }
      >
        <DateRangePanel
          presets={presets}
          appliedPreset={appliedPreset}
          appliedFrom={appliedFrom}
          appliedTo={appliedTo}
          customValue={customValue}
          onApply={onApply}
          onReset={onReset}
          onDone={() => setOpen(false)}
          min={min}
          max={max}
          className={clsx(styles.panel, panelClassName)}
        />
      </Popover>
    </span>
  )
}
