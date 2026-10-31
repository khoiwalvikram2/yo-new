import type { BreadcrumbItem } from '@/hooks/useBreadcrumbs'

export interface BreadcrumbTrailItem {
  label: string
  /** Link target, or null when the crumb is not clickable. */
  href: string | null
  /** First crumb: rendered with the home glyph. */
  isHome: boolean
  /** Styled as the current page (DynamicBreadcrumb's bold style). Can be true on a crumb that is not the final one. */
  isCurrent: boolean
  /** The final crumb: the only one that gets aria-current="page". */
  isFinal: boolean
}

/**
 * The display rules of shared/ui/DynamicBreadcrumb/DynamicBreadcrumb.tsx:23-54, unchanged:
 *  - drop a crumb whose label equals the label of the crumb before it in the UNFILTERED list;
 *  - a crumb is current if it is the final filtered crumb or carries isLast;
 *  - it is a link only if it has a path, the path has no ':' and is not the current pathname, and it is not current.
 */
export function toBreadcrumbTrail(items: readonly BreadcrumbItem[], pathname: string): BreadcrumbTrailItem[] {
  const filtered = items.filter((crumb, index) => index === 0 || crumb.label !== items[index - 1].label)
  return filtered.map((crumb, index) => {
    const isFinal = index === filtered.length - 1
    const isCurrent = isFinal || crumb.isLast === true
    const path = crumb.path
    const href =
      path !== undefined && path !== '' && !path.includes(':') && path !== pathname && !isCurrent ? path : null
    return {
      label: crumb.label,
      href,
      isHome: index === 0,
      isCurrent,
      isFinal,
    }
  })
}
