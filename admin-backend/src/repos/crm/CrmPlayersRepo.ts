import { db } from '@src/db/client.js'
import { users } from '@shared/db/schema.js'
import { sql, type SQL } from 'drizzle-orm'

/**
 * What a CRM caller is allowed to see.
 *
 * `viewAll` comes from the `crm.players:view_all` permission; `bookIds` from
 * their book membership. Both are derived server-side from the token — never
 * from anything the request carries.
 */
export type CrmPlayerScope = {
  tenant: string
  viewAll: boolean
  bookIds: string[]
}

/**
 * Turns a scope into a SQL condition on `users`.
 *
 * A caller without `view_all` and without books matches nothing — expressed as
 * `false` so the database returns an empty set, rather than by omitting the
 * clause and returning the whole tenant. That inversion is the classic way this
 * kind of filter fails open.
 *
 * References the `users` table by name, so every query below must join it
 * unaliased.
 */
function bookScopeCondition(scope: CrmPlayerScope): SQL {
  if (scope.viewAll) return sql`true`
  if (scope.bookIds.length === 0) return sql`false`
  return sql`EXISTS (
    SELECT 1 FROM crm_player_assignments a
    WHERE a.player_id = ${users.id}
      AND a.tenant = ${scope.tenant}
      AND a.book_id IN (${sql.join(
        scope.bookIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )})
  )`
}

/**
 * Staff are not players.
 *
 * Anyone holding a role in the platform's admin RBAC is excluded. The admin
 * panel does this by matching role names against '%admin%'; asking whether the
 * user holds any role at all is both stricter and independent of how a
 * whitelabel happens to have named its roles.
 */
const notStaffCondition = sql`NOT EXISTS (
  SELECT 1 FROM user_roles ur WHERE ur.user_id = ${users.id}
)`

export type CrmPlayerListItem = {
  id: number
  name: string
  username: string | null
  phone: string | null
  email: string | null
  status: string
  playerType: string
  createdAt: Date
  lastLoginAt: Date | null
  cash: string
  bonus: string
  exposure: string
  bookId: string | null
  bookName: string | null
  ownerName: string | null
}

