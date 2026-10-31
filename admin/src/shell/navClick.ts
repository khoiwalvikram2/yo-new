/**
 * Leaving /sports/event/* does a full load (old NavItem.tsx:61-68). Returns true when it handled the click.
 * `assign` is injectable for tests; defaults to (url) => window.location.assign(url).
 */
export function hardNavigateIfLeavingSportsEvent(
  event: Pick<MouseEvent, 'preventDefault'>,
  currentPath: string,
  to: string,
  assign: (url: string) => void = (url) => window.location.assign(url),
): boolean {
  if (currentPath.startsWith('/sports/event/') && currentPath !== to) {
    event.preventDefault()
    assign(to)
    return true
  }
  return false
}
