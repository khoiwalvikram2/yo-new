import { worliLockAt, worliSessionStatus } from '@shared/matka/schedule.js'
import type { matkaWorliInstances } from '@shared/db/schema.js'
import { getWorliInstanceByUnique } from '@/repos/matka-worli/worliInstancesRepo.js'
import { canUnlockWorliSession } from './sessionUnlock.js'
import { worliSessionsEverDeclared } from './sessionUnlockStore.js'

type WorliInstanceRow = typeof matkaWorliInstances.$inferSelect

/**
 * A session as the GraphQL `WorliInstance` type returns it, for the queries and for every
 * `worliInstanceUpdated` payload alike (the list page merges those payloads over its rows, so a payload
 * carrying the stored status would undo the derived one). The status and lock time are the ones players
 * get: the stored status moved on by the clock and the Lock Now / Close Now stamps, and the lock counted
 * back from the close when the suspend minutes were adjusted. `resultEverDeclared` (a result declared for
 * it, rolled back since or not) is read by worliInstanceViews below, which every producer goes through.
 */
export function worliInstanceView(row: WorliInstanceRow, marketName: string | null, now: Date, resultEverDeclared: boolean) {
  return {
    id: row.id,
    marketId: row.marketId,
    marketName,
    runDate: row.runDate,
    side: row.side,
    status: worliSessionStatus(row, now),
    scheduledOpenAt: row.scheduledOpenAtUtc?.toISOString?.() ?? null,
    scheduledLockAt: worliLockAt(row)?.toISOString() ?? null,
    scheduledCloseAt: row.scheduledCloseAtUtc?.toISOString?.() ?? null,
    operatorMessage: row.operatorMessage,
    // Whether Unlock would reopen it now (sessionUnlock.ts); the page offers the button only then.
    canUnlock: canUnlockWorliSession({ ...row, resultEverDeclared }, now),
    counters: {
      betCount: row.betCount,
      totalStakeMinor: Number(row.totalStakeMinor ?? 0),
      exposureTotalMinor: Number(row.exposureTotalMinor ?? 0),
      worstOutcomeKey: row.worstOutcomeKey ?? null,
      worstOutcomePlMinor: row.worstOutcomePlMinor != null ? Number(row.worstOutcomePlMinor) : null,
    },
    bidRulesVersionId: row.bidRulesVersionId,
  }
}

/** The views of sessions read from storage (the running list's rows carry their market's name). Whether a result was
 *  ever declared is read once for all of them, and only for the sessions Unlock could otherwise reopen: for any other
 *  session canUnlock is false either way (owner, 2026-11-04). */
export async function worliInstanceViews(rows: ReadonlyArray<WorliInstanceRow & { __marketName?: string | null }>, now = new Date()) {
  const declared = await worliSessionsEverDeclared(rows.filter(row => canUnlockWorliSession({ ...row, resultEverDeclared: false }, now)).map(row => row.id))
  return rows.map(row => worliInstanceView(row, row.__marketName ?? null, now, declared.has(row.id)))
}

/** One session's view: the session page's read, or a `worliInstanceUpdated` payload. */
export async function worliInstanceViewOf(row: WorliInstanceRow, now = new Date()) {
  return (await worliInstanceViews([row], now))[0]
}

/** After a result is declared or rolled back for a market's session (admin-backend matka resolvers), pushes the view of
 *  the session's row, when it has one, so its open page shows the new status and canUnlock (owner, 2026-11-04). Best
 *  effort: the result is committed by then, and the page reads the session again when it loads. */
export async function publishWorliSessionView(pubsub: any, marketId: string, date: string, type: string) {
  try {
    const row = await getWorliInstanceByUnique(marketId, date, type === 'close' ? 'CLOSE' : 'OPEN')
    if (!row || typeof pubsub?.publish !== 'function') return
    const view = await worliInstanceViewOf(row)
    Promise.resolve(pubsub.publish({ topic: `WORLI_INSTANCE_${row.id}`, payload: { worliInstanceUpdated: view } })).catch(() => {})
  } catch { /* the page reads the session again when it loads */ }
}