export type CrmPlayerFilter = {
  search?: string | null
  status?: string | null
  bookId?: string | null
  /** 'assigned' | 'unassigned' | null */
  assignment?: string | null
  /** Players carrying every one of these tags. */
  tagIds?: string[] | null
  /** 'all' (default) requires every tag; 'any' requires at least one. */
  tagMatch?: 'all' | 'any' | null
  /** Players with at least one note. */
  hasNotes?: boolean | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Reduces an arbitrary filter to values this query can actually run.
 *
 * Two of these fields are interpolated with an explicit `::uuid` cast, so a
 * value that is not uuid-shaped does not narrow the result — it aborts the
 * statement. Measured before this existed: `tagIds: ['garbage']` or
 * `bookId: 'garbage'` threw out of both `crmPlayers` and `crmExportPlayers`,
 * and because a saved segment stores a filter verbatim, one malformed id
 * planted in a *shared* segment broke the player list for the whole desk until
 * somebody found and deleted it.
 *
 * Unknown values are dropped rather than refused. A filter is a narrowing
 * device: dropping a term shows more rows, never fewer and never other
 * tenants' — scope is applied separately and is not expressible here. Refusing
 * outright would turn a stale saved segment into an error page.
 *
 * Exported because the same normalisation has to happen on the way *in* to
 * storage as on the way out: `CrmSegmentsRepo` saves what this returns, so a
 * segment cannot hold a value the query would choke on.
 */
export function normaliseCrmPlayerFilter(raw: unknown): CrmPlayerFilter {
  const input = (raw ?? {}) as Record<string, unknown>
  const out: CrmPlayerFilter = {}

  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined

  const search = str(input.search)
  if (search) out.search = search

  const status = str(input.status)
  if (status) out.status = status

  const bookId = str(input.bookId)
  if (bookId && UUID_RE.test(bookId)) out.bookId = bookId

  const assignment = str(input.assignment)
  if (assignment === 'assigned' || assignment === 'unassigned') out.assignment = assignment

  const tagIds = Array.isArray(input.tagIds)
    ? input.tagIds.filter((t): t is string => typeof t === 'string' && UUID_RE.test(t))
    : []
  if (tagIds.length > 0) out.tagIds = tagIds

  // Only meaningful alongside tags, and 'all' is the default the query applies.
  const tagMatch = str(input.tagMatch)
  if (tagMatch === 'any' || tagMatch === 'all') out.tagMatch = tagMatch

  if (typeof input.hasNotes === 'boolean') out.hasNotes = input.hasNotes

  return out
}

function buildWhere(scope: CrmPlayerScope, rawFilter: CrmPlayerFilter): SQL {
  // Normalised here rather than at each call site, so every route into this
  // query — the list, the export, and a stored segment — is covered by one
  // definition instead of three that can drift.
  const filter = normaliseCrmPlayerFilter(rawFilter)
  const clauses: SQL[] = [
    sql`${users.tenant} = ${scope.tenant}`,
    notStaffCondition,
    bookScopeCondition(scope),
  ]

  if (filter.search?.trim()) {
    const q = `%${filter.search.trim()}%`
    clauses.push(sql`(
      ${users.name} ILIKE ${q} OR ${users.username} ILIKE ${q}
      OR ${users.phone} ILIKE ${q} OR ${users.email} ILIKE ${q}
    )`)
  }
  if (filter.status?.trim()) {
    clauses.push(sql`${users.status}::text = ${filter.status.trim()}`)
  }
  if (filter.bookId) {
    clauses.push(sql`EXISTS (
      SELECT 1 FROM crm_player_assignments a2
      WHERE a2.player_id = ${users.id} AND a2.tenant = ${scope.tenant}
        AND a2.book_id = ${filter.bookId}::uuid
    )`)
  }
  if (filter.assignment === 'assigned' || filter.assignment === 'unassigned') {
    const assigned = sql`EXISTS (
      SELECT 1 FROM crm_player_assignments a3
      WHERE a3.player_id = ${users.id} AND a3.tenant = ${scope.tenant}
    )`
    clauses.push(filter.assignment === 'assigned' ? assigned : sql`NOT ${assigned}`)
  }

  const tagIds = (filter.tagIds ?? []).filter(Boolean)
  if (tagIds.length > 0) {
    const list = sql.join(
      tagIds.map((id) => sql`${id}::uuid`),
      sql`, `
    )
    // 'any' is an existence check; 'all' counts the distinct matches and demands
    // the full set. Both are expressed as a subquery against the composite
    // primary key of crm_player_tags rather than a join, so adding a tag filter
    // cannot multiply the rows the outer query returns.
    clauses.push(
      filter.tagMatch === 'any'
        ? sql`EXISTS (
            SELECT 1 FROM crm_player_tags pt
            WHERE pt.player_id = ${users.id} AND pt.tenant = ${scope.tenant}
              AND pt.tag_id IN (${list})
          )`
        : sql`(
            SELECT count(DISTINCT pt.tag_id) FROM crm_player_tags pt
            WHERE pt.player_id = ${users.id} AND pt.tenant = ${scope.tenant}
              AND pt.tag_id IN (${list})
          ) = ${tagIds.length}`
    )
  }

  if (filter.hasNotes === true || filter.hasNotes === false) {
    // `admin_only` is excluded for the same reason the CRM cannot read those
    // notes and the DSAR export omits them: an operator writing "suspected
    // bonus abuse, do not disclose" needs somewhere the other surface cannot
    // see. Counting them here made their existence detectable — filter for
    // "has notes", find a player whose note list comes back empty, and the
    // hidden note is inferred. The note count on each row already excludes
    // them (`countNotesForPlayers(..., 'crm')`), so without this the filter and
    // the column it filters on disagreed.
    const hasNote = sql`EXISTS (
      SELECT 1 FROM crm_player_notes n
      WHERE n.player_id = ${users.id} AND n.tenant = ${scope.tenant}
        AND n.deleted_at IS NULL
        AND n.visibility <> 'admin_only'
    )`
    clauses.push(filter.hasNotes ? hasNote : sql`NOT ${hasNote}`)
  }

  return sql.join(clauses, sql` AND `)
}

export async function listCrmPlayers(
  scope: CrmPlayerScope,
  filter: CrmPlayerFilter,
  page: { limit: number; offset: number }
): Promise<{ items: CrmPlayerListItem[]; total: number }> {
  const limit = Math.min(Math.max(page.limit || 25, 1), 200)
  const offset = Math.max(page.offset || 0, 0)
  const where = buildWhere(scope, filter)

  const [rows, countRows] = await Promise.all([
    db.execute(sql`
      SELECT
        users.id, users.name, users.username, users.phone, users.email,
        users.status::text AS status, users.player_type::text AS player_type,
        users.created_at, users.last_login_at,
        COALESCE(w.cash, '0') AS cash,
        COALESCE(w.bonus, '0') AS bonus,
        COALESCE(w.exposure, '0') AS exposure,
        a.book_id, b.name AS book_name, o.name AS owner_name
      FROM users
      LEFT JOIN wallets w ON w.user_id = users.id AND w.tenant = users.tenant
      LEFT JOIN crm_player_assignments a ON a.player_id = users.id AND a.tenant = users.tenant
      LEFT JOIN crm_books b ON b.id = a.book_id
      LEFT JOIN crm_users o ON o.id = a.owner_id AND o.tenant = users.tenant
      WHERE ${where}
      ORDER BY users.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`SELECT count(*)::int AS n FROM users WHERE ${where}`),
  ])

  const items = (rows.rows as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    name: String(r.name ?? ''),
    username: (r.username as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    status: String(r.status ?? ''),
    playerType: String(r.player_type ?? 'REGULAR'),
    createdAt: r.created_at as Date,
    lastLoginAt: (r.last_login_at as Date | null) ?? null,
    cash: String(r.cash ?? '0'),
    bonus: String(r.bonus ?? '0'),
    exposure: String(r.exposure ?? '0'),
    bookId: (r.book_id as string | null) ?? null,
    bookName: (r.book_name as string | null) ?? null,
    ownerName: (r.owner_name as string | null) ?? null,
  }))

  const total = Number((countRows.rows[0] as { n: number } | undefined)?.n ?? 0)
  return { items, total }
}

/**
 * Whether this caller may open this player at all.
 *
 * Checked before any profile or timeline query rather than filtering the result
 * afterwards: an out-of-scope player must be indistinguishable from one that
 * does not exist, and a query that runs and then hides its output has already
 * read the data.
 */
export async function canCrmUserSeePlayer(
  scope: CrmPlayerScope,
  playerId: number
): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT 1 FROM users
    WHERE users.id = ${playerId}
      AND users.tenant = ${scope.tenant}
      AND ${notStaffCondition}
      AND ${bookScopeCondition(scope)}
    LIMIT 1
  `)
  return res.rows.length > 0
}

export type CrmPlayerProfile = CrmPlayerListItem & {
  riskType: string | null
  remark: string | null
  withdrawalLock: boolean
  bonusAllowed: boolean
  sportsBetAllowed: boolean
  casinoBetAllowed: boolean
  matkaBetAllowed: boolean
  creditLimit: string
  creditUsed: string
  referralBalance: string
  totalDeposits: string
  depositCount: number
  totalWithdrawals: string
  withdrawalCount: number
  totalStake: string
  betCount: number
  firstBetAt: Date | null
  lastBetAt: Date | null
}

/**
 * The Player 360.
 *
 * Lifetime aggregates are computed over one player's own rows, which the
 * (user_id, tenant) indexes serve directly. This is the one place a pass over a
 * player's full betting history is acceptable — it is a single player, and the
 * totals are what the page exists to show. Volume is paged in the *timeline*,
 * which is a different query for that reason.
 */
export async function getCrmPlayerProfile(
  tenant: string,
  playerId: number
): Promise<CrmPlayerProfile | null> {
  const res = await db.execute(sql`
    SELECT
      users.id, users.name, users.username, users.phone, users.email,
      users.status::text AS status, users.player_type::text AS player_type,
      users.created_at, users.last_login_at,
      users.risk_type::text AS risk_type, users.remark,
      users.withdrawal_lock, users.bonus_allowed,
      users.sports_bet_allowed, users.casino_bet_allowed, users.matka_bet_allowed,
      COALESCE(users.credit_limit, '0') AS credit_limit,
      COALESCE(users.credit_used, '0') AS credit_used,
      COALESCE(w.cash, '0') AS cash,
      COALESCE(w.bonus, '0') AS bonus,
      COALESCE(w.exposure, '0') AS exposure,
      COALESCE(w.referral_balance, '0') AS referral_balance,
      a.book_id, b.name AS book_name, o.name AS owner_name,
      COALESCE(d.total, 0) AS total_deposits, COALESCE(d.n, 0) AS deposit_count,
      COALESCE(x.total, 0) AS total_withdrawals, COALESCE(x.n, 0) AS withdrawal_count,
      COALESCE(bt.total, 0) AS total_stake, COALESCE(bt.n, 0) AS bet_count,
      bt.first_at AS first_bet_at, bt.last_at AS last_bet_at
    FROM users
    LEFT JOIN wallets w ON w.user_id = users.id AND w.tenant = users.tenant
    LEFT JOIN crm_player_assignments a ON a.player_id = users.id AND a.tenant = users.tenant
    LEFT JOIN crm_books b ON b.id = a.book_id
    LEFT JOIN crm_users o ON o.id = a.owner_id AND o.tenant = users.tenant
    LEFT JOIN LATERAL (
      SELECT sum(amount) AS total, count(*)::int AS n
      FROM deposit_requests
      WHERE user_id = users.id AND tenant = users.tenant AND status = 'APPROVED'
    ) d ON true
    LEFT JOIN LATERAL (
      SELECT sum(amount) AS total, count(*)::int AS n
      FROM withdrawal_requests
      WHERE user_id = users.id AND tenant = users.tenant AND status = 'COMPLETED'
    ) x ON true
    LEFT JOIN LATERAL (
      SELECT sum(stake) AS total, count(*)::int AS n,
             min(created_at) AS first_at, max(created_at) AS last_at
      FROM (
        SELECT stake, created_at FROM sports_bets
          WHERE user_id = users.id AND tenant = users.tenant
        UNION ALL
        SELECT stake, created_at FROM casino_bets
          WHERE user_id = users.id AND tenant = users.tenant
        UNION ALL
        SELECT bet_amount AS stake, created_at FROM matka_bets
          WHERE user_id = users.id AND tenant = users.tenant
      ) all_bets
    ) bt ON true
    WHERE users.id = ${playerId} AND users.tenant = ${tenant}
    LIMIT 1
  `)

  const r = res.rows[0] as Record<string, unknown> | undefined
  if (!r) return null

  return {
    id: Number(r.id),
    name: String(r.name ?? ''),
    username: (r.username as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    status: String(r.status ?? ''),
    playerType: String(r.player_type ?? 'REGULAR'),
    createdAt: r.created_at as Date,
    lastLoginAt: (r.last_login_at as Date | null) ?? null,
    cash: String(r.cash ?? '0'),
    bonus: String(r.bonus ?? '0'),
    exposure: String(r.exposure ?? '0'),
    bookId: (r.book_id as string | null) ?? null,
    bookName: (r.book_name as string | null) ?? null,
    ownerName: (r.owner_name as string | null) ?? null,
    riskType: (r.risk_type as string | null) ?? null,
    remark: (r.remark as string | null) ?? null,
    withdrawalLock: r.withdrawal_lock === true,
    bonusAllowed: r.bonus_allowed === true,
    sportsBetAllowed: r.sports_bet_allowed === true,
    casinoBetAllowed: r.casino_bet_allowed === true,
    matkaBetAllowed: r.matka_bet_allowed === true,
    creditLimit: String(r.credit_limit ?? '0'),
    creditUsed: String(r.credit_used ?? '0'),
    referralBalance: String(r.referral_balance ?? '0'),
    totalDeposits: String(r.total_deposits ?? '0'),
    depositCount: Number(r.deposit_count ?? 0),
    totalWithdrawals: String(r.total_withdrawals ?? '0'),
    withdrawalCount: Number(r.withdrawal_count ?? 0),
    totalStake: String(r.total_stake ?? '0'),
    betCount: Number(r.bet_count ?? 0),
    firstBetAt: (r.first_bet_at as Date | null) ?? null,
    lastBetAt: (r.last_bet_at as Date | null) ?? null,
  }
}
