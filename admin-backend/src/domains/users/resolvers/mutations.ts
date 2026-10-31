import { findUserByEmailWithRoles, updateUserPasswordDb, getUserPasswordHashDb } from '@/repos/users/usersRepo.js'
import { getClientIp, getClientUserAgent } from '@src/utils/getClientIp.js'
import { signJwt, verifyPassword, ensureAgentCanMutate } from '@/domains/common/auth.js'
import { checkLoginRateLimit, recordFailedLoginAttempt, clearLoginAttempts } from '@/middleware/loginRateLimiter.js'
import { getUserPermissions, aggregatePermissionPairs, setRolePermissions, assignRoleToUser, removeRoleFromUser, getUserRoleNames, listRolesWithPermissions } from '@/repos/rbac/rbacRepo.js'
import { currencyService } from '@src/services/currencyService.js'
import { z } from 'zod'
import { adjustWalletDb } from '@/repos/players/walletsRepo.js'
import { db } from '@/db/client.js'
import { updateUserDomainBetsDb, setUserBonusAllowedDb, setUserVipTierDb, setUserStatusDb, setRequirePasswordResetDb, setWithdrawalLockDb, setPlayerRemarkDb, incrementTokenVersionDb, upsertPlayerLimitsDb, createPlayerDb, getUserDb } from '@/repos/users/usersRepo.js'
import { hashPassword } from '@/domains/common/auth.js'
import { requirePermission } from '@src/domains/common/auth.js'
import { ensureActorMayGrantPermissions, ensureMayUseRoleName } from '@/domains/rbac/services/rbacService.js'
import { PlayerAuthService } from '@src/domains/players/services/PlayerAuthService.js'
import { normalizeCreditLimit, resolveOwningAgentForCreate, refuseAgentCallerForAdminCreate } from '@src/domains/users/resolvers/createPlayerRules.js'
import { bettingFlagsFromAgentDomains } from '@src/domains/players/resolvers/agentPlayerCreation.js'
import { loadPlayerDomains, PLAYER_DOMAINS } from '@shared/access/playerDomains.js'
// legacy in-memory usersStore removed

/**
 * Every mutation below that names a player holds only a permission check, and
 * agents hold those permissions (`users:write` / `players:manage` map onto
 * `players.profile:update`, `players.wallet:update`, …). Without this an agent
 * could suspend, re-flag or force-logout any player in the whitelabel. The
 * helper is a no-op for admins, who are scoped by the tenant filter in the repo
 * call instead; for agents it walks the closure-table subtree plus
 * referral-linked players, the same scope the players-domain mutations use.
 */
const playerAuthService = new PlayerAuthService()

const LoginInput = z.object({ email: z.string().email(), password: z.string().min(6) })
const IdInput = z.object({ id: z.string().min(1) })
const SetKycInput = z.object({ id: z.string().min(1), kyc: z.string().min(1) })
const SetSanctionsInput = z.object({ id: z.string().min(1), sanctions: z.boolean() })
const SetBetAllowedInput = z.object({ id: z.string().min(1), allow: z.boolean() })
const SetVipTierInput = z.object({ id: z.string().min(1), vipTierId: z.string().uuid().nullable().optional() })
const SetStatusInput = z.object({ id: z.string().min(1), status: z.enum(['ACTIVE','INACTIVE','SUSPENDED']) })
const MAX_FINANCIAL_AMOUNT = 1_000_000_000
const PlayerLimitsInput = z.object({ input: z.object({
  userId: z.string().min(1),
  dailyStakeLimit: z.number().max(MAX_FINANCIAL_AMOUNT).nullable().optional(),
  weeklyStakeLimit: z.number().max(MAX_FINANCIAL_AMOUNT).nullable().optional(),
  exposureCapOverride: z.number().max(MAX_FINANCIAL_AMOUNT).nullable().optional(),
  cooldownSeconds: z.number().int().max(86400 * 365).nullable().optional(),
  maxBetSports: z.number().max(MAX_FINANCIAL_AMOUNT).nullable().optional(),
  maxBetCasino: z.number().max(MAX_FINANCIAL_AMOUNT).nullable().optional(),
  maxBetMatka: z.number().max(MAX_FINANCIAL_AMOUNT).nullable().optional(),
}) })
const AdjustWalletInput = z.object({
  userId: z.string().min(1),
  amount: z.number().min(-MAX_FINANCIAL_AMOUNT).max(MAX_FINANCIAL_AMOUNT),
  currency: z.string().min(3).max(3).optional(),
  applyBonus: z.boolean().optional(),
})
const UpsertRoleInput = z.object({ input: z.object({ name: z.string().min(1), permissions: z.array(z.object({ domain: z.string().min(1), actions: z.array(z.string().min(1)) })) }) })
const AssignRoleInput = z.object({ userId: z.string().min(1), role: z.string().min(1) })

