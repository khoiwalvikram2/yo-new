import type { ResolvedSection, ShellRow, ShellSection } from './shellTypes'
import { normalizePath, pathMatches } from './paths'

export const SECTION_PREFIX_FALLBACKS: ReadonlyArray<readonly [prefix: string, sectionKey: string]> = [
  ['/sports', 'trading'],
  ['/matka', 'trading'],
  ['/config', 'system'],
  ['/reporting', 'reporting'],
]

/** Longest normalised `to` over every row of every section (pathMatches); ties keep the earlier section. */
export function findActiveRow(pathname: string, sections: readonly ShellSection[]): ShellRow | null {
  const path = normalizePath(pathname)
  let best: ShellRow | null = null
  for (const section of sections) {
    for (const row of section.rows) {
      if (!pathMatches(path, row.to)) continue
      if (best === null || normalizePath(row.to).length > normalizePath(best.to).length) {
        best = row
      }
    }
  }
  return best
}

/** First table entry with pathname === prefix || startsWith(prefix + '/') || startsWith(prefix + '-'), whose section is visible. */
export function fallbackSectionKey(pathname: string, sections: readonly ShellSection[]): string | null {
  const path = normalizePath(pathname)
  for (const [prefix, sectionKey] of SECTION_PREFIX_FALLBACKS) {
    const matches = path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '-')
    if (matches && sections.some((section) => section.key === sectionKey)) {
      return sectionKey
    }
  }
  return null
}

/** 1 active row; 2 fallback; 3 previousKey if still visible; 4 first section; { null, null } with no sections. activeTo only from step 1. */
export function resolveSection(
  pathname: string,
  sections: readonly ShellSection[],
  previousKey: string | null,
): ResolvedSection {
  const activeRow = findActiveRow(pathname, sections)
  if (activeRow !== null) {
    return { sectionKey: activeRow.sectionKey, activeTo: activeRow.to }
  }
  const fallback = fallbackSectionKey(pathname, sections)
  if (fallback !== null) {
    return { sectionKey: fallback, activeTo: null }
  }
  if (previousKey !== null && sections.some((section) => section.key === previousKey)) {
    return { sectionKey: previousKey, activeTo: null }
  }
  const first = sections[0] ?? null
  return { sectionKey: first ? first.key : null, activeTo: null }
}
