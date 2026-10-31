/**
 * GlobalSearch "Pages" group items (decision 10; contracts §8.13). A page result is a panel row shown in the
 * existing search list: the row's destination is both its id and its route, and its section title is the
 * subtitle. Entity results are untouched.
 */
import type { SearchResult } from '@/hooks/useGlobalSearch'
import type { ShellRow } from './shellTypes'

/** Font Awesome name; SearchResultItem draws the icon from typeConfig.page, which uses the same name. */
export const PAGE_RESULT_ICON = 'fa-file-lines'

/** Pure: ShellRow → SearchResult { type: 'page', id: to, label, subtitle: sectionTitle, route: to, icon: PAGE_RESULT_ICON } */
export function toPageSearchResults(rows: readonly ShellRow[]): SearchResult[] {
  return rows.map(
    (row): SearchResult => ({
      type: 'page',
      id: row.to,
      label: row.label,
      subtitle: row.sectionTitle,
      route: row.to,
      icon: PAGE_RESULT_ICON,
    }),
  )
}
