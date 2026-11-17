import type { TablerIcon } from '@tabler/icons-react'
import type { NavItem, NavigationSection } from '@/components/sidebar/navigationData'
import { navIcon } from './navIcons'
import { normalizePath } from './paths'
import { sectionMetaFor } from './sectionMeta'
import type { ShellBadgeKey, ShellEntry, ShellRow, ShellRowEntry, ShellSection } from './shellTypes'

/** Same list NavItem.badgeKey is guarded against (keyof BadgeCounts, badgeService.ts). */
export const SHELL_BADGE_KEYS: readonly ShellBadgeKey[] = [
  'deposits',
  'withdrawals',
  'payments',
  'sportsEvents',
  'matkaDraws',
  'agentRequests',
  'alerts',
]

export function isShellBadgeKey(value: unknown): value is ShellBadgeKey {
  return typeof value === 'string' && (SHELL_BADGE_KEYS as readonly string[]).includes(value)
}

function keywordList(label: string, ...sources: ReadonlyArray<readonly string[] | string | undefined>): string[] {
  const own = label.trim().toLowerCase()
  const out: string[] = []
  for (const source of sources) {
    if (source === undefined) continue
    for (const raw of typeof source === 'string' ? [source] : source) {
      const keyword = raw.trim().toLowerCase()
      if (keyword && keyword !== own && !out.includes(keyword)) out.push(keyword)
    }
  }
  return out
}

function buildRow(
  sectionKey: string,
  sectionTitle: string,
  sourceKey: string,
  to: string,
  label: string,
  icon: TablerIcon,
  keywords: readonly string[],
  badgeKey: ShellBadgeKey | null,
): ShellRow {
  return {
    id: `${sectionKey}|${sourceKey}|${to}`,
    sectionKey,
    sectionTitle,
    to,
    label,
    icon,
    keywords,
    badgeKey,
  }
}

const rowEntry = (row: ShellRow): ShellRowEntry => ({ kind: 'row', row })

function itemEntry(sectionKey: string, sectionTitle: string, item: NavItem): ShellEntry {
  const sourceKey = item.key || item.to
  const badgeKey = isShellBadgeKey(item.badgeKey) ? item.badgeKey : null
  const children = item.children ?? []

  // No children, or children: [] (possible after permission filtering): a plain row to item.to.
  if (children.length === 0) {
    return rowEntry(
      buildRow(
        sectionKey,
        sectionTitle,
        sourceKey,
        item.to,
        item.label,
        navIcon(item.icon),
        keywordList(item.label, item.keywords),
        badgeKey,
      ),
    )
  }

  // Exactly one child: only that child's row. The heading disappears, so the row inherits the item's
  // label and keywords for search, and the item's badge, and shows the child's standalone label when the
  // child has one (a "Management" row with no Matka heading read as part of the Casino group above it).
  if (children.length === 1) {
    const child = children[0]
    const label = child.standaloneLabel ?? child.label
    return rowEntry(
      buildRow(
        sectionKey,
        sectionTitle,
        sourceKey,
        child.to,
        label,
        navIcon(child.icon),
        keywordList(label, child.keywords, item.label, item.keywords),
        badgeKey,
      ),
    )
  }

  // >= 2 children: heading + one row per child. The child that is the item's own landing page
  // (normalised child.to === normalised item.to) inherits the item's label and keywords.
  const landingIndex = children.findIndex((child) => normalizePath(child.to) === normalizePath(item.to))
  return {
    kind: 'group',
    id: `${sectionKey}|${sourceKey}`,
    label: item.label,
    badgeKey,
    rows: children.map((child, index) =>
      buildRow(
        sectionKey,
        sectionTitle,
        sourceKey,
        child.to,
        child.label,
        navIcon(child.icon),
        index === landingIndex
          ? keywordList(child.label, child.keywords, item.label, item.keywords)
          : keywordList(child.label, child.keywords),
        null,
      ),
    ),
  }
}

