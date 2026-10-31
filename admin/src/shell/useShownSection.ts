/**
 * Which section the contextual panel shows (decision 7, contracts §9.2).
 * State is adjusted during render, not in an effect, so a new pathname and its section commit together
 * (R8-shell-navigation-model §5.2).
 */
import { useCallback, useMemo, useState } from 'react'
import { findActiveRow, resolveSection } from './resolveSection'
import type { ShellSection } from './shellTypes'

export interface ShownSection {
  shownKey: string | null
  /** row to mark aria-current="page"; null when step 1 finds nothing */
  activeTo: string | null
  /** rail click: shows that section until the next pathname change */
  showSection: (key: string) => void
}

interface ShownState {
  path: string
  key: string | null
}

export function useShownSection(pathname: string, sections: readonly ShellSection[]): ShownSection {
  const [state, setState] = useState<ShownState>(() => ({
    path: pathname,
    key: resolveSection(pathname, sections, null).sectionKey,
  }))

  let shownKey = state.key
  if (state.path !== pathname) {
    // Navigation: steps 1-4, where step 3 keeps the section shown before it (a rail click included).
    shownKey = resolveSection(pathname, sections, state.key).sectionKey
    setState({ path: pathname, key: shownKey })
  } else {
    // Same path with a new sections array (a directorMode switch): recompute only when the shown section is gone.
    const vanished =
      shownKey === null ? sections.length > 0 : !sections.some((section) => section.key === shownKey)
    if (vanished) {
      shownKey = resolveSection(pathname, sections, null).sectionKey
      setState({ path: pathname, key: shownKey })
    }
  }

  const activeTo = useMemo(() => findActiveRow(pathname, sections)?.to ?? null, [pathname, sections])

  const showSection = useCallback((key: string) => {
    setState((previous) => ({ path: previous.path, key }))
  }, [])

  return { shownKey, activeTo, showSection }
}
