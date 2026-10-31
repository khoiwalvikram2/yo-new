import type { RefObject } from 'react'
import { FilterChips as KitFilterChips } from '@/ui/components/FilterChips'

export interface FilterChip {
  key: string
  label: string
  value: string | number
  onRemove: () => void
}

export interface FilterChipsProps {
  chips: FilterChip[]
  onClearAll: () => void
  /** BEYOND the legacy props: where focus goes when the last chip is removed (the kit's fallback). */
  fallbackFocusRef?: RefObject<HTMLElement | null>
}

/**
 * The drill-down reports' active-filter strip. A thin adapter: the kit FilterChips already draws the
 * legacy anatomy ("Active", one pill per filter, "Clear all" from two chips up, nothing when empty);
 * this keeps the legacy props, where every chip has a value and Clear All is required.
 */
export function FilterChips({ chips, onClearAll, fallbackFocusRef }: FilterChipsProps) {
  return <KitFilterChips chips={chips} onClearAll={onClearAll} fallbackFocusRef={fallbackFocusRef} />
}
