/// <reference types="node" />
import 'dotenv/config'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { hasSuperAdminRoleName } from '@src/domains/common/roleNames.js'

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET || JWT_SECRET === 'dev-secret') {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: JWT_SECRET must be set in production and cannot be "dev-secret"')
  }
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || 'dev-secret'
const JWT_EXPIRES_IN_MINUTES = process.env.JWT_EXPIRES_IN_MINUTES || '10080' // 7 days in minutes
const JWT_EXPIRES_IN_SECONDS = Number.parseInt(JWT_EXPIRES_IN_MINUTES, 10) * 60

export type JwtPayload = {
	sub: string;
	name: string;
	roles: string[];
	agentId?: string;
	type?: 'admin' | 'agent' | 'crm';
	/** CRM users are their own principal — see domains/crm/services/CrmAuthService.ts */
	crmUserId?: string;
	/** Set on CRM tokens so one whitelabel's token cannot be replayed against another. */
	tenant?: string;
	// Agent-specific fields (populated from database on auth)
	agentSchemeType?: 'COMMISSION' | 'SHARING' | 'CREDIT';
	agentAllowedDomains?: string[];
	/** True when agent status is INACTIVE (view-only, no mutations) */
	isReadOnly?: boolean;
	/** Token version for force-logout; must match agents.token_version (agents) or users.token_version (admins) */
	v?: number;
}

const BCRYPT_ROUNDS = 12

export async function hashPassword(plain: string): Promise<string> {
  const salt = await bcrypt.genSalt(BCRYPT_ROUNDS)
  return bcrypt.hash(plain, salt)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

export function signJwt(payload: JwtPayload): string {
  return jwt.sign(payload, EFFECTIVE_JWT_SECRET, { expiresIn: JWT_EXPIRES_IN_SECONDS })
}

export function verifyJwt(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, EFFECTIVE_JWT_SECRET) as JwtPayload
  } catch {
    return null
  }
}

export function getAuthFromRequest(req: any): { user?: JwtPayload } {
  const header = req.headers?.authorization as string | undefined
  if (!header) return {}
  const [scheme, value] = header.split(' ')
  if (scheme !== 'Bearer' || !value) return {}
  const payload = verifyJwt(value)
  if (!payload) return {}
  return { user: payload }
}

/** Throws if the current user is an agent in read-only (INACTIVE) mode. Call at the start of any mutation that agents can invoke. */
export function ensureAgentCanMutate(ctx: any): void {
  if (ctx?.user?.type === 'agent' && ctx?.user?.isReadOnly) {
    throw new Error('Your account is inactive. You cannot perform this action.')
  }
}

import { getUserPermissions, aggregatePermissionPairs } from '@/repos/rbac/rbacRepo.js'
import { getClientIp, getClientUserAgent } from '@src/utils/getClientIp.js'
import { getFlatPermissionsThatGrantNested } from '@/config/nestedPermissions.js'
import { checkIpAllowed, listIpAllowlist } from '@/repos/adminSecurityRepo.js'
import { AgentsRepo } from '@/repos/agents/AgentsRepo.js'
import { deriveAgentPermissions, isAgentActive, canAgentLogin, agentAccessVerdict } from '@/domains/agents/services/AgentPermissionsService.js'

/**
 * Why a token that was presented is not honoured.
 *
 * buildAuthContext answered every refusal of a presented token with `{}`, the same answer as no token at all, so
 * each resolver then refused in its own words ("Forbidden: insufficient permissions to access agents") and the
 * panel could not tell a revoked session from a missing permission: a suspended agent's open tab kept navigating
 * on refusals until a reload. The tenant and IP refusals threw instead, inside the GraphQL context function, which
 * the HTTP layer answered with a bare 500 (and mercurius ran the context a second time, auditing twice).
 * guardAdminSurface (domains/crmSurfaceGuard.ts) gives every admin-surface field one answer for either kind.
 *
 * - `session_ended`: the session no longer exists: signed out, forced out, password changed, suspended,
 *   deactivated or deleted, or an agent under a suspended parent. Its message is one the panel already treats
 *   as "Session ended" (admin/src/shared/core/api.ts).
 * - `access_denied`: a live session used from where it may not be (another tenant, an address outside the IP
 *   allowlist). Its message says which.
 */
