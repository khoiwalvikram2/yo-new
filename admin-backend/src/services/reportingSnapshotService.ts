import { FINANCIAL_SNAPSHOT_VERSION } from '@src/shared/reportingSql.js'
import { sportsPayoutAggregateSql } from '@src/shared/reportingSql.js'
import { DateTime } from 'luxon';
import { db, pool } from '@src/db/client.js';
import { reportingDailySnapshots, sportsBets, agentLedger, bonusAwards, bonusCampaigns, users, matkaBets, casinoBets, agents, } from '@shared/db/schema.js';
import { eq, and, gte, lte, sql, inArray, isNotNull, isNull } from 'drizzle-orm';
import { acquireSnapshotLock, releaseSnapshotLock, isSnapshotLocked } from '@src/services/reportingSnapshotLock.js';
import { getEnv } from '@src/config/env.js';
import { AgentConfigsRepo, type AgentDomain } from '@src/repos/agents/AgentConfigsRepo.js';
import { getStartOfDayForDate, getEndOfDayForDate } from '@src/shared/dateUtils.js';
import { getWhitelabelTimezone, getWhitelabelCurrency } from '@src/shared/whitelabelConfig.js';
import { logSnapshotEvent, truncateDetailForAudit } from '@src/services/snapshotAuditLog.js';
import { formatDateInTz } from '@src/shared/dateUtils.js';

/**
 * The domains a daily snapshot is generated for. Kept local because nothing
 * outside this file consumes it.
 */
type SnapshotDomain = 'sports' | 'casino' | 'matka' | 'agents' | 'bonuses' | 'global'

/** What generateDailySnapshot is asked to produce, and the audit trail to attach it to. */
type GenerateDailySnapshotOptions = {
  tenant: string
  whitelabelId: string
  date: Date
  domain: SnapshotDomain
  currency?: string
  forceRefresh?: boolean
  audit?: {
    runId?: string | null
    pgBossJobId?: string | null
    singletonKey?: string | null
  }
}

const env = getEnv();
const SNAPSHOT_SKIP_IF_EXISTS_HOURS = parseInt(process.env.SNAPSHOT_SKIP_IF_EXISTS_HOURS || env.SNAPSHOT_SKIP_IF_EXISTS_HOURS || '1', 10);
const SNAPSHOT_LOCK_TTL_SECONDS = parseInt(process.env.SNAPSHOT_LOCK_TTL_SECONDS || env.SNAPSHOT_LOCK_TTL_SECONDS || '300', 10);
/**
 * Check if snapshot already exists and is recent
 */
async function checkSnapshotExists(
  tenant: string,
  whitelabelId: string,
  date: Date,
  domain: SnapshotDomain,
  currency: string,
  skipIfExistsHours: number,
) {
    const tz = await getWhitelabelTimezone(tenant);
    const startOfDay = getStartOfDayForDate(date, tz);
    const cutoffTime = new Date(Date.now() - skipIfExistsHours * 60 * 60 * 1000);
    try {
        const existing = await db
            .select({
            id: reportingDailySnapshots.id,
            createdAt: reportingDailySnapshots.createdAt,
        })
            .from(reportingDailySnapshots)
            .where(and(eq(reportingDailySnapshots.tenant, tenant), eq(reportingDailySnapshots.whitelabelId, whitelabelId), eq(reportingDailySnapshots.snapshotDate, startOfDay), eq(reportingDailySnapshots.domain, domain), eq(reportingDailySnapshots.currency, currency), 
        // Check for overall snapshot (all dimension fields are NULL)
        isNull(reportingDailySnapshots.sportId), isNull(reportingDailySnapshots.leagueId), isNull(reportingDailySnapshots.eventId), isNull(reportingDailySnapshots.agentId), isNull(reportingDailySnapshots.campaignId), isNull(reportingDailySnapshots.playerId)))
            .limit(1);
        if (existing.length > 0 && existing[0].createdAt) {
            const createdAt = existing[0].createdAt instanceof Date ? existing[0].createdAt : new Date(existing[0].createdAt);
            if (createdAt >= cutoffTime) {
                return true;
            }
        }
        return false;
    }
    catch (error) {
        return false; // Fail open - proceed with generation
    }
}
/**
 * Generate daily snapshot for a specific domain with lock protection and existence check
 */
export async function generateDailySnapshot(options: GenerateDailySnapshotOptions) {
    const { tenant, whitelabelId, date, domain, currency = 'USD', forceRefresh = false, audit } = options;
    const auditBase = () => ({
        runId: audit?.runId ?? undefined,
        pgBossJobId: audit?.pgBossJobId ?? undefined,
        singletonKey: audit?.singletonKey ?? undefined,
        tenant,
        whitelabelId,
        currency,
        domain,
    });
    try {
        const tz = await getWhitelabelTimezone(tenant);
        const startOfDay = getStartOfDayForDate(date, tz);
        const endOfDay = getEndOfDayForDate(date, tz);
        const reportingDay = formatDateInTz(date, tz);
        // Guard: never generate a snapshot for today or the future — the day is incomplete
        const todayStr = DateTime.now().setZone(tz).toFormat('yyyy-MM-dd');
        if (reportingDay >= todayStr) {
            await logSnapshotEvent({
                ...auditBase(),
                level: 'warn',
                eventType: 'skipped_incomplete_day',
                reportingDay,
                snapshotDateUtc: startOfDay,
                message: `Skipped ${domain}: date ${reportingDay} is today or future (incomplete day)`,
            });
            return { success: true, domain, skipped: true, reason: 'date_not_complete' };
        }
        // Check if snapshot already exists and is recent (skip this check when forceRefresh is set)
        if (!forceRefresh) {
            const exists = await checkSnapshotExists(tenant, whitelabelId, date, domain, currency, SNAPSHOT_SKIP_IF_EXISTS_HOURS);
            if (exists) {
                await logSnapshotEvent({
                    ...auditBase(),
                    level: 'info',
                    eventType: 'skipped_exists',
                    reportingDay,
                    snapshotDateUtc: startOfDay,
                    message: `Skipped ${domain}: already_exists (recent)`,
                });
                return { success: true, domain, skipped: true, reason: 'already_exists' };
            }
        }
        // Check if lock exists (another process is generating)
        const isLocked = await isSnapshotLocked(tenant, whitelabelId, date, domain, currency);
        if (isLocked) {
            await logSnapshotEvent({
                ...auditBase(),
                level: 'warn',
                eventType: 'lock_blocked',
                reportingDay,
                snapshotDateUtc: startOfDay,
                message: `Skipped ${domain}: lock_exists`,
            });
            return { success: true, domain, skipped: true, reason: 'lock_exists' };
        }
        // Try to acquire lock
        const lockAcquired = await acquireSnapshotLock(tenant, whitelabelId, date, domain, currency, SNAPSHOT_LOCK_TTL_SECONDS);
        if (!lockAcquired) {
            await logSnapshotEvent({
                ...auditBase(),
                level: 'warn',
                eventType: 'lock_blocked',
                reportingDay,
                snapshotDateUtc: startOfDay,
                message: `Skipped ${domain}: lock_not_acquired`,
            });
            return { success: true, domain, skipped: true, reason: 'lock_not_acquired' };
        }
        try {
            let result;
            if (domain === 'sports') {
                result = await generateSportsSnapshot(tenant, whitelabelId, startOfDay, endOfDay, currency);
            }
            else if (domain === 'casino') {
                result = await generateCasinoSnapshot(tenant, whitelabelId, startOfDay, endOfDay, currency);
            }
            else if (domain === 'matka') {
                result = await generateMatkaSnapshot(tenant, whitelabelId, startOfDay, endOfDay, currency);
            }
            else if (domain === 'agents') {
                result = await generateAgentsSnapshot(tenant, whitelabelId, startOfDay, endOfDay, currency);
            }
            else if (domain === 'bonuses') {
                result = await generateBonusesSnapshot(tenant, whitelabelId, startOfDay, endOfDay, currency);
            }
            else if (domain === 'global') {
                result = await generateGlobalSnapshot(tenant, whitelabelId, startOfDay, endOfDay, currency);
            }
            else {
                throw new Error(`Unknown domain: ${domain}`);
            }
            return result;
        }
        finally {
            // Release lock (optional - TTL will handle it, but good practice)
            await releaseSnapshotLock(tenant, whitelabelId, date, domain, currency);
        }
    }
    catch (error) {
        const tz = await getWhitelabelTimezone(tenant).catch(() => 'Asia/Kolkata');
        const startOfDay = getStartOfDayForDate(date, tz);
        const reportingDay = formatDateInTz(date, tz);
        await logSnapshotEvent({
            ...auditBase(),
            level: 'error',
            eventType: 'generate_threw',
            reportingDay,
            snapshotDateUtc: startOfDay,
            message: error instanceof Error ? error.message : String(error),
            detailJson: truncateDetailForAudit(error),
        });
        // Release lock on error
        await releaseSnapshotLock(tenant, whitelabelId, date, domain, currency).catch(() => {
            // Ignore release errors
        });
        throw error; // Re-throw to allow caller to handle
    }
}
/**
 * Generate sports betting snapshot
 */
