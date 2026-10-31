/** Which route renders on the kit and follows the theme toggle, and which one is forced light.
 *
 * A migrated route says so on itself: its route object in `app/router/index.tsx` carries
 * `handle: { migrated: true }`, and page migration (C) adds that line as the last edit of the page's
 * own task. This replaced a list of path prefixes, which could not express 26 of the 100 page paths:
 * '/agents' would have flipped '/agents/:id' with it, and '/matka/:id' could only be written as
 * '/matka', which covers every matka page. The prefixes also left the dashboard forced light at '/'
 * while it followed the theme at '/overview', although the same component is mounted at both.
 *
 * Only the LEAF match counts, so a layout route can never mark the pages inside it. */
import { useMatches } from 'react-router-dom'

/** The shape a route's `handle` needs for this module to treat it as migrated. */
export interface MigratedRouteHandle {
  migrated?: boolean
}

/** The part of a react-router match this module reads. */
interface HandleMatch {
  handle?: unknown
}

/** True when the last (leaf) match carries `handle: { migrated: true }`. */
export function isMigratedMatch(matches: readonly HandleMatch[]): boolean {
  const leaf = matches.length > 0 ? matches[matches.length - 1] : undefined
  const handle = leaf?.handle as MigratedRouteHandle | undefined
  return handle?.migrated === true
}

/** `isMigratedMatch` over the current route's matches. Only valid inside the router. */
export function useIsMigratedRoute(): boolean {
  return isMigratedMatch(useMatches())
}
