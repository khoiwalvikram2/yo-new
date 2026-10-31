import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'

/**
 * The Export Center's whitelabel-context rule: the page opens for an agent, for a Whitelabel
 * Admin, and for a Super Admin only while the director switch is on 'whitelabel'. Everyone else
 * gets its "only available in Whitelabel view" screen.
 *
 * Lifted out of ExportCenterWhitelabelGuard (ExportsPage.tsx) unchanged, so that anything linking
 * to /reporting/exports (the dashboard's reports banner) asks the page's own question and the two
 * cannot disagree. Do not import ExportsPage for this: it is a large lazy chunk.
 *
 * This is ONLY the context rule. The page's permission gate is separate (RBACGuard on
 * reporting.exports:view, bypassed for agents), so a caller that must match the page checks both.
 *
 * The role tests are the guard's own, loose ones included: any role whose name contains
 * "whitelabel" counts as a Whitelabel Admin, and any containing both "super" and "admin" counts
 * as a Super Admin. A Director is not a Super Admin here unless its role name says so. Tightening
 * or widening a test here changes who can open the Export Center.
 */
export interface ExportCenterContextInput {
  roles: readonly string[]
  directorMode: 'core' | 'whitelabel'
  isAgent: boolean
}

export function canAccessExportCenterContext({ roles, directorMode, isAgent }: ExportCenterContextInput): boolean {
  const isWhitelabelAdmin = roles.some(
    (r) => r === 'Whitelabel Admin' || r.toLowerCase() === 'whitelabel_admin' || r.toLowerCase().includes('whitelabel')
  )
  const isSuperAdmin = roles.some(
    (r) => r === 'Super Admin' || r.toLowerCase() === 'super_admin' || (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
  )
  return isAgent || isWhitelabelAdmin || (isSuperAdmin && directorMode === 'whitelabel')
}

/* A stable empty list: a selector that returned a fresh [] would hand zustand a new value on every
   read. The guard used `s.roles || []`; defaulting outside the selector gives the same roles. */
const NO_ROLES: readonly string[] = []

/** canAccessExportCenterContext for the signed-in session, read from the same stores the guard read. */
export function useCanAccessExportCenterContext(): boolean {
  const roles = useAuthStore((s) => s.roles) || NO_ROLES
  const directorMode = useUIStore((s) => s.directorMode)
  const isAgent = useAuthStore((s) => s.isAgent())
  return canAccessExportCenterContext({ roles, directorMode, isAgent })
}
