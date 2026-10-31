// Member and points mutations moved to the database; the in-memory equivalents
// (createMember, updateMember, addPoints, removePoints) are no longer imported so
// nobody reaches for them again by accident.
import {
  createTier,
  updateTier,
  deleteTier,
  scheduleTierStatus,
  publishScheduled,
  revertVIPVersion,
  importVIPTiers,
  exportVIPTiers,
  addVIPAudit
} from '@/stores/index.js'
import { createVipTierDb, updateVipTierDb, deleteVipTierDb, addVipAuditDb } from '@src/repos/vip/vipRepo.js'
import { resolveVipTenant } from '@src/domains/vip/vipTenantContext.js'
import { z } from 'zod'
import { vipDepositPolicySchema } from '@shared/vip/depositPolicy.js'
import { hasPermission } from '@src/domains/common/auth.js'

// Null or absent leaves the receiving accounts as they are.
const ReceivingAccountIds = z.array(z.string().min(1)).max(500).nullable().optional()

/** Choosing a tier's receiving accounts edits payment methods, which needs that permission too. */
function assertCanEditAccounts(ctx: any, ids: string[] | null | undefined) {
  if (ids == null) return
  if (!hasPermission(ctx?.permissions ?? [], 'payments.methods', 'update'))
    throw new Error('Forbidden: choosing receiving accounts needs permission to update payment methods')
}

const VIPPerkInput = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  icon: z.string().optional()
})

const VIPTierInput = z.object({
  input: z.object({
    name: z.string().min(1),
    level: z.number().int().positive(),
    minMonthlyDeposit: z.number().min(0),
    color: z.string().min(1),
    depositPolicy: vipDepositPolicySchema.optional(),
    benefits: z.array(z.string()),
    perks: z.array(VIPPerkInput),
    receivingAccountIds: ReceivingAccountIds,
  })
})

const UpdateVIPTierInput = z.object({
  id: z.string().min(1),
  input: z.object({
    name: z.string().min(1).optional(),
    level: z.number().int().positive().optional(),
    minMonthlyDeposit: z.number().min(0).optional(),
    color: z.string().min(1).optional(),
    depositPolicy: vipDepositPolicySchema.optional(),
    benefits: z.array(z.string()).optional(),
    perks: z.array(VIPPerkInput).optional(),
    receivingAccountIds: ReceivingAccountIds,
  })
})

const DeleteVIPTierInput = z.object({
  id: z.string().min(1)
})

const CreateVIPMemberInput = z.object({
  input: z.object({
    userId: z.string().min(1),
    tierId: z.string().min(1),
    initialPoints: z.number().int().min(0).optional()
  })
})

const UpdateVIPMemberInput = z.object({
  input: z.object({
    memberId: z.string().min(1),
    tierId: z.string().min(1).optional(),
    points: z.number().int().min(0).optional(),
    status: z.string().optional()
  })
})

const VIPPointsInput = z.object({
  input: z.object({
    memberId: z.string().min(1),
    points: z.number().int().positive(),
    description: z.string().min(1),
    relatedEntityType: z.string().optional(),
    relatedEntityId: z.string().optional()
  })
})

