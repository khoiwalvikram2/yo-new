import { db } from '@src/db/client.js'
import { sql } from 'drizzle-orm'

/**
 * A player's activity, newest first, across every source that records one.
 *
 * The naive version of this is a UNION over every table ordered by time. For a
 * player with 50,000 bets that reads and sorts the whole history to render
 * twenty rows, and it gets slower every day they keep playing.
 *
 * Instead each source is asked for at most one page of its own newest rows —
 * an index-ordered read of (user_id, created_at) — and the merge happens over
 * those few hundred rows. The work per page is bounded by the page size, not by
 * how long the player has been with the brand.
 */

export type CrmTimelineSource =
  | 'deposit'
  | 'withdrawal'
  | 'sports_bet'
  | 'casino_bet'
  | 'matka_bet'

export type CrmTimelineEntry = {
  /** Stable across pages: source and primary key. Also the de-duplication key. */
  key: string
  source: CrmTimelineSource
  occurredAt: Date
  title: string
  status: string | null
  amount: string | null
  detail: string | null
}

export type CrmTimelinePage = {
  entries: CrmTimelineEntry[]
  nextCursor: string | null
}

type Cursor = {
  /** Newest timestamp already shown. The next page starts at or before it. */
  ts: string
  /** Keys already emitted at exactly `ts`, so a tie does not repeat or skip. */
  seen: string[]
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url')
}

function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (typeof parsed?.ts !== 'string') return null
    const ts = new Date(parsed.ts)
    if (Number.isNaN(ts.getTime())) return null
    const seen = Array.isArray(parsed.seen) ? parsed.seen.filter((s: unknown) => typeof s === 'string') : []
    // A malformed or hostile cursor degrades to "start from the beginning"
    // rather than throwing: a bad cursor is a broken link, not an error the
    // user can act on.
    return { ts: ts.toISOString(), seen: seen.slice(0, 500) }
  } catch {
    return null
  }
}

/**
 * Each source contributes one bounded, index-ordered read.
 *
 * `created_at <= cursor` rather than `<`, with the boundary's already-seen keys
 * filtered out afterwards. Strict `<` would silently drop any row sharing the
 * last timestamp of the previous page, which is exactly what happens when a
 * player places several bets in the same second.
 */
function sourceQuery(
  source: CrmTimelineSource,
  playerId: number,
  tenant: string,
  limit: number,
  cursorTs: string | null
) {
  const bound = cursorTs ? sql`AND created_at <= ${cursorTs}::timestamptz` : sql``

  switch (source) {
    case 'deposit':
      return sql`
        SELECT 'deposit:' || id AS key, 'deposit' AS source, created_at,
               'Deposit' AS title, status::text AS status,
               amount::text AS amount,
               COALESCE(method::text, '') || CASE WHEN utr IS NOT NULL THEN ' · ' || utr ELSE '' END AS detail
        FROM deposit_requests
        WHERE user_id = ${playerId} AND tenant = ${tenant} ${bound}
        ORDER BY created_at DESC LIMIT ${limit}`
    case 'withdrawal':
      return sql`
        SELECT 'withdrawal:' || id AS key, 'withdrawal' AS source, created_at,
               'Withdrawal' AS title, status::text AS status,
               amount::text AS amount, note AS detail
        FROM withdrawal_requests
        WHERE user_id = ${playerId} AND tenant = ${tenant} ${bound}
        ORDER BY created_at DESC LIMIT ${limit}`
    case 'sports_bet':
      // The bet row carries ids, not names. The event name is joined after the
      // limit has already bounded the rows, so it costs one index lookup per
      // row shown rather than a join across the player's whole history.
      return sql`
        SELECT 'sports_bet:' || b.id AS key, 'sports_bet' AS source, b.created_at,
               'Sports bet' AS title, b.status::text AS status,
               b.stake::text AS amount,
               COALESCE(e.name, 'Event') || ' · ' || b.side::text || ' @ ' || b.price::text AS detail
        FROM (
          SELECT id, created_at, status, stake, side, price, event_id
          FROM sports_bets
          WHERE user_id = ${playerId} AND tenant = ${tenant} ${bound}
          ORDER BY created_at DESC LIMIT ${limit}
        ) b
        LEFT JOIN sports_events e ON e.id = b.event_id`
    case 'casino_bet':
      return sql`
        SELECT 'casino_bet:' || id AS key, 'casino_bet' AS source, created_at,
               'Casino bet' AS title, status::text AS status,
               stake::text AS amount, game_name AS detail
        FROM casino_bets
        WHERE user_id = ${playerId} AND tenant = ${tenant} ${bound}
        ORDER BY created_at DESC LIMIT ${limit}`
    case 'matka_bet':
      return sql`
        SELECT 'matka_bet:' || id AS key, 'matka_bet' AS source, created_at,
               'Matka bet' AS title, status::text AS status,
               bet_amount::text AS amount, selection_key AS detail
        FROM matka_bets
        WHERE user_id = ${playerId} AND tenant = ${tenant} ${bound}
        ORDER BY created_at DESC LIMIT ${limit}`
  }
}