/** Group headings and rows for one section (S "panelRows"; R8 §2.1 mapping table). */
export function panelRows(sectionKey: string, section: NavigationSection): ShellEntry[] {
  const sectionTitle = sectionMetaFor(sectionKey, section.label).title

  if ('isSpecial' in section && section.isSpecial) {
    // Special dashboard sections contain one real destination.
    if (section.to === '/overview') {
      return [
        rowEntry(
          buildRow(
            sectionKey,
            sectionTitle,
            sectionKey,
            section.to,
            'Overview',
            navIcon(section.icon),
            keywordList('Overview', section.label),
            null,
          ),
        ),
      ]
    }
    // Agents' overview (to '/agent') and any other special: just its real link with the data label.
    return [
      rowEntry(
        buildRow(
          sectionKey,
          sectionTitle,
          sectionKey,
          section.to,
          section.label,
          navIcon(section.icon),
          keywordList(section.label),
          null,
        ),
      ),
    ]
  }

  if ('items' in section) {
    return section.items.map((item) => itemEntry(sectionKey, sectionTitle, item))
  }

  return []
}

/**
 * The ordered sections the rail, the panel and the Pages search read (S "Sections").
 * - Order is the Record's insertion order: role priority for admins, getAgentNavigation's order for agents.
 * - A section with no rows is dropped (NavigationSection.tsx:57-59): a CREDIT agent's marketing has items: [].
 * - title, subtitle and icon come from sectionMetaFor(key, section.label).
 * - badgeKey (the rail badge) is the first non-null badgeKey among the entries, wherever panelRows put it
 *   (group heading or single row, decision 5): admin finance → 'payments', agents → null.
 * Pure: reads no store and never mutates its input.
 */
export function toShellSections(navigation: Readonly<Record<string, NavigationSection>>): ShellSection[] {
  const sections: ShellSection[] = []
  for (const [key, section] of Object.entries(navigation)) {
    const entries = panelRows(key, section)
    const rows = entries.flatMap((entry) => (entry.kind === 'row' ? [entry.row] : entry.rows))
    if (rows.length === 0) continue
    const badgeKey =
      entries
        .map((entry) => (entry.kind === 'row' ? entry.row.badgeKey : entry.badgeKey))
        .find((candidate) => candidate !== null) ?? null
    const meta = sectionMetaFor(key, section.label)
    sections.push({ key, title: meta.title, subtitle: meta.subtitle, icon: meta.icon, badgeKey, entries, rows })
  }
  return mergeOverviewIntoTrading(sections)
}

/** The dashboard section the rail folds into Trading (the owner, 2026-10-21: one button for both). */
export const MERGED_INTO_TRADING = 'overview'

/**
 * The dashboard section holds a single row (Overview, or an agent's Dashboard), so it does not get a rail
 * button of its own: its rows open the Trading panel, at its top, and Trading takes the dashboard's place
 * first in the rail. Without a visible Trading section the dashboard keeps its own button.
 */
export function mergeOverviewIntoTrading(sections: readonly ShellSection[]): ShellSection[] {
  const overview = sections.find((section) => section.key === MERGED_INTO_TRADING)
  const trading = sections.find((section) => section.key === 'trading')
  if (!overview || !trading) return [...sections]
  // ids keep their unique `${sectionKey}|…` shape under the section the rows now live in; the page itself
  // keeps its own eyebrow (the dashboard still reads "Analytics", not "Trading")
  const moved = (row: ShellRow): ShellRow => ({ ...row, id: `${trading.key}|${row.id}`, sectionKey: trading.key, sectionTitle: trading.title, eyebrow: overview.title })
  const overviewEntries: ShellEntry[] = overview.entries.map((entry) =>
    entry.kind === 'row' ? { kind: 'row', row: moved(entry.row) } : { ...entry, id: `${trading.key}|${entry.id}`, rows: entry.rows.map(moved) },
  )
  const merged: ShellSection = {
    ...trading,
    badgeKey: overview.badgeKey ?? trading.badgeKey,
    entries: [...overviewEntries, ...trading.entries],
    rows: [...overviewEntries.flatMap((entry) => (entry.kind === 'row' ? [entry.row] : entry.rows)), ...trading.rows],
  }
  return sections.flatMap((section) => (section === overview ? [merged] : section === trading ? [] : [section]))
}

