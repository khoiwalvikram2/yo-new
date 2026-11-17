import { aggregateInstanceBets, openBookEntriesByInstance } from '@/repos/matka/matkaBetsRepo.js'
import { getWorliInstanceByUnique, patchWorliInstance } from '@/repos/matka-worli/worliInstancesRepo.js'
import { worstMatkaOutcome } from '@shared/matka/book.js'
import { matkaKind } from '@shared/matka/rules.js'
import type { matkaWorliInstances } from '@shared/db/schema.js'
import { worliInstanceViewOf } from './sessionView.js'

export async function recomputeInstanceCounters(instanceId: string, pubsub: any) {
  const { totalStakeMinor, betCount } = await aggregateInstanceBets(instanceId)
  const updated = await patchWorliInstance(instanceId, { totalStakeMinor: BigInt(totalStakeMinor), betCount })
  pubsub.publish({ topic: `WORLI_INSTANCE_${updated.id}`, payload: { worliInstanceUpdated: await worliInstanceViewOf(updated) } })
  return updated
}

/**
 * The result that would cost the house most on a session's open bets, and the house P/L if it came
 * (shared/src/matka/book.ts). A Close session uses the declared Open result, when there is one, for its Jodi
 * and Sangam bets. Null when nothing is open.
 */
export async function worliWorstOutcome(instance: typeof matkaWorliInstances.$inferSelect) {
  const entries = await openBookEntriesByInstance(instance.id)
  if (!entries.length) return null
  const side = instance.side === 'CLOSE' ? 'close' : 'open'
  const open = side === 'close' ? await getWorliInstanceByUnique(instance.marketId, String(instance.runDate), 'OPEN') : null
  return worstMatkaOutcome(entries, matkaKind({ matkaType: entries[0].matkaType }), side, open?.resultPublishedAtUtc ? open.resultValue : null)
}