export type AuthRejection = { reason: 'session_ended' | 'access_denied'; message: string }

export const SESSION_ENDED_MESSAGE = 'Unauthorized: session invalid. Please sign in again.'

const sessionEnded = (): { authRejected: AuthRejection } => ({
  authRejected: { reason: 'session_ended', message: SESSION_ENDED_MESSAGE },
})
const accessDenied = (message: string): { authRejected: AuthRejection } => ({
  authRejected: { reason: 'access_denied', message },
})

/**
 * The columns that decide whether an admin's session still stands, read by id: users.status, users.token_version
 * (moved on by Logout, Force Logout and a password change) and users.require_password_reset (Reset Password).
 * Null when the row is gone.
 */
export async function readAdminSessionState(
  userId: number
): Promise<{ tenant: string | null; status: string; tokenVersion: number; requirePasswordReset: boolean } | null> {
  const { db } = await import('@/db/client.js')
  const { users } = await import('@/db/schema.js')
  const { eq } = await import('drizzle-orm')
  const rows = await db
    .select({ tenant: users.tenant, status: users.status, tokenVersion: users.tokenVersion, requirePasswordReset: users.requirePasswordReset })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  const tenant = typeof row.tenant === 'string' && row.tenant.trim() !== '' ? row.tenant.trim() : null
  return { tenant, status: String(row.status), tokenVersion: Number(row.tokenVersion) || 0, requirePasswordReset: row.requirePasswordReset === true }
}

/**
 * Ends every session of an admin: the version its tokens carry no longer matches. By id alone, because the id
 * comes from the caller's own session, and a platform Super Admin's row lives in `default` while `ctx.tenant` is
 * whichever whitelabel it is working in (a tenant-scoped bump was a no-op for it).
 */
export async function endAdminSessions(userId: number): Promise<void> {
  const { db } = await import('@/db/client.js')
  const { users } = await import('@/db/schema.js')
  const { eq, sql } = await import('drizzle-orm')
  await db.update(users).set({ tokenVersion: sql`${users.tokenVersion} + 1` }).where(eq(users.id, userId))
}

/** Clears Reset Password's flag once the admin has chosen a new password (guardAdminSurface calls it). */
export async function clearRequiredPasswordChange(userId: number): Promise<void> {
  const { db } = await import('@/db/client.js')
  const { users } = await import('@/db/schema.js')
  const { eq } = await import('drizzle-orm')
  await db.update(users).set({ requirePasswordReset: false }).where(eq(users.id, userId))
}

