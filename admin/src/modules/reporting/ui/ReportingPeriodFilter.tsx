import { useEffect, useId, useState } from 'react'
import clsx from 'clsx'
import { Button } from '@/ui/components/Button'
import { DateField } from '@/ui/components/DateField'
import { DateRangeField } from '@/ui/components/DateRangeField'
import type { DateRangeApply } from '@/ui/components/DateRangePanel'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { useInFilterSheet } from '@/ui/components/filterSheetContext'
import { isDayString } from '@/ui/components/istDate'
import {
  REPORTING_DATE_PRESET_OPTIONS,
  REPORTING_QUICK_PRESET_OPTIONS,
  computeReportingCustomRange,
  isReportingDatePreset,
  reportingPeriodLabel,
  reportingPresetPeriod,
  type ReportingDateFilterProps,
  type ReportingDatePreset,
  type ReportingPeriod,
} from '../reportingDateFilter'
import styles from './ReportingPeriodFilter.module.css'

export interface ReportingPeriodFilterProps extends ReportingDateFilterProps {
  /** `sm` for a filter row or card head, `md` beside a page title. @default 'sm' */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * The reports' period control on the kit, replacing ReportingDateFilter and ReportingDateFilterMobile
 * with the same props: `dateFrom`, `dateTo` (IST `yyyy-MM-dd` days), `preset`, and
 * `onChange(dateFrom, dateTo, preset)`.
 *
 * In a filter row it is the mockup's period control (M:1737-1746): a pill stating the applied range, which
 * opens the kit period panel (every preset, and two date fields for Custom), followed by the presets that
 * apply in one press. Both write through `onChange`, so they never disagree; a custom range leaves every
 * preset button unpressed. `preset` is controlled when given, as before; without it the control keeps
 * its own, starting on All time.
 *
 * Inside the FilterBar's folded Filters sheet the sheet is already the popup, so the choices show at once:
 * All time, Today, Yesterday and Custom; the first three apply in one press, Custom opens its two dates and
 * an Apply under them (PeriodSheet).
 */
export function ReportingPeriodFilter({
  dateFrom,
  dateTo,
  preset,
  onChange,
  size = 'sm',
  className,
}: ReportingPeriodFilterProps) {
  const inSheet = useInFilterSheet()
  const [ownPreset, setOwnPreset] = useState<ReportingDatePreset>(preset ?? 'allTime')
  const applied = preset ?? ownPreset

  /* Custom opens on the applied range while one is in force, otherwise on the range the legacy
     filter applied when Custom was chosen: the last 30 days through today. */
  const customSeed = applied === 'custom' ? { dateFrom, dateTo } : computeReportingCustomRange()

  const choose = (next: ReportingPeriod) => {
    setOwnPreset(next.preset)
    onChange(next.dateFrom, next.dateTo, next.preset)
  }

  if (inSheet) {
    return <PeriodSheet applied={applied} dateFrom={dateFrom} dateTo={dateTo} seed={customSeed} choose={choose} className={className} />
  }

  const applyFromPanel = (payload: DateRangeApply) => {
    if (payload.kind === 'custom') {
      choose({ dateFrom: payload.from, dateTo: payload.to, preset: 'custom' })
      return
    }
    if (isReportingDatePreset(payload.preset)) choose(reportingPresetPeriod(payload.preset))
  }

  return (
    <div className={clsx(styles.filter, className)}>
      <DateRangeField
        className={styles.pill}
        label="Period"
        size={size}
        presets={REPORTING_DATE_PRESET_OPTIONS}
        appliedPreset={applied}
        appliedFrom={customSeed.dateFrom}
        appliedTo={customSeed.dateTo}
        customValue="custom"
        valueLabel={reportingPeriodLabel({ preset: applied, dateFrom, dateTo })}
        onApply={applyFromPanel}
        onReset={() => choose(reportingPresetPeriod('allTime'))}
      />
      <SegmentedControl<ReportingDatePreset>
        className={styles.presets}
        label="Period"
        size={size}
        value={applied}
        options={REPORTING_QUICK_PRESET_OPTIONS}
        onChange={(value) => choose(reportingPresetPeriod(value))}
      />
    </div>
  )
}

interface PeriodSheetProps {
  applied: ReportingDatePreset
  dateFrom: string
  dateTo: string
  /** where Custom's two dates start */
  seed: { dateFrom: string; dateTo: string }
  choose: (next: ReportingPeriod) => void
  className?: string
}

/** The period choices laid out for the Filters sheet. */
function PeriodSheet({ applied, dateFrom, dateTo, seed, choose, className }: PeriodSheetProps) {
  const blockedId = useId()
  // Custom is chosen here before it applies anything, so the sheet keeps which choice is showing.
  const [shown, setShown] = useState<ReportingDatePreset>(applied)
  const [from, setFrom] = useState(seed.dateFrom)
  const [to, setTo] = useState(seed.dateTo)
  useEffect(() => { setShown(applied) }, [applied])

  const wholeRange = isDayString(from) && isDayString(to) && from <= to
  const blockedReason = !from || !to ? 'Pick both dates' : from > to ? 'The end date is before the start' : undefined
  const inForce = applied === 'custom' && from === dateFrom && to === dateTo

  const pick = (value: ReportingDatePreset) => {
    setShown(value)
    if (value !== 'custom') choose(reportingPresetPeriod(value))
  }
  const pickRange = (start: string, end: string) => { setFrom(start); setTo(end) }
  const applyRange = () => {
    if (wholeRange && !inForce) choose({ dateFrom: from, dateTo: to, preset: 'custom' })
  }

  return (
    <div className={clsx(styles.sheet, className)}>
      {/* the caption is for the eye; the choices below are the group named Period */}
      <span className={styles.caption} aria-hidden="true">Period</span>
      <SegmentedControl<ReportingDatePreset>
        className={styles.sheetChoices}
        label="Period"
        size="sm"
        value={shown}
        options={REPORTING_DATE_PRESET_OPTIONS}
        onChange={pick}
      />
      {shown === 'custom' ? (
        <div className={styles.sheetCustom}>
          <div className={styles.sheetDates}>
            <DateField label="Start date" size="sm" value={from} onChange={setFrom} max={to || undefined}
              range={{ edge: 'start', start: from, end: to, onChange: pickRange }} />
            <DateField label="End date" size="sm" value={to} onChange={setTo} min={from || undefined}
              range={{ edge: 'end', start: from, end: to, onChange: pickRange }} />
          </div>
          <div className={styles.sheetApply}>
            {blockedReason ? <span className={styles.blocked} id={blockedId}>{blockedReason}</span> : null}
            <Button size="sm" variant={inForce ? 'secondary' : 'primary'} aria-disabled={!wholeRange || inForce || undefined}
              aria-describedby={blockedReason ? blockedId : undefined} onClick={applyRange}>
              {inForce ? 'Range applied' : 'Apply range'}
            </Button>
          </div>
        </div>
      ) : null}
      <p className={styles.sheetNow} aria-live="polite">
        Showing <b>{reportingPeriodLabel({ preset: applied, dateFrom, dateTo })}</b>
      </p>
    </div>
  )
}
