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
import { resolveOwningAgentForCreate, refuseAgentCallerForAdminCreate } from '@src/domains/users/resolvers/createPlayerRules.js'
import { creatorActorOf, creditReferenceOf, depositOpeningChipsInTx, lockOpeningChipsParent, openingChipsOf, openingChipsRestrictedUplineRefusal } from '@src/domains/agents/services/openingChips.js'
import { ChipRepo } from '@src/repos/agents/ChipRepo.js'
import { isCreditPlayer as isCreditPlayerType } from '@shared/services/credit/isCreditPlayer.js'
import { bettingFlagsFromAgentDomains, playerCreatedMessage } from '@src/domains/players/resolvers/agentPlayerCreation.js'
import { loadPlayerDomains, PLAYER_DOMAINS } from '@shared/access/playerDomains.js'
import { playerLimitFields, limitInputError } from '@src/domains/players/playerLimitsInput.js'
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

/**
 * A manual cash movement on a player's wallet with the whitelabel pool it comes from or returns to, on the
 * caller's transaction: a deposit debits the pool, a withdrawal releases to it (the 'default' tenant has no
 * pool). Used by adjustWallet and by createPlayer's opening balance, so both write the same pool and ledger rows.
 *
 * MONEY-CRITICAL: the pool row is locked first and the wallet second, the order the deposit approvals use.
 * adjustWalletDb refuses a withdrawal above the available balance under the wallet lock, and a missing wallet
 * throws here, inside the transaction, so either refusal rolls the pool movement back. (A null wallet used to be
 * reported only after the commit, leaving the pool debited or credited for nothing.)
 */
async function moveWalletCashWithPoolInTx(tx: any, tenant: string, playerId: number, amount: number, meta: Record<string, unknown>) {
  if (tenant && tenant !== 'default') {
    const { WhitelabelCreditService } = await import('@src/domains/common/services/WhitelabelCreditService.js')
    const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js')
    const whitelabelCreditService = new WhitelabelCreditService(new WhitelabelCreditRepo())
    if (amount > 0) {
      await whitelabelCreditService.deductCredit(tenant, amount, `Direct wallet deposit for player ${playerId}`, tx)
    } else if (amount < 0) {
      await whitelabelCreditService.addCredit(tenant, Math.abs(amount), `Direct wallet withdrawal for player ${playerId}`, tx)
    }
  }
  const wallet = await adjustWalletDb(playerId, amount, meta, tenant, tx)
  if (!wallet) throw new Error('Wallet not found')
  return wallet
}

/**
 * Which kind of account an audited "user" is (SYS-14). Staff and players share the users table, and the
 * users.security rows below (status, password reset, force logout, the admin sign-in) look the same for both, so
 * the Audit Trail could not tell which page a row's resource opens. From now on the row records it in `after` as
 * `accountKind`; older rows carry none and keep the Audit Trail's old rule. A player holds no role in this tenant and
 * has a wallet (rbacRepo.isPlayerAccount); any other account is staff. Never throws: undefined leaves the key out.
 */