async function generateSportsSnapshot(tenant: string, whitelabelId: string, startOfDay: Date, endOfDay: Date, currency: string) {
    // Settled-only: revenue metrics from won/lost/settled
    const settledStatuses = ['won', 'lost', 'settled'] as const;
    const betsAggregate = await db
        .select({
        totalStakes: sql<number>`COALESCE(SUM(${sportsBets.liability}), 0)`,
        totalPayouts: sportsPayoutAggregateSql(),
        betCount: sql<number>`COUNT(*)`,
        playerCount: sql<number>`COUNT(DISTINCT ${sportsBets.userId})`,
    })
        .from(sportsBets)
        .where(and(eq(sportsBets.tenant, tenant), eq(sportsBets.whitelabelId, whitelabelId), eq(sportsBets.currency, currency), gte(sportsBets.createdAt, startOfDay), lte(sportsBets.createdAt, endOfDay), inArray(sportsBets.status, settledStatuses)));
    // Open-only: exposure from matched/unmatched
    const exposureAggregate = await db
        .select({
        totalExposure: sql<number>`COALESCE(SUM(${sportsBets.liability}), 0)`,
    })
        .from(sportsBets)
        .where(and(eq(sportsBets.tenant, tenant), eq(sportsBets.whitelabelId, whitelabelId), eq(sportsBets.currency, currency), gte(sportsBets.createdAt, startOfDay), lte(sportsBets.createdAt, endOfDay), inArray(sportsBets.status, ['matched', 'unmatched'])));
    const rev = betsAggregate[0];
    const exp = exposureAggregate[0];
    const agg = {
        totalStakes: rev?.totalStakes ?? 0,
        totalPayouts: rev?.totalPayouts ?? 0,
        totalExposure: exp?.totalExposure ?? 0,
        betCount: rev?.betCount ?? 0,
        playerCount: rev?.playerCount ?? 0,
    };
    const totalStakes = Number(agg.totalStakes) || 0;
    const totalPayouts = Number(agg.totalPayouts) || 0;
    const totalExposure = Number(agg.totalExposure) || 0;
    const ggr = totalStakes - totalPayouts;
    const holdPercentage = totalStakes > 0 ? ggr / totalStakes : 0;
    // Insert or update overall snapshot (all dimension fields are NULL for overall)
    try {
        await db
            .insert(reportingDailySnapshots)
            .values({
            metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
            tenant,
            whitelabelId,
            snapshotDate: startOfDay,
            domain: 'sports',
            sportId: null, // NULL for overall snapshot
            leagueId: null,
            eventId: null,
            agentId: null,
            campaignId: null,
            playerId: null,
            totalStakes: totalStakes.toString(),
            totalPayouts: totalPayouts.toString(),
            totalExposure: totalExposure.toString(),
            totalLiquidity: '0', // Would need market data for this
            grossGamingRevenue: ggr.toString(),
            netRevenue: ggr.toString(),
            holdPercentage: holdPercentage.toString(),
            betCount: Number(agg.betCount) || 0,
            playerCount: Number(agg.playerCount) || 0,
            activePlayerCount: Number(agg.playerCount) || 0,
            currency,
        })
            .onConflictDoUpdate({
            target: [
                reportingDailySnapshots.tenant,
                reportingDailySnapshots.whitelabelId,
                reportingDailySnapshots.snapshotDate,
                reportingDailySnapshots.domain,
                reportingDailySnapshots.sportId,
                reportingDailySnapshots.leagueId,
                reportingDailySnapshots.eventId,
                reportingDailySnapshots.agentId,
                reportingDailySnapshots.campaignId,
                reportingDailySnapshots.playerId,
            ],
            set: {
                metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
                totalStakes: totalStakes.toString(),
                totalPayouts: totalPayouts.toString(),
                totalExposure: totalExposure.toString(),
                grossGamingRevenue: ggr.toString(),
                netRevenue: ggr.toString(),
                holdPercentage: holdPercentage.toString(),
                betCount: Number(agg.betCount) || 0,
                playerCount: Number(agg.playerCount) || 0,
                activePlayerCount: Number(agg.playerCount) || 0,
            },
        });
    }
    catch (error) {
        throw error;
    }
    // Generate player-level snapshots with agentId
    await generatePlayerLevelSnapshots(tenant, whitelabelId, startOfDay, endOfDay, currency, 'sports');
    // Generate agent-level snapshots
    await generateAgentLevelSnapshots(tenant, whitelabelId, startOfDay, endOfDay, currency, 'sports');
    return { success: true, domain: 'sports' };
}
/**
 * Generate player-level snapshots for a domain
 */