export async function buildAuthContext(req: any, tenant?: string): Promise<{ user?: JwtPayload; permissions?: { domain: string; actions: string[] }[]; directorMode?: 'core' | 'whitelabel' | null; directorWhitelabelId?: string | null; authRejected?: AuthRejection; passwordChangeRequired?: boolean }> {
  const base = getAuthFromRequest(req)
  if (!base.user) {
    // No token is an anonymous caller. A token that was sent but does not verify (expired, or not one of ours)
    // is a session that has ended, as surely as a revoked one.
    return req?.headers?.authorization ? sessionEnded() : {}
  }

  // A CRM token is not an admin identity. Without this it would fall through to
  // the admin branch, where Number(sub) on a uuid is NaN and the function
  // returns a user with no permissions — authenticated-looking but meaningless.
  // CRM callers are resolved separately by buildCrmAuthContext.
  if (base.user.type === 'crm') return {}
  
  // Use provided tenant or default, ensure it's a valid string
  const effectiveTenant = (tenant && typeof tenant === 'string' && tenant.trim() !== '') ? tenant.trim() : 'default'
  
  // Check if this is an agent token (type must be explicitly 'agent')
  if (base.user.type === 'agent' && base.user.agentId) {
    // Load agent data and derive permissions
    const agentsRepo = new AgentsRepo()
    const agent = await agentsRepo.findById(base.user.agentId)
    
    if (!agent) {
      return sessionEnded() // Invalid agent token (the agent is gone)
    }

    // Verify tenant matches (if tenant is provided)
    // Normalize agent tenantId for comparison (trim whitespace)
    const agentTenant = (agent.tenantId && typeof agent.tenantId === 'string') ? agent.tenantId.trim() : null
    if (effectiveTenant && agentTenant && agentTenant !== effectiveTenant) {
      return sessionEnded() // Agent not authorized for this tenant; signing in again sets the panel's tenant
    }
    if (effectiveTenant && !agentTenant) {
      return sessionEnded() // Agent has no tenant configured
    }

    // Only SUSPENDED (and BLOCKED) cannot access; INACTIVE can access in read-only mode
    if (!canAgentLogin(agent.status)) {
      return sessionEnded() // Agent suspended or blocked
    }

    // Force-logout: if JWT token version does not match DB, reject (e.g. after suspend or Sign out)
    const agentTokenVersion = Number((agent as any).tokenVersion) || 0
    const jwtVersion = Number((base.user as any)?.v)
    if (Number.isFinite(jwtVersion) && jwtVersion !== agentTokenVersion) {
      return sessionEnded() // Token invalidated (e.g. agent was suspended or signed out)
    }

    // Owner decision 1: a SUSPENDED/BLOCKED ancestor blocks the whole subtree, and
    // an INACTIVE one makes it read-only. Checked per request (one indexed closure
    // query) rather than by bumping every descendant's token version, so it also
    // covers status changes made through updateAgent, and lifting the suspension
    // restores the subtree without forcing everyone to sign in again.
    const ancestorStatuses = await agentsRepo.listNonActiveAncestorStatuses(String(agent.id))
    const access = agentAccessVerdict(agent.status, ancestorStatuses)
    if (!access.allowed) {
      return sessionEnded() // An ancestor agent is suspended or blocked
    }

    const isReadOnly = access.isReadOnly

    // Derive permissions from allowedDomains
    // Ensure allowedDomains is an array (safety check)
    const allowedDomains = Array.isArray(agent.allowedDomains) ? agent.allowedDomains : []
    const permissions = deriveAgentPermissions(allowedDomains as any[], agent.schemeType)

    // Return enriched user context with agent-specific fields
    return {
      user: {
        ...base.user,
        agentSchemeType: agent.schemeType as 'COMMISSION' | 'SHARING' | 'CREDIT',
        agentAllowedDomains: allowedDomains as string[],
        isReadOnly,
      },
      permissions
    }
  }
  
  // Admin user flow (existing logic)
  const userIdNum = Number(base.user.sub)
  // Only the login mutation mints admin tokens, always with the numeric users.id as sub; anything else names no
  // admin. (This returned the user with no permissions, which a resolver checking only for a session accepted.)
  if (!Number.isSafeInteger(userIdNum) || userIdNum <= 0) return sessionEnded()

  // An admin's session stands only while its users row does, as an agent's does (above). None of this was read,
  // so Deactivate, Force Logout and Sign out changed nothing for a live token, and the token of a deleted admin
  // still read every commission payout of its whitelabel. One indexed read, Super Admin included.
  const session = await readAdminSessionState(userIdNum)
  if (!session || session.status !== 'active') return sessionEnded()
  // A token minted before admin tokens carried a version has no `v` and counts as version 0. Honouring it instead
  // would leave Force Logout and Sign out with no effect on such a token until it expired (seven days by default).
  // The cost is one more sign-in, once, for an admin whose version has already moved on.
  const jwtVersion = Number(base.user.v ?? 0)
  if (jwtVersion !== session.tokenVersion) return sessionEnded()

  // CRITICAL: Check if user is Super Admin
  const roleNames = base.user.roles || []
  const isSuperAdmin = hasSuperAdminRoleName(roleNames)
  
  // CRITICAL: Super Admin mode detection (only process for Super Admin)
  let directorMode: 'core' | 'whitelabel' | null = null
  let directorWhitelabelId: string | null = null
  
  if (isSuperAdmin) {
    // Read X-Admin-Mode header (only for Super Admin)
    const adminModeHeader = req.headers?.['x-admin-mode'] || req.headers?.['X-Admin-Mode']
    if (adminModeHeader && typeof adminModeHeader === 'string') {
      const mode = adminModeHeader.trim().toLowerCase()
      if (mode === 'core' || mode === 'whitelabel') {
        directorMode = mode as 'core' | 'whitelabel'
      }
    }
    
    // If no header, default to core mode for Super Admin
    if (!directorMode) {
      directorMode = 'core'
    }
    
    // In whitelabel mode, read selected whitelabel ID
    if (directorMode === 'whitelabel') {
      const whitelabelIdHeader = req.headers?.['x-whitelabel-id'] || req.headers?.['X-Whitelabel-ID']
      if (whitelabelIdHeader && typeof whitelabelIdHeader === 'string') {
        directorWhitelabelId = whitelabelIdHeader.trim()
        
        // SECURITY: Validate whitelabel ID exists
        if (directorWhitelabelId) {
          const { listWhitelabelsDb } = await import('@/repos/common/whitelabelRepo.js')
          const whitelabels = await listWhitelabelsDb()
          const whitelabelExists = whitelabels.some(wl => wl.id === directorWhitelabelId)
          
          if (!whitelabelExists) {
            // Log security violation
            const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
            recordAuditDb({
              tenant: effectiveTenant,
              actorId: String(userIdNum),
              domain: 'users.security',
              action: 'invalid_whitelabel_id',
              resourceType: 'whitelabel',
              resourceId: directorWhitelabelId,
              before: { directorMode, whitelabelId: directorWhitelabelId, exists: false },
            }).catch(() => {})
            
            // Reset to core mode if invalid whitelabel
            directorMode = 'core'
            directorWhitelabelId = null
          }
        }
      }
    }
  } else {
    // SECURITY: Reject X-Admin-Mode header from non-Super Admin users
    const adminModeHeader = req.headers?.['x-admin-mode'] || req.headers?.['X-Admin-Mode']
    if (adminModeHeader) {
      // Log security violation attempt
      const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
      recordAuditDb({
        tenant: effectiveTenant,
        actorId: String(userIdNum),
        domain: 'users.security',
        action: 'unauthorized_admin_mode_header',
        resourceType: 'user',
        resourceId: String(userIdNum),
        before: { roles: roleNames, attemptedHeader: adminModeHeader },
      }).catch(() => {})
      
      // Silently ignore (don't throw error to avoid breaking existing functionality)
      // But log for security monitoring
    }
  }
  
  // For non-Super Admin users, use the actual tenant from DB (read with the session above) for permission loading
  // This ensures permissions are always loaded from the tenant where roles were assigned
  let userDbTenant: string = effectiveTenant
  if (!isSuperAdmin) {
    if (session.tenant) {
      userDbTenant = session.tenant
    }

    // CRITICAL SECURITY: For Whitelabel Admins, verify user's actual tenant matches effective tenant
    const isWhitelabelAdmin = roleNames.some(r =>
      r === 'Whitelabel Admin' || r.toLowerCase() === 'whitelabel_admin' || r.toLowerCase().includes('whitelabel')
    )

    if (isWhitelabelAdmin) {
      const auditIp = getClientIp(req)
      const auditUserAgent = getClientUserAgent(req)

      // These refusals used to be thrown, which the HTTP layer turned into a 500 the panel could not read; they
      // are returned now, and guardAdminSurface answers every field with the message (SCO-10).
      if (!session.tenant) {
        const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
        recordAuditDb({
          tenant: effectiveTenant,
          actorId: String(userIdNum),
          domain: 'users.security',
          action: 'invalid_user_tenant',
          resourceType: 'user',
          resourceId: String(userIdNum),
          before: { userFound: true, tenant: null, effectiveTenant, ipAddress: auditIp, userAgent: auditUserAgent },
        }).catch(() => {})

        return accessDenied('Access denied: Invalid user or tenant configuration')
      }
      
      // SECURITY: Whitelabel Admin can ONLY access their own tenant
      if (userDbTenant !== effectiveTenant) {
        const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
        recordAuditDb({
          tenant: effectiveTenant,
          actorId: String(userIdNum),
          domain: 'users.security',
          action: 'cross_tenant_access_blocked',
          resourceType: 'user',
          resourceId: String(userIdNum),
          before: { userTenant: userDbTenant, effectiveTenant, attemptedAccess: true, ipAddress: auditIp, userAgent: auditUserAgent },
        }).catch(() => {})

        return accessDenied('Access denied: Whitelabel Admins can only access their own tenant')
      }
      
      const requestedTenantRaw = req.headers?.['x-tenant'] || req.headers?.['X-Tenant']
      const requestedTenant = (requestedTenantRaw && typeof requestedTenantRaw === 'string') ? requestedTenantRaw.trim() : null
      if (requestedTenant && requestedTenant !== effectiveTenant) {
        const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
        recordAuditDb({
          tenant: effectiveTenant,
          actorId: String(userIdNum),
          domain: 'users.security',
          action: 'tenant_switch_blocked',
          resourceType: 'user',
          resourceId: String(userIdNum),
          before: { requestedTenant, effectiveTenant, ipAddress: auditIp, userAgent: auditUserAgent },
        }).catch(() => {})

        return accessDenied('Access denied: Whitelabel Admins cannot switch tenants')
      }
    }
  }
  
  // Load permissions using the user's actual DB tenant (not request-derived tenant)
  // Super Admin: always 'default', others: user's DB tenant where roles are assigned
  const permissionTenant = isSuperAdmin ? 'default' : userDbTenant
  const pairs = await getUserPermissions(userIdNum, permissionTenant)
  const hasAdminRole = pairs.length > 0
  
  // If user has admin roles, check IP allowlist (admin UI only enforcement)
  if (hasAdminRole) {
    // Detect if request is from admin UI (check path or headers)
    const isAdminUI = req.url?.includes('/graphql') || req.headers?.['x-client-type'] === 'admin'
    
    if (isAdminUI) {
      // Use DB home tenant for allowlist (matches roles/permissions). Request header tenant can be
      // wrong for support admins who omit X-Whitelabel-ID (would check wrong allowlist).
      const allowlistTenant = !isSuperAdmin ? userDbTenant : effectiveTenant
      const entries = await listIpAllowlist(userIdNum, allowlistTenant)
      
      // If entries exist, enforce IP check
      if (entries.length > 0) {
        // Get client IP from request
        const clientIp = getClientIp(req) || req.socket?.remoteAddress || 'unknown'
        
        const allowed = await checkIpAllowed(userIdNum, clientIp, allowlistTenant)
        
        if (!allowed) {
          // Record audit event for blocked attempt
          const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
          recordAuditDb({
            tenant: effectiveTenant,
            actorId: String(userIdNum),
            domain: 'users.security',
            action: 'ip_blocked',
            resourceType: 'user',
            resourceId: String(userIdNum),
            before: { ip: clientIp },
          }).catch(() => {})

          return accessDenied('Access denied: IP address not in allowlist')
        }
      }
      // If no entries, allow (default off behavior)
    }
  }
  
  // Return auth context with Super Admin mode info
  const result: any = { user: base.user, permissions: aggregatePermissionPairs(pairs) }

  // Reset Password (Support Admins) sets require_password_reset, and nothing read it: the admin kept working and
  // signed straight back in. Until the admin chooses a new password the session may do only that
  // (guardAdminSurface lets changeAdminPassword and logout through), so it carries no permissions.
  if (session.requirePasswordReset) {
    result.permissions = []
    result.passwordChangeRequired = true
  }

  // Only include Super Admin mode fields if user is Super Admin
  if (isSuperAdmin) {
    result.directorMode = directorMode
    result.directorWhitelabelId = directorWhitelabelId
  }
  
  return result
}

