import type { TablerIcon } from '@tabler/icons-react'
import type { BadgeCounts } from '@/shared/services/badgeService'

export type ShellBadgeKey = keyof BadgeCounts

/** One navigable link in the panel, and one Pages search entry. */
export interface ShellRow {
  /** Unique: `${sectionKey}|${sourceKey}|${to}` */
  id: string
  sectionKey: string
  /** sectionMeta title of the row's section */
  sectionTitle: string
  to: string
  label: string
  icon: TablerIcon
  /** lower-cased, de-duplicated, never the row's own label */
  keywords: readonly string[]
  /** set only where the item's badge sits (decision 5) */
  badgeKey: ShellBadgeKey | null
  /** The page's own eyebrow when the row opens in another section's panel (the Overview, inside Trading). */
  eyebrow?: string
}
export interface ShellRowEntry { kind: 'row'; row: ShellRow }
export interface ShellGroupEntry {
  kind: 'group'
  /** `${sectionKey}|${sourceKey}` */
  id: string
  label: string
  badgeKey: ShellBadgeKey | null
  rows: readonly ShellRow[]     // length >= 2
}
export type ShellEntry = ShellRowEntry | ShellGroupEntry
export interface ShellSection {
  key: string
  title: string
  subtitle: string | null
  icon: TablerIcon
  /** rail badge: first non-null badgeKey among its entries */
  badgeKey: ShellBadgeKey | null
  entries: readonly ShellEntry[]
  /** entries flattened in display order; never empty */
  rows: readonly ShellRow[]
}
export interface ResolvedSection { sectionKey: string | null; activeTo: string | null }