async function generatePlayerLevelSnapshots(tenant: string, whitelabelId: string, startOfDay: Date, endOfDay: Date, currency: string, domain: SnapshotDomain) {
    if (domain === 'sports') {
        // Group by playerId and agentId, aggregate metrics (settled bets only)
        const playerAggregates = await db
            .select({
            playerId: sportsBets.userId,
            agentId: users.agentId,
            sportId: sportsBets.sportId,
            leagueId: sportsBets.leagueId,
            eventId: sportsBets.eventId,
            totalStakes: sql<number>`COALESCE(SUM(${sportsBets.liability}), 0)`,
            totalPayouts: sportsPayoutAggregateSql(),
            totalExposure: sql<number>`0`,
            betCount: sql<number>`COUNT(*)`,
        })
            .from(sportsBets)
            .leftJoin(users, eq(sportsBets.userId, users.id))
            .where(and(eq(sportsBets.tenant, tenant), eq(sportsBets.whitelabelId, whitelabelId), eq(sportsBets.currency, currency), gte(sportsBets.createdAt, startOfDay), lte(sportsBets.createdAt, endOfDay), inArray(sportsBets.status, ['won', 'lost', 'settled'])))
            .groupBy(sportsBets.userId, users.agentId, sportsBets.sportId, sportsBets.leagueId, sportsBets.eventId);
        // Insert player-level snapshots with agentId
        let insertedCount = 0;
        for (const agg of playerAggregates) {
            const totalStakes = Number(agg.totalStakes) || 0;
            const totalPayouts = Number(agg.totalPayouts) || 0;
            const totalExposure = Number(agg.totalExposure) || 0;
            const ggr = totalStakes - totalPayouts;
            const holdPercentage = totalStakes > 0 ? ggr / totalStakes : 0;
            await db
                .insert(reportingDailySnapshots)
                .values({
            metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
                tenant,
                whitelabelId,
                snapshotDate: startOfDay,
                domain: 'sports',
                sportId: agg.sportId,
                leagueId: agg.leagueId,
                eventId: agg.eventId,
                agentId: agg.agentId || null,
                playerId: agg.playerId,
                totalStakes: totalStakes.toString(),
                totalPayouts: totalPayouts.toString(),
                totalExposure: totalExposure.toString(),
                grossGamingRevenue: ggr.toString(),
                netRevenue: ggr.toString(),
                holdPercentage: holdPercentage.toString(),
                betCount: Number(agg.betCount) || 0,
                playerCount: 1,
                activePlayerCount: 1,
                currency,
            })
                .onConflictDoUpdate({
                target: [
                    reportingDailySnapshots.tenant,
                    reportingDailySnapshots.whitelabelId,
                    reportingDailySnapshots.snapshotDate,
                    reportingDailySnapshots.domain,
                    reportingDailySnapshots.sportId,
                    reportingDailySnapshots.leagueId,
                    reportingDailySnapshots.eventId,
                    reportingDailySnapshots.agentId,
                    reportingDailySnapshots.campaignId,
                    reportingDailySnapshots.playerId,
                ],
                set: {
                metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
                    totalStakes: totalStakes.toString(),
                    totalPayouts: totalPayouts.toString(),
                    totalExposure: totalExposure.toString(),
                    grossGamingRevenue: ggr.toString(),
                    netRevenue: ggr.toString(),
                    holdPercentage: holdPercentage.toString(),
                    betCount: Number(agg.betCount) || 0,
                    playerCount: 1,
                    activePlayerCount: 1,
                },
            });
            insertedCount++;
        }
    }
    else if (domain === 'casino') {
        // Settled-only for stakes/payouts/counts; exposure from pending/active. Cash only (exclude bonus/referralBonus for commission).
        // Player-level rows are grouped by (player, agent) only.
        //
        // This also grouped by vendor and game until the rows were checked against the
        // bets they came from: the insert below writes every discriminator
        // column NULL, so all of a player's vendor/game groups for one day collided
        // on reporting_snapshots_unique, and onConflictDoUpdate's `set:` kept
        // whichever landed last instead of accumulating. Measured across the
        // whole table before this was corrected, casino per-player stake was
        // under-counted by 32.6% — 77.9M of 238.7M.
        // The unique key has no vendor/game column, so any grain finer than
        // (player, agent) cannot be represented here at all.
        const playerAggregates = await db
            .select({
            playerId: casinoBets.userId,
            agentId: users.agentId,
            totalStakes: sql<number>`COALESCE(SUM(CASE WHEN ${casinoBets.status} IN ('won', 'lost') THEN ${casinoBets.stake}::numeric ELSE 0 END), 0)`,
            totalPayouts: sql<number>`COALESCE(SUM(CASE WHEN ${casinoBets.status} IN ('won', 'lost') THEN COALESCE(${casinoBets.payout}::numeric, ${casinoBets.winAmount}::numeric, 0) ELSE 0 END), 0)`,
            totalExposure: sql<number>`COALESCE(SUM(CASE WHEN ${casinoBets.status} IN ('pending', 'active') THEN ${casinoBets.stake}::numeric ELSE 0 END), 0)`,
            betCount: sql<number>`COUNT(CASE WHEN ${casinoBets.status} IN ('won', 'lost') THEN 1 END)`,
        })
            .from(casinoBets)
            .leftJoin(users, eq(casinoBets.userId, users.id))
            .where(and(eq(casinoBets.tenant, tenant), eq(casinoBets.whitelabelId, whitelabelId), eq(casinoBets.currency, currency), eq(casinoBets.walletType, 'cash'), gte(casinoBets.createdAt, startOfDay), lte(casinoBets.createdAt, endOfDay)))
            .groupBy(casinoBets.userId, users.agentId);
        // Insert player-level snapshots with agentId
        let insertedCount = 0;
        for (const agg of playerAggregates) {
            const totalStakes = Number(agg.totalStakes) || 0;
            const totalPayouts = Number(agg.totalPayouts) || 0;
            const totalExposure = Number(agg.totalExposure) || 0;
            const ggr = totalStakes - totalPayouts;
            const holdPercentage = totalStakes > 0 ? ggr / totalStakes : 0;
            await db
                .insert(reportingDailySnapshots)
                .values({
            metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
                tenant,
                whitelabelId,
                snapshotDate: startOfDay,
                domain: 'casino',
                sportId: null, // Casino doesn't have sports hierarchy
                leagueId: null,
                eventId: null,
                agentId: agg.agentId || null,
                campaignId: null,
                playerId: agg.playerId,
                totalStakes: totalStakes.toString(),
                totalPayouts: totalPayouts.toString(),
                totalExposure: totalExposure.toString(),
                grossGamingRevenue: ggr.toString(),
                netRevenue: ggr.toString(),
                holdPercentage: holdPercentage.toString(),
                betCount: Number(agg.betCount) || 0,
                playerCount: 1,
                activePlayerCount: 1,
                currency,
            })
                .onConflictDoUpdate({
                target: [
                    reportingDailySnapshots.tenant,
                    reportingDailySnapshots.whitelabelId,
                    reportingDailySnapshots.snapshotDate,
                    reportingDailySnapshots.domain,
                    reportingDailySnapshots.sportId,
                    reportingDailySnapshots.leagueId,
                    reportingDailySnapshots.eventId,
                    reportingDailySnapshots.agentId,
                    reportingDailySnapshots.campaignId,
                    reportingDailySnapshots.playerId,
                ],
                set: {
                metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
                    totalStakes: totalStakes.toString(),
                    totalPayouts: totalPayouts.toString(),
                    totalExposure: totalExposure.toString(),
                    grossGamingRevenue: ggr.toString(),
                    netRevenue: ggr.toString(),
                    holdPercentage: holdPercentage.toString(),
                    betCount: Number(agg.betCount) || 0,
                    playerCount: 1,
                    activePlayerCount: 1,
                },
            });
            insertedCount++;
        }
    }
    else if (domain === 'matka') {
        // Settled-only for stakes/payouts/counts; exposure from pending/active (matka has no 'settled')
        // Player-level rows are grouped by (player, agent) only.
        //
        // This also grouped by matka and matka type until the rows were checked against the
        // bets they came from: the insert below writes every discriminator
        // column NULL, so all of a player's matka/type groups for one day collided
        // on reporting_snapshots_unique, and onConflictDoUpdate's `set:` kept
        // whichever landed last instead of accumulating. No matka per-player rows
        // exist yet, so nothing needs regenerating — but the defect was
        // identical and would have appeared with the first row.
        // The unique key has no matka/type column, so any grain finer than
        // (player, agent) cannot be represented here at all.
        const playerAggregates = await db
            .select({
            playerId: matkaBets.userId,
            agentId: users.agentId,
            totalStakes: sql<number>`COALESCE(SUM(CASE WHEN ${matkaBets.status} IN ('won', 'lost') THEN ${matkaBets.betAmount}::numeric ELSE 0 END), 0)`,
            totalPayouts: sql<number>`COALESCE(SUM(CASE WHEN ${matkaBets.status} = 'won' THEN ${matkaBets.actualWin}::numeric ELSE 0 END), 0)`,
            totalExposure: sql<number>`COALESCE(SUM(CASE WHEN ${matkaBets.status} IN ('pending', 'active') THEN ${matkaBets.potentialWin}::numeric ELSE 0 END), 0)`,
            betCount: sql<number>`COUNT(CASE WHEN ${matkaBets.status} IN ('won', 'lost') THEN 1 END)`,
        })
            .from(matkaBets)
            .leftJoin(users, eq(matkaBets.userId, users.id))
            .where(and(eq(matkaBets.tenant, tenant), eq(matkaBets.whitelabelId, whitelabelId), eq(matkaBets.currency, currency), gte(matkaBets.createdAt, startOfDay), lte(matkaBets.createdAt, endOfDay)))
            .groupBy(matkaBets.userId, users.agentId);
        // Insert player-level snapshots with agentId
        let insertedCount = 0;
        for (const agg of playerAggregates) {
            const totalStakes = Number(agg.totalStakes) || 0;
            const totalPayouts = Number(agg.totalPayouts) || 0;
            const totalExposure = Number(agg.totalExposure) || 0;
            const ggr = totalStakes - totalPayouts;
            const holdPercentage = totalStakes > 0 ? ggr / totalStakes : 0;
            await db
                .insert(reportingDailySnapshots)
                .values({
            metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
                tenant,
                whitelabelId,
                snapshotDate: startOfDay,
                domain: 'matka',
                sportId: null, // Matka doesn't have sports hierarchy
                leagueId: null,
                eventId: null,
                agentId: agg.agentId || null,
                campaignId: null,
                playerId: agg.playerId,
                totalStakes: totalStakes.toString(),
                totalPayouts: totalPayouts.toString(),
                totalExposure: totalExposure.toString(),
                grossGamingRevenue: ggr.toString(),
                netRevenue: ggr.toString(),
                holdPercentage: holdPercentage.toString(),
                betCount: Number(agg.betCount) || 0,
                playerCount: 1,
                activePlayerCount: 1,
                currency,
            })
                .onConflictDoUpdate({
                target: [
                    reportingDailySnapshots.tenant,
                    reportingDailySnapshots.whitelabelId,
                    reportingDailySnapshots.snapshotDate,
                    reportingDailySnapshots.domain,
                    reportingDailySnapshots.sportId,
                    reportingDailySnapshots.leagueId,
                    reportingDailySnapshots.eventId,
                    reportingDailySnapshots.agentId,
                    reportingDailySnapshots.campaignId,
                    reportingDailySnapshots.playerId,
                ],
                set: {
                metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
                    totalStakes: totalStakes.toString(),
                    totalPayouts: totalPayouts.toString(),
                    totalExposure: totalExposure.toString(),
                    grossGamingRevenue: ggr.toString(),
                    netRevenue: ggr.toString(),
                    holdPercentage: holdPercentage.toString(),
                    betCount: Number(agg.betCount) || 0,
                    playerCount: 1,
                    activePlayerCount: 1,
                },
            });
            insertedCount++;
        }
    }
}
/**
 * Generate agent-level snapshots for a domain
 * Aggregates all bets by agentId for reporting
 */
