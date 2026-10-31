/** The "All" tab: it scrolls back to the top of the lobby rather than to a row. */
export const ALL_TAB = 'all'

/** One lobby category as the tabs and the rows both know it; `count` is null while unknown. */
export type LobbyCategory = { id: string; name: string; count: number | null; iconData: string | null }

/** Admin category icons arrive as data URLs, http URLs or bare base64 PNG. */
export function categoryIconSrc(iconData: string): string {
  return iconData.startsWith('data:') || iconData.startsWith('http') ? iconData : `data:image/png;base64,${iconData}`
}
