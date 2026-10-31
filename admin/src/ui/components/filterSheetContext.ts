import { createContext, useContext } from 'react'

/**
 * True inside the FilterBar's folded Filters sheet. A filter control can lay itself out for the sheet there
 * (ReportingPeriodFilter shows its choices outright instead of a pill that opens a second panel), since the
 * sheet is already the popup and the bar's inline labels do not come along.
 */
export const FilterSheetContext = createContext(false)

export function useInFilterSheet(): boolean {
  return useContext(FilterSheetContext)
}