/** Get commission rate (0..1) per COMMISSION agent for a domain at a given date; non-COMMISSION agents are omitted (treated as 0). */
async function getCommissionRatesForAgents(agentIds: string[], domain: AgentDomain, at: Date) {
    if (agentIds.length === 0)
        return new Map();
    const configsRepo = new AgentConfigsRepo();
    const agentRows = await db
        .select({ id: agents.id, schemeType: agents.schemeType })
        .from(agents)
        .where(inArray(agents.id, agentIds));
    const commissionAgentIds = agentRows.filter((r) => r.schemeType === 'COMMISSION').map((r) => r.id);
    const map = new Map();
    for (const agentId of commissionAgentIds) {
        const config = await configsRepo.getCommissionConfig(agentId, domain, at);
        map.set(agentId, config ? Number(config.commissionRate) : 0);
    }
    return map;
}
async function generateAgentLevelSnapshots(tenant: string, whitelabelId: string, startOfDay: Date, endOfDay: Date, currency: string, domain: SnapshotDomain) {
    if (domain === 'sports') {
        // Aggregate by agentId (settled bets only); exposure from open kept at 0 at agent level
        const agentAggregates = await db
            .select({
            agentId: users.agentId,
            totalStakes: sql<number>`COALESCE(SUM(${sportsBets.liability}), 0)`,
            totalPayouts: sportsPayoutAggregateSql(),
            totalExposure: sql<number>`0`,
            betCount: sql<number>`COUNT(*)`,
            playerCount: sql<number>`COUNT(DISTINCT ${sportsBets.userId})`,
        })
            .from(sportsBets)
            .leftJoin(users, eq(sportsBets.userId, users.id))
            .where(and(eq(sportsBets.tenant, tenant), eq(sportsBets.whitelabelId, whitelabelId), eq(sportsBets.currency, currency), gte(sportsBets.createdAt, startOfDay), lte(sportsBets.createdAt, endOfDay), isNotNull(users.agentId), inArray(sportsBets.status, ['won', 'lost', 'settled'])))
            .groupBy(users.agentId);
        const sportsAgentIds = agentAggregates.map((a) => a.agentId).filter((id) => id != null);
        const sportsCommissionRateMap = sportsAgentIds.length > 0 ? await getCommissionRatesForAgents(sportsAgentIds, 'sports', startOfDay) : new Map();
        // Insert agent-level snapshots
        let insertedCount = 0;
        for (const agg of agentAggregates) {
            if (!agg.agentId)
                continue; // Skip if no agentId
            const totalStakes = Number(agg.totalStakes) || 0;
            const totalPayouts = Number(agg.totalPayouts) || 0;
            const totalExposure = Number(agg.totalExposure) || 0;
            const ggr = totalStakes - totalPayouts;
            const holdPercentage = totalStakes > 0 ? ggr / totalStakes : 0;
            const commissionRate = sportsCommissionRateMap.get(agg.agentId) ?? 0;
            const agentCommission = ggr * commissionRate;
            await db
                .insert(reportingDailySnapshots)
                .values({
            metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
                tenant,
                whitelabelId,
                snapshotDate: startOfDay,
                domain: 'sports',
                sportId: null, // NULL for agent-level snapshot (aggregated across all sports)
                leagueId: null,
                eventId: null,
                agentId: agg.agentId,
                campaignId: null,
                playerId: null, // NULL for agent-level snapshot (aggregated across all players)
                totalStakes: totalStakes.toString(),
                totalPayouts: totalPayouts.toString(),
                totalExposure: totalExposure.toString(),
                grossGamingRevenue: ggr.toString(),
                netRevenue: ggr.toString(),
                holdPercentage: holdPercentage.toString(),
                betCount: Number(agg.betCount) || 0,
                playerCount: Number(agg.playerCount) || 0,
                activePlayerCount: Number(agg.playerCount) || 0,
                agentCommission: agentCommission.toString(),
                currency,
            })
                .onConflictDoUpdate({
                target: [
                    reportingDailySnapshots.tenant,
                    reportingDailySnapshots.whitelabelId,
                    reportingDailySnapshots.snapshotDate,
                    reportingDailySnapshots.domain,
                    reportingDailySnapshots.sportId,
                    reportingDailySnapshots.leagueId,
                    reportingDailySnapshots.eventId,
                    reportingDailySnapshots.agentId,
                    reportingDailySnapshots.campaignId,
                    reportingDailySnapshots.playerId,
                ],
                set: {
                metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
                    totalStakes: totalStakes.toString(),
                    totalPayouts: totalPayouts.toString(),
                    totalExposure: totalExposure.toString(),
                    grossGamingRevenue: ggr.toString(),
                    netRevenue: ggr.toString(),
                    holdPercentage: holdPercentage.toString(),
                    betCount: Number(agg.betCount) || 0,
                    playerCount: Number(agg.playerCount) || 0,
                    activePlayerCount: Number(agg.playerCount) || 0,
                    agentCommission: agentCommission.toString(),
                },
            });
            insertedCount++;
        }
    }
    else if (domain === 'casino') {
        // Settled-only for stakes/payouts/counts; exposure from pending/active. Cash only (exclude bonus/referralBonus for commission).
        const agentAggregates = await db
            .select({
            agentId: users.agentId,
            totalStakes: sql<number>`COALESCE(SUM(CASE WHEN ${casinoBets.status} IN ('won', 'lost') THEN ${casinoBets.stake}::numeric ELSE 0 END), 0)`,
            totalPayouts: sql<number>`COALESCE(SUM(CASE WHEN ${casinoBets.status} IN ('won', 'lost') THEN COALESCE(${casinoBets.payout}::numeric, ${casinoBets.winAmount}::numeric, 0) ELSE 0 END), 0)`,
            totalExposure: sql<number>`COALESCE(SUM(CASE WHEN ${casinoBets.status} IN ('pending', 'active') THEN ${casinoBets.stake}::numeric ELSE 0 END), 0)`,
            betCount: sql<number>`COUNT(CASE WHEN ${casinoBets.status} IN ('won', 'lost') THEN 1 END)`,
            playerCount: sql<number>`COUNT(DISTINCT CASE WHEN ${casinoBets.status} IN ('won', 'lost') THEN ${casinoBets.userId} END)`,
        })
            .from(casinoBets)
            .leftJoin(users, eq(casinoBets.userId, users.id))
            .where(and(eq(casinoBets.tenant, tenant), eq(casinoBets.whitelabelId, whitelabelId), eq(casinoBets.currency, currency), eq(casinoBets.walletType, 'cash'), gte(casinoBets.createdAt, startOfDay), lte(casinoBets.createdAt, endOfDay), isNotNull(users.agentId)))
            .groupBy(users.agentId);
        const casinoAgentIds = agentAggregates.map((a) => a.agentId).filter((id) => id != null);
        const casinoCommissionRateMap = casinoAgentIds.length > 0 ? await getCommissionRatesForAgents(casinoAgentIds, 'casino', startOfDay) : new Map();
        // Insert agent-level snapshots
        let insertedCount = 0;
        for (const agg of agentAggregates) {
            if (!agg.agentId)
                continue; // Skip if no agentId
            const totalStakes = Number(agg.totalStakes) || 0;
            const totalPayouts = Number(agg.totalPayouts) || 0;
            const totalExposure = Number(agg.totalExposure) || 0;
            const ggr = totalStakes - totalPayouts;
            const holdPercentage = totalStakes > 0 ? ggr / totalStakes : 0;
            const commissionRate = casinoCommissionRateMap.get(agg.agentId) ?? 0;
            const agentCommission = ggr * commissionRate;
            await db
                .insert(reportingDailySnapshots)
                .values({
            metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
                tenant,
                whitelabelId,
                snapshotDate: startOfDay,
                domain: 'casino',
                sportId: null, // NULL for agent-level snapshot (aggregated across all games)
                leagueId: null,
                eventId: null,
                agentId: agg.agentId,
                campaignId: null,
                playerId: null, // NULL for agent-level snapshot (aggregated across all players)
                totalStakes: totalStakes.toString(),
                totalPayouts: totalPayouts.toString(),
                totalExposure: totalExposure.toString(),
                grossGamingRevenue: ggr.toString(),
                netRevenue: ggr.toString(),
                holdPercentage: holdPercentage.toString(),
                betCount: Number(agg.betCount) || 0,
                playerCount: Number(agg.playerCount) || 0,
                activePlayerCount: Number(agg.playerCount) || 0,
                agentCommission: agentCommission.toString(),
                currency,
            })
                .onConflictDoUpdate({
                target: [
                    reportingDailySnapshots.tenant,
                    reportingDailySnapshots.whitelabelId,
                    reportingDailySnapshots.snapshotDate,
                    reportingDailySnapshots.domain,
                    reportingDailySnapshots.sportId,
                    reportingDailySnapshots.leagueId,
                    reportingDailySnapshots.eventId,
                    reportingDailySnapshots.agentId,
                    reportingDailySnapshots.campaignId,
                    reportingDailySnapshots.playerId,
                ],
                set: {
                metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
                    totalStakes: totalStakes.toString(),
                    totalPayouts: totalPayouts.toString(),
                    totalExposure: totalExposure.toString(),
                    grossGamingRevenue: ggr.toString(),
                    netRevenue: ggr.toString(),
                    holdPercentage: holdPercentage.toString(),
                    betCount: Number(agg.betCount) || 0,
                    playerCount: Number(agg.playerCount) || 0,
                    activePlayerCount: Number(agg.playerCount) || 0,
                    agentCommission: agentCommission.toString(),
                },
            });
            insertedCount++;
        }
    }
    else if (domain === 'matka') {
        // Settled-only for stakes/payouts/counts; exposure from pending/active (matka has no 'settled')
        const agentAggregates = await db
            .select({
            agentId: users.agentId,
            totalStakes: sql<number>`COALESCE(SUM(CASE WHEN ${matkaBets.status} IN ('won', 'lost') THEN ${matkaBets.betAmount}::numeric ELSE 0 END), 0)`,
            totalPayouts: sql<number>`COALESCE(SUM(CASE WHEN ${matkaBets.status} = 'won' THEN ${matkaBets.actualWin}::numeric ELSE 0 END), 0)`,
            totalExposure: sql<number>`COALESCE(SUM(CASE WHEN ${matkaBets.status} IN ('pending', 'active') THEN ${matkaBets.potentialWin}::numeric ELSE 0 END), 0)`,
            betCount: sql<number>`COUNT(CASE WHEN ${matkaBets.status} IN ('won', 'lost') THEN 1 END)`,
            playerCount: sql<number>`COUNT(DISTINCT CASE WHEN ${matkaBets.status} IN ('won', 'lost') THEN ${matkaBets.userId} END)`,
        })
            .from(matkaBets)
            .leftJoin(users, eq(matkaBets.userId, users.id))
            .where(and(eq(matkaBets.tenant, tenant), eq(matkaBets.whitelabelId, whitelabelId), eq(matkaBets.currency, currency), gte(matkaBets.createdAt, startOfDay), lte(matkaBets.createdAt, endOfDay), isNotNull(users.agentId)))
            .groupBy(users.agentId);
        const matkaAgentIds = agentAggregates.map((a) => a.agentId).filter((id) => id != null);
        const matkaCommissionRateMap = matkaAgentIds.length > 0 ? await getCommissionRatesForAgents(matkaAgentIds, 'matka', startOfDay) : new Map();
        // Insert agent-level snapshots for matka
        for (const agg of agentAggregates) {
            if (!agg.agentId)
                continue;
            const totalStakes = Number(agg.totalStakes) || 0;
            const totalPayouts = Number(agg.totalPayouts) || 0;
            const totalExposure = Number(agg.totalExposure) || 0;
            const ggr = totalStakes - totalPayouts;
            const holdPercentage = totalStakes > 0 ? ggr / totalStakes : 0;
            const commissionRate = matkaCommissionRateMap.get(agg.agentId) ?? 0;
            const agentCommission = ggr * commissionRate;
            await db
                .insert(reportingDailySnapshots)
                .values({
            metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
                tenant,
                whitelabelId,
                snapshotDate: startOfDay,
                domain: 'matka',
                sportId: null, // NULL for agent-level snapshot (aggregated across all sports)
                leagueId: null,
                eventId: null,
                agentId: agg.agentId,
                campaignId: null,
                playerId: null, // NULL for agent-level snapshot (aggregated across all players)
                totalStakes: totalStakes.toString(),
                totalPayouts: totalPayouts.toString(),
                totalExposure: totalExposure.toString(),
                grossGamingRevenue: ggr.toString(),
                netRevenue: ggr.toString(),
                holdPercentage: holdPercentage.toString(),
                betCount: Number(agg.betCount) || 0,
                playerCount: Number(agg.playerCount) || 0,
                activePlayerCount: Number(agg.playerCount) || 0,
                agentCommission: agentCommission.toString(),
                currency,
            })
                .onConflictDoUpdate({
                target: [
                    reportingDailySnapshots.tenant,
                    reportingDailySnapshots.whitelabelId,
                    reportingDailySnapshots.snapshotDate,
                    reportingDailySnapshots.domain,
                    reportingDailySnapshots.sportId,
                    reportingDailySnapshots.leagueId,
                    reportingDailySnapshots.eventId,
                    reportingDailySnapshots.agentId,
                    reportingDailySnapshots.campaignId,
                    reportingDailySnapshots.playerId,
                ],
                set: {
                metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
                    totalStakes: totalStakes.toString(),
                    totalPayouts: totalPayouts.toString(),
                    totalExposure: totalExposure.toString(),
                    grossGamingRevenue: ggr.toString(),
                    netRevenue: ggr.toString(),
                    holdPercentage: holdPercentage.toString(),
                    betCount: Number(agg.betCount) || 0,
                    playerCount: Number(agg.playerCount) || 0,
                    activePlayerCount: Number(agg.playerCount) || 0,
                    agentCommission: agentCommission.toString(),
                },
            });
        }
    }
    // TODO: Add agent-level snapshots for casino when bet schema is available
}
/**
 * Generate casino snapshot
 */
