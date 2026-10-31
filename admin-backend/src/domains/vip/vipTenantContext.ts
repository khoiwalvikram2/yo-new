import { getEffectiveTenant } from '@src/domains/common/directorModeUtils.js'

/** Tenant scope for VIP tiers/members: always effective context tenant (never cross-tenant list/create). */
export function resolveVipTenant(ctx: any): string {
  const t = getEffectiveTenant(ctx, 'default')
  const s = t != null ? String(t).trim() : ''
  return s || 'default'
}
