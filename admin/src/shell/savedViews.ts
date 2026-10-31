import type { ShellRow, ShellSection } from './shellTypes'
import { normalizePath } from './paths'

export const SAVED_VIEWS_LIMIT_MESSAGE = 'Maximum 7 saved views. Remove one to add more.'

/**
 * Resolves favourited paths to the rows the current user can still see, in the order they were saved.
 * Matching is on the exact normalised `to`; a favourite with no matching row (the user lost access, or the
 * navigation changed) is silently dropped. When more than one row shares a normalised `to`, the first one
 * found (section order, then row order) wins.
 */
export function resolveSavedViews(
  favorites: readonly string[],
  sections: readonly ShellSection[],
): ShellRow[] {
  const byPath = new Map<string, ShellRow>()
  for (const section of sections) {
    for (const row of section.rows) {
      const key = normalizePath(row.to)
      if (!byPath.has(key)) {
        byPath.set(key, row)
      }
    }
  }

  const result: ShellRow[] = []
  for (const favorite of favorites) {
    const row = byPath.get(normalizePath(favorite))
    if (row) {
      result.push(row)
    }
  }
  return result
}