async function generateCasinoSnapshot(tenant: string, whitelabelId: string, startOfDay: Date, endOfDay: Date, currency: string) {
    // Settled-only: revenue metrics from won/lost (cash bets only; bonus/referralBonus do not generate commission)
    const betsAggregate = await db
        .select({
        totalStakes: sql<number>`COALESCE(SUM(${casinoBets.stake}), 0)`,
        totalPayouts: sql<number>`COALESCE(SUM(COALESCE(${casinoBets.payout}::numeric, ${casinoBets.winAmount}::numeric, 0)), 0)`,
        betCount: sql<number>`COUNT(*)`,
        playerCount: sql<number>`COUNT(DISTINCT ${casinoBets.userId})`,
    })
        .from(casinoBets)
        .where(and(eq(casinoBets.tenant, tenant), eq(casinoBets.whitelabelId, whitelabelId), eq(casinoBets.currency, currency), eq(casinoBets.walletType, 'cash'), gte(casinoBets.createdAt, startOfDay), lte(casinoBets.createdAt, endOfDay), inArray(casinoBets.status, ['won', 'lost'])));
    // Open-only: exposure from pending/active (cash only)
    const exposureAggregate = await db
        .select({
        totalExposure: sql<number>`COALESCE(SUM(${casinoBets.stake}), 0)`,
    })
        .from(casinoBets)
        .where(and(eq(casinoBets.tenant, tenant), eq(casinoBets.whitelabelId, whitelabelId), eq(casinoBets.currency, currency), eq(casinoBets.walletType, 'cash'), gte(casinoBets.createdAt, startOfDay), lte(casinoBets.createdAt, endOfDay), inArray(casinoBets.status, ['pending', 'active'])));
    const rev = betsAggregate[0];
    const exp = exposureAggregate[0];
    const agg = {
        totalStakes: rev?.totalStakes ?? 0,
        totalPayouts: rev?.totalPayouts ?? 0,
        totalExposure: exp?.totalExposure ?? 0,
        betCount: rev?.betCount ?? 0,
        playerCount: rev?.playerCount ?? 0,
    };
    const totalStakes = Number(agg.totalStakes) || 0;
    const totalPayouts = Number(agg.totalPayouts) || 0;
    const totalExposure = Number(agg.totalExposure) || 0;
    const ggr = totalStakes - totalPayouts;
    const holdPercentage = totalStakes > 0 ? ggr / totalStakes : 0;
    // Insert or update overall snapshot (all dimension fields are NULL for overall)
    try {
        await db
            .insert(reportingDailySnapshots)
            .values({
            metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
            tenant,
            whitelabelId,
            snapshotDate: startOfDay,
            domain: 'casino',
            sportId: null, // NULL for overall snapshot
            leagueId: null,
            eventId: null,
            agentId: null,
            campaignId: null,
            playerId: null,
            totalStakes: totalStakes.toString(),
            totalPayouts: totalPayouts.toString(),
            totalExposure: totalExposure.toString(),
            totalLiquidity: '0', // Would need market data for this
            grossGamingRevenue: ggr.toString(),
            netRevenue: ggr.toString(),
            holdPercentage: holdPercentage.toString(),
            betCount: Number(agg.betCount) || 0,
            playerCount: Number(agg.playerCount) || 0,
            activePlayerCount: Number(agg.playerCount) || 0,
            currency,
        })
            .onConflictDoUpdate({
            target: [
                reportingDailySnapshots.tenant,
                reportingDailySnapshots.whitelabelId,
                reportingDailySnapshots.snapshotDate,
                reportingDailySnapshots.domain,
                reportingDailySnapshots.sportId,
                reportingDailySnapshots.leagueId,
                reportingDailySnapshots.eventId,
                reportingDailySnapshots.agentId,
                reportingDailySnapshots.campaignId,
                reportingDailySnapshots.playerId,
            ],
            set: {
                metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
                totalStakes: totalStakes.toString(),
                totalPayouts: totalPayouts.toString(),
                totalExposure: totalExposure.toString(),
                grossGamingRevenue: ggr.toString(),
                netRevenue: ggr.toString(),
                holdPercentage: holdPercentage.toString(),
                betCount: Number(agg.betCount) || 0,
                playerCount: Number(agg.playerCount) || 0,
                activePlayerCount: Number(agg.playerCount) || 0,
            },
        });
    }
    catch (error) {
        throw error;
    }
    // Generate player-level snapshots
    await generatePlayerLevelSnapshots(tenant, whitelabelId, startOfDay, endOfDay, currency, 'casino');
    // Generate agent-level snapshots
    await generateAgentLevelSnapshots(tenant, whitelabelId, startOfDay, endOfDay, currency, 'casino');
    return { success: true, domain: 'casino' };
}
/**
 * Generate matka snapshot
 */
