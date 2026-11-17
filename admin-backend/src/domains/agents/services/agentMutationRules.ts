import { DateTime } from 'luxon'
import { COMMISSION_SETTLEMENT_IST, getMondayToMondayPeriodIST } from './CommissionCycleUtils.js'

/**
 * Pure rules shared by the agent mutations (resolvers/mutations.ts).
 *
 * Kept free of I/O so each rule is unit-tested on its own
 * (services/__tests__/agentMutationRules.test.ts); the resolvers load the rows
 * and call these to decide.
 */

export type AgentSchemeName = 'COMMISSION' | 'SHARING' | 'CREDIT'

/** SHARING and CREDIT hierarchies stop at level 4. COMMISSION has no depth limit. */
export const MAX_SHARING_CREDIT_LEVEL = 4

/**
 * Throws unless `level` is a valid hierarchy level for the scheme:
 * at least 1 for every scheme, at most 4 for SHARING/CREDIT.
 */
export function assertLevelAllowed(scheme: string | null | undefined, level: unknown): void {
  if (typeof level !== 'number' || !Number.isFinite(level) || level < 1) {
    throw new Error('Hierarchy level must be at least 1')
  }
  if (scheme !== 'COMMISSION' && level > MAX_SHARING_CREDIT_LEVEL) {
    throw new Error(
      `Maximum hierarchy depth (${MAX_SHARING_CREDIT_LEVEL} levels) reached for sharing/credit agents. Cannot use level ${level}`
    )
  }
}

/** The domains in `child` that `parent` does not have. */
export function domainsOutsideParent(
  child: readonly string[] | null | undefined,
  parent: readonly string[] | null | undefined
): string[] {
  const allowed = new Set(parent ?? [])
  return (child ?? []).filter((d) => !allowed.has(d))
}

/** Throws when a child would hold a domain its parent lacks. */
export function assertDomainsWithinParent(
  child: readonly string[] | null | undefined,
  parent: readonly string[] | null | undefined
): void {
  const outside = domainsOutsideParent(child, parent)
  if (outside.length > 0) {
    throw new Error(
      `Domain '${outside[0]}' is not allowed for the parent agent. Choose only from the parent's domains (${(parent ?? []).join(', ') || 'none'}).`
    )
  }
}

/** Domains present in `before` and missing from `after` (a narrowing). */
export function removedDomains(
  before: readonly string[] | null | undefined,
  after: readonly string[] | null | undefined
): string[] {
  if (after === undefined || after === null) return []
  const kept = new Set(after)
  return Array.from(new Set(before ?? [])).filter((d) => !kept.has(d))
}

/**
 * Fields an agent may not change through updateAgent, even on its own
 * sub-agents: the hierarchy level and the commission tally settings. Returns the
 * names of the fields the input would actually change (an echoed, unchanged
 * value is not a change, because the edit form sends every field back).
 */
export function restrictedAgentFieldChanges(
  current: { levelIndex?: number | null; tallyEnabled?: boolean | null; tallyDomains?: readonly string[] | null },
  input: { levelIndex?: number | null; tallyEnabled?: boolean | null; tallyDomains?: readonly string[] | null }
): string[] {
  const changed: string[] = []
  if (input.levelIndex !== undefined && (input.levelIndex ?? null) !== (current.levelIndex ?? null)) {
    changed.push('levelIndex')
  }
  if (input.tallyEnabled !== undefined && Boolean(input.tallyEnabled) !== Boolean(current.tallyEnabled)) {
    changed.push('tallyEnabled')
  }
  if (input.tallyDomains !== undefined) {
    const a = new Set(input.tallyDomains ?? [])
    const b = new Set(current.tallyDomains ?? [])
    if (a.size !== b.size || [...a].some((d) => !b.has(d))) changed.push('tallyDomains')
  }
  return changed
}

const TALLY_DOMAINS: ReadonlySet<string> = new Set(['sports', 'casino', 'matka'])

