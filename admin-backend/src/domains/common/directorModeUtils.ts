import { hasSuperAdminRoleName } from '@src/domains/common/roleNames.js'

/**
 * Super Admin Mode Utilities
 * 
 * CRITICAL: These functions ONLY affect Super Admin. Whitelabel Admin and Agents
 * use existing tenant logic and are NOT affected by these functions.
 */

/**
 * Get effective tenant for Super Admin based on mode
 * 
 * @param ctx - GraphQL context
 * @returns null if not Super Admin or in core mode (skip tenant filtering)
 * @returns whitelabel ID if Super Admin in whitelabel mode
 * @returns null for all other roles (they use existing ctx.tenant logic)
 */
export function getEffectiveTenantForDirector(ctx: any): string | null {
  // CRITICAL: Only process Super Admin - all other roles use existing logic
  const isSuperAdmin = hasSuperAdminRoleName(ctx?.user?.roles)
  
  if (!isSuperAdmin) {
    // Not Super Admin - return null to use existing tenant logic
    // This ensures Whitelabel Admin and Agents are unaffected
    return null
  }
  
  const mode = ctx?.directorMode
  if (mode === 'core') {
    return null // No tenant filtering for core mode
  }
  if (mode === 'whitelabel' && ctx?.directorWhitelabelId) {
    return ctx.directorWhitelabelId
  }
  
  // Default: use existing tenant logic (backward compatibility)
  return null
}

/**
 * Check if tenant filtering should be skipped for Super Admin in core mode
 * 
 * @param ctx - GraphQL context
 * @returns true if Super Admin in core mode (skip filtering), false otherwise
 */
export function shouldSkipTenantFiltering(ctx: any): boolean {
  const isSuperAdmin = hasSuperAdminRoleName(ctx?.user?.roles)
  
  if (!isSuperAdmin) {
    return false // Always filter for non-Super Admin users
  }
  
  return ctx?.directorMode === 'core'
}

/**
 * Get effective tenant for queries (handles Super Admin mode)
 * 
 * @param ctx - GraphQL context
 * @param defaultTenant - Default tenant to use if not Super Admin or in whitelabel mode
 * @returns tenant ID to use for filtering, or null to skip filtering
 */
export function getEffectiveTenant(ctx: any, defaultTenant?: string): string | null {
  const directorTenant = getEffectiveTenantForDirector(ctx)
  
  if (directorTenant !== null) {
    // Super Admin mode is active
    return directorTenant
  }
  
  // Use existing tenant logic for all other roles
  const existingTenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? defaultTenant ?? 'default'
  return existingTenant
}
