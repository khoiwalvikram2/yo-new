import { upsertPlayerLimitsDb, updateUserPasswordDb, getUserPasswordHashDb, getUserDb, setRequirePasswordResetDb } from '@/repos/users/usersRepo.js'
import { setUserVipTierDb } from '@/repos/users/usersRepo.js'
import { recordAuditDb } from '@/repos/audit/auditRepo.js'
import { adjustWalletDb, adjustWalletBonusDb, ensurePlayerWalletDb } from '@/repos/players/walletsRepo.js'
import {
  createManualBonusAward,
  createSpecialBonusAward,
  updateBonusAwardStatus,
  getBonusAwardById,
  touchBonusAwardAdminStatusActorDb,
  forfeitBonusAwardByIdAdmin,
} from '@/repos/marketing/bonusesRepo.js'
import { isActiveEntityStatus } from '../statusNormalization.js'
import { PlayerAuthService } from '../services/PlayerAuthService.js'
import { playerTypeForAgentScheme, bettingFlagsFromAgentDomains } from './agentPlayerCreation.js'
import { resolveBonusAwardStatusActorDisplay } from '../services/bonusAwardStatusActorDisplay.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { ensureAgentCanMutate, hashPassword, verifyPassword, hasPermission, requirePermission } from '@/domains/common/auth.js'
import { db } from '@/db/client.js'
import {
  activateBonusAwardCore,
  BONUS_ACTIVATION_ALREADY_ACTIVE_MESSAGE,
} from '@shared/services/bonusAwardActivation.js'
import { switchBonusAwardCore } from '@shared/services/bonusAwardSwitch.js'
import { getWhitelabelCurrency } from '@src/shared/whitelabelConfig.js'
import { z } from 'zod'

const playerAuthService = new PlayerAuthService()

function normalizeBonusAdminRemark(remark: unknown): string | null {
  if (remark == null) return null
  const s = String(remark).trim()
  return s.length > 0 ? s : null
}

function requireBonusAdminRemark(remark: unknown): string {
  const n = normalizeBonusAdminRemark(remark)
  if (!n) {
    throw new Error('Remark is required for this action')
  }
  return n
}

