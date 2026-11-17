import { getEffectiveTenantForDirector, shouldSkipTenantFiltering } from '@/domains/common/directorModeUtils.js'
import { db } from '@/db/client.js'
import { voidAndRefundMatkaBet } from '@shared/matka/settlement.js'
import { worliSessionStatus } from '@shared/matka/schedule.js'
import { addWorliActivity, listWorliActivity } from '@/repos/matka-worli/worliActivityRepo.js'
import { getWorliInstanceByIdScoped, updateWorliInstanceStatus, patchWorliInstance } from '@/repos/matka-worli/worliInstancesRepo.js'
import { hasPermission } from '@/domains/common/auth.js'
import { recordAuditDb } from '@/repos/audit/auditRepo.js'
import { getMatkaBetById } from '@/repos/matka/matkaBetsRepo.js'
import { recomputeInstanceCounters } from '@/domains/matka-worli/services/RiskService.js'
import { worliInstanceViewOf } from '@/domains/matka-worli/services/sessionView.js'
import { UNLOCK_SESSION_CHANGED, worliStatusBeforeStop, worliUnlockRefusal } from '@/domains/matka-worli/services/sessionUnlock.js'
import { unlockWorliSessionIfUnchanged, worliSessionsEverDeclared } from '@/domains/matka-worli/services/sessionUnlockStore.js'
import { SELECT_WHITELABEL_FOR_WORLI, isWorliId } from './queries.js'

/** The whitelabel a session control acts in. A Super Admin in core mode has none, and is told so rather
 *  than answered "Not found" after a lookup in its own tenant (the Worli reads refuse the same way). */
function worliWriteTenant(ctx: any): string | null {
  if (shouldSkipTenantFiltering(ctx)) return null
  return getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
}
/** Once a session is locked (or further on), betting is over for it: pausing or locking it again changes nothing. */
const STOPPED = ['LOCKED', 'CLOSED', 'SETTLING', 'SETTLED', 'VOIDED']