async function generateMatkaSnapshot(tenant: string, whitelabelId: string, startOfDay: Date, endOfDay: Date, currency: string) {
    // Settled-only: revenue metrics from won/lost (matka has no 'settled' enum)
    const betsAggregate = await db
        .select({
        totalStakes: sql<number>`COALESCE(SUM(${matkaBets.betAmount}), 0)`,
        totalPayouts: sql<number>`COALESCE(SUM(CASE WHEN ${matkaBets.status} = 'won' THEN ${matkaBets.actualWin}::numeric ELSE 0 END), 0)`,
        betCount: sql<number>`COUNT(*)`,
        playerCount: sql<number>`COUNT(DISTINCT ${matkaBets.userId})`,
    })
        .from(matkaBets)
        .where(and(eq(matkaBets.tenant, tenant), eq(matkaBets.whitelabelId, whitelabelId), eq(matkaBets.currency, currency), gte(matkaBets.createdAt, startOfDay), lte(matkaBets.createdAt, endOfDay), inArray(matkaBets.status, ['won', 'lost'])));
    // Open-only: exposure from pending/active
    const exposureAggregate = await db
        .select({
        totalExposure: sql<number>`COALESCE(SUM(${matkaBets.potentialWin}::numeric), 0)`,
    })
        .from(matkaBets)
        .where(and(eq(matkaBets.tenant, tenant), eq(matkaBets.whitelabelId, whitelabelId), eq(matkaBets.currency, currency), gte(matkaBets.createdAt, startOfDay), lte(matkaBets.createdAt, endOfDay), inArray(matkaBets.status, ['pending', 'active'])));
    const rev = betsAggregate[0];
    const exp = exposureAggregate[0];
    const agg = {
        totalStakes: rev?.totalStakes ?? 0,
        totalPayouts: rev?.totalPayouts ?? 0,
        totalExposure: exp?.totalExposure ?? 0,
        betCount: rev?.betCount ?? 0,
        playerCount: rev?.playerCount ?? 0,
    };
    const totalStakes = Number(agg.totalStakes) || 0;
    const totalPayouts = Number(agg.totalPayouts) || 0;
    const totalExposure = Number(agg.totalExposure) || 0;
    const ggr = totalStakes - totalPayouts;
    const holdPercentage = totalStakes > 0 ? ggr / totalStakes : 0;
    // Insert or update overall snapshot
    await db
        .insert(reportingDailySnapshots)
        .values({
            metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
        tenant,
        whitelabelId,
        snapshotDate: startOfDay,
        domain: 'matka',
        totalStakes: totalStakes.toString(),
        totalPayouts: totalPayouts.toString(),
        totalExposure: totalExposure.toString(),
        grossGamingRevenue: ggr.toString(),
        netRevenue: ggr.toString(),
        holdPercentage: holdPercentage.toString(),
        betCount: Number(agg.betCount) || 0,
        playerCount: Number(agg.playerCount) || 0,
        activePlayerCount: Number(agg.playerCount) || 0,
        currency,
    })
        .onConflictDoUpdate({
        target: [
            reportingDailySnapshots.tenant,
            reportingDailySnapshots.whitelabelId,
            reportingDailySnapshots.snapshotDate,
            reportingDailySnapshots.domain,
            reportingDailySnapshots.sportId,
            reportingDailySnapshots.leagueId,
            reportingDailySnapshots.eventId,
            reportingDailySnapshots.agentId,
            reportingDailySnapshots.campaignId,
            reportingDailySnapshots.playerId,
        ],
        set: {
                metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
            totalStakes: totalStakes.toString(),
            totalPayouts: totalPayouts.toString(),
            totalExposure: totalExposure.toString(),
            grossGamingRevenue: ggr.toString(),
            netRevenue: ggr.toString(),
            holdPercentage: holdPercentage.toString(),
            betCount: Number(agg.betCount) || 0,
            playerCount: Number(agg.playerCount) || 0,
            activePlayerCount: Number(agg.playerCount) || 0,
        },
    });
    // Generate agent-level snapshots
    await generateAgentLevelSnapshots(tenant, whitelabelId, startOfDay, endOfDay, currency, 'matka');
    return { success: true, domain: 'matka' };
}
/**
 * Generate agents snapshot
 */
