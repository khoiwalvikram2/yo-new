import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'

/**
 * A Super Admin in core mode has no whitelabel selected. The Matka running-markets and Worli session screens
 * act per whitelabel, so admin-backend refuses them in that mode ("Select a whitelabel ..."); the pages show
 * that up front instead of polling a refusal every five seconds and toasting it each time. The role test is
 * the GraphQL link's (shared/core/api.ts), which decides whether X-Admin-Mode is sent at all.
 */
export function isSuperAdminRole(role: string): boolean {
  const lower = (role ?? '').toLowerCase()
  return role === 'Super Admin' || lower === 'super_admin' || (lower.includes('super') && lower.includes('admin'))
}

export function needsWhitelabelSelection(roles: readonly string[] | null | undefined, directorMode: string | null | undefined): boolean {
  return (roles ?? []).some(isSuperAdminRole) && directorMode === 'core'
}

export function useNeedsWhitelabelSelection(): boolean {
  const roles = useAuthStore((state) => state.roles)
  const directorMode = useUIStore((state) => state.directorMode)
  return needsWhitelabelSelection(roles, directorMode)
}

export const SELECT_WHITELABEL_TITLE = 'Select a whitelabel'
export const SELECT_WHITELABEL_HINT = 'Switch to Whitelabel mode in the top bar and choose the site whose Matka markets you want to manage.'
