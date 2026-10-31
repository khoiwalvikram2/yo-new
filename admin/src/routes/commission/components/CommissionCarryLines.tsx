import { DescriptionList, type DescriptionListItem } from '@/ui/components/DescriptionList'
import { carryDeductionLabel, commissionCarryLines, type CommissionCarryFigures } from '../commissionOverviewModel'

export interface CommissionCarryLinesProps {
  figures: CommissionCarryFigures | null | undefined
  /** Formats an amount for display (the screen's currency conversion and format). */
  format: (value: number) => string
  /** A range of several weeks: one line with the losses taken off between its weeks, and no "this week" line. */
  multiWeek?: boolean
}

/**
 * Loss carry-forward lines (one week, approach A): "Loss carried from last week −X", the part not recovered
 * (forgiven, never carried again) and "This week's loss (carries to next week) −Y". Renders nothing when there
 * is no loss either way, or on an older backend without the fields.
 */
export function CommissionCarryLines({ figures, format, multiWeek = false }: CommissionCarryLinesProps) {
  const lines = commissionCarryLines(figures)
  if (!lines) return null
  const items: DescriptionListItem[] = multiWeek
    ? (lines.carryApplied > 0 ? [{ key: 'between', term: 'Losses carried between weeks', value: carryDeductionLabel(lines.carryApplied, format) }] : [])
    : [
        ...(lines.carriedLoss > 0 ? [{ key: 'carried', term: 'Loss carried from last week', value: carryDeductionLabel(lines.carriedLoss, format) }] : []),
        ...(lines.forgiven > 0 ? [{ key: 'forgiven', term: 'Not recovered (forgiven)', value: format(lines.forgiven) }] : []),
        ...(lines.lossThisCycle > 0 ? [{ key: 'thisWeek', term: "This week's loss (carries to next week)", value: carryDeductionLabel(lines.lossThisCycle, format) }] : []),
      ]
  if (items.length === 0) return null
  return <DescriptionList aria-label="Loss carry-forward" items={items} />
}
