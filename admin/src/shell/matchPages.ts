import type { ShellRow, ShellSection } from './shellTypes'
import { normalizePath } from './paths'

/** The 2-character threshold for the Pages group in GlobalSearch (decision 10). */
export const PAGE_QUERY_MIN_LENGTH = 2
/** At most 8 Pages results are shown (decision 10). */
export const PAGE_MATCH_LIMIT = 8

/** 0 label starts with · 1 label contains · 2 a keyword starts with · 3 a keyword contains. */
export type PageRank = 0 | 1 | 2 | 3

/** `normalizedQuery` must already be trimmed and lower-cased. */
export function rankPageRow(normalizedQuery: string, row: ShellRow): PageRank | null {
  const label = row.label.toLowerCase()
  if (label.startsWith(normalizedQuery)) return 0
  if (label.includes(normalizedQuery)) return 1
  if (row.keywords.some((keyword) => keyword.startsWith(normalizedQuery))) return 2
  if (row.keywords.some((keyword) => keyword.includes(normalizedQuery))) return 3
  return null
}

/** All rows of every visible section, de-duplicated by normalised `to` (the first row wins). */
export function searchablePageRows(sections: readonly ShellSection[]): ShellRow[] {
  const seen = new Set<string>()
  const result: ShellRow[] = []
  const candidates = sections.flatMap((section) => section.rows)
  for (const row of candidates) {
    const to = normalizePath(row.to)
    if (seen.has(to)) continue
    seen.add(to)
    result.push(row)
  }
  return result
}

/**
 * Ranks `rows` against the query string (label and keywords only), de-duplicates by normalised `to` keeping the first match, sorts
 * by rank then input order, and caps at `limit`.
 */
export function matchPages(query: string, rows: readonly ShellRow[], limit: number = PAGE_MATCH_LIMIT): ShellRow[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery.length < PAGE_QUERY_MIN_LENGTH || limit <= 0) return []

  const seen = new Set<string>()
  const hits: Array<{ row: ShellRow; rank: PageRank; order: number }> = []
  for (const row of rows) {
    const to = normalizePath(row.to)
    if (seen.has(to)) continue
    const rank = rankPageRow(normalizedQuery, row)
    if (rank === null) continue
    seen.add(to)
    hits.push({ row, rank, order: hits.length })
  }

  hits.sort((a, b) => a.rank - b.rank || a.order - b.order)
  return hits.slice(0, limit).map((hit) => hit.row)
}
