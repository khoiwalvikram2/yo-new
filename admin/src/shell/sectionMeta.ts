import type { TablerIcon } from '@tabler/icons-react'
import {
  IconChartBar,
  IconCube,
  IconGift,
  IconPoint,
  IconSettings,
  IconStack2,
  IconUsers,
  IconWallet,
} from '@tabler/icons-react'

export interface SectionMeta {
  title: string
  subtitle: string | null
  icon: TablerIcon
}

/**
 * Spec "Sections — sectionMeta.ts" table, verbatim.
 * @internal Read only via `sectionMetaFor()`. Direct indexing (`SECTION_META[key]`) skips the
 * `Object.hasOwn` guard and can return an inherited `Object.prototype` value (e.g. `constructor`)
 * for a key not actually in this table.
 */
export const SECTION_META: Readonly<Record<string, SectionMeta>> = {
  overview: { title: 'Analytics', subtitle: 'Understand your business', icon: IconChartBar },
  trading: { title: 'Trading', subtitle: 'Overview, markets and bets', icon: IconCube },
  userManagement: { title: 'Users', subtitle: 'Players and agents', icon: IconUsers },
  marketing: { title: 'Marketing', subtitle: 'Bonuses, referrals and VIP', icon: IconGift },
  finance: { title: 'Finance', subtitle: 'Money in and money out', icon: IconWallet },
  reporting: { title: 'Reporting', subtitle: 'Numbers you can export', icon: IconStack2 },
  system: { title: 'System', subtitle: 'Access and configuration', icon: IconSettings },
}

/** A key not in the table uses the section's own label, no subtitle and IconPoint. */
export function sectionMetaFor(key: string, fallbackLabel: string): SectionMeta {
  return Object.hasOwn(SECTION_META, key)
    ? SECTION_META[key]
    : { title: fallbackLabel, subtitle: null, icon: IconPoint }
}