async function generateAgentsSnapshot(tenant: string, whitelabelId: string, startOfDay: Date, endOfDay: Date, currency: string) {
    // Aggregate agent ledger entries (joined with agents to filter by tenant, avoiding cross-tenant data mixing)
    const ledgerAggregate = await db
        .select({
        totalCommission: sql<number>`COALESCE(SUM(CASE WHEN ${agentLedger.lineType} = 'COMMISSION' THEN ${agentLedger.amount} ELSE 0 END), 0)`,
        totalShare: sql<number>`COALESCE(SUM(CASE WHEN ${agentLedger.lineType} = 'SHARE' THEN ${agentLedger.amount} ELSE 0 END), 0)`,
        agentCount: sql<number>`COUNT(DISTINCT ${agentLedger.agentId})`,
    })
        .from(agentLedger)
        .innerJoin(agents, eq(agents.id, agentLedger.agentId))
        .where(and(eq(agents.tenantId, tenant), eq(agentLedger.currency, currency), gte(agentLedger.createdAt, startOfDay), lte(agentLedger.createdAt, endOfDay)));
    const agg = ledgerAggregate[0] || {
        totalCommission: 0,
        totalShare: 0,
        agentCount: 0,
    };
    await db
        .insert(reportingDailySnapshots)
        .values({
            metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
        tenant,
        whitelabelId,
        snapshotDate: startOfDay,
        domain: 'agents',
        agentCommission: Number(agg.totalCommission).toString(),
        agentShare: Number(agg.totalShare).toString(),
        currency,
    })
        .onConflictDoUpdate({
        target: [
            reportingDailySnapshots.tenant,
            reportingDailySnapshots.whitelabelId,
            reportingDailySnapshots.snapshotDate,
            reportingDailySnapshots.domain,
            reportingDailySnapshots.sportId,
            reportingDailySnapshots.leagueId,
            reportingDailySnapshots.eventId,
            reportingDailySnapshots.agentId,
            reportingDailySnapshots.campaignId,
            reportingDailySnapshots.playerId,
        ],
        set: {
                metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
            agentCommission: Number(agg.totalCommission).toString(),
            agentShare: Number(agg.totalShare).toString(),
        },
    });
    return { success: true, domain: 'agents' };
}
/**
 * Generate bonuses snapshot
 */
async function generateBonusesSnapshot(tenant: string, whitelabelId: string, startOfDay: Date, endOfDay: Date, currency: string) {
    // Aggregate bonus awards for this tenant only (via campaign)
    const bonusAggregate = await db
        .select({
        totalIssued: sql<number>`COALESCE(SUM(CASE WHEN ${bonusAwards.status} IN ('pending', 'active') THEN ${bonusAwards.amount} ELSE 0 END), 0)`,
        totalRedeemed: sql<number>`COALESCE(SUM(CASE WHEN ${bonusAwards.status} = 'completed' THEN ${bonusAwards.amount} ELSE 0 END), 0)`,
        totalExpired: sql<number>`COALESCE(SUM(CASE WHEN ${bonusAwards.status} = 'expired' THEN ${bonusAwards.amount} ELSE 0 END), 0)`,
        awardCount: sql<number>`COUNT(*)`,
        playerCount: sql<number>`COUNT(DISTINCT ${bonusAwards.userId})`,
    })
        .from(bonusAwards)
        .innerJoin(bonusCampaigns, eq(bonusCampaigns.id, bonusAwards.campaignId))
        .where(and(eq(bonusCampaigns.tenant, tenant), eq(bonusAwards.currency, currency), gte(bonusAwards.awardedAt, startOfDay), lte(bonusAwards.awardedAt, endOfDay)));
    const agg = bonusAggregate[0] || {
        totalIssued: 0,
        totalRedeemed: 0,
        totalExpired: 0,
        awardCount: 0,
        playerCount: 0,
    };
    const totalIssued = Number(agg.totalIssued) || 0;
    const totalRedeemed = Number(agg.totalRedeemed) || 0;
    const totalExpired = Number(agg.totalExpired) || 0;
    const outstandingLiability = Math.max(0, totalIssued - totalRedeemed - totalExpired);
    await db
        .insert(reportingDailySnapshots)
        .values({
            metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
        tenant,
        whitelabelId,
        snapshotDate: startOfDay,
        domain: 'bonuses',
        bonusIssued: totalIssued.toString(),
        bonusRedeemed: totalRedeemed.toString(),
        bonusLiability: outstandingLiability.toString(),
        currency,
        betCount: Number(agg.awardCount) || 0,
        playerCount: Number(agg.playerCount) || 0,
    })
        .onConflictDoUpdate({
        target: [
            reportingDailySnapshots.tenant,
            reportingDailySnapshots.whitelabelId,
            reportingDailySnapshots.snapshotDate,
            reportingDailySnapshots.domain,
            reportingDailySnapshots.sportId,
            reportingDailySnapshots.leagueId,
            reportingDailySnapshots.eventId,
            reportingDailySnapshots.agentId,
            reportingDailySnapshots.campaignId,
            reportingDailySnapshots.playerId,
        ],
        set: {
                metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
            bonusIssued: totalIssued.toString(),
            bonusRedeemed: totalRedeemed.toString(),
            bonusLiability: outstandingLiability.toString(),
            betCount: Number(agg.awardCount) || 0,
            playerCount: Number(agg.playerCount) || 0,
        },
    });
    return { success: true, domain: 'bonuses' };
}
/**
 * Generate global snapshot (aggregates all domains)
 */
