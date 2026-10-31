/**
 * Database Verification Script for Reporting Snapshots
 * 
 * This script checks if reporting snapshots are being generated properly
 * and provides diagnostic information about snapshot generation.
 */

import 'dotenv/config';
import { db } from '../src/db/client.js';
import { reportingDailySnapshots, sportsBets, users } from '@shared/db/schema.js';
import { eq, and, gte, lte, sql, isNotNull, count } from 'drizzle-orm';

interface SnapshotVerificationResult {
  hasSnapshots: boolean;
  snapshotCount: number;
  dateRange: { oldest: Date | null; newest: Date | null };
  byDomain: Record<string, number>;
  byWhitelabel: Record<string, number>;
  agentLevelSnapshots: number;
  playerLevelSnapshots: number;
  overallSnapshots: number;
  recentBets: {
    count: number;
    dateRange: { oldest: Date | null; newest: Date | null };
    whitelabels: string[];
  };
  missingSnapshots: Array<{
    whitelabelId: string;
    date: Date;
    betCount: number;
  }>;
}

/**
 * Verify snapshots for a specific whitelabel (optional)
 */
export async function verifySnapshots(whitelabelId?: string): Promise<SnapshotVerificationResult> {
  console.log('\n=== Reporting Snapshot Verification ===\n');
  
  // Check if any snapshots exist
  const snapshotConditions = [];
  if (whitelabelId) {
    snapshotConditions.push(eq(reportingDailySnapshots.whitelabelId, whitelabelId));
  }
  
  const totalSnapshots = await db
    .select({ count: count() })
    .from(reportingDailySnapshots)
    .where(snapshotConditions.length > 0 ? and(...snapshotConditions) : undefined);
  
  const snapshotCount = totalSnapshots[0]?.count || 0;
  const hasSnapshots = snapshotCount > 0;
  
  console.log(`Total snapshots: ${snapshotCount}`);
  
  if (!hasSnapshots) {
    console.log('⚠️  No snapshots found in database!');
  }
  
  // Get date range
  const dateRange = await db
    .select({
      oldest: sql<Date>`MIN(${reportingDailySnapshots.snapshotDate})`,
      newest: sql<Date>`MAX(${reportingDailySnapshots.snapshotDate})`,
    })
    .from(reportingDailySnapshots)
    .where(snapshotConditions.length > 0 ? and(...snapshotConditions) : undefined);
  
  // Get snapshots by domain
  const byDomain = await db
    .select({
      domain: reportingDailySnapshots.domain,
      count: count(),
    })
    .from(reportingDailySnapshots)
    .where(snapshotConditions.length > 0 ? and(...snapshotConditions) : undefined)
    .groupBy(reportingDailySnapshots.domain);
  
  const domainMap: Record<string, number> = {};
  byDomain.forEach((row) => {
    domainMap[row.domain] = row.count;
  });
  
  // Get snapshots by whitelabel
  const byWhitelabel = await db
    .select({
      whitelabelId: reportingDailySnapshots.whitelabelId,
      count: count(),
    })
    .from(reportingDailySnapshots)
    .groupBy(reportingDailySnapshots.whitelabelId);
  
  const whitelabelMap: Record<string, number> = {};
  byWhitelabel.forEach((row) => {
    whitelabelMap[row.whitelabelId] = row.count;
  });
  
  // Count agent-level snapshots
  const agentLevelCount = await db
    .select({ count: count() })
    .from(reportingDailySnapshots)
    .where(
      and(
        isNotNull(reportingDailySnapshots.agentId),
        ...snapshotConditions,
      ),
    );
  
  // Count player-level snapshots
  const playerLevelCount = await db
    .select({ count: count() })
    .from(reportingDailySnapshots)
    .where(
      and(
        isNotNull(reportingDailySnapshots.playerId),
        ...snapshotConditions,
      ),
    );
  
  // Count overall snapshots (no agentId, no playerId)
  const overallCount = await db
    .select({ count: count() })
    .from(reportingDailySnapshots)
    .where(
      and(
        sql`${reportingDailySnapshots.agentId} IS NULL`,
        sql`${reportingDailySnapshots.playerId} IS NULL`,
        ...snapshotConditions,
      ),
    );
  
  // Check recent bets
  const betConditions = [];
  if (whitelabelId) {
    betConditions.push(eq(sportsBets.whitelabelId, whitelabelId));
  }
  
  const recentBetsData = await db
    .select({
      count: count(),
      oldest: sql<Date>`MIN(${sportsBets.createdAt})`,
      newest: sql<Date>`MAX(${sportsBets.createdAt})`,
    })
    .from(sportsBets)
    .where(betConditions.length > 0 ? and(...betConditions) : undefined);
  
  const whitelabelsInBets = await db
    .selectDistinct({
      whitelabelId: sportsBets.whitelabelId,
    })
    .from(sportsBets);
  
  // Find missing snapshots (dates with bets but no snapshots)
  const missingSnapshots: Array<{ whitelabelId: string; date: Date; betCount: number }> = [];
  
  if (whitelabelId) {
    // Get dates with bets for this whitelabel
    const betDates = await db
      .select({
        date: sql<Date>`DATE(${sportsBets.createdAt})`,
        betCount: count(),
      })
      .from(sportsBets)
      .where(eq(sportsBets.whitelabelId, whitelabelId))
      .groupBy(sql`DATE(${sportsBets.createdAt})`);
    
    // Check which dates don't have snapshots
    for (const betDate of betDates) {
      const snapshotExists = await db
        .select({ count: count() })
        .from(reportingDailySnapshots)
        .where(
          and(
            eq(reportingDailySnapshots.whitelabelId, whitelabelId),
            sql`DATE(${reportingDailySnapshots.snapshotDate}) = DATE(${betDate.date})`,
            eq(reportingDailySnapshots.domain, 'sports'),
          ),
        );
      
      if (snapshotExists[0]?.count === 0) {
        missingSnapshots.push({
          whitelabelId,
          date: betDate.date as Date,
          betCount: betDate.betCount,
        });
      }
    }
  }
  
  const result: SnapshotVerificationResult = {
    hasSnapshots,
    snapshotCount,
    dateRange: {
      oldest: dateRange[0]?.oldest || null,
      newest: dateRange[0]?.newest || null,
    },
    byDomain: domainMap,
    byWhitelabel: whitelabelMap,
    agentLevelSnapshots: agentLevelCount[0]?.count || 0,
    playerLevelSnapshots: playerLevelCount[0]?.count || 0,
    overallSnapshots: overallCount[0]?.count || 0,
    recentBets: {
      count: recentBetsData[0]?.count || 0,
      dateRange: {
        oldest: recentBetsData[0]?.oldest || null,
        newest: recentBetsData[0]?.newest || null,
      },
      whitelabels: whitelabelsInBets.map((w) => w.whitelabelId || 'unknown'),
    },
    missingSnapshots,
  };
  
  // Print results
  console.log('\n--- Snapshot Statistics ---');
  const oldestSnapshotDate = result.dateRange.oldest;
  const newestSnapshotDate = result.dateRange.newest;
  const oldestStr = oldestSnapshotDate ? (oldestSnapshotDate instanceof Date ? oldestSnapshotDate.toISOString() : new Date(oldestSnapshotDate).toISOString()) : 'N/A';
  const newestStr = newestSnapshotDate ? (newestSnapshotDate instanceof Date ? newestSnapshotDate.toISOString() : new Date(newestSnapshotDate).toISOString()) : 'N/A';
  console.log(`Date Range: ${oldestStr} to ${newestStr}`);
  console.log(`\nBy Domain:`);
  Object.entries(result.byDomain).forEach(([domain, count]) => {
    console.log(`  ${domain}: ${count}`);
  });
  console.log(`\nBy Whitelabel:`);
  Object.entries(result.byWhitelabel).forEach(([wl, count]) => {
    console.log(`  ${wl}: ${count}`);
  });
  console.log(`\nSnapshot Types:`);
  console.log(`  Overall: ${result.overallSnapshots}`);
  console.log(`  Agent-level: ${result.agentLevelSnapshots}`);
  console.log(`  Player-level: ${result.playerLevelSnapshots}`);
  
  console.log(`\n--- Recent Bets ---`);
  console.log(`Total bets: ${result.recentBets.count}`);
  const oldestBetDate = result.recentBets.dateRange.oldest;
  const newestBetDate = result.recentBets.dateRange.newest;
  const oldestBetStr = oldestBetDate ? (oldestBetDate instanceof Date ? oldestBetDate.toISOString() : new Date(oldestBetDate).toISOString()) : 'N/A';
  const newestBetStr = newestBetDate ? (newestBetDate instanceof Date ? newestBetDate.toISOString() : new Date(newestBetDate).toISOString()) : 'N/A';
  console.log(`Date Range: ${oldestBetStr} to ${newestBetStr}`);
  console.log(`Whitelabels with bets: ${result.recentBets.whitelabels.join(', ')}`);
  
  if (result.missingSnapshots.length > 0) {
    console.log(`\n⚠️  Missing Snapshots (dates with bets but no snapshots):`);
    const { DateTime } = await import('luxon');
    const IST = 'Asia/Kolkata';
    result.missingSnapshots.forEach((missing) => {
      const d = missing.date instanceof Date ? missing.date : new Date(missing.date);
      const dateStr = DateTime.fromJSDate(d, { zone: IST }).toFormat('yyyy-MM-dd');
      console.log(`  - ${missing.whitelabelId} on ${dateStr} (${missing.betCount} bets)`);
    });
  } else if (result.recentBets.count > 0) {
    console.log(`\n✅ All dates with bets have snapshots`);
  }
  
  console.log('\n=== Verification Complete ===\n');
  
  return result;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const whitelabelId = process.argv[2];
  verifySnapshots(whitelabelId)
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('Verification failed:', error);
      process.exit(1);
    });
}