/**
 * Whether a COMMISSION agent's cross-domain tally is on: the flag AND at least one domain, which is how the
 * commission engine reads it (commissionTallyRules.applyTallyRulesForSettlement). A flag with no domain nets
 * nothing, so createAgent and updateAgent store it as off rather than keep a "Tally on" that pays as off.
 */
export function tallyIsOn(
  enabled: boolean | null | undefined,
  domains: readonly string[] | null | undefined
): boolean {
  return Boolean(enabled) && (domains ?? []).some((d) => TALLY_DOMAINS.has(d))
}

// ---------------------------------------------------------------------------
// Rate history (agent_commission_config / agent_sharing_config)
// ---------------------------------------------------------------------------

export interface RateRow {
  effectiveFrom: Date
  effectiveTo: Date | null
  rate: number
}

/**
 * The rate in force at `at`, resolved exactly as AgentConfigsRepo.getCommissionConfig
 * / getSharingConfig do: the row with the latest effectiveFrom that has started
 * (with their one-second buffer) and has not ended. null when no row covers `at`.
 */
export function rateAt(rows: readonly RateRow[], at: Date): number | null {
  const buffer = at.getTime() + 1000
  let best: RateRow | null = null
  for (const r of rows) {
    const from = r.effectiveFrom.getTime()
    if (from > buffer) continue
    if (r.effectiveTo && r.effectiveTo.getTime() < at.getTime()) continue
    if (!best || from > best.effectiveFrom.getTime()) best = r
  }
  return best ? best.rate : null
}

/**
 * The window a new row starting at `from` governs: until the agent's next
 * later row starts, or the new row's own effectiveTo, whichever is first.
 * `end` null means open-ended.
 */
export function governingWindow(
  ownRows: readonly RateRow[],
  from: Date,
  effectiveTo: Date | null
): { start: Date; end: Date | null } {
  let end: number | null = effectiveTo ? effectiveTo.getTime() : null
  for (const r of ownRows) {
    const t = r.effectiveFrom.getTime()
    if (t > from.getTime() && (end === null || t < end)) end = t
  }
  return { start: from, end: end === null ? null : new Date(end) }
}

/**
 * The instants inside a window at which the other side's rate can change: the
 * window start plus every start (and end) of the other side's rows that falls
 * inside it. Checking a cap at these points checks it over the whole window.
 */
export function rateChangePoints(window: { start: Date; end: Date | null }, otherRows: readonly RateRow[]): Date[] {
  const s = window.start.getTime()
  const e = window.end ? window.end.getTime() : Number.POSITIVE_INFINITY
  const points = new Set<number>([s])
  for (const r of otherRows) {
    const f = r.effectiveFrom.getTime()
    if (f > s && f < e) points.add(f)
    if (r.effectiveTo) {
      const after = r.effectiveTo.getTime() + 1
      if (after > s && after < e) points.add(after)
    }
  }
  return [...points].sort((a, b) => a - b).map((t) => new Date(t))
}

/**
 * The first moment at which `rate` would exceed the cap. The cap at each change
 * point is the parent's rate, or, where the parent has no rate, `fallbackCap`
 * (the whitelabel cap; undefined = no cap configured, null = refuse because a
 * cap is required but missing). Returns null when the rate fits everywhere.
 */
export function firstCapBreach(params: {
  rate: number
  window: { start: Date; end: Date | null }
  parentRows: readonly RateRow[]
  fallbackCap: number | null | undefined
}): { at: Date; cap: number | null; source: 'parent' | 'whitelabel' } | null {
  for (const at of rateChangePoints(params.window, params.parentRows)) {
    const parentRate = rateAt(params.parentRows, at)
    if (parentRate !== null) {
      if (params.rate > parentRate + 1e-9) return { at, cap: parentRate, source: 'parent' }
      continue
    }
    if (params.fallbackCap === undefined) continue
    if (params.fallbackCap === null) return { at, cap: null, source: 'whitelabel' }
    if (params.rate > params.fallbackCap + 1e-9) return { at, cap: params.fallbackCap, source: 'whitelabel' }
  }
  return null
}

