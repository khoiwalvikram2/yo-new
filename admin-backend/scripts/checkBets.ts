/**
 * Check Sports Bets Data
 * 
 * This script checks the actual bet data to understand why snapshots are showing 0 values.
 */

import 'dotenv/config';
import { db } from '../src/db/client.js';
import { sportsBets } from '@shared/db/schema.js';
import { sql } from 'drizzle-orm';

async function checkBets() {
  await db
    .select({
      id: sportsBets.id,
      tenant: sportsBets.tenant,
      whitelabelId: sportsBets.whitelabelId,
      currency: sportsBets.currency,
      stake: sportsBets.stake,
      createdAt: sportsBets.createdAt,
      status: sportsBets.status,
    })
    .from(sportsBets)
    .limit(10);

  await db
    .select({
      totalBets: sql<number>`COUNT(*)`,
      uniqueTenants: sql<number>`COUNT(DISTINCT ${sportsBets.tenant})`,
      uniqueWhitelabels: sql<number>`COUNT(DISTINCT ${sportsBets.whitelabelId})`,
      uniqueCurrencies: sql<number>`COUNT(DISTINCT ${sportsBets.currency})`,
      dateRange: sql<string>`MIN(${sportsBets.createdAt})::text || ' to ' || MAX(${sportsBets.createdAt})::text`,
    })
    .from(sportsBets);

  await db
    .select({
      whitelabelId: sportsBets.whitelabelId,
      count: sql<number>`COUNT(*)`,
      currencies: sql<string>`STRING_AGG(DISTINCT ${sportsBets.currency}, ', ')`,
    })
    .from(sportsBets)
    .groupBy(sportsBets.whitelabelId);
}

checkBets().catch((error) => {
  process.stderr.write(`Failed to check bets: ${error}\n`);
  process.exit(1);
});