/**
 * Check if user has permission for (domain, action).
 * Supports: 1) all.*, 2) exact nested or flat match, 3) flat→nested backward compat (e.g. sports.read grants sports.events.view).
 */
export function hasPermission(perms: { domain: string; actions: string[] }[] | undefined, domain: string, action: string): boolean {
  if (!perms) return false
  // 1. Super Admin: all.* grants everything
  const all = perms.find(p => p.domain === 'all')
  if (all && (all.actions.includes('*') || all.actions.includes(action))) return true
  // 2. Exact permission (nested or flat)
  const p = perms.find(p => p.domain === domain)
  if (p && (p.actions.includes(action) || p.actions.includes('*'))) return true
  // 3. Backward compat: if checking nested (domain contains '.'), see if any flat perm grants it
  if (domain.includes('.')) {
    const flatGrants = getFlatPermissionsThatGrantNested(domain, action)
    for (const flat of flatGrants) {
      const fp = perms.find(pp => pp.domain === flat.domain)
      if (fp && (fp.actions.includes(flat.action) || fp.actions.includes('*'))) return true
    }
  }
  return false
}

/**
 * The permission gate for a read.
 *
 * Identical to `requirePermission` except that it does not call
 * `ensureAgentCanMutate` — a read-only agent may still read, and refusing them
 * on a query would be a different bug from the one this closes.
 *
 * Deliberately **no exemption for agents.** An agent carries flat permissions
 * (`players:view`, `agents:view`, …) and `hasPermission` resolves a nested
 * check against them through `getFlatPermissionsThatGrantNested`. Measured:
 * `players.list:view` is granted to an agent and to a Whitelabel Admin, and
 * refused to an admin holding nothing — which is exactly the distinction
 * wanted. An exemption would have re-opened the hole for the principal with the
 * widest reach.
 *
 * This exists because the player list was readable by an admin holding no
 * permissions at all: verified against live data, an authenticated admin with
 * an empty permission set listed 648 players with names, usernames and phone
 * numbers.
 */
