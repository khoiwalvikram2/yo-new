/**
 * Who may administer a whitelabel's CRM users from the admin panel.
 *
 * The CRM is a separate principal with its own login, so its own user
 * management lives inside the CRM application and is gated by
 * `crm.users:manage`. That is the right place for it — right up until the
 * whitelabel has no working CRM login at all, which is exactly when somebody
 * needs to create one. Before this surface existed, that meant a Super Admin,
 * for every whitelabel, every time.
 *
 * This module holds the whole authorisation decision for the admin-side
 * surface, in one function, on purpose — seven resolvers each deciding for
 * themselves is seven places for the answer to differ.
 *
 * The administrator is recognised by `roles.is_whitelabel_admin`, never by what
 * the role is called. `roles.name` is free text and `renameRole` will change it
 * to anything, so an earlier version that matched on the name would have
 * removed a whitelabel's access to its own CRM the moment somebody renamed
 * their role — a lockout with no visible connection to the action that caused
 * it. The flag survives the rename; the name does not.
 */
import { getCrmSettings } from '@src/repos/crm/CrmSettingsRepo.js'
import { db } from '@src/db/client.js'
import { roles, userRoles } from '@shared/db/schema.js'
import { and, eq } from 'drizzle-orm'

/**
 * Role names recognised as "administers this whitelabel", for tenants whose
 * `roles.is_whitelabel_admin` flag was never set.
 *
 * The flag is the real answer — `roles.name` is free text and `renameRole` will
 * change it to anything, so a check that reads the name loses access the moment
 * somebody renames their own role, through an action with no visible connection
 * to it. This list is the fallback for a role created by hand after the
 * backfill migration ran, so such a tenant degrades to the old behaviour rather
 * than to no access at all.
 */
const LEGACY_ADMIN_ROLE_NAMES = ['whitelabel admin', 'wl admin']

export type CrmAdminScope = {
  /** The whitelabel whose CRM is being administered. Never taken from the caller unchecked. */
  tenant: string
  /** For the audit trail: the admin user behind the change, not a CRM user. */
  actorId: string
  /** A Super Admin may act on any whitelabel; everyone else only on their own. */
  isSuperAdmin: boolean
}

function rolesOf(ctx: any): string[] {
  return (ctx?.user?.roles ?? []) as string[]
}

export function isPlatformSuperAdmin(ctx: any): boolean {
  return rolesOf(ctx).some(
    (r) =>
      r === 'Super Admin' ||
      r.toLowerCase() === 'super_admin' ||
      (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
  )
}

/**
 * Whether this admin holds their whitelabel's administrator role.
 *
 * Resolved through `user_roles` by user id, so no part of this depends on what
 * the role is *called* — not the row, and not the name carried on the token,
 * which is stale for the rest of a session after a rename anyway.
 */
async function holdsAdminRole(ctx: any, tenant: string): Promise<boolean> {
  const userId = Number(ctx?.user?.sub)
  if (Number.isFinite(userId)) {
    const rows = await db
      .select({ id: roles.id })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(roles.tenant, tenant),
          eq(roles.isWhitelabelAdmin, true)
        )
      )
      .limit(1)
    if (rows.length > 0) return true
  }

  // Fallback for a tenant with nothing flagged — see LEGACY_ADMIN_ROLE_NAMES.
  return rolesOf(ctx).some((r) => LEGACY_ADMIN_ROLE_NAMES.includes(r.trim().toLowerCase()))
}

/**
 * Resolves — and refuses — the whitelabel this caller may administer.
 *
 * A Super Admin names the tenant. A whitelabel admin does not get to: their
 * `tenant` argument is *overridden*, not validated, so a crafted request cannot
 * reach another whitelabel's CRM even if a future caller forgets to check the
 * return value against what it asked for.
 *
 * Throws rather than returning null. Every caller is a mutation or a scoped
 * read where continuing without a tenant would be a bug, and a thrown error
 * cannot be accidentally ignored the way a null can.
 */
export async function assertCrmAdminSurface(
  ctx: any,
  requestedTenant?: string | null
): Promise<CrmAdminScope> {
  if (!ctx?.user) throw new Error('Unauthorized: authentication required')

  // A CRM session reaching an admin-panel field is already refused by
  // `guardAdminSurface` — these field names deliberately fall outside its `crm`
  // prefix exemption. This is the second lock on the same door.
  if (ctx?.crmUser) {
    throw new Error('Forbidden: CRM sessions manage their own users inside the CRM.')
  }

  const actorId = String(ctx.user.sub ?? 'unknown')

  if (isPlatformSuperAdmin(ctx)) {
    const tenant = String(requestedTenant ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? '').trim()
    if (!tenant) throw new Error('A whitelabel must be named.')
    return { tenant, actorId, isSuperAdmin: true }
  }

  const own = String(ctx?.tenant ?? ctx?.whitelabel?.id ?? '').trim()
  if (own && (await holdsAdminRole(ctx, own))) {
    // Overridden, never honoured. See the doc comment above.
    return { tenant: own, actorId, isSuperAdmin: false }
  }

  throw new Error('Forbidden: only a whitelabel administrator can manage CRM users.')
}

/**
 * Refuses a whitelabel whose CRM the Super Admin has not switched on.
 *
 * Separate from the scope check because reading is still allowed when the CRM
 * is off — an administrator should be able to see the users that exist and
 * understand why nothing can be changed, rather than face an empty screen with
 * no explanation.
 */
export async function assertCrmEnabled(tenant: string): Promise<void> {
  const settings = await getCrmSettings(tenant)
  if (!settings || !settings.enabled) {
    throw new Error('The CRM is not enabled for this whitelabel. A Super Admin switches it on.')
  }
}
