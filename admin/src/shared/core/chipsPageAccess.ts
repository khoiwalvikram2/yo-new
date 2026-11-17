import { hasPermissionWithNested } from './nestedPermissionMapping'

/**
 * Who can open /credit, the admin's Chips page (CreditManagementPage), in one place: the page and its sidebar link
 * both read it, so everyone the page admits can reach it (T068). It used to show the link only to the exact
 * "Whitelabel Admin" role names, while the page also admitted Finance Manager and Reports Viewer (through
 * credit.management:view), Super Admin in whitelabel mode and any other role named "…whitelabel…".
 */

/** The page's own permission (Finance Manager and Reports Viewer hold it; the flat credit:read grants it too). */
export const CHIPS_PAGE_PERMISSION = { domain: 'credit.management', actions: ['view'] }

/** The role-name test that lets a whitelabel admin onto the page without the permission (that role holds none). */
export function isWhitelabelAdminRole(roles: readonly string[]): boolean {
  return roles.some(role =>
    role === 'Whitelabel Admin' || role.toLowerCase() === 'whitelabel_admin' || role.toLowerCase().includes('whitelabel')
  )
}

/**
 * Whether this admin can open the profile a Chips row's View action links to: an agent's needs agents.list:view
 * and a player's players.profile:view, while a whitelabel admin role opens both. Finance Manager reads the page
 * through credit.management:view alone, so its rows show no View that would open a page it is refused.
 */
export function canOpenChipProfile(
  accountType: string,
  roles: readonly string[],
  permissions: readonly { domain: string; actions: string[] }[] | null | undefined,
): boolean {
  if (isWhitelabelAdminRole(roles)) return true
  const domain = accountType === 'AGENT' ? 'agents.list' : 'players.profile'
  return hasPermissionWithNested([...(permissions ?? [])], domain, 'view')
}

/** True when the page lets this admin in: a whitelabel admin by role, anyone else by credit.management:view. */
export function canOpenChipsPage(
  roles: readonly string[],
  permissions: readonly { domain: string; actions: string[] }[] | null | undefined,
): boolean {
  return isWhitelabelAdminRole(roles) || hasPermissionWithNested([...(permissions ?? [])], 'credit.management', 'view')
}
