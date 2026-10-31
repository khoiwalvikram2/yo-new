import { getEffectiveTenantForDirector } from '@/domains/common/directorModeUtils.js'
import { db } from '@/db/client.js'
import { voidAndRefundMatkaBet } from '@shared/matka/settlement.js'
import { addWorliActivity } from '@/repos/matka-worli/worliActivityRepo.js'
import { getWorliInstanceByIdScoped, updateWorliInstanceStatus, patchWorliInstance } from '@/repos/matka-worli/worliInstancesRepo.js'
import { hasPermission } from '@/domains/common/auth.js'
import { getMatkaBetById } from '@/repos/matka/matkaBetsRepo.js'
import { recomputeInstanceCounters } from '@/domains/matka-worli/services/RiskService.js'

export const worliMutationResolvers = {
  pauseWorliInstance: async function (_: any, { id, reason }: any, ctx: any) {
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'update')) return { success: false, message: 'Forbidden' }
    // `matka_worli_instances` carries no tenant of its own; the market it
    // belongs to does. Without this join one whitelabel could act on another's
    // session by naming its id.
    const tenant = getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const inst = await getWorliInstanceByIdScoped(id, tenant)
    if (!inst) return { success: false, message: 'Not found' }
    if (inst.resultPublishedAtUtc) return { success: false, message: 'Rollback the published result before changing this session' }
    if (inst.status === 'PAUSED') return { success: true, message: 'Already paused' }
    const updated = await updateWorliInstanceStatus(id, 'PAUSED' as any)
    await addWorliActivity({ instanceId: id, actorId: String(ctx?.user?.sub ?? ctx?.actor?.id ?? 'system'), action: 'PAUSE', reason })
    // notify subscribers
    ctx.pubsub.publish({ topic: `WORLI_INSTANCE_${id}`, payload: { worliInstanceUpdated: {
      id: updated.id,
      marketId: updated.marketId,
      runDate: updated.runDate,
      side: updated.side,
      status: updated.status,
      scheduledOpenAt: updated.scheduledOpenAtUtc?.toISOString?.() ?? null,
      scheduledLockAt: updated.scheduledLockAtUtc?.toISOString?.() ?? null,
      scheduledCloseAt: updated.scheduledCloseAtUtc?.toISOString?.() ?? null,
      operatorMessage: updated.operatorMessage,
      counters: {
        betCount: updated.betCount,
        totalStakeMinor: Number(updated.totalStakeMinor ?? 0),
        exposureTotalMinor: Number(updated.exposureTotalMinor ?? 0),
        worstOutcomeKey: updated.worstOutcomeKey ?? null,
        worstOutcomePlMinor: updated.worstOutcomePlMinor != null ? Number(updated.worstOutcomePlMinor) : null,
      },
      bidRulesVersionId: updated.bidRulesVersionId,
    } } })
    return { success: true, message: 'Paused' }
  },
  resumeWorliInstance: async function (_: any, { id, reason }: any, ctx: any) {
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'update')) return { success: false, message: 'Forbidden' }
    // `matka_worli_instances` carries no tenant of its own; the market it
    // belongs to does. Without this join one whitelabel could act on another's
    // session by naming its id.
    const tenant = getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const inst = await getWorliInstanceByIdScoped(id, tenant)
    if (!inst) return { success: false, message: 'Not found' }
    if (inst.resultPublishedAtUtc) return { success: false, message: 'Rollback the published result before changing this session' }
    if (inst.status !== 'PAUSED') return { success: true, message: 'Not paused' }
    const updated = await updateWorliInstanceStatus(id, 'OPEN' as any)
    await addWorliActivity({ instanceId: id, actorId: String(ctx?.user?.sub ?? ctx?.actor?.id ?? 'system'), action: 'RESUME', reason })
    ctx.pubsub.publish({ topic: `WORLI_INSTANCE_${id}`, payload: { worliInstanceUpdated: {
      id: updated.id,
      marketId: updated.marketId,
      runDate: updated.runDate,
      side: updated.side,
      status: updated.status,
      scheduledOpenAt: updated.scheduledOpenAtUtc?.toISOString?.() ?? null,
      scheduledLockAt: updated.scheduledLockAtUtc?.toISOString?.() ?? null,
      scheduledCloseAt: updated.scheduledCloseAtUtc?.toISOString?.() ?? null,
      operatorMessage: updated.operatorMessage,
      counters: {
        betCount: updated.betCount,
        totalStakeMinor: Number(updated.totalStakeMinor ?? 0),
        exposureTotalMinor: Number(updated.exposureTotalMinor ?? 0),
        worstOutcomeKey: updated.worstOutcomeKey ?? null,
        worstOutcomePlMinor: updated.worstOutcomePlMinor != null ? Number(updated.worstOutcomePlMinor) : null,
      },
      bidRulesVersionId: updated.bidRulesVersionId,
    } } })
    return { success: true, message: 'Resumed' }
  },
  lockNowWorliInstance: async function (_: any, { id, reason }: any, ctx: any) {
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'update')) return { success: false, message: 'Forbidden' }
    // `matka_worli_instances` carries no tenant of its own; the market it
    // belongs to does. Without this join one whitelabel could act on another's
    // session by naming its id.
    const tenant = getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const inst = await getWorliInstanceByIdScoped(id, tenant)
    if (!inst) return { success: false, message: 'Not found' }
    if (inst.resultPublishedAtUtc) return { success: false, message: 'Rollback the published result before changing this session' }
    const now = new Date()
    const updated = await patchWorliInstance(id, { actualLockAtUtc: now } as any)
    await addWorliActivity({ instanceId: id, actorId: String(ctx?.user?.sub ?? ctx?.actor?.id ?? 'system'), action: 'LOCK_NOW', reason })
    ctx.pubsub.publish({ topic: `WORLI_INSTANCE_${id}`, payload: { worliInstanceUpdated: {
      id: updated.id,
      marketId: updated.marketId,
      runDate: updated.runDate,
      side: updated.side,
      status: updated.status,
      scheduledOpenAt: updated.scheduledOpenAtUtc?.toISOString?.() ?? null,
      scheduledLockAt: updated.scheduledLockAtUtc?.toISOString?.() ?? null,
      scheduledCloseAt: updated.scheduledCloseAtUtc?.toISOString?.() ?? null,
      operatorMessage: updated.operatorMessage,
      counters: {
        betCount: updated.betCount,
        totalStakeMinor: Number(updated.totalStakeMinor ?? 0),
        exposureTotalMinor: Number(updated.exposureTotalMinor ?? 0),
        worstOutcomeKey: updated.worstOutcomeKey ?? null,
        worstOutcomePlMinor: updated.worstOutcomePlMinor != null ? Number(updated.worstOutcomePlMinor) : null,
      },
      bidRulesVersionId: updated.bidRulesVersionId,
    } } })
    return { success: true, message: 'Locked' }
  },
  closeNowWorliInstance: async function (_: any, { id, reason }: any, ctx: any) {
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'update')) return { success: false, message: 'Forbidden' }
    // `matka_worli_instances` carries no tenant of its own; the market it
    // belongs to does. Without this join one whitelabel could act on another's
    // session by naming its id.
    const tenant = getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const inst = await getWorliInstanceByIdScoped(id, tenant)
    if (!inst) return { success: false, message: 'Not found' }
    if (inst.resultPublishedAtUtc) return { success: false, message: 'Rollback the published result before changing this session' }
    const now = new Date()
    const updated = await patchWorliInstance(id, { actualCloseAtUtc: now } as any)
    await addWorliActivity({ instanceId: id, actorId: String(ctx?.user?.sub ?? ctx?.actor?.id ?? 'system'), action: 'CLOSE_NOW', reason })
    ctx.pubsub.publish({ topic: `WORLI_INSTANCE_${id}`, payload: { worliInstanceUpdated: {
      id: updated.id,
      marketId: updated.marketId,
      runDate: updated.runDate,
      side: updated.side,
      status: updated.status,
      scheduledOpenAt: updated.scheduledOpenAtUtc?.toISOString?.() ?? null,
      scheduledLockAt: updated.scheduledLockAtUtc?.toISOString?.() ?? null,
      scheduledCloseAt: updated.scheduledCloseAtUtc?.toISOString?.() ?? null,
      operatorMessage: updated.operatorMessage,
      counters: {
        betCount: updated.betCount,
        totalStakeMinor: Number(updated.totalStakeMinor ?? 0),
        exposureTotalMinor: Number(updated.exposureTotalMinor ?? 0),
        worstOutcomeKey: updated.worstOutcomeKey ?? null,
        worstOutcomePlMinor: updated.worstOutcomePlMinor != null ? Number(updated.worstOutcomePlMinor) : null,
      },
      bidRulesVersionId: updated.bidRulesVersionId,
    } } })
    return { success: true, message: 'Closed' }
  },
  setWorliMarketMessage: async function (_: any, { id, message }: any, ctx: any) {
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'update')) return { success: false, message: 'Forbidden' }
    // `matka_worli_instances` carries no tenant of its own; the market it
    // belongs to does. Without this join one whitelabel could act on another's
    // session by naming its id.
    const tenant = getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    // This one patched without looking the instance up at all.
    const inst = await getWorliInstanceByIdScoped(id, tenant)
    if (!inst) return { success: false, message: 'Not found' }
    if (inst.resultPublishedAtUtc) return { success: false, message: 'Rollback the published result before changing this session' }
    const updated = await patchWorliInstance(id, { operatorMessage: message })
    await addWorliActivity({ instanceId: id, actorId: String(ctx?.user?.sub ?? ctx?.actor?.id ?? 'system'), action: 'SET_MESSAGE', reason: null, metaJson: { message } })
    ctx.pubsub.publish({ topic: `WORLI_INSTANCE_${id}`, payload: { worliInstanceUpdated: {
      id: updated.id,
      marketId: updated.marketId,
      runDate: updated.runDate,
      side: updated.side,
      status: updated.status,
      scheduledOpenAt: updated.scheduledOpenAtUtc?.toISOString?.() ?? null,
      scheduledLockAt: updated.scheduledLockAtUtc?.toISOString?.() ?? null,
      scheduledCloseAt: updated.scheduledCloseAtUtc?.toISOString?.() ?? null,
      operatorMessage: updated.operatorMessage,
      counters: {
        betCount: updated.betCount,
        totalStakeMinor: Number(updated.totalStakeMinor ?? 0),
        exposureTotalMinor: Number(updated.exposureTotalMinor ?? 0),
        worstOutcomeKey: updated.worstOutcomeKey ?? null,
        worstOutcomePlMinor: updated.worstOutcomePlMinor != null ? Number(updated.worstOutcomePlMinor) : null,
      },
      bidRulesVersionId: updated.bidRulesVersionId,
    } } })
    return { success: true, message: 'Message set' }
  },
  adjustWorliSuspendMinutes: async function (_: any, { id, minutes, reason }: any, ctx: any) {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) return { success: false, message: 'Suspend minutes must be between 0 and 1440' }
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'update')) return { success: false, message: 'Forbidden' }
    // `matka_worli_instances` carries no tenant of its own; the market it
    // belongs to does. Without this join one whitelabel could act on another's
    // session by naming its id.
    const tenant = getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    // This one patched without looking the instance up at all.
    const inst = await getWorliInstanceByIdScoped(id, tenant)
    if (!inst) return { success: false, message: 'Not found' }
    if (inst.resultPublishedAtUtc) return { success: false, message: 'Rollback the published result before changing this session' }
    const updated = await patchWorliInstance(id, { suspendMinutesOverride: minutes })
    await addWorliActivity({ instanceId: id, actorId: String(ctx?.user?.sub ?? ctx?.actor?.id ?? 'system'), action: 'ADJUST_SUSPEND', reason, metaJson: { minutes } })
    ctx.pubsub.publish({ topic: `WORLI_INSTANCE_${id}`, payload: { worliInstanceUpdated: {
      id: updated.id,
      marketId: updated.marketId,
      runDate: updated.runDate,
      side: updated.side,
      status: updated.status,
      scheduledOpenAt: updated.scheduledOpenAtUtc?.toISOString?.() ?? null,
      scheduledLockAt: updated.scheduledLockAtUtc?.toISOString?.() ?? null,
      scheduledCloseAt: updated.scheduledCloseAtUtc?.toISOString?.() ?? null,
      operatorMessage: updated.operatorMessage,
      counters: {
        betCount: updated.betCount,
        totalStakeMinor: Number(updated.totalStakeMinor ?? 0),
        exposureTotalMinor: Number(updated.exposureTotalMinor ?? 0),
        worstOutcomeKey: updated.worstOutcomeKey ?? null,
        worstOutcomePlMinor: updated.worstOutcomePlMinor != null ? Number(updated.worstOutcomePlMinor) : null,
      },
      bidRulesVersionId: updated.bidRulesVersionId,
    } } })
    return { success: true, message: 'Suspend minutes adjusted' }
  },
  voidMatkaBet: async function (_: any, { id, reason }: any, ctx: any) {
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'update')) return { success: false, message: 'Forbidden' }
    const bet = await getMatkaBetById(id)
    if (!bet) return { success: false, message: 'Bet not found' }
    // `getMatkaBetById` looks a bet up by id alone, and `updateMatkaBetStatus`
    // then takes the tenant from the row it found. Nothing compared either to
    // the caller, so a whitelabel admin holding `matka.worli:update` could void
    // another brand's bet by id. Reported as 'not found' rather than
    // 'forbidden', so the response does not confirm the id exists elsewhere.
    const callerTenant = getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    if ((bet.tenant || 'default') !== callerTenant) {
      return { success: false, message: 'Bet not found' }
    }
    try {
      await voidAndRefundMatkaBet(db, id, reason, { tenant: callerTenant, actorId: String(ctx?.user?.sub ?? 'system') })
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Could not void this bet' }
    }
    if (bet.instanceId) {
      await recomputeInstanceCounters(bet.instanceId, ctx.pubsub)
    }
    return { success: true, message: 'Bet voided' }
  },
}