export const playersMutationResolvers = {
  changePlayerPassword: async (_: any, args: any, ctx: any) => {
    ensureAgentCanMutate(ctx)
    if (!hasPermission(ctx?.permissions ?? [], 'players.profile', 'change-password')) {
      throw new Error('Forbidden: insufficient permissions to change player password')
    }

    const p = z.object({
      playerId: z.string().min(1),
      newPassword: z.string().min(6, 'Password must be at least 6 characters'),
      adminPassword: z.string().min(1, 'Admin password is required'),
    }).safeParse(args)

    if (!p.success) {
      throw new Error(p.error.issues.map(e => e.message).join(', '))
    }

    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    const playerId = Number(p.data.playerId)
    if (!Number.isFinite(playerId)) throw new Error('Invalid player ID')

    // Agent authorization check
    await playerAuthService.validateAgentPlayerAccess(ctx, playerId, 'change password for')

    // Verify the admin/agent password first
    const adminUserId = ctx?.user?.sub
    if (!adminUserId) {
      throw new Error('Unauthorized: Not authenticated')
    }

    // For agents, verify agent credentials
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findById(ctx.user.agentId)
      if (!agent) throw new Error('Agent not found')

      const { db } = await import('@/db/client.js')
      const { agentCredentials } = await import('@shared/db/schema.js')
      const { eq } = await import('drizzle-orm')

      const credRows = await db
        .select({ passwordHash: agentCredentials.passwordHash })
        .from(agentCredentials)
        .where(eq(agentCredentials.agentId, ctx.user.agentId))
        .limit(1)

      if (!credRows.length || !credRows[0].passwordHash) {
        throw new Error('Agent credentials not found')
      }

      const isAdminPasswordValid = await verifyPassword(p.data.adminPassword, credRows[0].passwordHash)
      if (!isAdminPasswordValid) {
        throw new Error('Invalid admin password. Please enter your correct login password to confirm.')
      }
    } else {
      // For admin users, verify admin password
      const adminIdNum = Number(adminUserId)
      if (!Number.isFinite(adminIdNum)) throw new Error('Invalid admin ID')

      const adminPasswordHash = await getUserPasswordHashDb(adminIdNum)
      if (!adminPasswordHash) throw new Error('Admin user not found')

      const isAdminPasswordValid = await verifyPassword(p.data.adminPassword, adminPasswordHash)
      if (!isAdminPasswordValid) {
        throw new Error('Invalid admin password. Please enter your correct login password to confirm.')
      }
    }

    // Validate the player exists in this tenant
    const player = await getUserDb(playerId, tenant)
    if (!player) {
      throw new Error('Player not found')
    }

    // Hash the new password and update the player's password
    const newPasswordHash = await hashPassword(p.data.newPassword)
    // `playerId` comes from the request, so the target must be in this tenant.
    await updateUserPasswordDb(playerId, newPasswordHash, tenant)

    // Verify the password was actually updated
    const updatedHash = await getUserPasswordHashDb(playerId)
    if (updatedHash !== newPasswordHash) {
      throw new Error('Password update failed. Please try again.')
    }

    // Clear requirePasswordReset flag since password is now directly changed
    await setRequirePasswordResetDb(playerId, false, tenant)

    // Audit logging
    const actorId = ctx?.user?.agentId || ctx?.user?.sub || 'system'
    recordAuditDb({
      tenant,
      actorId: String(actorId),
      domain: 'players.security',
      action: 'change_player_password',
      resourceType: 'player',
      resourceId: String(playerId),
      after: { passwordChanged: true, changedBy: ctx?.user?.type || 'admin' },
    }).catch(() => {})

    return { success: true, message: 'Player password changed successfully' }
  },

  setPlayerLimits: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'players.limits', 'update')
    ensureAgentCanMutate(ctx)
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const userId = Number(args.input.playerId)
    if (!Number.isFinite(userId)) throw new Error('Invalid player ID')
    
    // Agent authorization check
    await playerAuthService.validateAgentPlayerAccess(ctx, userId, 'modify limits for')
    
    const limits = await upsertPlayerLimitsDb(tenant, userId, {
      dailyStakeLimit: args.input.dailyStakeLimit,
      weeklyStakeLimit: args.input.weeklyStakeLimit,
      exposureCapOverride: args.input.exposureCapOverride,
      cooldownSeconds: args.input.cooldownSeconds,
      maxBetSports: args.input.maxBetSports,
      maxBetCasino: args.input.maxBetCasino,
      maxBetMatka: args.input.maxBetMatka,
    })
    
    await recordAuditDb({
      tenant,
      actorId: ctx?.user?.id || 'system',
      domain: 'players',
      action: 'set_limits',
      resourceType: 'player',
      resourceId: String(userId),
      after: limits,
    })
    
    return {
      success: true,
      message: 'Player limits updated successfully',
      limits,
    }
  },

  grantPlayerBonus: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'players.bonuses', 'create')
    ensureAgentCanMutate(ctx)
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const userId = Number(args.input.playerId)
    if (!Number.isFinite(userId)) throw new Error('Invalid player ID')
    
    // Prevent sharing agents from granting bonuses
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findById(ctx.user.agentId)
      if (agent?.schemeType === 'SHARING') {
        throw new Error('Sharing agents cannot grant player bonuses')
      }
    }
    
    // Agent authorization check
    await playerAuthService.validateAgentPlayerAccess(ctx, userId, 'grant bonus to')
    
    const amount = args.input.amount
    const currency = args.input.currency || 'INR'

    // Create award first so we can cancel it if wallet update fails
    const award = await createManualBonusAward(tenant, userId, {
      amount,
      currency,
      bonusType: args.input.bonusType,
      wageringRequirement: args.input.wageringRequirement ?? 0,
    })
    try {
      await adjustWalletBonusDb(userId, amount, {
        type: 'bonus',
        bonusType: args.input.bonusType,
        reason: args.input.reason,
      }, tenant)
    } catch (err) {
      await updateBonusAwardStatus(award.id, 'cancelled')
      throw err
    }

    await recordAuditDb({
      tenant,
      actorId: ctx?.user?.id || 'system',
      domain: 'players',
      action: 'grant_bonus',
      resourceType: 'player',
      resourceId: String(userId),
      after: { bonusType: args.input.bonusType, amount, bonusAwardId: award?.id },
    })
    
    return {
      success: true,
      message: 'Bonus granted successfully',
      bonus: {
        id: String(award?.id ?? ''),
        type: args.input.bonusType,
        name: args.input.bonusType,
        amount,
        currency,
        status: 'active',
        grantedAt: new Date().toISOString(),
        expiresAt: args.input.expiresInDays
          ? new Date(Date.now() + args.input.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
          : null,
        wageringRequirement: args.input.wageringRequirement || 0,
        wageringCompleted: 0,
        wageringRemaining: args.input.wageringRequirement || 0,
        contributionRules: null,
      },
    }
  },

  grantSpecialBonus: async (_: any, args: any, ctx: any) => {
    ensureAgentCanMutate(ctx)
    requirePermission(ctx, 'players.specialBonus', 'create')
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const userId = Number(args.input?.playerId)
    if (!Number.isFinite(userId)) throw new Error('Invalid player ID')
    const campaignId = Number(args.input?.campaignId)
    if (!Number.isFinite(campaignId)) throw new Error('Invalid campaign ID')
    const amount = Number(args.input?.amount)
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be a positive number')

    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findById(ctx.user.agentId)
      if (agent?.schemeType === 'SHARING') {
        throw new Error('Sharing agents cannot grant special bonuses')
      }
    }
    await playerAuthService.validateAgentPlayerAccess(ctx, userId, 'grant special bonus to')

    const currency = args.input?.currency ?? undefined
    const award = await createSpecialBonusAward(tenant, userId, campaignId, amount, currency)

    await recordAuditDb({
      tenant,
      actorId: ctx?.user?.id || 'system',
      domain: 'players',
      action: 'grant_special_bonus',
      resourceType: 'player',
      resourceId: String(userId),
      after: { campaignId, amount, bonusAwardId: award.id },
    })

    const wageringReq = Number(award.wageringReq ?? 0)
    return {
      success: true,
      message: 'Special bonus created; player can activate it in the app.',
      bonus: {
        id: String(award.id),
        campaignId: award.campaignId,
        type: 'special',
        name: 'Special Bonus',
        domain: award.domain ?? 'global',
        amount: Number(award.amount),
        currency: award.currency ?? 'INR',
        status: award.status ?? 'pending',
        distributionType: null,
        grantedAt: (award.awardedAt && (award.awardedAt instanceof Date ? award.awardedAt.toISOString() : String(award.awardedAt))) ?? new Date().toISOString(),
        completedAt: null,
        expiresAt: null,
        triggerAmount: award.triggerAmount ? Number(award.triggerAmount) : null,
        wageringRequirement: wageringReq,
        wageringCompleted: 0,
        wageringRemaining: wageringReq,
        firstDepositRequired: award.firstDepositRequired ?? false,
        firstDepositUnlocked: award.firstDepositUnlocked ?? false,
        contributionRules: null,
        campaign: null,
      },
    }
  },

  revokePlayerBonus: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'players.bonuses', 'delete')
    ensureAgentCanMutate(ctx)
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const awardId = Number(args.bonusId)
    if (!Number.isFinite(awardId)) throw new Error('Invalid bonus ID')

    const award = await getBonusAwardById(awardId)
    if (!award) throw new Error('Bonus not found')
    if (award.campaignTenant !== tenant) throw new Error('Unauthorized: bonus belongs to another tenant')

    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      await playerAuthService.validateAgentPlayerAccess(ctx, award.userId, 'revoke bonus for')
    }

    const wasActive = award.status === 'active'
    await updateBonusAwardStatus(awardId, 'cancelled')

    if (wasActive) {
      const amount = Number(award.amount) || 0
      if (amount > 0) {
        await adjustWalletBonusDb(award.userId, -amount, {
          type: 'bonus_revoke',
          reason: args.reason || 'Bonus revoked',
        }, tenant)
      }
    }

    await recordAuditDb({
      tenant,
      actorId: ctx?.user?.id || 'system',
      domain: 'players',
      action: 'revoke_bonus',
      resourceType: 'bonus',
      resourceId: args.bonusId,
      after: { awardId, userId: award.userId, amount: award.amount },
    })

    return {
      success: true,
      message: 'Bonus revoked successfully',
      bonus: {
        id: String(award.id),
        type: 'direct_amount',
        name: 'Revoked',
        amount: Number(award.amount),
        currency: award.currency,
        status: 'cancelled',
        grantedAt: award.awardedAt?.toISOString?.() ?? new Date().toISOString(),
        expiresAt: null,
        wageringRequirement: 0,
        wageringCompleted: 0,
        wageringRemaining: 0,
        contributionRules: null,
      },
    }
  },

  /**
   * Bonus cards list: move a pending award to cancelled or expired (no wallet movement).
   */
  setBonusAwardStatus: async (_: any, args: { awardId: string; status: string; remark: string }, ctx: any) => {
    ensureAgentCanMutate(ctx)
    const canSet =
      hasPermission(ctx?.permissions ?? [], 'players.bonuses', 'delete') ||
      hasPermission(ctx?.permissions ?? [], 'bonuses.detail', 'update')
    if (!canSet) {
      throw new Error('Forbidden: insufficient permissions to change bonus award status')
    }

    const awardId = Number(args.awardId)
    if (!Number.isFinite(awardId)) {
      throw new Error('Invalid award ID')
    }

    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    const award = await getBonusAwardById(awardId)
    if (!award) {
      throw new Error('Bonus award not found')
    }
    if (award.campaignTenant !== tenant) {
      throw new Error('Unauthorized: bonus belongs to another tenant')
    }

    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      await playerAuthService.validateAgentPlayerAccess(ctx, award.userId, 'change bonus status for')
    }

    if (award.status !== 'pending') {
      throw new Error(`Only pending bonus cards can be updated here (current status: ${award.status})`)
    }

    const next = String(args.status || '').toLowerCase()
    if (next !== 'cancelled' && next !== 'expired') {
      throw new Error('From pending you can only set status to cancelled or expired')
    }

    const actionRemark = requireBonusAdminRemark(args.remark)
    const statusActor = await resolveBonusAwardStatusActorDisplay(ctx)
    const ok = await updateBonusAwardStatus(awardId, next as 'cancelled' | 'expired', statusActor, actionRemark)
    if (!ok) {
      throw new Error('Failed to update bonus award')
    }

    await recordAuditDb({
      tenant,
      actorId: ctx?.user?.id || ctx?.user?.sub || 'system',
      domain: 'players',
      action: 'set_bonus_award_status',
      resourceType: 'bonus_award',
      resourceId: String(awardId),
      after: { awardId, userId: award.userId, from: award.status, to: next, remark: actionRemark },
    })

    return {
      success: true,
      message: next === 'cancelled' ? 'Bonus card cancelled' : 'Bonus card marked expired',
      newStatus: next,
    }
  },

  /**
   * Activate a pending bonus card (shared rules with user app). Returns code ALREADY_ACTIVE_BONUS when another bonus is active.
   */
  activateBonusAwardAdmin: async (_: any, args: { awardId: string; remark: string }, ctx: any) => {
    ensureAgentCanMutate(ctx)
    const canActivate =
      hasPermission(ctx?.permissions ?? [], 'players.bonuses', 'delete') ||
      hasPermission(ctx?.permissions ?? [], 'bonuses.detail', 'update')
    if (!canActivate) {
      throw new Error('Forbidden: insufficient permissions to activate bonus award')
    }

    const awardId = Number(args.awardId)
    if (!Number.isFinite(awardId)) {
      throw new Error('Invalid award ID')
    }

    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    const award = await getBonusAwardById(awardId)
    if (!award) {
      throw new Error('Bonus award not found')
    }
    if (award.campaignTenant !== tenant) {
      throw new Error('Unauthorized: bonus belongs to another tenant')
    }

    if (award.status !== 'pending') {
      throw new Error(`Only pending bonus cards can be activated (current status: ${award.status})`)
    }

    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findById(ctx.user.agentId)
      if (agent?.schemeType === 'SHARING') {
        throw new Error('Sharing agents cannot activate player bonuses')
      }
      await playerAuthService.validateAgentPlayerAccess(ctx, award.userId, 'activate bonus for')
    }

    const actionRemark = requireBonusAdminRemark(args.remark)

    try {
      const r = await activateBonusAwardCore({
        bonusId: awardId,
        userId: award.userId,
        tenant,
        db,
        ensureWallet: async (userId, ten, cur) => {
          const w = await ensurePlayerWalletDb(userId, ten, cur)
          return {
            id: w.id,
            cash: w.cash ?? null,
            bonus: w.bonus ?? null,
            exposure: w.exposure ?? null,
          }
        },
        getWhitelabelCurrency,
      })
      if (r.kind === 'not_found') {
        return {
          success: false,
          message: 'Bonus card not found for this player and tenant, or status is no longer pending.',
          code: 'NOT_FOUND',
        }
      }

      const activateActor = await resolveBonusAwardStatusActorDisplay(ctx)
      await touchBonusAwardAdminStatusActorDb(awardId, activateActor, actionRemark)

      await recordAuditDb({
        tenant,
        actorId: ctx?.user?.id || ctx?.user?.sub || 'system',
        domain: 'players',
        action: 'activate_bonus_award_admin',
        resourceType: 'bonus_award',
        resourceId: String(awardId),
        after: { awardId, userId: award.userId, remark: actionRemark },
      })

      return {
        success: true,
        message: 'Bonus activated successfully',
        code: null,
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Activation failed'
      if (msg === BONUS_ACTIVATION_ALREADY_ACTIVE_MESSAGE) {
        return { success: false, message: msg, code: 'ALREADY_ACTIVE_BONUS' }
      }
      if (msg.includes('Make a deposit first')) {
        return { success: false, message: msg, code: 'DEPOSIT_REQUIRED' }
      }
      if (msg === 'Bonus has expired') {
        return { success: false, message: msg, code: 'EXPIRED' }
      }
      throw e
    }
  },

  /**
   * Same as user app "Switch bonus": cancel active award, zero bonus wallet slice, activate this pending card.
   */
  switchBonusAwardAdmin: async (_: any, args: { awardId: string; remark: string }, ctx: any) => {
    ensureAgentCanMutate(ctx)
    const canSwitch =
      hasPermission(ctx?.permissions ?? [], 'players.bonuses', 'delete') ||
      hasPermission(ctx?.permissions ?? [], 'bonuses.detail', 'update')
    if (!canSwitch) {
      throw new Error('Forbidden: insufficient permissions to switch bonus award')
    }

    const awardId = Number(args.awardId)
    if (!Number.isFinite(awardId)) {
      throw new Error('Invalid award ID')
    }

    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    const award = await getBonusAwardById(awardId)
    if (!award) {
      throw new Error('Bonus award not found')
    }
    if (award.campaignTenant !== tenant) {
      throw new Error('Unauthorized: bonus belongs to another tenant')
    }

    if (award.status !== 'pending') {
      throw new Error(`Only pending bonus cards can be switched to (current status: ${award.status})`)
    }

    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findById(ctx.user.agentId)
      if (agent?.schemeType === 'SHARING') {
        throw new Error('Sharing agents cannot switch player bonuses')
      }
      await playerAuthService.validateAgentPlayerAccess(ctx, award.userId, 'switch bonus for')
    }

    const ensureWalletForBonus = async (userId: number, ten: string, cur?: string) => {
      const w = await ensurePlayerWalletDb(userId, ten, cur)
      return {
        id: w.id,
        cash: w.cash ?? null,
        bonus: w.bonus ?? null,
        exposure: w.exposure ?? null,
      }
    }

    const actionRemark = requireBonusAdminRemark(args.remark)

    try {
      await switchBonusAwardCore({
        newBonusId: awardId,
        userId: award.userId,
        tenant,
        db,
        ensureWallet: ensureWalletForBonus,
        getWhitelabelCurrency,
      })

      const switchActor = await resolveBonusAwardStatusActorDisplay(ctx)
      await touchBonusAwardAdminStatusActorDb(awardId, switchActor, actionRemark)

      await recordAuditDb({
        tenant,
        actorId: ctx?.user?.id || ctx?.user?.sub || 'system',
        domain: 'players',
        action: 'switch_bonus_award_admin',
        resourceType: 'bonus_award',
        resourceId: String(awardId),
        after: { awardId, userId: award.userId, remark: actionRemark },
      })

      return {
        success: true,
        message: 'Bonus switched successfully',
        code: null,
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Switch failed'
      if (msg.includes('Make a deposit first')) {
        return { success: false, message: msg, code: 'DEPOSIT_REQUIRED' }
      }
      if (msg === 'Bonus has expired') {
        return { success: false, message: msg, code: 'EXPIRED' }
      }
      if (msg.includes('not found') || msg.includes('not in pending')) {
        return { success: false, message: msg, code: 'NOT_FOUND' }
      }
      throw e
    }
  },

  /**
   * Forfeit an active bonus card: zero bonus wallet, mark award cancelled (same financial effect as player app Forfeit).
   */
  forfeitBonusAwardAdmin: async (_: any, args: { awardId: string; remark: string }, ctx: any) => {
    ensureAgentCanMutate(ctx)
    const canForfeit =
      hasPermission(ctx?.permissions ?? [], 'players.bonuses', 'delete') ||
      hasPermission(ctx?.permissions ?? [], 'bonuses.detail', 'update')
    if (!canForfeit) {
      throw new Error('Forbidden: insufficient permissions to forfeit bonus award')
    }

    const awardId = Number(args.awardId)
    if (!Number.isFinite(awardId)) {
      throw new Error('Invalid award ID')
    }

    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    const award = await getBonusAwardById(awardId)
    if (!award) {
      return { success: false, message: 'Bonus award not found', code: 'NOT_FOUND' }
    }
    if (award.campaignTenant !== tenant) {
      throw new Error('Unauthorized: bonus belongs to another tenant')
    }

    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findById(ctx.user.agentId)
      if (agent?.schemeType === 'SHARING') {
        throw new Error('Sharing agents cannot forfeit player bonuses')
      }
      await playerAuthService.validateAgentPlayerAccess(ctx, award.userId, 'forfeit bonus for')
    }

    const actionRemark = requireBonusAdminRemark(args.remark)

    const result = await forfeitBonusAwardByIdAdmin({ awardId, tenant })
    if (!result.ok) {
      return { success: false, message: result.reason, code: 'FORFEIT_FAILED' }
    }

    const forfeitActor = await resolveBonusAwardStatusActorDisplay(ctx)
    await touchBonusAwardAdminStatusActorDb(awardId, forfeitActor, actionRemark)

    await recordAuditDb({
      tenant,
      actorId: ctx?.user?.id || ctx?.user?.sub || 'system',
      domain: 'players',
      action: 'forfeit_bonus_award_admin',
      resourceType: 'bonus_award',
      resourceId: String(awardId),
      after: { awardId, userId: award.userId, remark: actionRemark },
    })

    return {
      success: true,
      message: 'Bonus forfeited — bonus wallet cleared and card cancelled',
      code: null,
    }
  },

  adjustPlayerVipTier: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'players.vip', 'update')
    ensureAgentCanMutate(ctx)
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const userId = Number(args.input.playerId)
    if (!Number.isFinite(userId)) throw new Error('Invalid player ID')
    
    // A tier decides a player's deposit methods and limits, so only whitelabel
    // staff set it. The player drawer has never offered it to agents either.
    if (ctx?.user?.type === 'agent') throw new Error('Agents cannot adjust player VIP tiers')
    await playerAuthService.validateAgentPlayerAccess(ctx, userId, 'adjust VIP tier for')

    const { getVipMemberByUserIdDb, getVipTierDb, listVipTransactionsDb, listVipHistoryDb } = await import('@/repos/vip/vipRepo.js')
    await setUserVipTierDb(userId, args.input.tierId || null, tenant,
      String(ctx?.user?.id || ctx?.user?.sub || 'admin'), args.input.reason || 'VIP tier changed by admin')

    await recordAuditDb({
      tenant,
      actorId: ctx?.user?.id || 'system',
      domain: 'players',
      action: 'adjust_vip_tier',
      resourceType: 'player',
      resourceId: String(userId),
      after: { tierId: args.input.tierId, reason: args.input.reason },
    })
    
    // Get updated VIP info
    const member = await getVipMemberByUserIdDb(String(userId), tenant)
    
    if (!member) {
      return {
        success: true,
        message: 'VIP tier updated successfully',
        vipInfo: null,
      }
    }
    
    const tier = await getVipTierDb(member.tierId, tenant)
    const transactions = await listVipTransactionsDb(tenant, member.id, 50)
    const history = await listVipHistoryDb(tenant, member.id)
    
    return {
      success: true,
      message: 'VIP tier updated successfully',
      vipInfo: {
        tierId: member.tierId,
        tierName: member.tierName,
        tierLevel: member.tierLevel,
        currentPoints: member.currentPoints,
        lifetimePoints: member.lifetimePoints,
        nextTierId: member.nextTierId || null,
        nextTierName: member.nextTierName || null,
        pointsToNextTier: member.pointsToNextTier || null,
        benefits: tier?.benefits || [],
        perks: tier?.perks || [],
        history: history.map((h: any) => ({
          id: h.id,
          fromTierId: h.fromTierId || null,
          fromTierName: null,
          toTierId: h.toTierId,
          toTierName: null,
          reason: h.reason,
          pointsAtChange: h.pointsAtChange,
          createdAt: h.createdAt?.toISOString() || new Date().toISOString(),
        })),
        transactions: transactions.map((t: any) => ({
          id: t.id,
          type: t.type,
          points: t.points,
          description: t.description,
          balanceBefore: t.balanceBefore,
          balanceAfter: t.balanceAfter,
          createdAt: t.createdAt?.toISOString() || new Date().toISOString(),
        })),
      },
    }
  },

  // addPlayerNote and playerNotes predate the CRM module, which supplied their
  // implementation and has been removed pending a rebuild as a standalone
  // application. The fields stay so the profile screen keeps its shape; they
  // report their own absence rather than failing silently.
  /**
   * Writes a note from the admin panel.
   *
   * The author is recorded as an admin user with their name snapshotted, so
   * a note still says who wrote it after that account is gone. There is no
   * edit path by design: a note that can be rewritten without a revision
   * history is a record that can be made to say something else afterwards.
   */
  addPlayerNote: async (_: any, args: { input: any }, ctx: any) => {
    requirePermission(ctx, 'players.notes', 'create')
    ensureAgentCanMutate(ctx)

    const input = args?.input ?? {}
    const playerId = Number(input.playerId)
    const content = String(input.content ?? '').trim()
    if (!Number.isFinite(playerId)) return { success: false, message: 'Unknown player', note: null }
    if (!content) return { success: false, message: 'A note cannot be empty', note: null }

    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    const { PlayerAuthService } = await import('@src/domains/players/services/PlayerAuthService.js')
    await new PlayerAuthService().validateAgentPlayerAccess(ctx, playerId, 'add a note for')

    const { db } = await import('@src/db/client.js')
    const { users } = await import('@shared/db/schema.js')
    const { and, eq } = await import('drizzle-orm')
    const [player] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, playerId), eq(users.tenant, tenant)))
      .limit(1)
    if (!player) return { success: false, message: 'Unknown player', note: null }

    const adminUserId = Number(ctx?.user?.sub)
    const { createPlayerNote } = await import('@src/repos/crm/CrmNotesRepo.js')
    const note = await createPlayerNote({
      tenant,
      playerId,
      body: content,
      category: input.category ?? null,
      labels: Array.isArray(input.tags) ? input.tags : [],
      isPinned: !!input.isPinned,
      visibility: 'all',
      author: {
        kind: 'admin',
        adminUserId: Number.isFinite(adminUserId) ? adminUserId : 0,
        name: String(ctx?.user?.name ?? 'Admin'),
      },
    })

    recordAuditDb({
      tenant,
      actorId: String(ctx?.user?.sub ?? 'unknown'),
      domain: 'players',
      action: 'add_player_note',
      resourceType: 'player',
      resourceId: String(playerId),
      before: { noteId: note.id },
    }).catch(() => {})

    return {
      success: true,
      message: 'Note added',
      note: {
        id: note.id,
        content: note.body,
        category: note.category,
        tags: note.labels,
        isPinned: note.isPinned,
        createdBy: note.authorName,
        createdAt: note.createdAt.toISOString(),
        updatedAt: null,
      },
    }
  },

  terminatePlayerSessions: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'players.sessions', 'delete')
    ensureAgentCanMutate(ctx)
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const userId = Number(args.input.playerId)
    if (!Number.isFinite(userId)) throw new Error('Invalid player ID')
    
    // Agent authorization check
    await playerAuthService.validateAgentPlayerAccess(ctx, userId, 'terminate sessions for')
    
    // TODO: implement session termination
    const terminatedCount = args.input.allSessions ? 1 : (args.input.sessionIds?.length || 0)
    
    await recordAuditDb({
      tenant,
      actorId: ctx?.user?.id || 'system',
      domain: 'players',
      action: 'terminate_sessions',
      resourceType: 'player',
      resourceId: String(userId),
      after: {
        terminatedCount,
        reason: args.input.reason,
      },
    })
    
    return {
      success: true,
      message: `Terminated ${terminatedCount} session(s)`,
      terminatedCount,
    }
  },

  lockPlayerAccount: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'players.profile', 'update')
    ensureAgentCanMutate(ctx)
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const userId = Number(args.playerId)
    if (!Number.isFinite(userId)) throw new Error('Invalid player ID')
    
    // Agent authorization check
    await playerAuthService.validateAgentPlayerAccess(ctx, userId, 'lock account for')
    
    const { setUserStatusDb } = await import('@/repos/users/usersRepo.js')
    await setUserStatusDb(userId, 'SUSPENDED', tenant)
    
    await recordAuditDb({
      tenant,
      actorId: ctx?.user?.id || 'system',
      domain: 'players',
      action: 'lock_account',
      resourceType: 'player',
      resourceId: String(userId),
      after: { reason: args.reason },
    })
    
    // Get updated profile
    const { getUserDb } = await import('@/repos/users/usersRepo.js')
    const user = await getUserDb(userId, tenant)
    
    if (!user) throw new Error('Player not found')
    
    const { getWalletDb } = await import('@/repos/players/walletsRepo.js')
    const wallet = await getWalletDb(userId, tenant)
    const { getPlayerLimitsDb } = await import('@/repos/users/usersRepo.js')
    const limits = await getPlayerLimitsDb(userId, tenant)
    const { getVipTierDb } = await import('@/repos/vip/vipRepo.js')
    let vipTierName = null
    if (user.vipTierId) {
      try {
        const tier = await getVipTierDb(user.vipTierId, tenant)
        vipTierName = tier?.name ?? null
      } catch {}
    }
    
    return {
      success: true,
      message: 'Account locked successfully',
      profile: {
        id: String(user.id),
        name: user.name,
        email: user.email,
        phone: user.phone,
        username: user.username,
        status: user.status.toUpperCase(),
        tenant: tenant,
        createdAt: user.createdAt?.toISOString() || null,
        lastLogin: (user as any).lastLoginAt ? new Date((user as any).lastLoginAt).toISOString() : null,
        lastBet: null,
        firstDeposit: null,
        riskType: user.riskType?.toUpperCase() || null,
        kycLevel: null,
        kycStatus: null,
        kycLastUpdate: null,
        vipTierId: user.vipTierId,
        vipTierName,
        wallet: wallet ? {
          userId: String(userId),
          currency: wallet.currency,
          balance: Number(wallet.cash || 0),
          bonus: Number(wallet.bonus || 0),
          exposure: Number(wallet.exposure || 0),
          updatedAt: new Date().toISOString(),
        } : null,
        limits: limits || null,
        access: {
          canLogin: false,
          canDeposit: false,
          canWithdraw: false,
          bonusEligible: false,
          sports: { visible: false, canBet: false },
          casino: { visible: false, canBet: false },
          matka: { visible: false, canBet: false },
        },
      },
    }
  },

  // Agent-specific mutations
  createPlayerForAgent: async (_: any, args: any, ctx: any) => {
    ensureAgentCanMutate(ctx)
    // Only agents can use this mutation
    if (!ctx?.user?.type || ctx.user.type !== 'agent' || !ctx.user.agentId) {
      throw new Error('This mutation is only available for agents')
    }

    const loggedInAgentId = ctx.user.agentId
    // Fetch agent scheme type from database if not in context (fallback)
    let loggedInAgentSchemeType = ctx.user.agentSchemeType as 'CREDIT' | 'SHARING' | 'COMMISSION' | undefined

    const { AgentsRepo } = await import('@/repos/agents/AgentsRepo');
    const agentsRepo = new AgentsRepo();
    
    // Fetch logged-in agent to get scheme type and tenantId
    const loggedInAgent = await agentsRepo.findById(loggedInAgentId);
    if (!loggedInAgent) {
      throw new Error('Logged-in agent not found');
    }
    
    // CRITICAL: Use agent's tenantId from database (not from context)
    // This ensures players are created in the correct tenant and can login
    const agentTenantId = loggedInAgent.tenantId && typeof loggedInAgent.tenantId === 'string' && loggedInAgent.tenantId.trim() !== ''
      ? loggedInAgent.tenantId.trim()
      : null
    
    // For Director Admin, use effective tenant based on mode
    // For agents, use agent's tenantId (fallback to context if agent has no tenant)
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? agentTenantId ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    
    // Use scheme type from database if not in context
    if (!loggedInAgentSchemeType && loggedInAgent.schemeType) {
      loggedInAgentSchemeType = loggedInAgent.schemeType as 'CREDIT' | 'SHARING' | 'COMMISSION';
    }
    
    // Determine target agent ID (self or sub-agent)
    // Frontend sends 'self' as a string when creating for self, otherwise sends the sub-agent ID
    let targetAgentId = (args.input.agentId === 'self' || !args.input.agentId) ? loggedInAgentId : args.input.agentId
    
    // Determine player type based on agent's scheme type
    const isCreditAgent = loggedInAgentSchemeType === 'CREDIT';
    const isSharingAgent = loggedInAgentSchemeType === 'SHARING';
    const isCommissionAgent = loggedInAgentSchemeType === 'COMMISSION';
    
    // An agent may create players for itself or for any agent beneath it.
    //
    // This rule is the same for every scheme. COMMISSION agents were previously
    // refused outright on the grounds that they "are standalone and have no
    // sub-agents", which is not true — createAgent explicitly permits COMMISSION
    // parents and children, and real hierarchies use them.
    //
    // The subtree is resolved through agent_hierarchy_closure so that any
    // descendant qualifies, not only a direct child.
    //
    // owningAgent is the agent the new player will belong to; its allowedDomains
    // decide the player's domain flags below.
    let owningAgent: { allowedDomains?: string[] | null; status?: string | null } = loggedInAgent;
    if (targetAgentId && targetAgentId !== loggedInAgentId) {
      const targetAgent = await agentsRepo.findById(targetAgentId);
      if (!targetAgent) {
        throw new Error('Target agent not found');
      }
      owningAgent = targetAgent;
      const descendantIds = await agentsRepo.getDescendantIds(loggedInAgentId);
      if (!descendantIds.includes(targetAgentId)) {
        throw new Error('You can only create players for yourself or an agent below you in your hierarchy');
      }
      // Same rule as the admin path: a player is created only under an ACTIVE agent.
      if (targetAgent.status !== 'ACTIVE') {
        throw new Error(`Target agent is not active. Status: ${targetAgent.status}`);
      }
      // A player's type is derived from its owning agent's scheme, so the target
      // must share the caller's scheme for the derived type to stay coherent.
      if (targetAgent.schemeType !== loggedInAgentSchemeType) {
        throw new Error('You can only create players for agents on the same scheme as you');
      }
    }
    
    // The player's type comes from the agent's scheme alone. input.playerType is
    // ignored: honouring it let an agent create a WHITELABEL_CREDIT player and
    // have its limit deducted from the whitelabel credit pool, or switch the
    // credit rules on for a non-credit agent.
    const effectivePlayerType = playerTypeForAgentScheme(loggedInAgentSchemeType);
    
    const canEditBonus = isSharingAgent || isCommissionAgent;
    
    // Get whitelabel base currency from app config
    const { getAppConfigDb } = await import('@/repos/app-config/appConfigRepo.js')
    const appConfig = await getAppConfigDb(tenant)
    const whitelabelBaseCurrency = appConfig?.baseCurrency || 'INR'
    
    // Check if creating for sub-agent (used in credit player restrictions and credit update)
    const isCreatingForSubAgent = targetAgentId !== loggedInAgentId;
    
    // ========== CREDIT PLAYER RESTRICTIONS ==========
    // Always validate for credit agents (isCreditAgent is determined from logged-in agent's scheme type)
    if (isCreditAgent) {
      
      // 1. Credit limit validation based on target agent
      if (isCreatingForSubAgent) {
        // When creating for sub-agent, credit limit must be 0 (sub-agent will manage credit)
        if (args.input.creditLimit && args.input.creditLimit > 0) {
          throw new Error('Credit limit must be 0 when creating player for sub-agent. Sub-agent will manage the player\'s credit.');
        }
        // Force credit limit to 0 for sub-agent
        args.input.creditLimit = 0;
      } else {
        // When creating for self, credit limit defaults to 0 if not provided
        // Frontend may not send creditLimit field, so default to 0 from backend
        if (args.input.creditLimit === undefined || args.input.creditLimit === null) {
          args.input.creditLimit = 0;
        }
        // Allow 0 as valid value (default from backend)
        // Only reject if explicitly provided and negative
        if (args.input.creditLimit < 0) {
          throw new Error('Credit limit cannot be negative');
        }
      }
      
      // 2. Initial balance must be 0 for credit players (they get credit, not balance)
      if (args.input.initialBalance && args.input.initialBalance > 0) {
        throw new Error('Credit players cannot have an initial balance. They receive credit limit instead.');
      }
      
      // 3. Bonus is not allowed for credit players
      if (args.input.bonusAllowed === true) {
        throw new Error('Credit players are not eligible for bonuses');
      }
      
      // 4. Currency must be whitelabel base currency for credit players
      if (args.input.currency && args.input.currency !== whitelabelBaseCurrency) {
        throw new Error(`Credit players must use the whitelabel's base currency (${whitelabelBaseCurrency})`);
      }
      
      // 5. Validate agent has sufficient available credit to assign to player (only when creating for self and creditLimit > 0)
      if (!isCreatingForSubAgent && args.input.creditLimit > 0) {
        // Always check logged-in agent's credit (not targetAgentId) because that's whose credit will be deducted
        const agentCreditData = await agentsRepo.getCreditFields(loggedInAgentId);
        if (!agentCreditData) {
          throw new Error('Agent credit information not found');
        }
        
        const requestedCreditLimit = Number(args.input.creditLimit);
        const agentAvailableCredit = Number(agentCreditData.creditAvailable || 0);
        
        if (requestedCreditLimit > agentAvailableCredit) {
          throw new Error(
            `Insufficient credit available. You have ${agentAvailableCredit.toFixed(2)} available, but ${requestedCreditLimit.toFixed(2)} was requested. ` +
            `(Your credit limit: ${agentCreditData.creditLimit.toFixed(2)}, Used: ${agentCreditData.creditUsed.toFixed(2)})`
          );
        }
      }
    }
    // ================================================
    
    // ========== WHITELABEL_CREDIT PLAYERS ==========
    // Not created here. An agent's player type comes from its scheme (see
    // effectivePlayerType); a WHITELABEL_CREDIT player belongs to the whitelabel,
    // not to an agent, and is created by an admin through users.createPlayer.
    // ================================================
    
    // ========== SHARING AGENT RESTRICTIONS ==========
    if (isSharingAgent) {
      // 1. Sharing agents cannot set initial balance (must be 0)
      if (args.input.initialBalance && args.input.initialBalance > 0) {
        throw new Error('Sharing agents cannot set initial balance. Players start with 0 balance.');
      }
      
      // 2. Sharing agents cannot set currency (must use whitelabel base currency)
      if (args.input.currency && args.input.currency !== whitelabelBaseCurrency) {
        throw new Error(`Sharing agents cannot set currency. Players use the whitelabel's base currency (${whitelabelBaseCurrency})`);
      }
    }
    // ================================================
    
    // ========== COMMISSION AGENT RESTRICTIONS ==========
    if (isCommissionAgent) {
      // 1. Commission agents cannot set initial balance (must be 0)
      if (args.input.initialBalance && args.input.initialBalance > 0) {
        throw new Error('Commission agents cannot set initial balance. Players start with 0 balance.');
      }
      
      // 2. Commission agents cannot set currency (must use whitelabel base currency)
      if (args.input.currency && args.input.currency !== whitelabelBaseCurrency) {
        throw new Error(`Commission agents cannot set currency. Players use the whitelabel's base currency (${whitelabelBaseCurrency})`);
      }
      
      // Note: bonusAllowed is allowed for commission agents (handled by canEditBonus logic)
    }
    // ================================================
    
    // ========== BONUS ELIGIBILITY RESTRICTIONS ==========
    // Bonus is only allowed for SHARING_AGENT_PLAYER and COMMISSION_AGENT_PLAYER
    if (!canEditBonus && args.input.bonusAllowed === true) {
      throw new Error('Bonus eligibility is not allowed for this player type');
    }
    // ================================================

    // Validate required fields
    if (!args.input.phone || (typeof args.input.phone === 'string' && args.input.phone.trim() === '')) {
      throw new Error('Phone number is required')
    }
    if (!args.input.name || (typeof args.input.name === 'string' && args.input.name.trim() === '')) {
      throw new Error('Name is required')
    }
    if (!args.input.username || (typeof args.input.username === 'string' && args.input.username.trim() === '')) {
      throw new Error('Username is required')
    }
    if (!args.input.password || (typeof args.input.password === 'string' && args.input.password.trim() === '')) {
      throw new Error('Password is required')
    }

    const { createPlayerDb } = await import('@/repos/users/usersRepo.js')
    const { normalizePhoneForStorage } = await import('@/utils/phoneUtils.js')

    // Normalize phone number for consistent storage (remove +91 prefix if present)
    const normalizedPhone = normalizePhoneForStorage(args.input.phone.trim())

    // The new player's domain flags come from the owning agent's allowedDomains
    // (owner decision 4), not from a hard-coded sports+casino on / matka off.
    const domainFlags = bettingFlagsFromAgentDomains(owningAgent.allowedDomains)

    // Credit the new player takes from the logged-in agent's own line (creating
    // for self only; a sub-agent's player starts at 0 and is funded by that
    // sub-agent later).
    const creditToAllocate = isCreditAgent && !isCreatingForSubAgent ? Number(args.input.creditLimit || 0) : 0

    // Create user with proper player type and agent linkage.
    // Note: createPlayerDb already creates the wallet, so we don't need to create it separately.
    //
    // MONEY-CRITICAL: the agent's credit deduction, the player row and its
    // agent_player_credits row are one transaction. Before, the player was
    // committed first and the deduction ran afterwards in its own transaction,
    // reading the agent's credit without a lock and writing absolute values — so
    // two concurrent creates could both pass and over-allocate, and a failed
    // deduction left a funded player behind. The deduction is now a delta applied
    // under the agent row's FOR UPDATE lock and re-validated against that row.
    // Credit-ledger row for the allocation (plan W7): written in the same transaction, as
    // every other allocation path does. Currency is fetched before the locks are taken.
    const allocationLedger = creditToAllocate > 0
      ? {
          repo: new (await import('@/repos/agents/AgentCreditLedgerRepo.js')).AgentCreditLedgerRepo(),
          currency: await (await import('@src/shared/whitelabelConfig.js')).getWhitelabelCurrency(tenant),
        }
      : null
    let allocatedAgentSnapshot: { creditLimit: number; creditUsed: number; creditAvailable: number; settlementBalance: number } | null = null

    const created = await db.transaction(async (tx) => {
      if (creditToAllocate > 0) {
        // Always the logged-in agent's credit (not targetAgentId): that is whose line is used.
        allocatedAgentSnapshot = await agentsRepo.lockAndUpdateCredit(loggedInAgentId, {
          creditUsedDelta: creditToAllocate,
          requireAvailableForDelta: true,
        }, tx);
      }

      const row = await createPlayerDb({
        tenant,
        username: args.input.username,
        email: args.input.email || null,
        phone: normalizedPhone,
        name: args.input.name || args.input.username,
        password: args.input.password, // Use provided password for agent-created players
        status: (args.input.status || 'active').toLowerCase() as 'active' | 'inactive' | 'suspended',
        bonusAllowed: canEditBonus ? (args.input.bonusAllowed !== false) : false,
        requirePasswordReset: false,
        ...domainFlags,
        // New fields for agent-created players
        playerType: effectivePlayerType,
        agentId: targetAgentId,
        // Credit limit: 0 for sub-agent, provided value for self (validated above)
        creditLimit: isCreditAgent ? (args.input.creditLimit || 0) : null,
        creditUsed: isCreditAgent ? 0 : null,
        creditAvailable: isCreditAgent ? (args.input.creditLimit || 0) : null,
        // For sharing agents: initialBalance must be 0 (enforced above)
        // For credit agents: initialBalance is 0
        // For commission agents: initialBalance must be 0 (enforced above)
        initialBalance: isSharingAgent ? 0 : (isCreditAgent ? 0 : (isCommissionAgent ? 0 : (args.input.initialBalance || 0))),
        // For sharing agents: always use whitelabel base currency (enforced above)
        // For credit agents: always use whitelabel base currency
        // For commission agents: always use whitelabel base currency (enforced above)
        currency: isSharingAgent ? whitelabelBaseCurrency : (isCreditAgent ? whitelabelBaseCurrency : (isCommissionAgent ? whitelabelBaseCurrency : (args.input.currency || whitelabelBaseCurrency))),
        limits: {
          maxBetSports: args.input.maxBetSports ?? null,
          maxBetCasino: args.input.maxBetCasino ?? null,
          maxBetMatka: args.input.maxBetMatka ?? null,
          dailyStakeLimit: args.input.dailyStakeLimit ?? null,
        }
      }, tx)

      // Ensure every AGENT_CREDIT player has an agent_player_credits (apc) row so the
      // bet cascade (which only UPDATEs an existing apc row) can track per-player exposure.
      // Idempotent via onConflictDoNothing (the 0087 unique index on (agent_id, player_id)).
      // The owning agent is targetAgentId (same agentId passed to createPlayerDb above).
      if (effectivePlayerType === 'AGENT_CREDIT' && targetAgentId) {
        const { agentPlayerCredits } = await import('@shared/db/schema.js')
        const apcLimit = String(args.input.creditLimit || 0)
        // Cast to any: drizzle cross-package table typing produces a spurious
        // PgTable<TableConfig> mismatch here (same as the vip_members inserts in this
        // file). Runtime behavior is unaffected.
        await (tx as any)
          .insert(agentPlayerCredits)
          .values({
            agentId: targetAgentId,
            playerId: row.id,
            creditLimit: apcLimit,
            currentBalance: '0',
            openExposure: '0',
            creditUsed: '0',
            creditAvailable: apcLimit,
          })
          .onConflictDoNothing()
      }

      // The agent's ALLOCATION credit-ledger row, with the before/after availability of
      // the locked agent row (like allocateCreditToPlayer / depositCredit).
      const agentSnap = allocatedAgentSnapshot as { creditLimit: number; creditUsed: number; creditAvailable: number; settlementBalance: number } | null
      if (allocationLedger && agentSnap) {
        await allocationLedger.repo.recordTransaction({
          tenantId: tenant,
          fromEntityType: 'agent',
          fromEntityId: loggedInAgentId,
          toEntityType: 'player',
          toEntityId: String(row.id),
          transactionType: 'ALLOCATION',
          amount: creditToAllocate,
          currency: allocationLedger.currency,
          balanceBefore: Math.max(0, Math.round((agentSnap.creditLimit - (agentSnap.creditUsed - creditToAllocate) + agentSnap.settlementBalance) * 100) / 100),
          balanceAfter: agentSnap.creditAvailable,
          reason: 'Credit allocation to player at creation',
          createdBy: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(loggedInAgentId)) ? String(loggedInAgentId) : undefined,
          createdByType: 'agent',
          metadata: { allocationType: 'player_creation' },
        }, tx)
      }

      return row
    })
    const userId = created.id

    // Credit alert check for the agent whose credit moved (best-effort, never throws).
    if (creditToAllocate > 0) {
      const { CreditService } = await import('@src/domains/agents/services/CreditService.js')
      await new CreditService(agentsRepo).checkCreditAlerts(loggedInAgentId)
    }

    // Link to agent via referral attribution
    // Note: Referral attribution requires a user ID, not an agent ID
    // Since agents may not have user accounts, we skip this for now
    // In production, agents should have user accounts for proper referral tracking
    try {
      const agent = await agentsRepo.findById(targetAgentId);
      
      if (agent) {
        // TODO: If agents have user accounts, link them here
        // For now, we skip referral attribution as agentId is UUID, not a user ID
        // const { createReferralAttributionDb } = await import('@/repos/referrals/referralsRepo.js');
        // await createReferralAttributionDb(tenant, {
        //   referrerId: agentUserId, // Would need to get user ID from agent
        //   refereeId: userId,
        //   tier: 1,
        //   status: 'confirmed',
        //   reason: `Agent-created ${effectivePlayerType} player`,
        // });
      }
    } catch (error) {
    }

    await recordAuditDb({
      tenant,
      actorId: loggedInAgentId,
      domain: 'players',
      action: 'create_player',
      resourceType: 'player',
      resourceId: String(userId),
      after: { 
        username: args.input.username, 
        agentId: targetAgentId,
        playerType: effectivePlayerType,
        creditLimit: isCreditAgent ? args.input.creditLimit : null,
        createdBy: loggedInAgentId,
      },
    })

    return {
      success: true,
      message: `${effectivePlayerType === 'AGENT_CREDIT' ? 'Credit' : 'Regular'} player created successfully`,
      playerId: String(userId),
    }
  },

  suspendPlayer: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'players.profile', 'update')
    ensureAgentCanMutate(ctx)
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const userId = Number(args.playerId)
    if (!Number.isFinite(userId)) throw new Error('Invalid player ID')

    // Agent authorization check
    await playerAuthService.validateAgentPlayerAccess(ctx, userId, 'suspend')

    const { setUserStatusDb, getUserDb } = await import('@/repos/users/usersRepo.js')
    await setUserStatusDb(userId, 'SUSPENDED', tenant)

    await recordAuditDb({
      tenant,
      actorId: ctx?.user?.id || ctx?.user?.agentId || 'system',
      domain: 'players',
      action: 'suspend_player',
      resourceType: 'player',
      resourceId: String(userId),
      after: { reason: args.reason },
    })

    // Create notification for player suspension
    try {
      const user = await getUserDb(userId, tenant)
      if (user) {
        const { NotificationsRepo } = await import('@/repos/notifications/notificationsRepo.js');
        const { NotificationService } = await import('@/domains/notifications/services/NotificationService.js');
        const notificationsRepo = new NotificationsRepo();
        const notificationService = new NotificationService(notificationsRepo);
        const whitelabelId = directorTenant ?? tenant;
        const agentId = (user as { agentId?: string | null })?.agentId ?? null;
        const userName = user.name || user.username || `User ID ${userId}`
        const userPhone = user.phone || 'N/A'
        await notificationService.createNotification(
          {
            tenant,
            whitelabelId: whitelabelId || tenant,
            agentId,
            userId,
            type: 'PLAYER',
            category: 'general',
            title: 'Player account suspended',
            message: `Player ${userName} (${userPhone}) account has been suspended.${args.reason ? ` Reason: ${args.reason}` : ''}`,
            actionUrl: `/players/profile/${userId}`,
            metadata: { userId, userName, userPhone, action: 'suspend', reason: args.reason || null },
          },
          ctx?.pubsub
        );
      }
    } catch (err: any) {
    }

    return {
      success: true,
      message: 'Player suspended successfully',
    }
  },

  blockPlayer: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'players.profile', 'update')
    ensureAgentCanMutate(ctx)
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const userId = Number(args.playerId)
    if (!Number.isFinite(userId)) throw new Error('Invalid player ID')

    // Agent authorization check
    await playerAuthService.validateAgentPlayerAccess(ctx, userId, 'block')

    const { setUserStatusDb } = await import('@/repos/users/usersRepo.js')
    await setUserStatusDb(userId, 'SUSPENDED', tenant)

    await recordAuditDb({
      tenant,
      actorId: ctx?.user?.id || ctx?.user?.agentId || 'system',
      domain: 'players',
      action: 'block_player',
      resourceType: 'player',
      resourceId: String(userId),
      after: { reason: args.reason },
    })

    return {
      success: true,
      message: 'Player blocked successfully',
    }
  },

  unblockPlayer: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'players.profile', 'update')
    ensureAgentCanMutate(ctx)
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const userId = Number(args.playerId)
    if (!Number.isFinite(userId)) throw new Error('Invalid player ID')

    // Agent authorization check
    await playerAuthService.validateAgentPlayerAccess(ctx, userId, 'unblock')

    const { setUserStatusDb } = await import('@/repos/users/usersRepo.js')
    await setUserStatusDb(userId, 'ACTIVE', tenant)

    await recordAuditDb({
      tenant,
      actorId: ctx?.user?.id || ctx?.user?.agentId || 'system',
      domain: 'players',
      action: 'unblock_player',
      resourceType: 'player',
      resourceId: String(userId),
      after: { reason: args.reason },
    })

    return {
      success: true,
      message: 'Player unblocked successfully',
    }
  },

  movePlayerToAgent: async (_: any, args: any, ctx: any) => {
    ensureAgentCanMutate(ctx)
    requirePermission(ctx, 'players.move-agent', 'execute')

    if (ctx?.user?.type === 'agent') {
      throw new Error('Forbidden: only admin users can move players between agents')
    }

    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    const parsed = z.object({
      playerId: z.string().min(1),
      targetAgentId: z.string().uuid('Invalid target agent ID'),
      reason: z.string().min(5, 'Reason must be at least 5 characters'),
    }).safeParse(args.input)

    if (!parsed.success) {
      throw new Error(parsed.error.issues.map(e => e.message).join(', '))
    }

    const { playerId: playerIdStr, targetAgentId, reason } = parsed.data
    const playerId = Number(playerIdStr)
    if (!Number.isFinite(playerId)) throw new Error('Invalid player ID')

    const player = await getUserDb(playerId, tenant)
    if (!player) throw new Error('Player not found')

    if ((player as any).playerType !== 'COMMISSION_AGENT_PLAYER') {
      throw new Error('Only commission agent players can be moved between agents')
    }
    if (!isActiveEntityStatus(player.status)) {
      throw new Error('Player must be ACTIVE to be moved. Current status: ' + player.status)
    }

    const sourceAgentId = (player as any).agentId
    if (!sourceAgentId) throw new Error('Player does not have an assigned agent')
    if (sourceAgentId === targetAgentId) throw new Error('Player is already assigned to this agent')

    const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
    const agentsRepo = new AgentsRepo()

    const sourceAgent = await agentsRepo.findById(sourceAgentId)
    if (!sourceAgent) throw new Error('Source agent not found')
    if (sourceAgent.schemeType !== 'COMMISSION') throw new Error('Source agent is not a COMMISSION agent')
    if (!isActiveEntityStatus(sourceAgent.status)) throw new Error('Source agent is not ACTIVE')
    if (sourceAgent.tenantId !== tenant) throw new Error('Source agent does not belong to this tenant')

    const targetAgent = await agentsRepo.findById(targetAgentId)
    if (!targetAgent) throw new Error('Target agent not found')
    if (targetAgent.schemeType !== 'COMMISSION') throw new Error('Target agent is not a COMMISSION agent')
    if (!isActiveEntityStatus(targetAgent.status)) throw new Error('Target agent is not ACTIVE')
    if (targetAgent.tenantId !== tenant) throw new Error('Target agent does not belong to this tenant')

    const sourceDomains = sourceAgent.allowedDomains ?? []
    const targetDomains = targetAgent.allowedDomains ?? []
    const missingDomains = sourceDomains.filter((d: string) => !targetDomains.includes(d))
    if (missingDomains.length > 0) {
      throw new Error(`Target agent does not support domains: ${missingDomains.join(', ')}`)
    }

    // Commission settlement guard: blocks only if THIS player has bets in unsettled cycles
    // of an agent whose commission the move re-attributes (source side and target side).
    const { evaluateCommissionAgentMoveGuard } = await import('../services/commissionAgentMoveGuard.js')
    const commissionMoveGuard = await evaluateCommissionAgentMoveGuard(sourceAgentId, tenant, playerId, targetAgentId)
    if (commissionMoveGuard.blockers.length > 0) {
      throw new Error(commissionMoveGuard.blockers.join(' '))
    }

    // Open bets guard — check ALL open bets regardless of age
    const now = new Date()
    const epoch = new Date(0)

    const { getPlayerOverviewOpenAggregates: sportsOpen } = await import('@/repos/sports/sportsBetsRepo.js')
    const { getPlayerOverviewOpenAggregates: casinoOpen } = await import('@/repos/casino/casinoBetsRepo.js')
    const { getPlayerOverviewOpenAggregates: matkaOpen } = await import('@/repos/matka/matkaBetsRepo.js')

    const [sportsAgg, casinoAgg, matkaAgg] = await Promise.all([
      sportsOpen(tenant, playerId, epoch, now),
      casinoOpen(tenant, playerId, epoch, now),
      matkaOpen(tenant, playerId, epoch, now),
    ])

    const totalOpenBets = (sportsAgg.openCount ?? 0) + (casinoAgg.openCount ?? 0) + (matkaAgg.openCount ?? 0)
    if (totalOpenBets > 0) {
      throw new Error(`Player has ${totalOpenBets} open bet(s). Settle all bets before moving.`)
    }

    // Active bonus guard
    const { getActiveBonusCountForPlayer } = await import('@/repos/marketing/bonusesRepo.js')
    const activeBonusCount = await getActiveBonusCountForPlayer(playerId)
    if (activeBonusCount > 0) {
      throw new Error(`Player has ${activeBonusCount} active/pending bonus(es). Complete or cancel bonuses before moving.`)
    }

    // Execute move
    const { movePlayerAgentDb } = await import('@/repos/users/usersRepo.js')
    await movePlayerAgentDb(playerId, tenant, targetAgentId)

    const sourceUsername = (sourceAgent as any).username ?? sourceAgentId
    const targetUsername = (targetAgent as any).username ?? targetAgentId
    const playerName = player.name || player.username || `Player ${playerId}`
    const playerPhone = player.phone || 'N/A'

    await recordAuditDb({
      tenant,
      actorId: ctx?.user?.id || ctx?.user?.sub || 'system',
      domain: 'players',
      action: 'move_player_agent',
      resourceType: 'player',
      resourceId: String(playerId),
      before: { agentId: sourceAgentId, agentUsername: sourceUsername, playerName, playerPhone },
      after: { agentId: targetAgentId, agentUsername: targetUsername, reason },
    })

    // Notifications to both agents
    try {
      const { NotificationsRepo } = await import('@/repos/notifications/notificationsRepo.js')
      const { NotificationService } = await import('@/domains/notifications/services/NotificationService.js')
      const notificationsRepo = new NotificationsRepo()
      const notificationService = new NotificationService(notificationsRepo)
      const whitelabelId = directorTenant ?? tenant

      await notificationService.createNotification({
        tenant,
        whitelabelId: whitelabelId || tenant,
        agentId: sourceAgentId,
        userId: playerId,
        type: 'AGENT',
        category: 'general',
        title: 'Player moved out of your downline',
        message: `Player ${playerName} (${playerPhone}) has been moved to agent ${targetUsername}. Reason: ${reason}`,
        actionUrl: `/players/profile/${playerId}`,
        metadata: { action: 'move_player_agent', direction: 'out', targetAgentId, reason },
      }, ctx?.pubsub)

      await notificationService.createNotification({
        tenant,
        whitelabelId: whitelabelId || tenant,
        agentId: targetAgentId,
        userId: playerId,
        type: 'AGENT',
        category: 'general',
        title: 'New player added to your downline',
        message: `Player ${playerName} (${playerPhone}) has been moved to your downline from agent ${sourceUsername}.`,
        actionUrl: `/players/profile/${playerId}`,
        metadata: { action: 'move_player_agent', direction: 'in', sourceAgentId, reason },
      }, ctx?.pubsub)
    } catch (_notifErr: any) {
      // Non-critical: don't fail the mutation if notifications fail
    }

    return {
      success: true,
      message: `Player moved from ${sourceUsername} to ${targetUsername} successfully`,
    }
  },
}

