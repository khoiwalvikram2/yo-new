import {
  listVIPSchedules,
  listVIPAudit,
  validateTiers,
  listVIPVersions
} from '@/stores/index.js'
import { listVipTiersDb, getVipTierDb, listVipMembersDb, getVipMemberDb, getVipMemberByUserIdDb, listVipTransactionsDb, listVipHistoryDb, getVipStatsDb } from '@src/repos/vip/vipRepo.js'
import { listVipAuditDb } from '@src/repos/vip/vipRepo.js'
import { z } from 'zod'
import { hasPermission } from '@src/domains/common/auth.js'
import { resolveVipTenant } from '@src/domains/vip/vipTenantContext.js'

const IdInput = z.object({ id: z.string().min(1) })
const UserIdInput = z.object({ userId: z.string().min(1) })
const MembersFilter = z.object({
  tierId: z.string().optional(),
  status: z.string().optional(),
  query: z.string().optional()
})
const TransactionsInput = z.object({
  memberId: z.string().min(1),
  limit: z.number().optional()
})

/**
 * Reading VIP data.
 *
 * Two rules that every resolver here now follows, and several of them did not:
 *
 *  - **Scope to a tenant.** vipTransactions, vipHistory, vipTierAudit and
 *    vipNearNextTier previously took no ctx at all. A member id is a bare uuid, so
 *    any authenticated admin could read any whitelabel's points ledger and tier
 *    history by passing one, and the audit list returned every whitelabel's rows to
 *    everybody. vipNearNextTier did not read the database at all — it read the
 *    process-wide in-memory vipStore.
 *  - **Check the permission.** Only vipTiers did. The rest returned member names,
 *    emails and balances to any authenticated admin regardless of role.
 *
 * resolveVipTenant is used rather than the CRM helper because this domain already
 * has one and mixing the two would leave two answers to the same question.
 */
function requireVipRead(ctx: any, domain: 'vip.tiers' | 'vip.members') {
  if (!hasPermission(ctx?.permissions ?? [], domain, 'view')) {
    throw new Error(`Forbidden: insufficient permissions for ${domain}:view`)
  }
}

export const vipQueryResolvers = {
  vipTiers: async (_: unknown, __: unknown, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'players.vip', 'update') && !['view', 'create', 'update'].some(action => hasPermission(ctx?.permissions ?? [], 'payments.methods', action))) requireVipRead(ctx, 'vip.tiers')
    const tiers = await listVipTiersDb(resolveVipTenant(ctx))
    return tiers
  },

  vipTier: async (_: unknown, args: unknown, ctx: any) => {
    requireVipRead(ctx, 'vip.tiers')
    const { id } = IdInput.parse(args)
    const t = await getVipTierDb(id, resolveVipTenant(ctx))
    return t
  },

  vipMembers: async (_: unknown, args: unknown, ctx: any) => {
    requireVipRead(ctx, 'vip.members')
    const filters = MembersFilter.parse(args)
    return listVipMembersDb(filters, resolveVipTenant(ctx))
  },

  vipMember: async (_: unknown, args: unknown, ctx: any) => {
    requireVipRead(ctx, 'vip.members')
    const { id } = IdInput.parse(args)
    return getVipMemberDb(id, resolveVipTenant(ctx))
  },

  vipMemberByUserId: async (_: unknown, args: unknown, ctx: any) => {
    requireVipRead(ctx, 'vip.members')
    const { userId } = UserIdInput.parse(args)
    return getVipMemberByUserIdDb(userId, resolveVipTenant(ctx))
  },

  vipTransactions: async (_: unknown, args: unknown, ctx: any) => {
    requireVipRead(ctx, 'vip.members')
    const { memberId, limit } = TransactionsInput.parse(args)
    return listVipTransactionsDb(resolveVipTenant(ctx), memberId, limit)
  },

  vipHistory: async (_: unknown, args: unknown, ctx: any) => {
    requireVipRead(ctx, 'vip.members')
    // The schema argument is memberId; parsing { id } refused every call.
    const { memberId } = z.object({ memberId: z.string().min(1) }).parse(args)
    return listVipHistoryDb(resolveVipTenant(ctx), memberId)
  },

  vipStats: async (_: unknown, __: unknown, ctx: any) => {
    requireVipRead(ctx, 'vip.members')
    return getVipStatsDb(resolveVipTenant(ctx))
  },

  /**
   * Players within threshold% of their next tier.
   *
   * Reads listVipMembersDb, which is tenant-scoped and computes pointsToNextTier
   * from the live tier table. It used to read the in-memory vipStore, so it returned
   * whatever happened to be in this process — across every whitelabel.
   */
  vipNearNextTier: async (_: unknown, args: unknown, ctx: any) => {
    requireVipRead(ctx, 'vip.members')
    const input = z.object({
      threshold: z.number().min(0).max(1).optional(),
      limit: z.number().int().positive().optional(),
    }).parse(args)
    const threshold = input.threshold ?? 0.2 // 20%

    const members = await listVipMembersDb(undefined, resolveVipTenant(ctx))
    // Progress is this month's approved deposits, the measure tiers are earned by.
    const near = members.filter((m) => {
      if (m.pointsToNextTier === undefined || m.pointsToNextTier < 0) return false
      const target = m.monthlyDeposits + m.pointsToNextTier
      // A member already at or past the threshold has nothing to divide by.
      if (target <= 0) return false
      return m.monthlyDeposits / target >= 1 - threshold
    })

    const sorted = near.sort((a, b) => (a.pointsToNextTier || 0) - (b.pointsToNextTier || 0))
    return input.limit ? sorted.slice(0, input.limit) : sorted
  },

  // The three below read the process-wide in-memory vipStore rather than the
  // database. That is a pre-existing design issue, not a cross-tenant database read;
  // they are gated on the permission here so they are at least not open to any
  // authenticated admin.
  vipTierSchedules: (_: unknown, __: unknown, ctx: any) => {
    requireVipRead(ctx, 'vip.tiers')
    return listVIPSchedules()
  },

  vipTierAudit: async (_: unknown, args: unknown, ctx: any) => {
    requireVipRead(ctx, 'vip.tiers')
    const input = z.object({ limit: z.number().int().positive().optional() }).parse(args)
    try {
      return await listVipAuditDb(resolveVipTenant(ctx), input.limit)
    } catch (err) {
      // This used to fall back to listVIPAudit, the process-wide in-memory array,
      // which is not tenant-scoped — so any database hiccup turned a scoped read into
      // an unscoped one. An audit list that is briefly empty is recoverable; one that
      // shows another whitelabel's rows is not.
      console.error('[vip] audit read failed', err)
      return []
    }
  },

  vipTierValidate: (_: unknown, __: unknown, ctx: any) => {
    requireVipRead(ctx, 'vip.tiers')
    return validateTiers()
  },

  vipTierVersions: (_: unknown, args: unknown, ctx: any) => {
    requireVipRead(ctx, 'vip.tiers')
    const { tierId } = z.object({ tierId: z.string().min(1) }).parse(args)
    return listVIPVersions(tierId)
  }
}
