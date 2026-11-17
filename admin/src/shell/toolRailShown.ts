import { createContext, useContext } from 'react'
import { useBreakpoint } from '@/shared/hooks/useBreakpoint'

/**
 * The kit's right tool rail (Assistant, Alerts, Tasks, Favourites, Exports) shows from 1024px. Below that
 * the shell is a drawer and the tools stay where they were: the topbar bells and the floating Assistant
 * button. (The classic skin, which kept them there at every width, was removed on 2026-11-04.)
 */
export function useToolRailShown(): boolean {
  const { isSmallScreen } = useBreakpoint()
  return !isSmallScreen
}

/** Set by AppShell, so the floating Assistant launcher (an AppShell overlay) steps aside for the rail. */
export const ToolRailShownContext = createContext(false)

export function useToolRailShownContext(): boolean {
  return useContext(ToolRailShownContext)
}
