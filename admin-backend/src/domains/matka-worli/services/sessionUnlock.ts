/**
 * Unlock (owner, 2026-11-04): undoes a Lock Now or Close Now while the session can still take bets. Players are gated
 * on the stored status and on the two operator stamps (shared/src/matka/schedule.ts: matkaSchedule's manualBlocked,
 * stoppedByOperator), so Unlock puts back the status the session had before it was stopped and clears both stamps.
 */
type UnlockSession = {
  status: string
  scheduledOpenAtUtc?: Date | null
  scheduledCloseAtUtc?: Date | null
  resultPublishedAtUtc?: Date | null
  actualLockAtUtc?: Date | null
  actualCloseAtUtc?: Date | null
}
/** A session as Unlock checks it: also whether a result was ever declared for its market, date and side, rolled back
 *  since or not (sessionUnlockStore.ts reads that from matka_results). */
type UnlockCheck = UnlockSession & { resultEverDeclared: boolean }
type ActivityRow = { action: string; metaJson?: string | null }

/** Statuses a session can be put back to: the ones it can be locked or closed from. Close Now also closes a LOCKED
 *  session; when that stop wrote the lock stamp itself, no Lock Now locked it (a result rollback leaves LOCKED, with no
 *  stamp, though a declared result now refuses Unlock first), so Unlock undoes only the Close Now and it stays LOCKED
 *  rather than reopening for bets (reviewer, G501). */
const RESTORABLE = ['SCHEDULED', 'OPENING_SOON', 'OPEN', 'PAUSED', 'LOCKED']
const STOPS = ['LOCK_NOW', 'CLOSE_NOW']

export const UNLOCK_RESULT_DECLARED = 'The result is declared for this session; it cannot be unlocked'
export const UNLOCK_RESULT_WAS_DECLARED = 'A result was declared for this session; it cannot be unlocked, even after a rollback'
export const UNLOCK_NOT_STOPPED = 'This session was not stopped with Lock Now or Close Now'
export const UNLOCK_CLOSE_PASSED = 'The scheduled close has passed; this session cannot be unlocked'
export const UNLOCK_SESSION_CHANGED = 'This session changed while it was being unlocked (a result was declared, or another operator changed it); reload it and try again'

/** Why the session cannot be unlocked, or null when it can: its result is not declared and never was (owner,
 *  2026-11-04: a result declared and then rolled back keeps it shut, as players may have seen it), Lock Now or Close
 *  Now stopped it (only they write the stamps; a status of CLOSED alone can be a side the market does not offer, and a
 *  rolled-back result leaves LOCKED), and its scheduled close is still ahead. */
export function worliUnlockRefusal(session: UnlockCheck, now = new Date()): string | null {
  if (session.resultPublishedAtUtc || ['SETTLING', 'SETTLED', 'VOIDED'].includes(session.status)) return UNLOCK_RESULT_DECLARED
  if (session.resultEverDeclared) return UNLOCK_RESULT_WAS_DECLARED
  if (!session.actualLockAtUtc && !session.actualCloseAtUtc) return UNLOCK_NOT_STOPPED
  if (!session.scheduledCloseAtUtc || now.getTime() >= new Date(session.scheduledCloseAtUtc).getTime()) return UNLOCK_CLOSE_PASSED
  return null
}

export function canUnlockWorliSession(session: UnlockCheck, now = new Date()): boolean {
  return worliUnlockRefusal(session, now) === null
}

function metaOf(row: ActivityRow): { previousStatus?: unknown; at?: unknown } | null {
  try {
    const meta = row.metaJson ? JSON.parse(row.metaJson) : null
    return meta && typeof meta === 'object' ? meta : null
  } catch {
    return null
  }
}

/**
 * The stored status Unlock writes. Lock Now and Close Now record the status they found and the moment they stopped
 * the session (metaJson previousStatus and at). The stop that wrote the session's lock stamp is the first since it
 * was last unlocked (Close Now keeps an earlier Lock Now's stamp, and found LOCKED), so its status is the one before
 * the stop; matching on the stamp needs no ordering of the log. A stop logged before that was recorded falls back to
 * the clock: OPEN once the scheduled open has passed, SCHEDULED before. A session that kept its status under an old
 * stamp-only Lock Now keeps that status; only its stamps are cleared.
 */
export function worliStatusBeforeStop(session: UnlockSession, activity: readonly ActivityRow[], now = new Date()): string {
  if (session.status !== 'LOCKED' && session.status !== 'CLOSED') return session.status
  const stampedAt = session.actualLockAtUtc ? new Date(session.actualLockAtUtc).toISOString() : null
  const firstStop = stampedAt ? activity.find(row => STOPS.includes(row.action) && metaOf(row)?.at === stampedAt) : undefined
  const recorded = firstStop ? metaOf(firstStop)?.previousStatus : null
  if (typeof recorded === 'string' && RESTORABLE.includes(recorded)) return recorded
  const opened = session.scheduledOpenAtUtc != null && now.getTime() >= new Date(session.scheduledOpenAtUtc).getTime()
  return opened ? 'OPEN' : 'SCHEDULED'
}