/**
 * Whether a new rate row would change nothing, so it is better not inserted: it is open-ended, no row of the agent
 * starts after it, and the row in force when it starts is open-ended with the same rate. The agent edit form sent
 * every domain's rate on every save, and each became one more open row identical to the one before it. A row that
 * is dated before the one in force, ends, or changes the rate is never redundant.
 */
export function isRedundantRateRow(
  ownRows: readonly RateRow[],
  row: { effectiveFrom: Date; effectiveTo: Date | null; rate: number }
): boolean {
  if (row.effectiveTo) return false
  const from = row.effectiveFrom.getTime()
  if (ownRows.some((r) => r.effectiveFrom.getTime() > from)) return false
  // The row in force at `from`, picked as rateAt picks it.
  let inForce: RateRow | null = null
  for (const r of ownRows) {
    const start = r.effectiveFrom.getTime()
    if (start > from + 1000) continue
    if (r.effectiveTo && r.effectiveTo.getTime() < from) continue
    if (!inForce || start > inForce.effectiveFrom.getTime()) inForce = r
  }
  return Boolean(inForce && inForce.effectiveTo === null && Math.abs(inForce.rate - row.rate) < 1e-9)
}

/**
 * The first moment at which a child's rate would sit above the parent's new
 * rate inside the window the new parent row governs. null when none does.
 */
export function firstChildAbove(params: {
  rate: number
  window: { start: Date; end: Date | null }
  childRows: readonly RateRow[]
}): { at: Date; childRate: number } | null {
  for (const at of rateChangePoints(params.window, params.childRows)) {
    const childRate = rateAt(params.childRows, at)
    if (childRate !== null && childRate > params.rate + 1e-9) return { at, childRate }
  }
  return null
}

// ---------------------------------------------------------------------------
// First rate config: back-date to the agent's first period
// ---------------------------------------------------------------------------

/**
 * Start of the first period an agent can be settled or paid for.
 *
 * - SHARING / CREDIT: start of the creation day in IST. When the whitelabel
 *   settles in another zone, the earlier of the two day-starts, so the first
 *   settlement period derived in either zone is covered.
 * - COMMISSION: Monday 00:00 IST of the creation cycle.
 */
export function firstRatePeriodStart(scheme: string, createdAt: Date, whitelabelTimezone?: string | null): Date {
  if (scheme === 'COMMISSION') return getMondayToMondayPeriodIST(createdAt).from
  let earliest = DateTime.fromJSDate(createdAt, { zone: COMMISSION_SETTLEMENT_IST }).startOf('day').toJSDate()
  if (whitelabelTimezone) {
    const other = DateTime.fromJSDate(createdAt, { zone: whitelabelTimezone })
    if (other.isValid) {
      const start = other.startOf('day').toJSDate()
      if (start < earliest) earliest = start
    }
  }
  return earliest
}

/**
 * effectiveFrom for a new rate row. When the row will be the agent's first for
 * the domain (no earlier row exists), it is moved back to the start of the
 * agent's first period. Without this the first day (SHARING) or cycle
 * (COMMISSION) has no rate, so a new agent earns 0 for it and a SHARING agent
 * created from the UI can never be settled for its first period.
 */
export function clampFirstRateEffectiveFrom(params: {
  requested: Date
  earliestExisting: Date | null
  periodStart: Date
}): Date {
  const { requested, earliestExisting, periodStart } = params
  const becomesFirst = !earliestExisting || requested.getTime() < earliestExisting.getTime()
  if (becomesFirst && requested.getTime() > periodStart.getTime()) return new Date(periodStart.getTime())
  return requested
}