/**
 * Guards the diagnostic bet mutations.
 *
 * `createTestCasinoBet`, `settleTestCasinoBet` and `createTestMatkaBet` write
 * real rows into the live bet tables and move real balances — `settleTestCasinoBet`
 * credits a winning payout. None of them checked anything: not a permission, not
 * even that a caller was signed in. Measured, `createTestMatkaBet` wrote a bet
 * with no session at all.
 *
 * They are development tools, so this refuses on two independent grounds: they
 * are switched off entirely in production, and elsewhere they need platform-wide
 * permission rather than any ordinary sports or casino grant. Either check alone
 * would close the hole; both are cheap.
 */
export function requireDiagnosticAccess(ctx: any, name: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Forbidden: ${name} is a diagnostic mutation and is disabled in production`)
  }
  if (!ctx?.user) throw new Error('Unauthorized: authentication required')
  if (!hasPermission(ctx?.permissions ?? [], 'all', '*')) {
    throw new Error(`Forbidden: ${name} requires platform administrator permission`)
  }
}
export function requireReadPermission(ctx: any, domain: string, action: string): void {
  if (!ctx?.user) throw new Error('Unauthorized: authentication required')
  if (!hasPermission(ctx?.permissions ?? [], domain, action)) {
    throw new Error(`Forbidden: insufficient permissions for ${domain}:${action}`)
  }
}

/** Requires auth, allows mutation for non-read-only agents, and checks permission. Call at the start of resolvers that need a specific permission. */
export function requirePermission(ctx: any, domain: string, action: string): void {
  if (!ctx?.user) {
    throw new Error('Unauthorized: authentication required')
  }
  ensureAgentCanMutate(ctx)
  if (!hasPermission(ctx?.permissions ?? [], domain, action)) {
    throw new Error(`Forbidden: insufficient permissions for ${domain}:${action}`)
  }
}

export function hasAgentPermission(perms: { domain: string; actions: string[] }[] | undefined, domain: string, action: string): boolean {
  if (!perms) return false
  const p = perms.find(p => p.domain === domain)
  return !!p && (p.actions.includes(action) || p.actions.includes('*'))
}

