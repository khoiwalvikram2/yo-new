/**
 * Stuck casino round detector.
 *
 * WHY: incident CS-22135. A provider (GMAG/Evolution) debited four bets, every settlement
 * callback was refused by our wallet with R_02, and the rounds sat `active` for 10.5 hours.
 * Nothing on our side noticed — the only signal was `console.warn`, and we found out when the
 * provider raised a support ticket. The player's 10,000 INR stake was gone the whole time.
 *
 * This detector is deliberately NOT specific to that bug. It watches the OUTCOME (a round
 * that took money and never resolved), so it fires for any future integration fault —
 * including ones nobody has thought of yet: a new provider id convention, a dropped callback,
 * a crashed worker, a schema drift. That is the point: the settlement fix stops one known
 * bug; this stops the class.
 *
 * Bets placed through the admin bet-tool (`exclude_from_admin_running`) are ignored — those
 * are staged manually and legitimately stay open until an operator settles them.
 */

import { db } from '@src/db/client.js'
import { casinoBets, whitelabels, casinoCallbackRejections } from '@shared/db/schema.js'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { NotificationsRepo } from '@src/repos/notifications/notificationsRepo.js'
import { NotificationService } from '@src/domains/notifications/services/NotificationService.js'
import { notifications } from '@shared/db/schema.js'
import { gte } from 'drizzle-orm'

/** A round open longer than this is not "in play" any more, it is stuck. */
const DEFAULT_STUCK_AFTER_MINUTES = 30
/** Do not re-alert the same tenant more often than this while the condition persists. */
const DEFAULT_REALERT_AFTER_MINUTES = 360 // 6h

export const STUCK_ROUND_ALERT_KIND = 'casino_round_stuck'

export interface StuckRoundGroup {
  tenant: string
  stuckCount: number
  stuckStake: number
  playerCount: number
  oldestAgeMinutes: number
  vendors: string[]
  sampleBetIds: string[]
  /** Open zero-stake rows for the same tenant. Reported, never alerted on — see below. */
  zeroStakeCount: number
}

export interface StuckRoundScanResult {
  scannedAt: Date
  stuckAfterMinutes: number
  groups: StuckRoundGroup[]
  alertsCreated: number
  alertsSuppressed: number
}

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
}

/**
 * Find every tenant currently holding casino bets that have been open too long.
 * Read-only — safe to call from anywhere.
 */
