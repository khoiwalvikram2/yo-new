import { createContext, useContext } from 'react'
import { useBreakpoint } from '@/shared/hooks/useBreakpoint'

/** The player skin is on unless index.html set <html data-skin="classic"> (from localStorage 'admin-skin',
 *  read once at load, so a render can read it). */
function isClassicSkin() {
  return typeof document !== 'undefined' && document.documentElement.dataset.skin === 'classic'
}

/**
 * The kit's right tool rail (Assistant, Alerts, Tasks, Favourites, Exports) shows from 1024px under the
 * player skin. Below that the shell is a drawer and the tools stay where they were: the topbar bells and
 * the floating Assistant button. The classic skin keeps them there at every width.
 */
export function useToolRailShown(): boolean {
  const { isSmallScreen } = useBreakpoint()
  return !isSmallScreen && !isClassicSkin()
}

/** Set by AppShell, so the floating Assistant launcher (an AppShell overlay) steps aside for the rail. */
export const ToolRailShownContext = createContext(false)

export function useToolRailShownContext(): boolean {
  return useContext(ToolRailShownContext)
}
