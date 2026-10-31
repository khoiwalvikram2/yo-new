import { createHash } from 'node:crypto'
import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm'
import { matkaDefaultRates, matkaRateVersions, matkaWorliInstances } from '../db/schema.js'
import type { SharedDb } from '../db/registry.js'
import { allowedBids, normalizeBid, payoutMinor, type MatkaBid, type MatkaKind } from './rules.js'
import { matkaSchedule } from './schedule.js'

export type MatkaRate = { bidType: MatkaBid; payoutMultiplier: string; versionId: string | null }
export async function effectiveMatkaRates(tx: SharedDb, tenant: string, marketId: string, kind: MatkaKind, now = new Date()): Promise<MatkaRate[]> {
  const [version] = await tx.select().from(matkaRateVersions).where(and(eq(matkaRateVersions.tenant, tenant), eq(matkaRateVersions.matkaId, marketId), lte(matkaRateVersions.effectiveFrom, now), or(isNull(matkaRateVersions.effectiveTo), gte(matkaRateVersions.effectiveTo, now)))).orderBy(desc(matkaRateVersions.effectiveFrom)).limit(1)
  const [defaults] = version ? [] : await tx.select().from(matkaDefaultRates).where(eq(matkaDefaultRates.tenant, tenant)).limit(1)
  const raw = version?.entries || defaults?.entries || {}, entries = Array.isArray(raw) ? raw : raw.entries || []
  const rates = new Map<MatkaBid, MatkaRate>()
  for (const entry of entries) {
    try {
      const bidType = normalizeBid(entry.betType), rate = String(entry.payoutMultiplier)
      payoutMinor(100n, rate)
      if (allowedBids(kind).includes(bidType)) rates.set(bidType, { bidType, payoutMultiplier: rate, versionId: version?.id || null })
    } catch { /* An unsupported legacy entry cannot enable a game accidentally. */ }
  }
  return [...rates.values()]
}

/** An instance is only created by an operator/bootstrap or an accepted wager,
 * never by a public catalogue GET. Existing operator state is preserved. */
export async function ensureMatkaInstance(tx: SharedDb, market: any, schedule: ReturnType<typeof matkaSchedule>, side: 'open' | 'close', rulesVersionId?: string | null) {
  const session = schedule[side]
  await tx.insert(matkaWorliInstances).values({ marketId: market.id, runDate: schedule.runDate, side: side === 'open' ? 'OPEN' : 'CLOSE', status: 'OPEN',
    scheduledOpenAtUtc: new Date(session.startsAt), scheduledLockAtUtc: new Date(session.lockAt), scheduledCloseAtUtc: new Date(session.resultAt),
    totalStakeMinor: 0n, exposureTotalMinor: 0n, betCount: 0, bidRulesVersionId: rulesVersionId || null,
  }).onConflictDoNothing()
  const [instance] = await tx.select().from(matkaWorliInstances).where(and(eq(matkaWorliInstances.marketId, market.id), eq(matkaWorliInstances.runDate, schedule.runDate), eq(matkaWorliInstances.side, side === 'open' ? 'OPEN' : 'CLOSE'))).for('update').limit(1)
  if (!instance) throw new Error('Market session could not be loaded')
  return instance
}

export function matkaRateFingerprint(rates: Array<{ bidType: string; payoutMultiplier: string | number }>): string {
  return createHash('sha256').update(JSON.stringify(rates.map(rate => [rate.bidType, Number(rate.payoutMultiplier)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))).digest('hex')
}