const ALL_SOURCES: CrmTimelineSource[] = [
  'deposit',
  'withdrawal',
  'sports_bet',
  'casino_bet',
  'matka_bet',
]

export async function getCrmPlayerTimeline(input: {
  tenant: string
  playerId: number
  limit?: number
  cursor?: string | null
  sources?: CrmTimelineSource[] | null
}): Promise<CrmTimelinePage> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100)
  const cursor = decodeCursor(input.cursor)
  const wanted =
    input.sources?.length ? ALL_SOURCES.filter((s) => input.sources!.includes(s)) : ALL_SOURCES
  if (wanted.length === 0) return { entries: [], nextCursor: null }

  // One extra row per source tells us whether a further page exists without a
  // second round trip.
  const perSource = limit + 1
  // Each arm is parenthesised: in Postgres an ORDER BY / LIMIT written bare
  // inside a UNION ALL binds to the whole union, not to that branch — which
  // would drop the per-source bound that makes this query cheap.
  const parts = wanted.map(
    (s) => sql`(${sourceQuery(s, input.playerId, input.tenant, perSource, cursor?.ts ?? null)})`
  )
  const unioned = sql.join(parts, sql` UNION ALL `)

  const res = await db.execute(sql`
    SELECT * FROM (${unioned}) merged
    ORDER BY created_at DESC, key DESC
    LIMIT ${wanted.length * perSource}
  `)

  const seen = new Set(cursor?.seen ?? [])
  const rows = (res.rows as Record<string, unknown>[])
    .map((r) => ({
      key: String(r.key),
      source: String(r.source) as CrmTimelineSource,
      occurredAt: r.created_at as Date,
      title: String(r.title ?? ''),
      status: (r.status as string | null) ?? null,
      amount: (r.amount as string | null) ?? null,
      detail: (r.detail as string | null) ?? null,
    }))
    .filter((e) => !seen.has(e.key))

  const entries = rows.slice(0, limit)
  if (entries.length < limit || rows.length === entries.length) {
    // Nothing was held back, so this is the last page. Reporting a cursor here
    // would cost the caller an extra round trip to discover the same thing.
    return { entries, nextCursor: null }
  }

  const lastTs = entries[entries.length - 1].occurredAt
  const lastIso = lastTs instanceof Date ? lastTs.toISOString() : new Date(String(lastTs)).toISOString()
  const seenAtBoundary = entries
    .filter((e) => {
      const t = e.occurredAt instanceof Date ? e.occurredAt : new Date(String(e.occurredAt))
      return t.getTime() === new Date(lastIso).getTime()
    })
    .map((e) => e.key)
  const carried = [...(cursor?.ts === lastIso ? (cursor?.seen ?? []) : []), ...seenAtBoundary]

  return { entries, nextCursor: encodeCursor({ ts: lastIso, seen: [...new Set(carried)].slice(0, 500) }) }
}