export const vipMutationResolvers = {
  createVIPTier: async (_: unknown, args: unknown, ctx: any) => {
    try {
      const { input } = VIPTierInput.parse(args)
      assertCanEditAccounts(ctx, input.receivingAccountIds)
      const tenant = resolveVipTenant(ctx)
      // Persist in DB
      const dbTier = await createVipTierDb({ ...input, status: 'active', tenant })
      if (!dbTier) throw new Error('Failed to create VIP tier')
      await addVipAuditDb(resolveVipTenant(ctx), ctx?.user?.id,'create_tier', dbTier.id, `Created tier ${dbTier.name}`)
      // Compose payload tier with benefits/perks for GraphQL
      const tier = { ...dbTier, benefits: input.benefits, perks: input.perks }
      return {
        success: true,
        message: `VIP tier "${tier.name}" created successfully`,
        tier
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create VIP tier',
        tier: null
      }
    }
  },

  updateVIPTier: async (_: unknown, args: unknown, ctx: any) => {
    try {
      const { id, input } = UpdateVIPTierInput.parse(args)
      assertCanEditAccounts(ctx, input.receivingAccountIds)
      const updated = await updateVipTierDb(id, input, resolveVipTenant(ctx))
      if (!updated) {
        return {
          success: false,
          message: 'VIP tier not found',
          tier: null
        }
      }
      await addVipAuditDb(resolveVipTenant(ctx), ctx?.user?.id,'update_tier', id, `Updated tier ${updated.name}`)
      const tier = { ...updated, benefits: input.benefits ?? [], perks: input.perks ?? [] }
      return {
        success: true,
        message: `VIP tier "${tier.name}" updated successfully`,
        tier
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update VIP tier',
        tier: null
      }
    }
  },

  deleteVIPTier: async (_: unknown, args: unknown, ctx: any) => {
    try {
      const { id } = DeleteVIPTierInput.parse(args)
      const deleted = await deleteVipTierDb(id, resolveVipTenant(ctx))
      if (!deleted) {
        return {
          success: false,
          message: 'VIP tier not found',
          tier: null
        }
      }
      await addVipAuditDb(resolveVipTenant(ctx), ctx?.user?.id,'delete_tier', id, `Deleted tier ${id}`)
      return {
        success: true,
        message: 'VIP tier deleted successfully',
        tier: null
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to delete VIP tier',
        tier: null
      }
    }
  },

  createVIPMember: async (_: unknown, args: unknown, context: any) => {
    try {
      const { input } = CreateVIPMemberInput.parse(args)
      const tenant = resolveVipTenant(context)
      const userId = Number(input.userId)
      if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Invalid user ID')
      const { db } = await import('@/db/client.js')
      const { changePlayerVipTier } = await import('@shared/vip/membership.js')
      const { lockVipPlayer } = await import('@shared/vip/depositAccess.js')
      const { vipMembersTable, vipTransactionsTable } = await import('@/db/schema.js')
      const { and, eq } = await import('drizzle-orm')
      await db.transaction(async tx => {
        await lockVipPlayer(tx, tenant, userId)
        const [existing] = await tx.select().from(vipMembersTable).where(and(eq(vipMembersTable.tenant, tenant), eq(vipMembersTable.userId, String(userId))))
        await changePlayerVipTier(tx, tenant, userId, input.tierId, String(context?.user?.id || 'admin'), 'Manual enrollment by admin')
        if (!existing && input.initialPoints) {
          const [member] = await tx.select().from(vipMembersTable).where(and(eq(vipMembersTable.tenant, tenant), eq(vipMembersTable.userId, String(userId))))
          await tx.update(vipMembersTable).set({ currentPoints: input.initialPoints, lifetimePoints: input.initialPoints }).where(eq(vipMembersTable.id, member.id))
          await tx.insert(vipTransactionsTable).values({ memberId: member.id, type: 'credit', points: input.initialPoints,
            description: 'Initial VIP points set by admin', balanceBefore: 0, balanceAfter: input.initialPoints, createdAt: new Date() })
        }
      })
      const { getVipMemberByUserIdDb } = await import('@/repos/vip/vipRepo.js')
      return { success: true, message: 'VIP member saved successfully', member: await getVipMemberByUserIdDb(String(userId), tenant) }
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to create VIP member', member: null }
    }
  },

  /**
   * These three used to call the in-memory vipStore, so an operator's change lived in
   * one process, was invisible to every other, and was gone on restart. They now write
   * the database, scoped to the caller's whitelabel.
   */
  updateVIPMember: async (_: unknown, args: unknown, ctx: any) => {
    try {
      const { input } = UpdateVIPMemberInput.parse(args)
      const { updateVipMemberDb } = await import('@/repos/vip/vipRepo.js')
      const member = await updateVipMemberDb(resolveVipTenant(ctx), input.memberId, {
        tierId: input.tierId,
        currentPoints: input.points,
        status: input.status,
      }, String(ctx?.user?.id || ctx?.user?.sub || 'admin'))

      if (!member) {
        return {
          success: false,
          message: 'VIP member not found',
          member: null
        }
      }

      return {
        success: true,
        message: `VIP member updated successfully`,
        member
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update VIP member',
        member: null
      }
    }
  },

  addVIPPoints: async (_: unknown, args: unknown, ctx: any) => {
    try {
      const { input } = VIPPointsInput.parse(args)
      const tenant = resolveVipTenant(ctx)
      const { addVipPointsDb, getVipMemberDb } = await import('@/repos/vip/vipRepo.js')
      const result = await addVipPointsDb(
        tenant,
        input.memberId,
        input.points,
        input.description,
        input.relatedEntityType,
        input.relatedEntityId
      )

      if (!result) {
        return {
          success: false,
          message: 'VIP member not found',
          transaction: null,
          member: null
        }
      }

      return {
        success: true,
        message: `${input.points} points added successfully`,
        transaction: result.transaction,
        // Re-read for the enriched shape the VIPMember type expects (tier name, level,
        // gap to the next tier), which the raw row does not carry.
        member: await getVipMemberDb(input.memberId, tenant)
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to add VIP points',
        transaction: null,
        member: null
      }
    }
  },

  removeVIPPoints: async (_: unknown, args: unknown, ctx: any) => {
    try {
      const { input } = VIPPointsInput.parse(args)
      const tenant = resolveVipTenant(ctx)
      const { removeVipPointsDb, getVipMemberDb } = await import('@/repos/vip/vipRepo.js')
      const result = await removeVipPointsDb(tenant, input.memberId, input.points, input.description)

      if (!result) {
        return {
          success: false,
          message: 'VIP member not found',
          transaction: null,
          member: null
        }
      }

      return {
        success: true,
        message: `${input.points} points removed successfully`,
        transaction: result.transaction,
        member: await getVipMemberDb(input.memberId, tenant)
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to remove VIP points',
        transaction: null,
        member: null
      }
    }
  },

  setVIPTierStatus: async (_: unknown, args: unknown, ctx: any) => {
    const Input = z.object({ id: z.string().min(1), status: z.string().min(1) })
    try {
      const { id, status } = Input.parse(args)
      const updated = await updateVipTierDb(id, { status }, resolveVipTenant(ctx))
      if (!updated) {
        return { success: false, message: 'VIP tier not found', tier: null }
      }
      await addVipAuditDb(resolveVipTenant(ctx), ctx?.user?.id,'set_status', id, `Set tier ${updated.name} status to ${status}`)
      const tier = { ...updated, benefits: [], perks: [] }
      return { success: true, message: `VIP tier status set to ${status}`, tier }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to set VIP tier status',
        tier: null
      }
    }
  }
  ,
  scheduleVIPTierStatus: (_: unknown, args: unknown) => {
    const Input = z.object({ tierId: z.string().min(1), toStatus: z.string().min(1), effectiveAt: z.string().min(1) })
    const { tierId, toStatus, effectiveAt } = Input.parse(args)
    return scheduleTierStatus(tierId, toStatus, effectiveAt)
  },
  publishScheduledVIPTier: (_: unknown, args: unknown) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(args)
    const tier = publishScheduled(id)
    if (!tier) throw new Error('Schedule not found')
    return tier
  },
  revertVIPTierVersion: (_: unknown, args: unknown) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(args)
    const tier = revertVIPVersion(id)
    if (!tier) throw new Error('Version not found')
    return tier
  },
  importVIPTiers: (_: unknown, args: unknown) => {
    const { json } = z.object({ json: z.string().min(2) }).parse(args)
    return importVIPTiers(json)
  },
  exportVIPTiers: () => exportVIPTiers()
}

