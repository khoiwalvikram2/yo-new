import { aggregateInstanceBets } from '@/repos/matka/matkaBetsRepo.js'
import { patchWorliInstance } from '@/repos/matka-worli/worliInstancesRepo.js'

export async function recomputeInstanceCounters(instanceId: string, pubsub: any) {
  const { totalStakeMinor, betCount } = await aggregateInstanceBets(instanceId)
  const updated = await patchWorliInstance(instanceId, { totalStakeMinor: BigInt(totalStakeMinor), betCount })
  pubsub.publish({ topic: `WORLI_INSTANCE_${updated.id}`, payload: { worliInstanceUpdated: {
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
  return updated
}