export const usersMutationResolvers = {
  login: async (_: any, args: any, ctx: any) => {
    const parsed = LoginInput.safeParse(args.input)
    const email = parsed.success ? parsed.data.email : (args?.input?.email ?? 'unknown')
    const loginTenant = () => (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default').trim() || 'default'
    const req = ctx?.request
    const auditIp = getClientIp(req)
    const auditUserAgent = getClientUserAgent(req)
    const ip = auditIp ?? 'unknown'

    checkLoginRateLimit(ip, email)

    if (!parsed.success) {
      recordFailedLoginAttempt(ip, email)
      const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
      await recordAuditDb({
        tenant: loginTenant(),
        actorId: 'unknown',
        domain: 'users.security',
        action: 'login_failed',
        resourceType: 'user',
        resourceId: 'unknown',
        after: { success: false, ipAddress: auditIp, userAgent: auditUserAgent },
      }).catch(() => {})
      throw new Error('Invalid input')
    }
    const { password } = parsed.data

    try {
      // Try to find user in default tenant first
      let tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
      if (typeof tenant !== 'string' || tenant.trim() === '') {
        tenant = 'default'
      } else {
        tenant = tenant.trim()
      }
      let user = await findUserByEmailWithRoles(email, tenant)

      // If user not found in default tenant, search across all tenants
      if (!user) {
        const { db } = await import('@/db/client.js')
        const { users, roles, userRoles } = await import('@/db/schema.js')
        const { eq, inArray, and } = await import('drizzle-orm')

        const userRows = await db.select({
          id: users.id,
          name: users.name,
          email: users.email,
          passwordHash: users.passwordHash,
          tenant: users.tenant
        }).from(users).where(eq(users.email, email)).limit(1)

        if (userRows.length) {
          const u = userRows[0]
          if (!u.tenant || typeof u.tenant !== 'string' || u.tenant.trim() === '') {
            const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
            await recordAuditDb({
              tenant,
              actorId: String(u.id),
              domain: 'users.security',
              action: 'login_failed',
              resourceType: 'user',
              resourceId: String(u.id),
              after: { success: false, ipAddress: auditIp, userAgent: auditUserAgent },
            }).catch(() => {})
            recordFailedLoginAttempt(ip, email)
            throw new Error('Invalid user tenant configuration')
          }
          tenant = u.tenant.trim()
          const ur = await db.select({ roleId: userRoles.roleId }).from(userRoles).where(and(eq(userRoles.userId, u.id), eq(userRoles.tenant, tenant)))
          const roleIds = ur.map(r => r.roleId)
          let roleNames: string[] = []
          if (roleIds.length) {
            const rs = await db.select({ name: roles.name }).from(roles).where(and(inArray(roles.id, roleIds), eq(roles.tenant, tenant)))
            roleNames = rs.map(r => r.name)
          }
          user = { id: u.id, name: u.name, email: u.email || '', passwordHash: u.passwordHash, roles: roleNames }
        }
      }

      if (!user) {
        recordFailedLoginAttempt(ip, email)
        const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
        await recordAuditDb({
          tenant,
          actorId: email,
          domain: 'users.security',
          action: 'login_failed',
          resourceType: 'user',
          resourceId: email,
          after: { success: false, ipAddress: auditIp, userAgent: auditUserAgent },
        }).catch(() => {})
        throw new Error('Invalid credentials')
      }
      const ok = await verifyPassword(password, user.passwordHash)
      if (!ok) {
        recordFailedLoginAttempt(ip, email)
        const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
        await recordAuditDb({
          tenant,
          actorId: String(user.id),
          domain: 'users.security',
          action: 'login_failed',
          resourceType: 'user',
          resourceId: String(user.id),
          after: { success: false, ipAddress: auditIp, userAgent: auditUserAgent },
        }).catch(() => {})
        throw new Error('Invalid credentials')
      }

      if (!user.roles || user.roles.length === 0) {
        recordFailedLoginAttempt(ip, email)
        const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
        await recordAuditDb({
          tenant,
          actorId: String(user.id),
          domain: 'users.security',
          action: 'login_failed',
          resourceType: 'user',
          resourceId: String(user.id),
          after: { success: false, ipAddress: auditIp, userAgent: auditUserAgent },
        }).catch(() => {})
        throw new Error('Invalid credentials')
      }

      const isWhitelabelAdmin = user.roles.some(r =>
        r === 'Whitelabel Admin' || r.toLowerCase() === 'whitelabel_admin' || r.toLowerCase().includes('whitelabel')
      )

      if (isWhitelabelAdmin) {
        let contextTenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
        if (typeof contextTenant !== 'string' || contextTenant.trim() === '') {
          contextTenant = 'default'
        } else {
          contextTenant = contextTenant.trim()
        }
        const { db } = await import('@/db/client.js')
        const { users } = await import('@/db/schema.js')
        const { eq } = await import('drizzle-orm')
        const userRow = await db.select({ tenant: users.tenant })
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1)
        if (!userRow.length || !userRow[0].tenant || typeof userRow[0].tenant !== 'string' || userRow[0].tenant.trim() === '') {
          recordFailedLoginAttempt(ip, email)
          const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
          await recordAuditDb({
            tenant,
            actorId: String(user.id),
            domain: 'users.security',
            action: 'login_failed',
            resourceType: 'user',
            resourceId: String(user.id),
            after: { success: false, ipAddress: auditIp, userAgent: auditUserAgent },
          }).catch(() => {})
          throw new Error('Access denied: Invalid user or tenant configuration')
        }
        const userTenant = userRow[0].tenant.trim()
        if (userTenant !== contextTenant) {
          const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
          await recordAuditDb({
            tenant,
            actorId: String(user.id),
            domain: 'users.security',
            action: 'login_failed',
            resourceType: 'user',
            resourceId: String(user.id),
            after: { success: false, ipAddress: auditIp, userAgent: auditUserAgent },
          }).catch(() => {})
          recordFailedLoginAttempt(ip, email)
          throw new Error('Access denied: Whitelabel Admins must login via their own tenant domain')
        }
      }

      clearLoginAttempts(ip, email)
      const token = signJwt({ sub: String(user.id), name: user.name, roles: user.roles })
      const permsPairs = await getUserPermissions(user.id, tenant)
      const permissions = aggregatePermissionPairs(permsPairs)
      const normalizedTenant = (tenant && typeof tenant === 'string') ? tenant.trim() : 'default'

      const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
      await recordAuditDb({
        tenant: normalizedTenant,
        actorId: String(user.id),
        domain: 'users.security',
        action: 'login',
        resourceType: 'user',
        resourceId: String(user.id),
        after: { success: true, ipAddress: auditIp, userAgent: auditUserAgent },
      }).catch(() => {})

      return { token, user: { id: String(user.id), name: user.name }, roles: user.roles, permissions, tenant: normalizedTenant }
    } catch (err: any) {
      throw err
    }
  },
  logout: async (_: any, __: any, ctx: any) => {
    const userId = ctx?.user?.sub
    if (!userId) {
      return { success: true, message: 'Not authenticated' }
    }
    const userIdNum = Number(userId)
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    if (Number.isFinite(userIdNum)) {
      await incrementTokenVersionDb(userIdNum, tenant)
    }
    return { success: true, message: 'Logged out' }
  },
  setUserDomainBets: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'players.profile', 'update')
    ensureAgentCanMutate(ctx)
    const schema = z.object({ id: z.string().min(1), sports: z.boolean().optional(), casino: z.boolean().optional(), matka: z.boolean().optional(), sportsVisible: z.boolean().optional(), casinoVisible: z.boolean().optional(), matkaVisible: z.boolean().optional() })
    const p = schema.safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    const { id, sports, casino, matka } = p.data
    const idNum = Number(id)
    if (!Number.isSafeInteger(idNum) || idNum <= 0) throw new Error('Invalid id')
    await playerAuthService.validateAgentPlayerAccess(ctx, idNum, 'change betting permissions for')
    const update: any = {}
    if (typeof sports === 'boolean') update.sportsBetAllowed = sports
    if (typeof casino === 'boolean') update.casinoBetAllowed = casino
    if (typeof matka === 'boolean') update.matkaBetAllowed = matka
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    for (const domain of PLAYER_DOMAINS) if (typeof p.data[`${domain}Visible`] === 'boolean') update[`${domain}Visible`] = p.data[`${domain}Visible`]
    if (!Object.keys(update).length) throw new Error('Choose a visibility or betting setting to update')
    if (Object.values(update).some(value => value === true)) {
      const caps = await loadPlayerDomains(db, tenant, idNum)
      for (const domain of PLAYER_DOMAINS) if ((update[`${domain}Visible`] === true || update[`${domain}BetAllowed`] === true) && !caps[domain].agentAllowed) {
        throw new Error(`Cannot enable ${domain}: the owning agent branch does not allow this domain`)
      }
    }
    const user = await updateUserDomainBetsDb(idNum, update, tenant)
    if (!user) throw new Error('User not found')
    return { success: true, message: 'Player visibility and betting permissions updated', user: { ...user, id: String(user.id), status: (user.status?.toUpperCase() || 'ACTIVE') } }
  },
  setUserBonusAllowed: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'players.profile', 'update')
    ensureAgentCanMutate(ctx)
    const p = z.object({ id: z.string().min(1), allow: z.boolean() }).safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    const idNum = Number(p.data.id)
    if (!Number.isFinite(idNum)) throw new Error('Invalid id')
    await playerAuthService.validateAgentPlayerAccess(ctx, idNum, 'change bonus eligibility for')

    // Prevent sharing agents from changing bonus eligibility
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findById(ctx.user.agentId)
      if (agent?.schemeType === 'SHARING') {
        throw new Error('Sharing agents cannot modify player bonus eligibility')
      }
    }
    
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const user = await setUserBonusAllowedDb(idNum, p.data.allow, tenant)
    if (!user) throw new Error('User not found')
    return { success: true, message: 'Bonus eligibility updated', user: { ...user, id: String(user.id), status: (user.status?.toUpperCase() || 'ACTIVE') } }
  },
  setUserVipTier: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'players.vip', 'update')
    ensureAgentCanMutate(ctx)
    const p = SetVipTierInput.safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    const idNum = Number(p.data.id)
    if (!Number.isFinite(idNum)) throw new Error('Invalid id')
    // A tier decides a player's deposit methods and limits, so only whitelabel
    // staff set it. The player drawer has never offered it to agents either.
    if (ctx?.user?.type === 'agent') throw new Error('Agents cannot set player VIP tiers')
    await playerAuthService.validateAgentPlayerAccess(ctx, idNum, 'set the VIP tier of')

    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    
    const user = await setUserVipTierDb(idNum, p.data.vipTierId ?? null, tenant,
      String(ctx?.user?.id || ctx?.user?.sub || 'admin'), 'VIP tier changed from player actions')
    if (!user) throw new Error(`User with id ${idNum} not found`)

    return user
  },
  setUserStatus: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'players.profile', 'update')
    const p = SetStatusInput.safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    const idNum = Number(p.data.id)
    if (!Number.isFinite(idNum)) throw new Error('Invalid id')
    await playerAuthService.validateAgentPlayerAccess(ctx, idNum, 'change the status of')
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const actorId = ctx?.user?.sub ? String(ctx.user.sub) : 'system'
    
    // Get current status before update
    const { getUserDb } = await import('@/repos/users/usersRepo.js')
    const beforeUser = await getUserDb(idNum, tenant)
    const beforeStatus = beforeUser?.status
    
    const row = await setUserStatusDb(idNum, p.data.status, tenant)
    if (!row) throw new Error('User not found')
    if (p.data.status === 'SUSPENDED') {
      const { incrementTokenVersionDb } = await import('@/repos/users/usersRepo.js')
      await incrementTokenVersionDb(idNum, tenant)
    }
    // Audit event
    const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
    recordAuditDb({
      tenant,
      actorId,
      domain: 'users.security',
      action: p.data.status === 'INACTIVE' ? 'deactivate_user' : p.data.status === 'ACTIVE' ? 'reactivate_user' : 'suspend_user',
      resourceType: 'user',
      resourceId: String(idNum),
      before: { status: beforeStatus },
      after: { status: p.data.status },
    }).catch(() => {})
    
    // Format user for GraphQL (User resolver will handle vipTierName and access)
    const user = {
      id: String(row.id),
      tenant: tenant,
      name: row.name,
      email: row.email,
      phone: row.phone,
      username: row.username,
      status: (row.status?.toUpperCase() || 'ACTIVE') as 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
      bonusAllowed: row.bonusAllowed,
      requirePasswordReset: row.requirePasswordReset,
      sportsVisible: row.sportsVisible,
      sportsBetAllowed: row.sportsBetAllowed,
      casinoVisible: row.casinoVisible,
      casinoBetAllowed: row.casinoBetAllowed,
      matkaVisible: row.matkaVisible,
      matkaBetAllowed: row.matkaBetAllowed,
      withdrawalLock: (row as any).withdrawalLock || false,
      riskType: (row as any).riskType || null,
      vipTierId: row.vipTierId,
      createdAt: (row as any).createdAt ? ((row as any).createdAt instanceof Date ? (row as any).createdAt.toISOString() : String((row as any).createdAt)) : null,
    }
    
    return { success: true, message: 'Status updated', user }
  },
  setRequirePasswordReset: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'players.profile', 'update')
    const p = z.object({ id: z.string().min(1), require: z.boolean() }).safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    const idNum = Number(p.data.id)
    if (!Number.isFinite(idNum)) throw new Error('Invalid id')
    await playerAuthService.validateAgentPlayerAccess(ctx, idNum, 'require a password reset for')
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const actorId = ctx?.user?.sub ? String(ctx.user.sub) : 'system'
    
    const resetRow = await setRequirePasswordResetDb(idNum, p.data.require, tenant)
    if (!resetRow) throw new Error('User not found')
    
    // Get full user data for response
    const { getUserDb } = await import('@/repos/users/usersRepo.js')
    const fullUser = await getUserDb(idNum, tenant)
    if (!fullUser) throw new Error('User not found')
    
    // Audit event
    const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
    recordAuditDb({
      tenant,
      actorId,
      domain: 'users.security',
      action: p.data.require ? 'require_password_reset' : 'clear_password_reset',
      resourceType: 'user',
      resourceId: String(idNum),
      after: { requirePasswordReset: p.data.require },
    }).catch(() => {})
    
    // Format user for GraphQL (User resolver will handle vipTierName and access)
    const user = {
      id: String(fullUser.id),
      tenant: tenant,
      name: fullUser.name,
      email: fullUser.email,
      phone: fullUser.phone,
      username: fullUser.username,
      status: (fullUser.status?.toUpperCase() || 'ACTIVE') as 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
      bonusAllowed: fullUser.bonusAllowed,
      requirePasswordReset: fullUser.requirePasswordReset,
      sportsVisible: fullUser.sportsVisible,
      sportsBetAllowed: fullUser.sportsBetAllowed,
      casinoVisible: fullUser.casinoVisible,
      casinoBetAllowed: fullUser.casinoBetAllowed,
      matkaVisible: fullUser.matkaVisible,
      matkaBetAllowed: fullUser.matkaBetAllowed,
      withdrawalLock: (fullUser as any).withdrawalLock || false,
      riskType: (fullUser as any).riskType || null,
      vipTierId: fullUser.vipTierId,
      createdAt: (fullUser as any).createdAt ? (((fullUser as any).createdAt instanceof Date ? (fullUser as any).createdAt.toISOString() : String((fullUser as any).createdAt))) : null,
    }
    
    return { success: true, message: 'Password reset flag updated', user }
  },
  setWithdrawalLock: async (_: any, args: any, ctx: any) => {
    ensureAgentCanMutate(ctx)
    requirePermission(ctx, 'players.profile', 'update')
    const p = z.object({ id: z.string().min(1), lock: z.boolean() }).safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    const idNum = Number(p.data.id)
    if (!Number.isFinite(idNum)) throw new Error('Invalid id')
    await playerAuthService.validateAgentPlayerAccess(ctx, idNum, 'change the withdrawal lock of')
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'

    // Prevent sharing agents from changing withdrawal lock
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findById(ctx.user.agentId)
      if (agent?.schemeType === 'SHARING') {
        throw new Error('Sharing agents cannot modify player withdrawal lock')
      }
    }

    const user = await setWithdrawalLockDb(idNum, p.data.lock, tenant)
    if (!user) throw new Error('User not found')
    
    // Create notification when withdrawal lock is enabled
    if (p.data.lock) {
      try {
        const { getUserDb } = await import('@/repos/users/usersRepo.js')
        const userData = await getUserDb(idNum, tenant)
        if (userData) {
          const { NotificationsRepo } = await import('@/repos/notifications/notificationsRepo.js');
          const { NotificationService } = await import('@/domains/notifications/services/NotificationService.js');
          const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js');
          const directorTenant = getEffectiveTenantForDirector(ctx)
          const whitelabelId = directorTenant ?? tenant;
          const agentId = (userData as { agentId?: string | null })?.agentId ?? null;
          const notificationsRepo = new NotificationsRepo();
          const notificationService = new NotificationService(notificationsRepo);
          const userName = userData.name || userData.username || `User ID ${idNum}`
          const userPhone = userData.phone || 'N/A'
          await notificationService.createNotification(
            {
              tenant,
              whitelabelId: whitelabelId || tenant,
              agentId,
              userId: idNum,
              type: 'PLAYER',
              category: 'general',
              title: 'Withdrawal lock enabled',
              message: `Withdrawal lock has been enabled for player ${userName} (${userPhone}).`,
              actionUrl: `/players/profile/${idNum}`,
              metadata: { userId: idNum, userName, userPhone, action: 'withdrawal_lock_enabled' },
            },
            ctx?.pubsub
          );
        }
      } catch (err: any) {
      }
    }
    
    return { success: true, message: 'Withdrawal lock updated', user: { ...user, id: String(user.id) } }
  },
  updatePlayerRemark: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'players.profile', 'update')
    ensureAgentCanMutate(ctx)
    const p = z.object({
      userId: z.string().min(1),
      remark: z.string().max(512).nullable().optional(),
    }).safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    const idNum = Number(p.data.userId)
    if (!Number.isFinite(idNum)) throw new Error('Invalid userId')
    await playerAuthService.validateAgentPlayerAccess(ctx, idNum, 'update the remark of')
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const updated = await setPlayerRemarkDb(idNum, tenant, p.data.remark ?? null)
    if (!updated) throw new Error('User not found')
    const user = await getUserDb(idNum, tenant)
    if (!user) throw new Error('User not found')
    return {
      success: true,
      message: 'Remark updated',
      user: { ...user, id: String(user.id), status: (user.status?.toUpperCase() || 'ACTIVE'), remark: (user as any).remark ?? null },
    }
  },
  forceLogoutUser: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'players.sessions', 'delete')
    const p = z.object({ id: z.string().min(1) }).safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    const idNum = Number(p.data.id)
    if (!Number.isFinite(idNum)) throw new Error('Invalid id')
    await playerAuthService.validateAgentPlayerAccess(ctx, idNum, 'log out')
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const actorId = ctx?.user?.sub ? String(ctx.user.sub) : 'system'

    await incrementTokenVersionDb(idNum, tenant)
    
    // Audit event
    const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
    recordAuditDb({
      tenant,
      actorId,
      domain: 'users.security',
      action: 'force_logout',
      resourceType: 'user',
      resourceId: String(idNum),
      after: { userId: idNum },
    }).catch(() => {})
    
    return { success: true, message: 'User sessions logged out' }
  },
  upsertPlayerLimits: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'players.limits', 'update')
    const p = PlayerLimitsInput.safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    const { userId, dailyStakeLimit, weeklyStakeLimit, exposureCapOverride, cooldownSeconds, maxBetSports, maxBetCasino, maxBetMatka } = p.data.input
    const idNum = Number(userId)
    if (!Number.isFinite(idNum)) throw new Error('Invalid userId')
    await playerAuthService.validateAgentPlayerAccess(ctx, idNum, 'modify limits for')
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const limits = await upsertPlayerLimitsDb(tenant, idNum, { dailyStakeLimit, weeklyStakeLimit, exposureCapOverride, cooldownSeconds, maxBetSports, maxBetCasino, maxBetMatka })
    return { success: true, message: 'Limits updated', limits }
  },
  adjustWallet: async (_: any, args: any, ctx: any) => { 
    requirePermission(ctx, 'players.wallet', 'update')
    ensureAgentCanMutate(ctx)
    const p = AdjustWalletInput.safeParse(args); 
    if (!p.success) throw new Error('Invalid input')
    // Validate currency if provided
    if (p.data.currency && !currencyService.isValidCurrency(p.data.currency)) {
      throw new Error(`Invalid currency: ${p.data.currency}`)
    }
    const idNum = Number(p.data.userId)
    if (!Number.isFinite(idNum)) throw new Error('Invalid userId')
    await playerAuthService.validateAgentPlayerAccess(ctx, idNum, 'adjust the wallet of')

    // CRITICAL: no agent adjusts a player's cash wallet here.
    // SHARING and COMMISSION agents were always refused. A CREDIT agent was not,
    // and a deposit below debits the WHITELABEL credit pool — so a credit agent
    // could mint cash for its players out of the whitelabel's pool, bypassing its
    // own credit line. Credit agents fund players through the agent credit tools
    // (allocateCreditToPlayer / depositCredit), which debit the agent's own line.
    if (ctx?.user?.type === 'agent') {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = ctx?.user?.agentId ? await agentsRepo.findById(ctx.user.agentId) : null

      if (agent?.schemeType === 'SHARING') {
        throw new Error('Sharing agents cannot adjust player balances')
      }
      if (agent?.schemeType === 'COMMISSION') {
        throw new Error('Commission agents cannot adjust player balances')
      }
      throw new Error('Agents cannot adjust player balances directly. Use the agent credit tools.')
    }
    
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    
    // ENFORCE WHITELABEL CREDIT: When whitelabel admin adjusts any player's wallet (deposit/withdrawal),
    // whitelabel credit must be adjusted regardless of player type
    // Only enforce for whitelabels (not 'default' tenant)
    const isWhitelabel = tenant && tenant !== 'default'
    const isDeposit = p.data.amount > 0
    const isWithdrawal = p.data.amount < 0
    const willAdjustWhitelabelCredit = isWhitelabel && (isDeposit || isWithdrawal)
    
    if (willAdjustWhitelabelCredit && isDeposit) {
      const { WhitelabelCreditService } = await import('@src/domains/common/services/WhitelabelCreditService.js')
      const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js')
      const whitelabelCreditService = new WhitelabelCreditService(new WhitelabelCreditRepo())
      
      // Validate whitelabel has enough credit available for deposit
      const hasCredit = await whitelabelCreditService.validateCreditAvailable(tenant, p.data.amount)
      if (!hasCredit) {
        const creditData = await whitelabelCreditService.getCreditAllocation(tenant)
        throw new Error(
          `Insufficient whitelabel credit. Available: ${creditData.creditAvailable.toFixed(2)}, Requested: ${p.data.amount.toFixed(2)}`
        )
      }
    }
    
    // Get meta from context if available (reason, type, etc.)
    const meta = ctx?.meta || { reason: 'admin_adjustment', type: 'admin_adjustment' }
    
    // ENFORCE WHITELABEL CREDIT: Adjust whitelabel credit inside transaction for atomicity
    const updated = await db.transaction(async (tx) => {
      if (willAdjustWhitelabelCredit) {
        const { WhitelabelCreditService } = await import('@src/domains/common/services/WhitelabelCreditService.js')
        const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js')
        const whitelabelCreditService = new WhitelabelCreditService(new WhitelabelCreditRepo())
        
        if (isDeposit) {
          // Deduct from whitelabel credit on deposit (for any player type)
          await whitelabelCreditService.deductCredit(
            tenant,
            p.data.amount,
            `Direct wallet deposit for player ${idNum}`,
            tx // Pass transaction for atomicity
          )
        } else if (isWithdrawal) {
          // Add back to whitelabel credit on withdrawal (for any player type)
          await whitelabelCreditService.addCredit(
            tenant,
            Math.abs(p.data.amount), // Use absolute value for withdrawal amount
            `Direct wallet withdrawal for player ${idNum}`,
            tx // Pass transaction for atomicity
          )
        }
      }
      
      // Now adjust wallet in same transaction
      const walletResult = await adjustWalletDb(idNum, p.data.amount, meta, tenant, tx)
      return walletResult
    })
    if (!updated) throw new Error('Wallet not found')
    
    // Process deposit bonus if admin opted in via applyBonus checkbox
    if (isDeposit && p.data.applyBonus === true) {
      setImmediate(async () => {
        try {
          const { findEligibleCampaignsForDepositTriggers, awardBonus } = await import('@shared/services/bonusService.js')
          const campaigns = await findEligibleCampaignsForDepositTriggers(tenant)
          
          for (const campaign of campaigns) {
            const result = await awardBonus({
              userId: idNum,
              tenant,
              campaignId: campaign.id,
              depositAmount: p.data.amount,
            })
            
            if (result.success) {
            }
          }
        } catch (error: any) {
        }
      })
    }
    
    // Publish whitelabel credit subscription when whitelabel credit is adjusted (deposits or withdrawals)
    // Use same effectiveWhitelabelId logic as subscription resolver to ensure topic matches
    if (willAdjustWhitelabelCredit && ctx?.pubsub) {
      try {
        const { WhitelabelCreditService } = await import('@src/domains/common/services/WhitelabelCreditService.js')
        const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js')
        const whitelabelCreditService = new WhitelabelCreditService(new WhitelabelCreditRepo())
        
        // Use effectiveWhitelabelId (same logic as subscription resolver) to ensure topic matches
        const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js')
        const directorTenant = getEffectiveTenantForDirector(ctx)
        const effectiveWhitelabelId = directorTenant ?? (ctx?.whitelabel?.id ?? tenant)
        const updatedCredit = await whitelabelCreditService.getCreditAllocation(effectiveWhitelabelId)
        const topic = `WHITELABEL_CREDIT_${effectiveWhitelabelId}`
        
        // Map isNearThreshold to isNearLimit for GraphQL schema compatibility
        const whitelabelCreditInfo = {
          creditLimit: updatedCredit.creditLimit,
          creditUsed: updatedCredit.creditUsed,
          creditAvailable: updatedCredit.creditAvailable,
          creditAlertThreshold: updatedCredit.creditAlertThreshold,
          usagePercentage: Math.round(updatedCredit.usagePercentage * 100) / 100,
          isNearLimit: updatedCredit.isNearThreshold, // Map isNearThreshold to isNearLimit
        }
        
        ctx.pubsub.publish({
          topic,
          payload: { whitelabelCreditUpdated: whitelabelCreditInfo },
        }).catch((err: Error) => {
        })
      } catch (err: any) {
        // Don't fail mutation if subscription fails
      }
    }
    
    // Return Wallet object directly (not a payload) as per GraphQL schema
    return { 
      userId: String(idNum), 
      tenant, 
      currency: updated.currency, 
      balance: Number(updated.cash as any) || 0, 
      bonus: 0, 
      exposure: Number(updated.exposure as any) || 0, 
      updatedAt: new Date().toISOString() 
    }
  },
  upsertRole: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'security.roles', 'create')
    const p = UpsertRoleInput.safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const pairs = p.data.input.permissions.flatMap((perm: any) => (perm.actions || []).map((a: string) => ({ domain: perm.domain, action: a })))
    // This is the flat role API that sits on the same tables as the nested one.
    // Demonstrated end to end: a caller could upsert a role holding
    // `{ domain: 'all', actions: ['*'] }` and assign it to themselves, and
    // `getUserPermissions` then returned `all:*`. Gating the two mutations was
    // not enough — every Whitelabel Admin holds flat `roles:write`, which maps
    // onto `security.roles:create`. The definition itself has to be bounded.
    const actorId = ctx?.user?.sub ? Number(ctx.user.sub) : null
    if (!actorId) throw new Error('Unauthorized: authentication required')
    ensureMayUseRoleName(ctx?.permissions, p.data.input.name)
    await ensureActorMayGrantPermissions(actorId, tenant, pairs)
    await setRolePermissions(p.data.input.name, pairs, tenant)
    return { name: p.data.input.name, permissions: aggregatePermissionPairs(pairs), updatedAt: new Date().toISOString() }
  },
  assignRole: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'security.roles', 'assign')
    const p = AssignRoleInput.safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const userIdNum = Number(p.data.userId)
    if (!Number.isFinite(userIdNum)) throw new Error('Invalid userId')
    // The other half of the same escalation. `assignRoleToAdmin` runs
    // `ensureNoPrivilegeEscalation`; this flat sibling ran nothing, so a role
    // holding more than the actor could be handed to anyone, including the
    // actor. Checked against the role's stored permissions, by name.
    const actorId = ctx?.user?.sub ? Number(ctx.user.sub) : null
    if (!actorId) throw new Error('Unauthorized: authentication required')
    const before = await listRolesWithPermissions(tenant)
    const target = before.find((x: any) => x.name === p.data.role)
    if (target) {
      await ensureActorMayGrantPermissions(actorId, tenant, target.permissions || [])
    }
    await assignRoleToUser(userIdNum, p.data.role, tenant)
    const names = await getUserRoleNames(userIdNum, tenant)
    const all = await listRolesWithPermissions(tenant)
    return names.map(name => {
      const r = all.find(x => x.name === name)
      const perms = aggregatePermissionPairs(r?.permissions || [])
      return { name, permissions: perms, updatedAt: r?.updatedAt || new Date().toISOString() }
    })
  },
  removeRole: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'security.roles', 'assign')
    const p = AssignRoleInput.safeParse(args)
    if (!p.success) throw new Error('Invalid input')
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const userIdNum = Number(p.data.userId)
    if (!Number.isFinite(userIdNum)) throw new Error('Invalid userId')
    await removeRoleFromUser(userIdNum, p.data.role, tenant)
    const names = await getUserRoleNames(userIdNum, tenant)
    const all = await listRolesWithPermissions(tenant)
    return names.map(name => {
      const r = all.find(x => x.name === name)
      const perms = aggregatePermissionPairs(r?.permissions || [])
      return { name, permissions: perms, updatedAt: r?.updatedAt || new Date().toISOString() }
    })
  },
  createPlayer: async (_: any, { input }: any, ctx: any) => {
    requirePermission(ctx, 'players.create', 'create')
    // Agents hold players.create (flat users:write) but have their own path,
    // createPlayerForAgent, which derives the type from the scheme and checks
    // the subtree. Here they could name any agent and any type, including
    // WHITELABEL_CREDIT, which drains the whitelabel pool.
    refuseAgentCallerForAdminCreate(ctx)
    // Ensure tenant is always a valid string, never undefined
    // Extract tenant from context with proper fallback
    let tenant: string = 'default'
    if (ctx?.tenant && typeof ctx.tenant === 'string' && ctx.tenant.trim() !== '') {
      tenant = ctx.tenant.trim()
    } else if (ctx?.whitelabel?.id && typeof ctx.whitelabel.id === 'string' && ctx.whitelabel.id.trim() !== '') {
      tenant = ctx.whitelabel.id.trim()
    }
    
    // Final validation - tenant must be a non-empty string
    if (!tenant || tenant.trim() === '' || tenant === 'undefined' || tenant === 'null') {
      throw new Error('Invalid tenant: tenant value is required and must be a valid string')
    }
    
    // Extract player type (REGULAR, AGENT_CREDIT, WHITELABEL_CREDIT, SHARING_AGENT_PLAYER, COMMISSION_AGENT_PLAYER)
    // Note: This may be overridden by referral code processing below
    const playerType: 'REGULAR' | 'AGENT_CREDIT' | 'WHITELABEL_CREDIT' | 'SHARING_AGENT_PLAYER' | 'COMMISSION_AGENT_PLAYER' = input.playerType || 'REGULAR'
    // These flags are based on input playerType, but will be recalculated after referral processing
    const isCreditPlayer = playerType === 'AGENT_CREDIT' || playerType === 'WHITELABEL_CREDIT'
    const isAgentPlayer = playerType === 'AGENT_CREDIT' || playerType === 'SHARING_AGENT_PLAYER' || playerType === 'COMMISSION_AGENT_PLAYER'
    const canEditBonus = playerType === 'REGULAR' || playerType === 'SHARING_AGENT_PLAYER' || playerType === 'COMMISSION_AGENT_PLAYER'
    
    // Get whitelabel base currency from app config
    const { getAppConfigDb } = await import('@/repos/app-config/appConfigRepo.js')
    const appConfig = await getAppConfigDb(tenant)
    const whitelabelBaseCurrency = appConfig?.baseCurrency || 'INR'
    
    // ========== CREDIT PLAYER RESTRICTIONS (Backend Enforcement) ==========
    if (isCreditPlayer) {
      // 1. Credit limit validation
      // Both credit types accept a limit of 0 (credit can be assigned later). The
      // agent's own create path always allowed 0 for AGENT_CREDIT; this path
      // refused it, so an admin could never create an AGENT_CREDIT player
      // without funding it up front.
      input.creditLimit = normalizeCreditLimit(input.creditLimit)

      // 2. Agent ID validation
      if (playerType === 'AGENT_CREDIT') {
        // AGENT_CREDIT players must have an agentId
        if (!input.agentId) {
          throw new Error('Agent ID is required for AGENT_CREDIT players')
        }
        // The agent must be a CREDIT agent in the caller's tenant, and ACTIVE.
        const { AgentsRepo } = await import('@/repos/agents/AgentsRepo')
        await resolveOwningAgentForCreate(new AgentsRepo(), String(input.agentId), tenant, 'AGENT_CREDIT')
      } else if (playerType === 'WHITELABEL_CREDIT') {
        // WHITELABEL_CREDIT players must NOT have an agentId
        if (input.agentId) {
          throw new Error('WHITELABEL_CREDIT players cannot have an agentId. They are managed directly by the whitelabel.')
        }
      }
      
      // 3. Currency must be whitelabel base currency for credit players
      if (input.currency && input.currency !== whitelabelBaseCurrency) {
        throw new Error(`Credit players must use the whitelabel's base currency (${whitelabelBaseCurrency})`)
      }
      
      // 4. Initial balance must be 0 for credit players (they get credit, not balance)
      if (input.initialBalance && input.initialBalance > 0) {
        throw new Error('Credit players cannot have an initial balance. They receive credit limit instead.')
      }
      
      // 5. Bonus is not allowed for credit players - ENFORCE regardless of input
      if (input.bonusAllowed === true) {
        throw new Error('Credit players are not eligible for bonuses')
      }
      
      // 6. For AGENT_CREDIT players, validate agent has sufficient available credit.
      // An early, friendly refusal only: the binding check is repeated under the
      // agent row's FOR UPDATE lock in the creation transaction below.
      if (playerType === 'AGENT_CREDIT' && input.agentId) {
        const { AgentsRepo } = await import('@/repos/agents/AgentsRepo')
        const agentsRepo = new AgentsRepo()
        const agentCreditData = await agentsRepo.getCreditFields(input.agentId)
        if (!agentCreditData) {
          throw new Error('Agent credit information not found')
        }
        
        const requestedCreditLimit = Number(input.creditLimit)
        const agentAvailableCredit = Number(agentCreditData.creditAvailable || 0)
        
        if (requestedCreditLimit > agentAvailableCredit) {
          throw new Error(
            `Insufficient credit available. Agent has ${agentAvailableCredit.toFixed(2)} available, but ${requestedCreditLimit.toFixed(2)} was requested. ` +
            `(Agent credit limit: ${agentCreditData.creditLimit.toFixed(2)}, Used: ${agentCreditData.creditUsed.toFixed(2)})`
          )
        }
      }
      
      // 7. For WHITELABEL_CREDIT players, validate whitelabel has sufficient available credit (BEFORE creating player)
      if (playerType === 'WHITELABEL_CREDIT' && input.creditLimit) {
        const isWhitelabel = tenant && tenant !== 'default'
        if (isWhitelabel) {
          const requestedCreditLimit = Number(input.creditLimit)
          
          // Validate credit limit is positive and finite
          if (!Number.isFinite(requestedCreditLimit) || requestedCreditLimit <= 0) {
            throw new Error(`Invalid credit limit: ${input.creditLimit}. Must be a positive number.`)
          }

          const { WhitelabelCreditService } = await import('@src/domains/common/services/WhitelabelCreditService.js')
          const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js')
          const whitelabelCreditService = new WhitelabelCreditService(new WhitelabelCreditRepo())
          
          // Validate whitelabel exists
          const whitelabelCredit = await whitelabelCreditService.getCreditAllocation(tenant)
          if (!whitelabelCredit) {
            throw new Error(`Whitelabel not found: ${tenant}`)
          }
          
          // Validate whitelabel has enough credit available (BEFORE creating player)
          const hasCredit = await whitelabelCreditService.validateCreditAvailable(tenant, requestedCreditLimit)
          if (!hasCredit) {
            throw new Error(
              `Insufficient whitelabel credit. Available: ${whitelabelCredit.creditAvailable.toFixed(2)}, Requested: ${requestedCreditLimit.toFixed(2)}`
            )
          }
        }
      }
    }
    // ======================================================================
    
    // ========== AGENT PLAYER VALIDATION (SHARING_AGENT_PLAYER, COMMISSION_AGENT_PLAYER) ==========
    if (isAgentPlayer && !isCreditPlayer) {
      // SHARING_AGENT_PLAYER and COMMISSION_AGENT_PLAYER must have an agentId
      if (!input.agentId) {
        throw new Error(`Agent ID is required for ${playerType} players`)
      }
      
      // Validate the agent exists in the caller's tenant, has the correct scheme
      // type and is ACTIVE. An unscoped findById accepted another tenant's agent.
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo')
      await resolveOwningAgentForCreate(new AgentsRepo(), String(input.agentId), tenant, playerType)
    }
    // ======================================================================
    
    // ========== BONUS ELIGIBILITY RESTRICTIONS ==========
    // Bonus is only allowed for REGULAR, SHARING_AGENT_PLAYER, COMMISSION_AGENT_PLAYER
    if (!canEditBonus && input.bonusAllowed === true) {
      throw new Error('Bonus eligibility is not allowed for this player type')
    }
    // ======================================================================
    
    const name: string = input.name
    const phone: string = input.phone
    const email: string | null = input.email || null
    // For credit players: always 0. For regular players: use input value
    // Note: This uses input playerType, not finalPlayerType (which is determined after referral processing)
    // This is correct because initialBalance should be based on what user requested, not what referral code changes
    const initialBalance: number = isCreditPlayer ? 0 : (input.initialBalance ?? 0)
    // For credit players: always use whitelabel base currency. For others: use input value or default
    const currency: string = isCreditPlayer ? whitelabelBaseCurrency : (input.currency || whitelabelBaseCurrency)
    const status: 'active' | 'inactive' | 'suspended' = (input.status?.toLowerCase?.() ?? 'active')
    // For credit players: always false. For others: use input value (default true for REGULAR, SHARING_AGENT_PLAYER, COMMISSION_AGENT_PLAYER)
    const bonusAllowed: boolean = canEditBonus ? (input.bonusAllowed ?? true) : false
    const requirePasswordReset: boolean = input.requirePasswordReset ?? false
    const sportsVisible: boolean = input.sportsVisible ?? true
    const sportsBetAllowed: boolean = input.sportsBetAllowed ?? true
    const casinoVisible: boolean = input.casinoVisible ?? true
    const casinoBetAllowed: boolean = input.casinoBetAllowed ?? true
    const matkaVisible: boolean = input.matkaVisible ?? false
    const matkaBetAllowed: boolean = input.matkaBetAllowed ?? false
    const riskType: 'low' | 'medium' | 'high' | undefined = input.riskType ? input.riskType.toLowerCase?.() : undefined
    const vipTierId: string | undefined = input.vipTierId ?? undefined
    // Pinning a tier at creation is a VIP change like any other.
    if (vipTierId) requirePermission(ctx, 'players.vip', 'update')

    // Generate a unique 12-char alphanumeric username (not exposed on frontend list)
    function generateUsername(length = 12): string {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
      let out = ''
      for (let i = 0; i < length; i++) out += alphabet.charAt(Math.floor(Math.random() * alphabet.length))
      return out
    }
    const username = input.username?.trim?.() || generateUsername(12)

    const password: string | undefined = input.password?.trim?.() || undefined

    // Handle referral signup with agent support - CHECK BEFORE CREATING PLAYER
    const refCode = (input as any).refCode
    let agentIdFromReferral: string | null = null
    let playerTypeFromReferral: 'SHARING_AGENT_PLAYER' | 'COMMISSION_AGENT_PLAYER' | null = null

    // Validation: Prevent referral code from overriding explicit credit player types
    if (refCode && (playerType === 'AGENT_CREDIT' || playerType === 'WHITELABEL_CREDIT')) {
      // Don't process referral code for credit players - they must be explicitly assigned
    } else if (refCode) {
      try {
        const { getReferralLinkByCodeDb } = await import('@src/repos/referrals/referralsRepo.js')
        // Normalize refCode to uppercase for consistent lookup (getReferralLinkByCodeDb also normalizes, but doing it here for clarity)
        const referralLink = await getReferralLinkByCodeDb(refCode.toUpperCase().trim())
        
        if (referralLink && referralLink.tenant === tenant && referralLink.isActive) {
          // Check if this is an agent referral
          // Handle case where agent was deleted (agentId would be NULL due to ON DELETE SET NULL)
          if (!referralLink.agentId && !referralLink.userId) {
            // Don't throw - allow player creation to proceed without referral
          } else if (referralLink.agentId) {
            // Validate agent exists and is active
            const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
            const agentsRepo = new AgentsRepo()
            const agent = await agentsRepo.findById(referralLink.agentId)
            
            if (!agent) {
              throw new Error(`Agent not found for referral code ${refCode}`)
            }
            
            if (agent.status !== 'ACTIVE') {
              throw new Error(`Agent is not active. Status: ${agent.status}`)
            }
            
            if (agent.schemeType !== 'SHARING' && agent.schemeType !== 'COMMISSION') {
              throw new Error(`Invalid agent type for referral. Expected SHARING or COMMISSION, got ${agent.schemeType}`)
            }
            
            if (agent.tenantId !== tenant) {
              throw new Error(`Agent belongs to different tenant`)
            }

            // Set agent assignment - use this when creating player
            agentIdFromReferral = referralLink.agentId
            playerTypeFromReferral = agent.schemeType === 'SHARING' 
              ? 'SHARING_AGENT_PLAYER' 
              : 'COMMISSION_AGENT_PLAYER'
            
            // Override input values if they conflict
            if (input.agentId && input.agentId !== agentIdFromReferral) {
            }
            
            if (input.playerType && input.playerType !== playerTypeFromReferral) {
            }
          }
        }
      } catch (error) {
        // If agent validation fails, we should fail the player creation
        if (error instanceof Error && error.message.includes('Agent')) {
          throw error
        }
      }
    }

    // Determine final playerType and agentId (after referral processing)
    const finalPlayerType = playerTypeFromReferral || playerType
    const finalAgentId = agentIdFromReferral || ((playerType === 'AGENT_CREDIT' || playerType === 'SHARING_AGENT_PLAYER' || playerType === 'COMMISSION_AGENT_PLAYER') ? input.agentId : (playerType === 'WHITELABEL_CREDIT' ? null : null))
    const finalIsCreditPlayer = finalPlayerType === 'AGENT_CREDIT' || finalPlayerType === 'WHITELABEL_CREDIT'

    // Additional validation after referral processing: ensure credit limit is valid for credit players.
    // Both credit types accept 0 (see normalizeCreditLimit): an AGENT_CREDIT player
    // with no line yet is valid, exactly as on the agent's own create path.
    const creditLimitValue = finalIsCreditPlayer ? normalizeCreditLimit(input.creditLimit) : 0
    if (finalIsCreditPlayer) input.creditLimit = creditLimitValue

    // The owning agent, whichever route named it (input or referral code), must
    // belong to this tenant and be ACTIVE. Its allowedDomains cap the new
    // player's domain flags (owner decision 4: an agent's domains limit its
    // players' betting).
    const { AgentsRepo: OwningAgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
    const owningAgentsRepo = new OwningAgentsRepo()
    let domainCap: ReturnType<typeof bettingFlagsFromAgentDomains> | null = null
    if (finalAgentId) {
      const owningAgent = await owningAgentsRepo.findByIdScoped(String(finalAgentId), tenant)
      if (!owningAgent) throw new Error('Agent not found')
      if (owningAgent.status !== 'ACTIVE') throw new Error(`Agent is not active. Status: ${owningAgent.status}`)
      domainCap = bettingFlagsFromAgentDomains(owningAgent.allowedDomains)
    }

    const isWhitelabelTenant = !!tenant && tenant !== 'default'
    const { WhitelabelCreditService } = await import('@src/domains/common/services/WhitelabelCreditService.js')
    const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js')

    // MONEY-CRITICAL: the credit a new credit player receives and the player row
    // are one transaction. Before, the agent's credit was read with no lock,
    // absolute used/available values were written, and that happened in its own
    // transaction AFTER the player had already been committed — so two concurrent
    // creates could both pass the check and over-allocate, and a failed deduction
    // left a funded player behind. Now:
    //   1. the agent row is locked FOR UPDATE and the limit is applied as a delta,
    //      re-validated against the locked row (lockAndUpdateCredit throws if the
    //      locked row lacks availability);
    //   2. the player, its wallet and its agent_player_credits row are written on
    //      the same transaction;
    //   3. a WHITELABEL_CREDIT player's limit is deducted from the whitelabel pool
    //      on the same transaction (deductCredit locks and re-checks too).
    // Any failure rolls all of it back.
    // The agent's ALLOCATION credit-ledger row is written in the same transaction, as the agent's
    // own create path and every other allocation path do (plan W7). Currency is read before the lock.
    const allocatesAgentCredit = finalPlayerType === 'AGENT_CREDIT' && !!finalAgentId && creditLimitValue > 0
    const allocationLedger = allocatesAgentCredit
      ? {
          repo: new (await import('@/repos/agents/AgentCreditLedgerRepo.js')).AgentCreditLedgerRepo(),
          currency: await (await import('@src/shared/whitelabelConfig.js')).getWhitelabelCurrency(tenant),
        }
      : null
    const created = await db.transaction(async (tx) => {
      let agentSnapshot: { creditLimit: number; creditUsed: number; creditAvailable: number; settlementBalance: number } | null = null
      if (allocatesAgentCredit) {
        agentSnapshot = await owningAgentsRepo.lockAndUpdateCredit(String(finalAgentId), {
          creditUsedDelta: creditLimitValue,
          requireAvailableForDelta: true,
        }, tx)
      }

      const row = await createPlayerDb({
        tenant,
        name,
        phone,
        email,
        username,
        password,
        status,
        bonusAllowed,
        requirePasswordReset,
        sportsVisible: sportsVisible && (domainCap?.sportsVisible ?? true),
        sportsBetAllowed: sportsBetAllowed && (domainCap?.sportsBetAllowed ?? true),
        casinoVisible: casinoVisible && (domainCap?.casinoVisible ?? true),
        casinoBetAllowed: casinoBetAllowed && (domainCap?.casinoBetAllowed ?? true),
        matkaVisible: matkaVisible && (domainCap?.matkaVisible ?? true),
        matkaBetAllowed: matkaBetAllowed && (domainCap?.matkaBetAllowed ?? true),
        riskType,
        vipTierId,
        vipActor: String(ctx?.user?.id || ctx?.user?.sub || 'admin'),
        initialBalance,
        currency,
        // New credit player fields
        // Use referral-based playerType and agentId if available, otherwise use input values
        playerType: finalPlayerType,
        agentId: finalAgentId,
        creditLimit: finalIsCreditPlayer ? creditLimitValue : null,
        creditUsed: finalIsCreditPlayer ? 0 : null,
        creditAvailable: finalIsCreditPlayer ? creditLimitValue : null,
        limits: {
          dailyStakeLimit: input.dailyStakeLimit ?? null,
          weeklyStakeLimit: input.weeklyStakeLimit ?? null,
          exposureCapOverride: input.exposureCapOverride ?? null,
          cooldownSeconds: input.cooldownSeconds ?? null,
          maxBetSports: input.maxBetSports ?? null,
          maxBetCasino: input.maxBetCasino ?? null,
          maxBetMatka: input.maxBetMatka ?? null,
        }
      }, tx)

      // Ensure every AGENT_CREDIT player has an agent_player_credits (apc) row so the
      // bet cascade (which only UPDATEs an existing apc row) can track per-player exposure.
      // Idempotent via onConflictDoNothing (the 0087 unique index on (agent_id, player_id)).
      // The owning agent is finalAgentId (same agentId passed to createPlayerDb above).
      if (finalPlayerType === 'AGENT_CREDIT' && finalAgentId) {
        const { agentPlayerCredits } = await import('@shared/db/schema.js')
        const apcLimit = String(creditLimitValue)
        // Cast to any: drizzle cross-package table typing produces a spurious
        // PgTable<TableConfig> mismatch here (same as the vip_members inserts in this
        // file). Runtime behavior is unaffected.
        await (tx as any)
          .insert(agentPlayerCredits)
          .values({
            agentId: finalAgentId,
            playerId: row.id,
            creditLimit: apcLimit,
            currentBalance: '0',
            openExposure: '0',
            creditUsed: '0',
            creditAvailable: apcLimit,
          })
          .onConflictDoNothing()
      }

      if (allocationLedger && agentSnapshot) {
        const adminId = String(ctx?.user?.id ?? '')
        await allocationLedger.repo.recordTransaction({
          tenantId: tenant,
          fromEntityType: 'agent',
          fromEntityId: String(finalAgentId),
          toEntityType: 'player',
          toEntityId: String(row.id),
          transactionType: 'ALLOCATION',
          amount: creditLimitValue,
          currency: allocationLedger.currency,
          balanceBefore: Math.max(0, Math.round((agentSnapshot.creditLimit - (agentSnapshot.creditUsed - creditLimitValue) + agentSnapshot.settlementBalance) * 100) / 100),
          balanceAfter: agentSnapshot.creditAvailable,
          reason: 'Credit allocation to player at creation (by an administrator)',
          createdBy: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(adminId) ? adminId : undefined,
          createdByType: 'admin',
          metadata: { allocationType: 'player_creation' },
        }, tx)
      }

      // ENFORCE WHITELABEL CREDIT: deduct the WHITELABEL_CREDIT player's limit from
      // the whitelabel pool. Validated above for a friendly early error; deductCredit
      // re-validates under its own FOR UPDATE lock on this transaction.
      if (finalPlayerType === 'WHITELABEL_CREDIT' && creditLimitValue > 0 && isWhitelabelTenant) {
        const whitelabelCreditService = new WhitelabelCreditService(new WhitelabelCreditRepo())
        await whitelabelCreditService.deductCredit(
          tenant,
          creditLimitValue,
          `WHITELABEL_CREDIT player created - Player ID: ${row.id}, Credit Limit: ${creditLimitValue}`,
          tx
        )
      }

      return row
    })

    // Record audit for Recent Activity (agent dashboard): every player creation
    const { recordAuditDb } = await import('@src/repos/audit/auditRepo.js')
    recordAuditDb({
      tenant,
      actorId: String(ctx?.user?.id ?? ctx?.user?.agentId ?? 'system'),
      domain: 'players',
      action: 'create_player',
      resourceType: 'player',
      resourceId: String(created.id),
      after: {
        username: created.username,
        name: created.name,
        agentId: finalAgentId ?? null,
        playerType: finalPlayerType,
      },
    }).catch(() => {})

    // Handle referral signup (async, non-blocking)
    // Only process if it's NOT an agent referral (agent referrals are already handled above)
    if (refCode && !agentIdFromReferral) {
      const { referralIntegrationService } = await import('@src/services/referrals/referralIntegrationService.js')
      referralIntegrationService.handleSignup(tenant, Number(created.id), refCode, (currency || 'INR') as any)
        .catch(() => {})
    } else if (agentIdFromReferral) {
      // Agent referral - log for tracking (player already created with correct agentId and playerType)
      
      // Record audit trail
      const { recordAuditDb } = await import('@src/repos/audit/auditRepo.js')
      recordAuditDb({
        tenant,
        actorId: agentIdFromReferral,
        domain: 'players',
        action: 'create_player_via_referral',
        resourceType: 'player',
        resourceId: String(created.id),
        after: {
          agentId: agentIdFromReferral,
          playerType: playerTypeFromReferral,
          referralCode: refCode,
        },
      }).catch(() => {})
    }

    return { success: true, message: `${finalIsCreditPlayer ? 'Credit' : 'Regular'} player created successfully`, user: { id: created.id, tenant, name, email: email || null, phone, username, vipTierId } }
  },
  changeAdminPassword: async (_: any, args: any, ctx: any) => {
    const p = z.object({ 
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8, 'Password must be at least 8 characters')
    }).safeParse(args)
    if (!p.success) {
      throw new Error(p.error.issues.map(e => e.message).join(', '))
    }

    const userId = ctx?.user?.sub
    if (!userId) {
      throw new Error('Unauthorized: User not authenticated')
    }

    const userIdNum = Number(userId)
    if (!Number.isFinite(userIdNum)) {
      throw new Error('Invalid user ID')
    }

    // Get current password hash
    const currentPasswordHash = await getUserPasswordHashDb(userIdNum)
    if (!currentPasswordHash) {
      throw new Error('User not found')
    }

    // Verify current password
    const isCurrentPasswordValid = await verifyPassword(p.data.currentPassword, currentPasswordHash)
    if (!isCurrentPasswordValid) {
      throw new Error('Current password is incorrect')
    }

    // Check if new password is different from current password
    const isSamePassword = await verifyPassword(p.data.newPassword, currentPasswordHash)
    if (isSamePassword) {
      throw new Error('New password must be different from current password')
    }

    // Hash new password
    const newPasswordHash = await hashPassword(p.data.newPassword)

    // Update password
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    // A self-change: `userIdNum` is `ctx.user.sub`, never an argument.
    await updateUserPasswordDb(userIdNum, newPasswordHash, null)
    await incrementTokenVersionDb(userIdNum, tenant)

    // Audit logging
    const actorId = String(userIdNum)
    const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
    recordAuditDb({
      tenant,
      actorId,
      domain: 'users.security',
      action: 'change_password',
      resourceType: 'user',
      resourceId: String(userIdNum),
      after: { passwordChanged: true },
    }).catch(() => {})

    return { success: true, message: 'Password changed successfully' }
  }
}
