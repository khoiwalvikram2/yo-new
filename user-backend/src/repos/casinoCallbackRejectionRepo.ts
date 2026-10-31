import { db } from '../db/client.js'
import { casinoCallbackRejections, users } from '@shared/db/schema.js'
import { eq } from 'drizzle-orm'

export interface RecordCallbackRejectionInput {
  providerKey: string
  endpoint: string
  errorCode: string
  errorMessage?: string | null
  /** Provider's player id, e.g. "131_5014". The numeric prefix is our users.id. */
  playerId?: string | null
  gameCode?: string | null
  roundId?: string | null
  transId?: string | null
  referenceId?: string | null
  requestId?: string | null
  payload?: unknown
}

/** users.id encoded in a GMAG playerId ("<userId>_<phoneLast4>"), or null if unparseable. */
function parseUserId(playerId: string | null | undefined): number | null {
  if (!playerId) return null
  const n = Number(String(playerId).split('_')[0])
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * Persist a REFUSED provider callback.
 *
 * Fire-and-forget by contract: this is diagnostics, and a logging failure must never turn into
 * a callback failure. Callers should not await it on the hot path and it never throws.
 *
 * See incident CS-22135 — 142 rejections in one evening left no trace on our side at all, so
 * the whole investigation depended on the provider's logs.
 */
export function recordCasinoCallbackRejection(input: RecordCallbackRejectionInput): void {
  void (async () => {
    try {
      const userId = parseUserId(input.playerId)

      // Resolve the tenant so the row (and any alert built on it) is scoped correctly. Only
      // runs on the rejection path, which is rare by definition.
      let tenant = 'default'
      if (userId != null) {
        const [row] = await db.select({ tenant: users.tenant }).from(users).where(eq(users.id, userId)).limit(1)
        if (row?.tenant) tenant = row.tenant
      }

      await db.insert(casinoCallbackRejections).values({
        tenant,
        providerKey: input.providerKey.slice(0, 64),
        endpoint: input.endpoint.slice(0, 64),
        errorCode: String(input.errorCode).slice(0, 48),
        errorMessage: input.errorMessage ? String(input.errorMessage).slice(0, 2000) : null,
        userId,
        playerId: input.playerId ? String(input.playerId).slice(0, 128) : null,
        gameCode: input.gameCode ? String(input.gameCode).slice(0, 128) : null,
        roundId: input.roundId ? String(input.roundId).slice(0, 128) : null,
        transId: input.transId ? String(input.transId).slice(0, 128) : null,
        referenceId: input.referenceId ? String(input.referenceId).slice(0, 128) : null,
        requestId: input.requestId ? String(input.requestId).slice(0, 128) : null,
        payload: (input.payload ?? null) as Record<string, unknown> | null,
      })
    } catch (err) {
      console.error(
        '[casino-callback-rejection] failed to record rejection:',
        err instanceof Error ? err.message : String(err)
      )
    }
  })()
}