async function generateGlobalSnapshot(tenant: string, whitelabelId: string, startOfDay: Date, endOfDay: Date, currency: string) {
    // Aggregate all domains
    const [sports, casino, matka, agents, bonuses] = await Promise.all([
        generateSportsSnapshot(tenant, whitelabelId, startOfDay, endOfDay, currency),
        generateCasinoSnapshot(tenant, whitelabelId, startOfDay, endOfDay, currency),
        generateMatkaSnapshot(tenant, whitelabelId, startOfDay, endOfDay, currency),
        generateAgentsSnapshot(tenant, whitelabelId, startOfDay, endOfDay, currency),
        generateBonusesSnapshot(tenant, whitelabelId, startOfDay, endOfDay, currency),
    ]);
    // Sum only overall rows (all dimension NULL) for sports/casino/matka to avoid double-counting drill-down rows
    const globalSnapshot = await db
        .select({
        totalStakes: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalStakes}::numeric), 0)`,
        totalPayouts: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalPayouts}::numeric), 0)`,
        totalGGR: sql<number>`COALESCE(SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric), 0)`,
        totalBetCount: sql<number>`COALESCE(SUM(${reportingDailySnapshots.betCount}), 0)`,
        totalPlayerCount: sql<number>`COALESCE(MAX(${reportingDailySnapshots.playerCount}), 0)`,
    })
        .from(reportingDailySnapshots)
        .where(and(eq(reportingDailySnapshots.tenant, tenant), eq(reportingDailySnapshots.whitelabelId, whitelabelId), eq(reportingDailySnapshots.snapshotDate, startOfDay), eq(reportingDailySnapshots.currency, currency), inArray(reportingDailySnapshots.domain, ['sports', 'casino', 'matka']), isNull(reportingDailySnapshots.sportId), isNull(reportingDailySnapshots.leagueId), isNull(reportingDailySnapshots.eventId), isNull(reportingDailySnapshots.agentId), isNull(reportingDailySnapshots.campaignId), isNull(reportingDailySnapshots.playerId)));
    const global = globalSnapshot[0] || {
        totalStakes: 0,
        totalPayouts: 0,
        totalGGR: 0,
        totalBetCount: 0,
        totalPlayerCount: 0,
    };
    await db
        .insert(reportingDailySnapshots)
        .values({
            metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
        tenant,
        whitelabelId,
        snapshotDate: startOfDay,
        domain: 'global',
        totalStakes: Number(global.totalStakes).toString(),
        totalPayouts: Number(global.totalPayouts).toString(),
        grossGamingRevenue: Number(global.totalGGR).toString(),
        netRevenue: Number(global.totalGGR).toString(),
        betCount: Number(global.totalBetCount) || 0,
        playerCount: Number(global.totalPlayerCount) || 0,
        currency,
    })
        .onConflictDoUpdate({
        target: [
            reportingDailySnapshots.tenant,
            reportingDailySnapshots.whitelabelId,
            reportingDailySnapshots.snapshotDate,
            reportingDailySnapshots.domain,
            reportingDailySnapshots.sportId,
            reportingDailySnapshots.leagueId,
            reportingDailySnapshots.eventId,
            reportingDailySnapshots.agentId,
            reportingDailySnapshots.campaignId,
            reportingDailySnapshots.playerId,
        ],
        set: {
                metadata: { financialCalculationVersion: FINANCIAL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString() },
            totalStakes: Number(global.totalStakes).toString(),
            totalPayouts: Number(global.totalPayouts).toString(),
            grossGamingRevenue: Number(global.totalGGR).toString(),
            netRevenue: Number(global.totalGGR).toString(),
            betCount: Number(global.totalBetCount) || 0,
            playerCount: Number(global.totalPlayerCount) || 0,
        },
    });
    return { success: true, domain: 'global' };
}
/**
 * Delete all snapshot rows for a given tenant, whitelabel, date and domain.
 * Used after result rollback so that the next report read uses live data or regenerated snapshots.
 */
export async function deleteSnapshotsForDate(tenant: string, whitelabelId: string, date: Date, domain: SnapshotDomain) {
    const tz = await getWhitelabelTimezone(tenant);
    const startOfDay = getStartOfDayForDate(date, tz);
    const deletedRows = await db
        .delete(reportingDailySnapshots)
        .where(and(eq(reportingDailySnapshots.tenant, tenant), eq(reportingDailySnapshots.whitelabelId, whitelabelId), eq(reportingDailySnapshots.snapshotDate, startOfDay), eq(reportingDailySnapshots.domain, domain)))
        .returning({ id: reportingDailySnapshots.id });
    const rowCount = deletedRows.length;
    if (rowCount > 0) {
    }
    return rowCount;
}
/**
 * After a result rollback: delete existing snapshots for that date+domain and regenerate the full day via 'global'.
 * Regenerating 'global' recreates all sub-domains (sports, casino, matka, agents, bonuses) and the global aggregate,
 * so the global snapshot and all domain rows stay consistent after a rollback.
 */
export async function regenerateSnapshotsForDateAfterRollback(
  tenant: string,
  whitelabelId: string,
  date: Date,
  domain: SnapshotDomain,
  currency?: string,
) {
    const deleted = await deleteSnapshotsForDate(tenant, whitelabelId, date, domain);
    // Also delete 'global' aggregate row so the existence check in generateDailySnapshot
    // does not skip regeneration when the nightly snapshot ran recently.
    await deleteSnapshotsForDate(tenant, whitelabelId, date, 'global');
    const resolvedCurrency = currency ?? (await getWhitelabelCurrency(whitelabelId));
    try {
        const result = await generateDailySnapshot({
            tenant,
            whitelabelId,
            date: new Date(date),
            domain: 'global',
            currency: resolvedCurrency,
        });
        return { deleted, generated: result.success && !('skipped' in result && result.skipped) };
    }
    catch (err) {
        return { deleted, generated: false };
    }
}
/**
 * Acquire a PostgreSQL advisory lock for (tenant, whitelabel, date) so only one process
 * generates snapshots for that date at a time. Prevents duplicate inserts when manual
 * trigger runs in parallel or when Redis is down (per-domain lock may be skipped).
 */
async function tryAdvisoryLockForDate(tenant: string, whitelabelId: string, dateStr: string) {
    try {
        const key = `snapshot:${tenant}:${whitelabelId}:${dateStr}`;
        const r = await pool.query('SELECT pg_try_advisory_lock(hashtext($1)) as pg_try_advisory_lock', [key]);
        return r.rows[0]?.pg_try_advisory_lock ?? false;
    }
    catch {
        return true; // fail open: allow generation if advisory lock errors
    }
}
/**
 * Release the advisory lock for (tenant, whitelabel, date).
 */
async function releaseAdvisoryLockForDate(tenant: string, whitelabelId: string, dateStr: string) {
    try {
        const key = `snapshot:${tenant}:${whitelabelId}:${dateStr}`;
        await pool.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
    }
    catch {
        // ignore release errors
    }
}
/**
 * Generate snapshots for a date range
 */
export async function generateSnapshotsForRange(tenant: string, whitelabelId: string, startDate: Date, endDate: Date, domains: SnapshotDomain[] = [
    'sports',
    'casino',
    'matka',
    'agents',
    'bonuses',
    'global',
], currency: string = 'USD') {
    const results = [];
    const tz = await getWhitelabelTimezone(tenant);
    const start = DateTime.fromJSDate(startDate, { zone: tz }).startOf('day');
    const end = DateTime.fromJSDate(endDate, { zone: tz }).endOf('day');
    for (let d = start; d <= end; d = d.plus({ days: 1 })) {
        const dateStr = d.toFormat('yyyy-MM-dd');
        const currentDate = d.toJSDate();
        const acquired = await tryAdvisoryLockForDate(tenant, whitelabelId, dateStr);
        if (!acquired) {
            results.push({
                success: false,
                skipped: true,
                reason: 'advisory_lock_not_acquired',
                date: dateStr,
            });
            continue;
        }
        try {
            for (const domain of domains) {
                const result = await generateDailySnapshot({
                    tenant,
                    whitelabelId,
                    date: currentDate,
                    domain,
                    currency,
                });
                results.push(result);
            }
        }
        finally {
            await releaseAdvisoryLockForDate(tenant, whitelabelId, dateStr);
        }
    }
    return results;
}
