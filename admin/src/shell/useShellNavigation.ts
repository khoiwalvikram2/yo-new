/**
 * The shell's navigation source (contracts §8.12). It calls the two existing utilities with exactly the
 * inputs Sidebar.tsx:32-50 passes today, so roles, permissions, whitelabel/core mode and agent schemes behave
 * as they do in the old sidebar. toShellSections then turns their output into ordered sections for the rail,
 * the panel and the Pages search.
 */
import { useMemo } from 'react'
import { navigationData } from '@/components/sidebar/navigationData'
import { useAuthStore } from '@/shared/core/authStore'
import { getAgentNavigation, getNavigationForUser, type AgentAccount } from '@/shared/core/navigationUtils'
import { useUIStore } from '@/shared/core/uiStore'
import { toShellSections } from './panelRows'
import type { ShellSection } from './shellTypes'

/** Same inputs as Sidebar.tsx:31-50; recomputes on directorMode; identity stable while inputs are unchanged. */
export function useShellNavigation(): readonly ShellSection[] {
  const isAgent = useAuthStore((s) => s.isAgent())
  const agent = useAuthStore((s) => s.agent)
  const permissions = useAuthStore((s) => s.permissions)
  const roles = useAuthStore((s) => s.roles)
  const directorMode = useUIStore((s) => s.directorMode)

  return useMemo(() => {
    // getNavigationForUser reads directorMode itself through useUIStore.getState() (navigationUtils.ts:516).
    // Reading it here makes it a real dependency of this memo: no counter state and no lint suppression.
    // DO NOT DELETE: removing this line lets exhaustive-deps flag directorMode as unused, inviting its
    // removal from the deps array below too — which would silently stop navigation from updating when a
    // Super Admin toggles core/whitelabel mode. Covered by the "recomputes when directorMode changes" test.
    void directorMode
    if (isAgent && agent) {
      return toShellSections(getAgentNavigation(agent as AgentAccount, agent.allowedDomains))
    }
    return toShellSections(getNavigationForUser(navigationData, permissions, roles))
  }, [isAgent, agent, permissions, roles, directorMode])
}