async function auditAccountKind(userId: number, tenant: string): Promise<'admin' | 'player' | undefined> {
  try {
    const { isPlayerAccount } = await import('@/repos/rbac/rbacRepo.js')
    return (await isPlayerAccount(userId, tenant)) ? 'player' : 'admin'
  } catch {
    return undefined
  }
}

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
  ...playerLimitFields,
}) })
const AdjustWalletInput = z.object({
  userId: z.string().min(1),
  amount: z.number().min(-MAX_FINANCIAL_AMOUNT).max(MAX_FINANCIAL_AMOUNT),
  currency: z.string().min(3).max(3).optional(),
  applyBonus: z.boolean().optional(),
  reason: z.string().max(500).nullable().optional(),
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
        // The lookup above spans every tenant's users, so this can be a player's account.
        const accountKind = user.roles?.length ? 'admin' : await auditAccountKind(user.id, tenant)
        const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
        await recordAuditDb({
          tenant,
          actorId: String(user.id),
          domain: 'users.security',
          action: 'login_failed',
          resourceType: 'user',
          resourceId: String(user.id),
          after: { success: false, ipAddress: auditIp, userAgent: auditUserAgent, accountKind },
        }).catch(() => {})
        throw new Error('Invalid credentials')
      }

      if (!user.roles || user.roles.length === 0) {
        recordFailedLoginAttempt(ip, email)
        // No role here: typically a player's credentials typed into the admin panel.
        const accountKind = await auditAccountKind(user.id, tenant)
        const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
        await recordAuditDb({
          tenant,
          actorId: String(user.id),
          domain: 'users.security',
          action: 'login_failed',
          resourceType: 'user',
          resourceId: String(user.id),
          after: { success: false, ipAddress: auditIp, userAgent: auditUserAgent, accountKind },
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
            after: { success: false, ipAddress: auditIp, userAgent: auditUserAgent, accountKind: 'admin' },
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
            after: { success: false, ipAddress: auditIp, userAgent: auditUserAgent, accountKind: 'admin' },
          }).catch(() => {})
          recordFailedLoginAttempt(ip, email)
          throw new Error('Access denied: Whitelabel Admins must login via their own tenant domain')
        }
      }

      // The columns buildAuthContext checks on every request. A deactivated or suspended admin was issued a token
      // and could use it; the token now also carries users.token_version, so Logout, Force Logout and a password
      // change end it (SYS-08).
      const { readAdminSessionState } = await import('@/domains/common/auth.js')
      const session = await readAdminSessionState(user.id)
      if (!session || session.status !== 'active') {
        recordFailedLoginAttempt(ip, email)
        const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
        await recordAuditDb({
          tenant,
          actorId: String(user.id),
          domain: 'users.security',
          action: 'login_failed',
          resourceType: 'user',
          resourceId: String(user.id),
          after: { success: false, reason: 'inactive', ipAddress: auditIp, userAgent: auditUserAgent, accountKind: 'admin' },
        }).catch(() => {})
        throw new Error('This account is not active. Contact your administrator.')
      }

      clearLoginAttempts(ip, email)
      const token = signJwt({ sub: String(user.id), name: user.name, roles: user.roles, v: session.tokenVersion })
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
        after: { success: true, ipAddress: auditIp, userAgent: auditUserAgent, accountKind: 'admin' },
      }).catch(() => {})

      // requirePasswordReset: until the admin chooses a new password its session may only do that
      // (buildAuthContext, guardAdminSurface). Returned so the sign-in page can ask for it straight away.
      return { token, user: { id: String(user.id), name: user.name }, roles: user.roles, permissions, tenant: normalizedTenant, requirePasswordReset: session.requirePasswordReset }
    } catch (err: any) {
      throw err
    }
  },
  logout: async (_: any, __: any, ctx: any) => {
    const userId = ctx?.user?.sub
    if (!userId) {
      return { success: true, message: 'Not authenticated' }
    }
    // An agent's sub is its uuid, so Number(sub) was NaN and nothing was bumped: Sign out answered "Logged out"
    // while the token kept working until it expired. Moving agents.token_version on ends it, as suspend does.
    if (ctx.user.type === 'agent' && ctx.user.agentId) {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      await new AgentsRepo().incrementTokenVersion(String(ctx.user.agentId))
      return { success: true, message: 'Logged out' }
    }
    const userIdNum = Number(userId)
    if (Number.isSafeInteger(userIdNum) && userIdNum > 0) {
      // By id: the id is the caller's own, from its session, and a Super Admin's row is not in ctx.tenant.
      const { endAdminSessions } = await import('@/domains/common/auth.js')
      await endAdminSessions(userIdNum)
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
    const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
    recordAuditDb({ tenant, actorId: ctx?.user?.sub ? String(ctx.user.sub) : 'system', domain: 'players', action: 'set_domain_controls', resourceType: 'player', resourceId: String(idNum), after: update }).catch(() => {})
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

    // Credit players get no bonuses (spec 2026-11-02 decision 7). Their cash wallet holds their chips, which move only
    // through Deposit / Withdraw by their direct upline; a bonus would add pool-funded money outside that chain.
    // Turning bonuses off is always allowed.
    if (p.data.allow) {
      const target = await new ChipRepo().readPlayer(db, idNum, String(tenant))
      if (target && isCreditPlayerType(target.playerType)) {
        throw new Error('Credit players cannot receive bonuses: their chips move only through Deposit / Withdraw')
      }
    }

    const user = await setUserBonusAllowedDb(idNum, p.data.allow, tenant)
    if (!user) throw new Error('User not found')
    const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
    recordAuditDb({ tenant, actorId: ctx?.user?.sub ? String(ctx.user.sub) : 'system', domain: 'players', action: 'set_bonus_eligibility', resourceType: 'player', resourceId: String(idNum), after: { bonusAllowed: p.data.allow } }).catch(() => {})
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

    // The writer's row as the other user mutations hand theirs back: a string id and the PlayerStatus value (it was
    // the row's lowercase 'active', so a reply selecting status failed "Enum PlayerStatus cannot represent value"),
    // with the player's tenant for the VIP field resolvers (vipTierName, vipDepositAccess).
    return { ...user, id: String(user.id), tenant, status: (user.status?.toUpperCase() || 'ACTIVE') as 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' }
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
    // Audit event. Support Admins uses this too, so the row says which kind of account it names.
    const accountKind = await auditAccountKind(idNum, tenant)
    const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
    recordAuditDb({
      tenant,
      actorId,
      domain: 'users.security',
      action: p.data.status === 'INACTIVE' ? 'deactivate_user' : p.data.status === 'ACTIVE' ? 'reactivate_user' : 'suspend_user',
      resourceType: 'user',
      resourceId: String(idNum),
      // On both sides: the account's kind is not part of the change ("Changed: status" in the trail's summary).
      before: { status: beforeStatus, accountKind },
      after: { status: p.data.status, accountKind },
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
    
    // Audit event, naming the kind of account (a player or a support admin).
    const accountKind = await auditAccountKind(idNum, tenant)
    const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
    recordAuditDb({
      tenant,
      actorId,
      domain: 'users.security',
      action: p.data.require ? 'require_password_reset' : 'clear_password_reset',
      resourceType: 'user',
      resourceId: String(idNum),
      after: { requirePasswordReset: p.data.require, accountKind },
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
    const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
    recordAuditDb({ tenant, actorId: ctx?.user?.sub ? String(ctx.user.sub) : 'system', domain: 'players', action: 'set_withdrawal_lock', resourceType: 'player', resourceId: String(idNum), after: { withdrawalLock: p.data.lock } }).catch(() => {})

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
    const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
    recordAuditDb({ tenant, actorId: ctx?.user?.sub ? String(ctx.user.sub) : 'system', domain: 'players', action: 'update_remark', resourceType: 'player', resourceId: String(idNum), after: { remark: p.data.remark ?? null } }).catch(() => {})
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

    // The scoped increment changes nothing for another tenant's player; without this check the caller was
    // still told "User sessions logged out" and an audit row was written for it.
    if (!(await getUserDb(idNum, tenant))) throw new Error('User not found')
    await incrementTokenVersionDb(idNum, tenant)
    
    // Audit event, naming the kind of account (a player or a support admin).
    const accountKind = await auditAccountKind(idNum, tenant)
    const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
    recordAuditDb({
      tenant,
      actorId,
      domain: 'users.security',
      action: 'force_logout',
      resourceType: 'user',
      resourceId: String(idNum),
      after: { userId: idNum, accountKind },
    }).catch(() => {})
    
    return { success: true, message: 'User sessions logged out' }
  },
  upsertPlayerLimits: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'players.limits', 'update')
    const p = PlayerLimitsInput.safeParse(args)
    if (!p.success) throw limitInputError(p.error)
    const { userId, dailyStakeLimit, weeklyStakeLimit, exposureCapOverride, cooldownSeconds, maxBetSports, maxBetCasino, maxBetMatka } = p.data.input
    const idNum = Number(userId)
    if (!Number.isFinite(idNum)) throw new Error('Invalid userId')
    await playerAuthService.validateAgentPlayerAccess(ctx, idNum, 'modify limits for')
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    // upsertPlayerLimitsDb refuses an id that is not a player of this tenant ("Player not found").
    const limits = await upsertPlayerLimitsDb(tenant, idNum, { dailyStakeLimit, weeklyStakeLimit, exposureCapOverride, cooldownSeconds, maxBetSports, maxBetCasino, maxBetMatka })
    const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
    recordAuditDb({
      tenant,
      actorId: ctx?.user?.sub ? String(ctx.user.sub) : 'system',
      domain: 'players',
      action: 'set_limits',
      resourceType: 'player',
      resourceId: String(idNum),
      after: limits,
    }).catch(() => {})
    return { success: true, message: 'Limits updated', limits }
  },
  adjustWallet: async (_: any, args: any, ctx: any) => { 
    requirePermission(ctx, 'players.wallet', 'update')
    ensureAgentCanMutate(ctx)
    const p = AdjustWalletInput.safeParse(args);
    if (!p.success) throw new Error('Invalid input')
    // A zero adjustment moves nothing but still wrote a ledger row of 0.
    if (p.data.amount === 0) throw new Error('Amount must not be zero')
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
    // own chips. Credit agents fund their players with Deposit chips
    // (agents.depositChips), which debits the agent's own chips.
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
      throw new Error('Agents cannot adjust player balances directly. Use Deposit / Withdraw chips.')
    }

    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'

    // A credit player's cash wallet holds its chips (spec 2026-11-02 §2), which move only through Deposit /
    // Withdraw chips by its direct parent, with their credit_chip_ledger rows. A direct wallet adjustment here
    // would mint or remove chips outside that ledger and outside the direct-parent rule.
    // MONEY-CRITICAL: the player must exist in this tenant before any pool credit moves. An id from another
    // tenant, or none at all, used to reach the pool movement below and only fail after it had committed.
    const target = await new ChipRepo().readPlayer(db, idNum, String(tenant))
    if (!target) throw new Error('Player not found')
    if (isCreditPlayerType(target.playerType)) {
      throw new Error("A credit player's chips move only through Deposit / Withdraw chips")
    }

    // The admin's reason goes on both ledger rows and on the audit row, which the adjustment dialog promises.
    const reason = p.data.reason?.trim() ?? ''
    if (!reason) throw new Error('A reason is required for a balance adjustment')

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
    
    // meta.type stays 'admin_adjustment': reports and statements classify manual deposits/withdrawals by it.
    const meta = { type: 'admin_adjustment', reason }

    // ENFORCE WHITELABEL CREDIT: Adjust whitelabel credit inside transaction for atomicity
    const updated = await db.transaction((tx) => moveWalletCashWithPoolInTx(tx, tenant, idNum, p.data.amount, meta))

    const balanceAfter = Number(updated.cash as any) || 0
    const { recordAuditDb } = await import('@/repos/audit/auditRepo.js')
    recordAuditDb({
      tenant,
      actorId: String(ctx?.user?.sub ?? 'system'),
      domain: 'players',
      action: p.data.amount > 0 ? 'manual_deposit' : 'manual_withdrawal',
      resourceType: 'player',
      resourceId: String(idNum),
      before: { balance: Math.round((balanceAfter - p.data.amount) * 100) / 100 },
      after: { amount: p.data.amount, reason, balance: balanceAfter, currency: updated.currency },
    }).catch(() => {})

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
    
    // Opening chips (spec 2026-11-02 §4.4): a deposit from the new credit player's parent (its agent, or the
    // whitelabel pool for a WHITELABEL_CREDIT player), made on the creation transaction below.
    const openingChips = openingChipsOf(input.openingChips)
    if (openingChips > 0 && !isCreditPlayer) {
      throw new Error('Opening chips can only be given to credit players')
    }

    // ========== CREDIT PLAYER RESTRICTIONS (Backend Enforcement) ==========
    if (isCreditPlayer) {
      // 1. The credit reference: the figure the player's Ref P/L is measured against. It gates nothing and
      // moves no chips, so 0 (the create form's default) is as valid as any other value.
      input.creditLimit = creditReferenceOf(input.creditLimit)

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
      
      // 4. Initial balance must be 0 for credit players: their chips arrive as a deposit (openingChips)
      if (input.initialBalance && input.initialBalance > 0) {
        throw new Error('Credit players cannot have an initial balance. Give them opening chips instead.')
      }

      // 5. Bonus is not allowed for credit players - ENFORCE regardless of input
      if (input.bonusAllowed === true) {
        throw new Error('Credit players are not eligible for bonuses')
      }
      // Whether the parent has the opening chips is decided under its lock, in the creation transaction.
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
    
    // Required here as on the agent path: a blank name was accepted and stored.
    const name: string = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name) throw new Error('Name is required')
    const phone: string = input.phone
    const email: string | null = input.email || null
    // For credit players: always 0. For regular players: use input value
    // Note: This uses input playerType, not finalPlayerType (which is determined after referral processing)
    // This is correct because initialBalance should be based on what user requested, not what referral code changes
    // The opening balance is a deposit made on the creation transaction below (pool debit and ledger rows).
    const initialBalance: number = isCreditPlayer ? 0 : Number(input.initialBalance ?? 0)
    if (!Number.isFinite(initialBalance) || initialBalance < 0 || initialBalance > MAX_FINANCIAL_AMOUNT) {
      throw new Error('Initial balance must be zero or a positive amount')
    }
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

    // The credit reference, after referral processing (a referral never makes a credit player, but the final
    // type is the one that counts). 0 is valid for both credit types.
    const creditLimitValue = finalIsCreditPlayer ? creditReferenceOf(input.creditLimit) : 0
    if (finalIsCreditPlayer) input.creditLimit = creditLimitValue
    if (openingChips > 0 && !finalIsCreditPlayer) {
      throw new Error('Opening chips can only be given to credit players')
    }

    // The owning agent, whichever route named it (input or referral code), must
    // belong to this tenant and be ACTIVE. Its allowedDomains cap the new
    // player's domain flags (owner decision 4: an agent's domains limit its
    // players' betting).
    const { AgentsRepo: OwningAgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
    const owningAgentsRepo = new OwningAgentsRepo()
    let domainCap: ReturnType<typeof bettingFlagsFromAgentDomains> | null = null
    let owningAgentName: string | null = null
    if (finalAgentId) {
      const owningAgent = await owningAgentsRepo.findByIdScoped(String(finalAgentId), tenant)
      if (!owningAgent) throw new Error('Agent not found')
      if (owningAgent.status !== 'ACTIVE') throw new Error(`Agent is not active. Status: ${owningAgent.status}`)
      domainCap = bettingFlagsFromAgentDomains(owningAgent.allowedDomains)
      owningAgentName = owningAgent.username || owningAgent.id
    }

    // MONEY-CRITICAL: a credit player's opening chips and the player row are one transaction (spec 2026-11-02
    // §4.4). Creating a credit player no longer allocates a limit from its agent or debits the whitelabel pool
    // for it. Instead:
    //   1. the parent whose chips fund the opening deposit (the player's agent, or the whitelabel pool) is
    //      locked first, before the player's rows exist;
    //   2. the player, its wallet and its agent_player_credits row are written on the same transaction;
    //   3. the opening deposit runs with every rule of depositChips on that transaction, writing its
    //      credit_chip_ledger rows and the player's wallet statement rows.
    // A refusal (not enough chips, an agent that is not ACTIVE, a tenant with no pool) rolls all of it back.
    const opensWithChips = finalIsCreditPlayer && openingChips > 0
    const openingParentAgentId = finalPlayerType === 'AGENT_CREDIT' && finalAgentId ? String(finalAgentId) : null
    // Owner decision 2026-11-04: an AGENT_CREDIT player's opening chips come out of its agent's own free chips, the
    // admin acting for that agent (openingChipsUplineRefusal); chips still move one level, parent to child. An agent
    // whose upline is suspended, blocked or inactive could not move them itself (owner decision 1), so the admin
    // does not either: refused here, before anything is written.
    if (opensWithChips && openingParentAgentId) {
      const refusal = openingChipsRestrictedUplineRefusal(
        owningAgentName ?? openingParentAgentId,
        await owningAgentsRepo.findRestrictingAncestor(openingParentAgentId)
      )
      if (refusal) throw refusal
    }
    let openingTransferId: string | null = null
    const created = await db.transaction(async (tx) => {
      if (opensWithChips) await lockOpeningChipsParent(tx, tenant, openingParentAgentId)

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
        currency,
        // New credit player fields
        // Use referral-based playerType and agentId if available, otherwise use input values
        playerType: finalPlayerType,
        agentId: finalAgentId,
        // credit_limit is the credit reference; credit_used and credit_available are retired with the
        // credit-limit model (a credit player's chips are its wallet's cash), as migration 0019 left them.
        creditLimit: finalIsCreditPlayer ? creditLimitValue : null,
        creditUsed: finalIsCreditPlayer ? 0 : null,
        creditAvailable: finalIsCreditPlayer ? 0 : null,
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
        // The agent's per-player mirror has no figures on chips: the reference is kept, the rest is 0, as
        // migration 0019 left every existing row.
        // Cast to any: drizzle cross-package table typing produces a spurious
        // PgTable<TableConfig> mismatch here (same as the vip_members inserts in this
        // file). Runtime behavior is unaffected.
        await (tx as any)
          .insert(agentPlayerCredits)
          .values({
            agentId: finalAgentId,
            playerId: row.id,
            creditLimit: String(creditLimitValue),
            currentBalance: '0',
            openExposure: '0',
            creditUsed: '0',
            creditAvailable: '0',
          })
          .onConflictDoNothing()
      }

      if (opensWithChips) {
        // The parent-to-player DEPOSIT (from the agent, or the pool), its credit_chip_ledger rows naming the admin
        // as the actor (created_by / created_by_type).
        const opening = await depositOpeningChipsInTx(
          { tenant, accountType: 'PLAYER', accountId: row.id, amount: openingChips, actor: creatorActorOf(ctx) },
          tx
        )
        openingTransferId = opening.transferId
      }

      // MONEY-CRITICAL: a cash player's opening balance is a manual deposit like adjustWallet's, on this
      // transaction: the whitelabel pool is debited and both ledgers get their rows. It used to be written straight
      // into the new wallet's cash, minting money outside the pool. Not enough pool credit refuses the creation.
      if (!finalIsCreditPlayer && initialBalance > 0) {
        await moveWalletCashWithPoolInTx(tx, tenant, Number(row.id), initialBalance, { type: 'admin_adjustment', reason: 'Opening balance at player creation' })
      }

      return row
    })

    // Record audit for Recent Activity (agent dashboard): every player creation
    const { recordAuditDb } = await import('@src/repos/audit/auditRepo.js')
    recordAuditDb({
      tenant,
      // The admin JWT carries `sub`; there is no `user.id`, so every admin creation was recorded as "system".
      actorId: String(ctx?.user?.sub ?? ctx?.user?.agentId ?? 'system'),
      domain: 'players',
      action: 'create_player',
      resourceType: 'player',
      resourceId: String(created.id),
      after: {
        username: created.username,
        name: created.name,
        agentId: finalAgentId ?? null,
        playerType: finalPlayerType,
        ...(!finalIsCreditPlayer && initialBalance > 0 ? { initialBalance } : {}),
        // A credit player's credit reference and opening chips, as the agent path records them, with where the
        // chips came from (its agent, or the whitelabel pool) and the credit_chip_ledger transfer that booked them.
        ...(finalIsCreditPlayer ? { creditLimit: creditLimitValue, openingChips: opensWithChips ? openingChips : null } : {}),
        ...(opensWithChips ? { openingChipsFrom: openingParentAgentId ?? 'whitelabel', openingChipsTransferId: openingTransferId } : {}),
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

    return { success: true, message: playerCreatedMessage(finalPlayerType), user: { id: created.id, tenant, name, email: email || null, phone, username: created.username ?? username, vipTierId } }
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
    // End the admin's other sessions by id, as logout does: a Super Admin working inside a whitelabel has ctx.tenant
    // set to that brand while its own row is in 'default', so a tenant-scoped bump changed nothing for it.
    const { endAdminSessions } = await import('@/domains/common/auth.js')
    await endAdminSessions(userIdNum)

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