export const worliMutationResolvers = {
  pauseWorliInstance: async function (_: any, { id, reason }: any, ctx: any) {
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'update')) return { success: false, message: 'Forbidden' }
    // `matka_worli_instances` carries no tenant of its own; the market it
    // belongs to does. Without this join one whitelabel could act on another's
    // session by naming its id.
    const tenant = worliWriteTenant(ctx)
    if (!tenant) return { success: false, message: SELECT_WHITELABEL_FOR_WORLI }
    const inst = isWorliId(id) ? await getWorliInstanceByIdScoped(id, tenant) : null
    if (!inst) return { success: false, message: 'Not found' }
    if (inst.resultPublishedAtUtc) return { success: false, message: 'Rollback the published result before changing this session' }
    if (inst.status === 'PAUSED') return { success: true, message: 'Already paused' }
    // A locked session must stay locked: Resume reopens whatever it un-pauses.
    const current = worliSessionStatus(inst)
    if (STOPPED.includes(current)) return { success: false, message: `Session is already ${current.toLowerCase()}; there is no betting to pause` }
    const updated = await updateWorliInstanceStatus(id, 'PAUSED' as any)
    await addWorliActivity({ instanceId: id, actorId: String(ctx?.user?.sub ?? ctx?.actor?.id ?? 'system'), action: 'PAUSE', reason })
    // notify subscribers
    ctx.pubsub.publish({ topic: `WORLI_INSTANCE_${id}`, payload: { worliInstanceUpdated: await worliInstanceViewOf(updated) } })
    return { success: true, message: 'Paused' }
  },
  resumeWorliInstance: async function (_: any, { id, reason }: any, ctx: any) {
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'update')) return { success: false, message: 'Forbidden' }
    // `matka_worli_instances` carries no tenant of its own; the market it
    // belongs to does. Without this join one whitelabel could act on another's
    // session by naming its id.
    const tenant = worliWriteTenant(ctx)
    if (!tenant) return { success: false, message: SELECT_WHITELABEL_FOR_WORLI }
    const inst = isWorliId(id) ? await getWorliInstanceByIdScoped(id, tenant) : null
    if (!inst) return { success: false, message: 'Not found' }
    if (inst.resultPublishedAtUtc) return { success: false, message: 'Rollback the published result before changing this session' }
    if (inst.status !== 'PAUSED') return { success: true, message: 'Not paused' }
    const updated = await updateWorliInstanceStatus(id, 'OPEN' as any)
    await addWorliActivity({ instanceId: id, actorId: String(ctx?.user?.sub ?? ctx?.actor?.id ?? 'system'), action: 'RESUME', reason })
    ctx.pubsub.publish({ topic: `WORLI_INSTANCE_${id}`, payload: { worliInstanceUpdated: await worliInstanceViewOf(updated) } })
    return { success: true, message: 'Resumed' }
  },
  lockNowWorliInstance: async function (_: any, { id, reason }: any, ctx: any) {
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'update')) return { success: false, message: 'Forbidden' }
    // `matka_worli_instances` carries no tenant of its own; the market it
    // belongs to does. Without this join one whitelabel could act on another's
    // session by naming its id.
    const tenant = worliWriteTenant(ctx)
    if (!tenant) return { success: false, message: SELECT_WHITELABEL_FOR_WORLI }
    const inst = isWorliId(id) ? await getWorliInstanceByIdScoped(id, tenant) : null
    if (!inst) return { success: false, message: 'Not found' }
    if (inst.resultPublishedAtUtc) return { success: false, message: 'Rollback the published result before changing this session' }
    // Betting is gated by the status (shared/src/matka/schedule.ts), so Lock Now writes LOCKED; the stamp
    // records when. It wrote only the stamp before, and the session kept taking bets.
    const current = worliSessionStatus(inst)
    if (current === 'LOCKED') return { success: true, message: 'Already locked' }
    if (STOPPED.includes(current)) return { success: false, message: `Session is already ${current.toLowerCase()}` }
    const now = new Date()
    const updated = await patchWorliInstance(id, { status: 'LOCKED', actualLockAtUtc: now })
    // The status it found is what Unlock puts back; `at` is the stamp it wrote (sessionUnlock.ts finds it by that).
    await addWorliActivity({ instanceId: id, actorId: String(ctx?.user?.sub ?? ctx?.actor?.id ?? 'system'), action: 'LOCK_NOW', reason, metaJson: { previousStatus: inst.status, at: now.toISOString() } })
    ctx.pubsub.publish({ topic: `WORLI_INSTANCE_${id}`, payload: { worliInstanceUpdated: await worliInstanceViewOf(updated) } })
    return { success: true, message: 'Locked' }
  },
  closeNowWorliInstance: async function (_: any, { id, reason }: any, ctx: any) {
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'update')) return { success: false, message: 'Forbidden' }
    // `matka_worli_instances` carries no tenant of its own; the market it
    // belongs to does. Without this join one whitelabel could act on another's
    // session by naming its id.
    const tenant = worliWriteTenant(ctx)
    if (!tenant) return { success: false, message: SELECT_WHITELABEL_FOR_WORLI }
    const inst = isWorliId(id) ? await getWorliInstanceByIdScoped(id, tenant) : null
    if (!inst) return { success: false, message: 'Not found' }
    if (inst.resultPublishedAtUtc) return { success: false, message: 'Rollback the published result before changing this session' }
    // As Lock Now: CLOSED stops betting, the stamps record when (closing locks it too, if it was not yet).
    const current = worliSessionStatus(inst)
    if (current === 'CLOSED') return { success: true, message: 'Already closed' }
    if (STOPPED.includes(current) && current !== 'LOCKED') return { success: false, message: `Session is already ${current.toLowerCase()}` }
    const now = new Date()
    const updated = await patchWorliInstance(id, { status: 'CLOSED', actualCloseAtUtc: now, actualLockAtUtc: inst.actualLockAtUtc ?? now })
    await addWorliActivity({ instanceId: id, actorId: String(ctx?.user?.sub ?? ctx?.actor?.id ?? 'system'), action: 'CLOSE_NOW', reason, metaJson: { previousStatus: inst.status, at: now.toISOString() } })
    ctx.pubsub.publish({ topic: `WORLI_INSTANCE_${id}`, payload: { worliInstanceUpdated: await worliInstanceViewOf(updated) } })
    return { success: true, message: 'Closed' }
  },
  /** Undoes Lock Now / Close Now (owner, 2026-11-04): the same permission, a reason, and an audit row with the tenant.
   *  Only before the scheduled close, and only if no result was ever declared for the session, even one rolled back
   *  since (sessionUnlock.ts); the session gets back the status it had before the stop and loses both stamps, so
   *  players can bet on it again. */
  unlockWorliInstance: async function (_: any, { id, reason }: any, ctx: any) {
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'update')) return { success: false, message: 'Forbidden' }
    // `matka_worli_instances` carries no tenant of its own; the market it
    // belongs to does. Without this join one whitelabel could act on another's
    // session by naming its id.
    const tenant = worliWriteTenant(ctx)
    if (!tenant) return { success: false, message: SELECT_WHITELABEL_FOR_WORLI }
    if (typeof reason !== 'string' || !reason.trim()) return { success: false, message: 'A reason is required to unlock a session' }
    const inst = isWorliId(id) ? await getWorliInstanceByIdScoped(id, tenant) : null
    if (!inst) return { success: false, message: 'Not found' }
    const now = new Date()
    const resultEverDeclared = (await worliSessionsEverDeclared([inst.id])).has(inst.id)
    const refusal = worliUnlockRefusal({ ...inst, resultEverDeclared }, now)
    if (refusal) return { success: false, message: refusal }
    const status = worliStatusBeforeStop(inst, await listWorliActivity(id), now) as any
    // Written only while the session is as read above: a result declared, or another operator's stop or unlock, in
    // between leaves no row to update, and the unlock is refused with nothing written.
    const updated = await unlockWorliSessionIfUnchanged(inst, status)
    if (!updated) return { success: false, message: UNLOCK_SESSION_CHANGED }
    const actorId = String(ctx?.user?.sub ?? ctx?.actor?.id ?? 'system')
    const stopped = { status: inst.status, actualLockAtUtc: inst.actualLockAtUtc?.toISOString() ?? null, actualCloseAtUtc: inst.actualCloseAtUtc?.toISOString() ?? null }
    await addWorliActivity({ instanceId: id, actorId, action: 'UNLOCK', reason, metaJson: { restoredStatus: status, stopped } })
    await recordAuditDb({ tenant, actorId, domain: 'matka.worli', action: 'unlock', resourceType: 'worli_instance', resourceId: id,
      before: stopped, after: { status, actualLockAtUtc: null, actualCloseAtUtc: null, reason } })
    ctx.pubsub.publish({ topic: `WORLI_INSTANCE_${id}`, payload: { worliInstanceUpdated: await worliInstanceViewOf(updated) } })
    return { success: true, message: 'Unlocked' }
  },
  setWorliMarketMessage: async function (_: any, { id, message }: any, ctx: any) {
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'update')) return { success: false, message: 'Forbidden' }
    // `matka_worli_instances` carries no tenant of its own; the market it
    // belongs to does. Without this join one whitelabel could act on another's
    // session by naming its id.
    const tenant = worliWriteTenant(ctx)
    if (!tenant) return { success: false, message: SELECT_WHITELABEL_FOR_WORLI }
    // This one patched without looking the instance up at all.
    const inst = isWorliId(id) ? await getWorliInstanceByIdScoped(id, tenant) : null
    if (!inst) return { success: false, message: 'Not found' }
    if (inst.resultPublishedAtUtc) return { success: false, message: 'Rollback the published result before changing this session' }
    const updated = await patchWorliInstance(id, { operatorMessage: message })
    await addWorliActivity({ instanceId: id, actorId: String(ctx?.user?.sub ?? ctx?.actor?.id ?? 'system'), action: 'SET_MESSAGE', reason: null, metaJson: { message } })
    ctx.pubsub.publish({ topic: `WORLI_INSTANCE_${id}`, payload: { worliInstanceUpdated: await worliInstanceViewOf(updated) } })
    return { success: true, message: 'Message set' }
  },
  adjustWorliSuspendMinutes: async function (_: any, { id, minutes, reason }: any, ctx: any) {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) return { success: false, message: 'Suspend minutes must be between 0 and 1440' }
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'update')) return { success: false, message: 'Forbidden' }
    // `matka_worli_instances` carries no tenant of its own; the market it
    // belongs to does. Without this join one whitelabel could act on another's
    // session by naming its id.
    const tenant = worliWriteTenant(ctx)
    if (!tenant) return { success: false, message: SELECT_WHITELABEL_FOR_WORLI }
    // This one patched without looking the instance up at all.
    const inst = isWorliId(id) ? await getWorliInstanceByIdScoped(id, tenant) : null
    if (!inst) return { success: false, message: 'Not found' }
    if (inst.resultPublishedAtUtc) return { success: false, message: 'Rollback the published result before changing this session' }
    // Players lock at close minus these minutes (matkaSchedule), so the stored lock moves with them. Counted
    // from the close, not the old lock, so repeated adjustments do not drift.
    const scheduledLockAtUtc = new Date(inst.scheduledCloseAtUtc.getTime() - minutes * 60000)
    const updated = await patchWorliInstance(id, { suspendMinutesOverride: minutes, scheduledLockAtUtc })
    await addWorliActivity({ instanceId: id, actorId: String(ctx?.user?.sub ?? ctx?.actor?.id ?? 'system'), action: 'ADJUST_SUSPEND', reason, metaJson: { minutes } })
    ctx.pubsub.publish({ topic: `WORLI_INSTANCE_${id}`, payload: { worliInstanceUpdated: await worliInstanceViewOf(updated) } })
    return { success: true, message: 'Suspend minutes adjusted' }
  },
  voidMatkaBet: async function (_: any, { id, reason }: any, ctx: any) {
    if (!hasPermission(ctx?.permissions, 'matka.worli', 'update')) return { success: false, message: 'Forbidden' }
    // An id that is not a uuid names no bet (Postgres would refuse it as a server error).
    const bet = isWorliId(id) ? await getMatkaBetById(id) : null
    if (!bet) return { success: false, message: 'Bet not found' }
    // `getMatkaBetById` looks a bet up by id alone, and `updateMatkaBetStatus`
    // then takes the tenant from the row it found. Nothing compared either to
    // the caller, so a whitelabel admin holding `matka.worli:update` could void
    // another brand's bet by id. Reported as 'not found' rather than
    // 'forbidden', so the response does not confirm the id exists elsewhere.
    const callerTenant = worliWriteTenant(ctx)
    if (!callerTenant) return { success: false, message: SELECT_WHITELABEL_FOR_WORLI }
    if ((bet.tenant || 'default') !== callerTenant) {
      return { success: false, message: 'Bet not found' }
    }
    // Voiding again refunds nothing (settlement.ts returns the void bet as it is); say so instead of "Bet voided".
    if (bet.status === 'void' || bet.status === 'cancelled') return { success: true, message: 'Bet is already void' }
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