export async function findStuckCasinoRounds(stuckAfterMinutes: number): Promise<StuckRoundGroup[]> {
  const cutoff = new Date(Date.now() - stuckAfterMinutes * 60_000)

  // Only stake > 0 counts as stuck MONEY. The zero-amount bet/transIn callback path creates
  // real rows with stake '0' that legitimately never settle (observed: 160 such Skywind rows
  // on this database). Alerting on them would bury the operator in noise and make the whole
  // detector ignorable — the failure mode that let CS-22135 run for 10.5 hours. They are
  // still counted, so a sudden spike is visible, but they never raise an alert.
  const moneyAtRisk = sql`${casinoBets.stake}::numeric > 0`

  const rows = await db
    .select({
      tenant: casinoBets.tenant,
      stuckCount: sql<number>`COUNT(*) FILTER (WHERE ${moneyAtRisk})::int`,
      stuckStake: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric) FILTER (WHERE ${moneyAtRisk}), 0)`,
      playerCount: sql<number>`COUNT(DISTINCT ${casinoBets.userId}) FILTER (WHERE ${moneyAtRisk})::int`,
      oldestAt: sql<Date>`MIN(${casinoBets.createdAt}) FILTER (WHERE ${moneyAtRisk})`,
      vendors: sql<string[]>`ARRAY_AGG(DISTINCT ${casinoBets.vendorName}) FILTER (WHERE ${moneyAtRisk})`,
      sampleBetIds: sql<string[]>`(ARRAY_AGG(${casinoBets.id}::text ORDER BY ${casinoBets.createdAt} ASC) FILTER (WHERE ${moneyAtRisk}))[1:5]`,
      zeroStakeCount: sql<number>`COUNT(*) FILTER (WHERE NOT (${moneyAtRisk}))::int`,
    })
    .from(casinoBets)
    .where(
      and(
        inArray(casinoBets.status, ['pending', 'active']),
        eq(casinoBets.excludeFromAdminRunning, false),
        lt(casinoBets.createdAt, cutoff)
      )
    )
    .groupBy(casinoBets.tenant)

  return rows
    .map((r) => ({
      tenant: r.tenant,
      stuckCount: Number(r.stuckCount ?? 0),
      stuckStake: Number(r.stuckStake ?? 0),
      playerCount: Number(r.playerCount ?? 0),
      oldestAgeMinutes: r.oldestAt ? Math.floor((Date.now() - new Date(r.oldestAt).getTime()) / 60_000) : 0,
      vendors: (r.vendors ?? []).filter(Boolean),
      sampleBetIds: r.sampleBetIds ?? [],
      zeroStakeCount: Number(r.zeroStakeCount ?? 0),
    }))
    .filter((g) => g.stuckCount > 0)
}

/**
 * Durable dedupe. A per-process Map would reset on deploy and would not coordinate across
 * instances, and the admin UI only lists UNREAD rows — so without this a scheduler tick
 * would mint a fresh alert every run and bury the operator.
 */
async function alertedRecently(tenant: string, alertKey: string, windowMinutes: number): Promise<boolean> {
  const since = new Date(Date.now() - windowMinutes * 60_000)
  const [row] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.tenant, tenant),
        gte(notifications.createdAt, since),
        sql`${notifications.metadata}->>'alertKey' = ${alertKey}`
      )
    )
    .limit(1)
  return !!row
}

/** Tenants that actually have a whitelabels row — whitelabel_id is an FK and a bad value throws. */
async function existingWhitelabelIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = await db.select({ id: whitelabels.id }).from(whitelabels).where(inArray(whitelabels.id, ids))
  return new Set(rows.map((r) => r.id))
}

/**
 * Scan for stuck rounds and raise one deduped admin notification per affected tenant.
 * Never throws — a detector that can take the scheduler down is worse than no detector.
 */
export async function runStuckCasinoRoundScan(): Promise<StuckRoundScanResult> {
  const stuckAfterMinutes = envInt('CASINO_STUCK_ROUND_MINUTES', DEFAULT_STUCK_AFTER_MINUTES)
  const realertAfterMinutes = envInt('CASINO_STUCK_ROUND_REALERT_MINUTES', DEFAULT_REALERT_AFTER_MINUTES)
  const result: StuckRoundScanResult = {
    scannedAt: new Date(),
    stuckAfterMinutes,
    groups: [],
    alertsCreated: 0,
    alertsSuppressed: 0,
  }

  result.groups = await findStuckCasinoRounds(stuckAfterMinutes)
  if (!result.groups.length) return result

  const knownWhitelabels = await existingWhitelabelIds(result.groups.map((g) => g.tenant))
  const service = new NotificationService(new NotificationsRepo())

  for (const g of result.groups) {
    const alertKey = `${STUCK_ROUND_ALERT_KIND}:${g.tenant}`
    try {
      if (await alertedRecently(g.tenant, alertKey, realertAfterMinutes)) {
        result.alertsSuppressed++
        continue
      }

      const hours = (g.oldestAgeMinutes / 60).toFixed(1)
      await service.createNotification(
        {
          tenant: g.tenant,
          // Must be set or whitelabel admins (filtered on whitelabel_id) never see the alert.
          whitelabelId: knownWhitelabels.has(g.tenant) ? g.tenant : null,
          type: 'SYSTEM',
          // NOT 'task': the task list is hard-filtered to DEPOSIT/WITHDRAWAL, so a SYSTEM
          // task would be invisible and uncounted.
          category: 'general',
          title: `${g.stuckCount} casino round${g.stuckCount === 1 ? '' : 's'} stuck unsettled`,
          message:
            `${g.stuckCount} casino bet${g.stuckCount === 1 ? '' : 's'} across ${g.playerCount} player${g.playerCount === 1 ? '' : 's'} ` +
            `have been open for more than ${stuckAfterMinutes} minutes (oldest ${hours}h). ` +
            `Stake at risk: ${g.stuckStake.toFixed(2)}. Vendors: ${g.vendors.join(', ') || 'unknown'}. ` +
            `The stake is already debited — if the provider's settlements are being refused, players are out of pocket until this is resolved.`,
          actionUrl: '/bets?domain=casino&status=active',
          metadata: {
            alertKey,
            alertKind: STUCK_ROUND_ALERT_KIND,
            severity: 'critical',
            stuckCount: g.stuckCount,
            stuckStake: g.stuckStake,
            playerCount: g.playerCount,
            oldestAgeMinutes: g.oldestAgeMinutes,
            stuckAfterMinutes,
            vendors: g.vendors,
            sampleBetIds: g.sampleBetIds,
            zeroStakeCount: g.zeroStakeCount,
          },
        },
        undefined // no pubsub in a scheduler; the admin UI polls every 10-30s
      )
      result.alertsCreated++
    } catch (err) {
      // Log loudly: every other notification call site in this repo swallows silently, which
      // is exactly how a missing alert stays missing.
      console.error(
        `[casino-stuck-rounds] failed to raise alert for tenant ${g.tenant}:`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  return result
}

// ---------------------------------------------------------------------------------------
// Provider callback rejection spikes
// ---------------------------------------------------------------------------------------

export const REJECTION_SPIKE_ALERT_KIND = 'casino_callback_rejection_spike'

/** Refusals that are ordinary business outcomes, not faults. Volume alone should not page. */
const BENIGN_REJECTION_CODES = new Set(
  (process.env.CASINO_REJECTION_BENIGN_CODES || 'T_01,T_04').split(',').map((s) => s.trim()).filter(Boolean)
)

const DEFAULT_SPIKE_WINDOW_MINUTES = 15
const DEFAULT_SPIKE_THRESHOLD = 10

export interface RejectionSpike {
  tenant: string
  providerKey: string
  errorCode: string
  count: number
  sampleRoundIds: string[]
  sampleGameCodes: string[]
}

/**
 * Refusals we returned to a provider, grouped and thresholded. Read-only.
 *
 * CS-22135 would have tripped this within minutes: 36 identical `G_01 Game not found` refusals
 * for one game inside the first hour, because our catalogue was missing a table the provider
 * had launched. Instead it ran for five hours and surfaced as a support ticket.
 */
export async function findCallbackRejectionSpikes(
  windowMinutes: number,
  threshold: number
): Promise<RejectionSpike[]> {
  const since = new Date(Date.now() - windowMinutes * 60_000)

  const rows = await db
    .select({
      tenant: casinoCallbackRejections.tenant,
      providerKey: casinoCallbackRejections.providerKey,
      errorCode: casinoCallbackRejections.errorCode,
      count: sql<number>`COUNT(*)::int`,
      sampleRoundIds: sql<string[]>`(ARRAY_AGG(DISTINCT ${casinoCallbackRejections.roundId}) FILTER (WHERE ${casinoCallbackRejections.roundId} IS NOT NULL))[1:5]`,
      sampleGameCodes: sql<string[]>`(ARRAY_AGG(DISTINCT ${casinoCallbackRejections.gameCode}) FILTER (WHERE ${casinoCallbackRejections.gameCode} IS NOT NULL))[1:5]`,
    })
    .from(casinoCallbackRejections)
    .where(gte(casinoCallbackRejections.createdAt, since))
    .groupBy(
      casinoCallbackRejections.tenant,
      casinoCallbackRejections.providerKey,
      casinoCallbackRejections.errorCode
    )

  return rows
    .map((r) => ({
      tenant: r.tenant,
      providerKey: r.providerKey,
      errorCode: r.errorCode,
      count: Number(r.count ?? 0),
      sampleRoundIds: r.sampleRoundIds ?? [],
      sampleGameCodes: r.sampleGameCodes ?? [],
    }))
    .filter((r) => r.count >= threshold && !BENIGN_REJECTION_CODES.has(r.errorCode))
}

/** Detect rejection spikes and raise one deduped alert per (tenant, provider, code). Never throws. */
export async function runCallbackRejectionSpikeScan(): Promise<{ spikes: RejectionSpike[]; alertsCreated: number; alertsSuppressed: number }> {
  const windowMinutes = envInt('CASINO_REJECTION_WINDOW_MINUTES', DEFAULT_SPIKE_WINDOW_MINUTES)
  const threshold = envInt('CASINO_REJECTION_SPIKE_THRESHOLD', DEFAULT_SPIKE_THRESHOLD)
  const realertAfterMinutes = envInt('CASINO_REJECTION_REALERT_MINUTES', 120)

  const spikes = await findCallbackRejectionSpikes(windowMinutes, threshold)
  let alertsCreated = 0
  let alertsSuppressed = 0
  if (!spikes.length) return { spikes, alertsCreated, alertsSuppressed }

  const knownWhitelabels = await existingWhitelabelIds(spikes.map((s) => s.tenant))
  const service = new NotificationService(new NotificationsRepo())

  for (const s of spikes) {
    const alertKey = `${REJECTION_SPIKE_ALERT_KIND}:${s.tenant}:${s.providerKey}:${s.errorCode}`
    try {
      if (await alertedRecently(s.tenant, alertKey, realertAfterMinutes)) {
        alertsSuppressed++
        continue
      }
      await service.createNotification(
        {
          tenant: s.tenant,
          whitelabelId: knownWhitelabels.has(s.tenant) ? s.tenant : null,
          type: 'SYSTEM',
          category: 'general',
          title: `Casino provider callbacks being refused (${s.errorCode})`,
          message:
            `We refused ${s.count} ${s.providerKey} callback${s.count === 1 ? '' : 's'} with ${s.errorCode} ` +
            `in the last ${windowMinutes} minutes. ` +
            (s.sampleGameCodes.length ? `Games: ${s.sampleGameCodes.join(', ')}. ` : '') +
            `The provider will keep retrying; until this is fixed those rounds cannot settle.`,
          actionUrl: '/casino/providers',
          metadata: {
            alertKey,
            alertKind: REJECTION_SPIKE_ALERT_KIND,
            severity: 'critical',
            providerKey: s.providerKey,
            errorCode: s.errorCode,
            count: s.count,
            windowMinutes,
            threshold,
            sampleRoundIds: s.sampleRoundIds,
            sampleGameCodes: s.sampleGameCodes,
          },
        },
        undefined
      )
      alertsCreated++
    } catch (err) {
      console.error(
        `[casino-rejection-spike] failed to raise alert for ${s.tenant}/${s.errorCode}:`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  return { spikes, alertsCreated, alertsSuppressed }
}
