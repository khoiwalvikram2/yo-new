import { hasPermission } from '@src/domains/common/auth.js'
import { getBookIdsForCrmUser } from '@src/repos/crm/CrmBooksRepo.js'
import type { CrmPlayerScope } from '@src/repos/crm/CrmPlayersRepo.js'

export type CrmContext = {
  crmUser?: { id: string; name: string; tenant: string; status: string; requirePasswordReset: boolean }
  permissions?: Array<{ domain: string; actions: string[] }>
  request?: unknown
}

/** The signed-in CRM user, or an error. Never returns undefined. */
export function requireCrmUser(ctx: CrmContext) {
  if (!ctx?.crmUser) throw new Error('Unauthorized: CRM sign-in required')
  return ctx.crmUser
}

/**
 * Every CRM operation states the permission it needs, and states it here rather
 * than relying on the UI not to offer the button.
 *
 * `hasPermission` is the platform's own check, reused unchanged — CRM roles
 * produce the same `{ domain, actions[] }` shape as admin roles, so there is no
 * second implementation of permission matching to keep in step with the first.
 */
export function requireCrmPermission(ctx: CrmContext, domain: string, action: string): void {
  requireCrmUser(ctx)
  if (!hasPermission(ctx.permissions ?? [], domain, action)) {
    throw new Error(`Forbidden: insufficient permissions for ${domain}:${action}`)
  }
}

/** An INACTIVE CRM user keeps their sign-in and loses every write. */
export function requireCrmWrite(ctx: CrmContext): void {
  const user = requireCrmUser(ctx)
  if (user.status === 'INACTIVE') {
    throw new Error('Your account is inactive. You cannot perform this action.')
  }
}

export function crmCanViewAllPlayers(ctx: CrmContext): boolean {
  return hasPermission(ctx.permissions ?? [], 'crm.players', 'view_all')
}

/**
 * What this caller may reach, assembled server-side.
 *
 * Books are read fresh rather than carried on the token, so removing someone
 * from a book takes their access away on the next request instead of at the end
 * of their session.
 */
export async function crmPlayerScope(ctx: CrmContext): Promise<CrmPlayerScope> {
  const user = requireCrmUser(ctx)
  const viewAll = crmCanViewAllPlayers(ctx)
  const bookIds = viewAll ? [] : await getBookIdsForCrmUser(user.tenant, user.id)
  return { tenant: user.tenant, viewAll, bookIds }
}

/**
 * The address the request came from — for the audit trail, the CRM IP allowlist
 * and the per-address login throttle.
 *
 * This used to read `x-forwarded-for` itself and take the first entry. Fastify
 * already computes `request.ip` from that header according to the app's
 * `trustProxy` setting, so parsing it a second time meant the CRM had its own
 * opinion about which hop to believe — and would not follow if that setting were
 * ever tightened. One setting should govern, so this asks Fastify.
 *
 * Note for whoever owns the deployment: the app sets `trustProxy: true`, which
 * trusts EVERY hop, so `request.ip` is still the leftmost value a client can
 * put in the header. If the CRM allowlist is meant to be an authorisation
 * boundary rather than a record, `trustProxy` needs to name the actual proxy
 * (a hop count or a CIDR). That is an infrastructure decision, not a code one.
 */
export function crmClientIp(ctx: { request?: unknown }): string | null {
  const req = ctx?.request as { ip?: string } | undefined
  return typeof req?.ip === 'string' && req.ip ? req.ip : null
}
