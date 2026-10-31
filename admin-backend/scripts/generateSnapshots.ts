/**
 * Manual Snapshot Generation Script
 *
 * This script manually generates reporting snapshots for a date range.
 * Use this when automatic snapshot generation fails or for backfilling historical data.
 *
 * Default domain is 'global': it generates all sub-domains (sports, casino, matka, agents, bonuses)
 * and the global aggregate in one pass. Use --domains only when you need a single domain (e.g. sports).
 *
 * Supports --all-tenants to auto-discover every tenant/whitelabel/currency combo from bets.
 */

import 'dotenv/config';
import { DateTime } from 'luxon';
import { generateSnapshotsForRange } from '../src/services/reportingSnapshotService.js';
import { db } from '../src/db/client.js';
import { sportsBets, casinoBets, matkaBets } from '@shared/db/schema.js';
import { sql } from 'drizzle-orm';

type Domain = 'sports' | 'casino' | 'matka' | 'agents' | 'bonuses' | 'global';

interface GenerateSnapshotsOptions {
  tenant?: string;
  whitelabelId?: string;
  dateFrom: string;
  dateTo: string;
  domains?: Domain[];
  currency?: string;
}

async function getAllActiveCombinations(): Promise<
  Array<{ tenant: string; whitelabelId: string; currency: string }>
> {
  const uniqueMap = new Map<string, { tenant: string; whitelabelId: string; currency: string }>();

  const addCombos = (
    combos: Array<{ tenant: string | null; whitelabelId: string | null; currency: string | null }>,
  ) => {
    for (const combo of combos) {
      if (!combo.tenant || !combo.whitelabelId) continue;
      const currency = combo.currency || 'USD';
      const key = `${combo.tenant}:${combo.whitelabelId}:${currency}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, { tenant: combo.tenant, whitelabelId: combo.whitelabelId, currency });
      }
    }
  };

  try {
    const sportsCombos = await db
      .selectDistinct({ tenant: sportsBets.tenant, whitelabelId: sportsBets.whitelabelId, currency: sportsBets.currency })
      .from(sportsBets)
      .where(sql`${sportsBets.currency} IS NOT NULL`);
    addCombos(sportsCombos);
  } catch (e) {
    console.error('[discover] sportsBets query failed:', e instanceof Error ? e.message : String(e));
  }

  try {
    const casinoCombos = await db
      .selectDistinct({ tenant: casinoBets.tenant, whitelabelId: casinoBets.whitelabelId, currency: casinoBets.currency })
      .from(casinoBets);
    addCombos(casinoCombos);
  } catch (e) {
    console.error('[discover] casinoBets query failed:', e instanceof Error ? e.message : String(e));
  }

  try {
    const matkaCombos = await db
      .selectDistinct({ tenant: matkaBets.tenant, whitelabelId: matkaBets.whitelabelId, currency: matkaBets.currency })
      .from(matkaBets);
    addCombos(matkaCombos);
  } catch (e) {
    console.error('[discover] matkaBets query failed:', e instanceof Error ? e.message : String(e));
  }

  return Array.from(uniqueMap.values());
}

async function generateSnapshots(options: GenerateSnapshotsOptions) {
  const {
    tenant = 'example-com',
    whitelabelId = 'example-com',
    dateFrom,
    dateTo,
    domains = ['global'],
    currency = 'INR',
  } = options;

  console.log('\n=== Manual Snapshot Generation ===\n');
  console.log(`Tenant: ${tenant}`);
  console.log(`Whitelabel: ${whitelabelId}`);
  console.log(`Currency: ${currency}`);
  console.log(`Date Range: ${dateFrom} to ${dateTo}`);
  console.log(`Domains: ${domains.join(', ')}`);
  console.log('\nStarting snapshot generation...\n');

  const startDate = DateTime.fromISO(dateFrom, { zone: 'Asia/Kolkata' }).startOf('day').toJSDate();
  const endDate = DateTime.fromISO(dateTo, { zone: 'Asia/Kolkata' }).endOf('day').toJSDate();

  if (isNaN(startDate.getTime())) throw new Error(`Invalid dateFrom: ${dateFrom}`);
  if (isNaN(endDate.getTime())) throw new Error(`Invalid dateTo: ${dateTo}`);
  if (startDate > endDate) throw new Error('dateFrom must be before or equal to dateTo');

  await generateSnapshotsForRange(tenant, whitelabelId, startDate, endDate, domains, currency);

  console.log('\n✅ Snapshot generation completed successfully!');
}

async function generateForAllTenants(dateFrom: string, dateTo: string, domains: Domain[]) {
  console.log('\n=== All-Tenant Snapshot Generation ===');
  console.log(`Date Range: ${dateFrom} to ${dateTo}`);
  console.log(`Domains: ${domains.join(', ')}`);
  console.log('\nDiscovering tenant/whitelabel/currency combinations...\n');

  const combos = await getAllActiveCombinations();
  if (combos.length === 0) {
    console.log('No active tenant combinations found in bet tables. Nothing to do.');
    process.exit(0);
  }

  console.log(`Found ${combos.length} combination(s):`);
  for (const c of combos) {
    console.log(`  • ${c.tenant} / ${c.whitelabelId} / ${c.currency}`);
  }
  console.log('');

  let succeeded = 0;
  let failed = 0;

  for (const combo of combos) {
    try {
      await generateSnapshots({
        tenant: combo.tenant,
        whitelabelId: combo.whitelabelId,
        dateFrom,
        dateTo,
        domains,
        currency: combo.currency,
      });
      succeeded++;
    } catch (error) {
      failed++;
      console.error(
        `\n❌ Failed for ${combo.tenant}/${combo.whitelabelId}/${combo.currency}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  console.log(`\n=== All-Tenant Generation Complete ===`);
  console.log(`  Succeeded: ${succeeded}  |  Failed: ${failed}  |  Total: ${combos.length}\n`);

  if (failed > 0) process.exit(1);
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('No arguments provided. Using default values. Use --help for usage.\n');
  generateSnapshots({
    tenant: 'example-com',
    whitelabelId: 'example-com',
    dateFrom: '2026-01-01',
    dateTo: '2026-03-05',
    domains: ['global'],
    currency: 'INR',
  }).catch((error) => {
    console.error('Failed to generate snapshots:', error);
    process.exit(1);
  });
} else if (args[0] === '--help' || args[0] === '-h') {
  console.log(`
Usage: npm run generate:snapshots [options]

Options:
  --tenant <tenant>           Tenant ID (default: default)
  --whitelabel <id>           Whitelabel ID (default: example-com)
  --from <date>               Start date (YYYY-MM-DD or ISO string)
  --to <date>                 End date (YYYY-MM-DD or ISO string)
  --domains <list>            Comma-separated: global (default, generates all), or sports,casino,matka,agents,bonuses
  --currency <code>           Currency code (default: INR)
  --all-tenants               Auto-discover all tenant/whitelabel/currency combos from bets
  --help, -h                  Show this help message

Examples:
  # Full snapshot for date range (default: global = all sub-domains + aggregate)
  npm run generate:snapshots -- --from 2026-01-24 --to 2026-01-26

  # All tenants for a date range
  npm run generate:snapshots -- --all-tenants --from 2025-03-02 --to 2026-03-02

  # Only sports domain (e.g. after sports-only fix)
  npm run generate:snapshots -- --all-tenants --domains sports --from 2025-03-02 --to 2026-03-02
`);
  process.exit(0);
} else {
  const options: GenerateSnapshotsOptions = { dateFrom: '', dateTo: '' };
  let allTenants = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    if (arg === '--all-tenants') {
      allTenants = true;
    } else if (arg === '--tenant' && nextArg) {
      (options as any).tenant = nextArg;
      i++;
    } else if (arg === '--whitelabel' && nextArg) {
      (options as any).whitelabelId = nextArg;
      i++;
    } else if (arg === '--from' && nextArg) {
      options.dateFrom = nextArg;
      i++;
    } else if (arg === '--to' && nextArg) {
      options.dateTo = nextArg;
      i++;
    } else if (arg === '--domains' && nextArg) {
      (options as any).domains = nextArg.split(',').map((d: string) => d.trim()) as any;
      i++;
    } else if (arg === '--currency' && nextArg) {
      (options as any).currency = nextArg;
      i++;
    }
  }

  if (!options.dateFrom || !options.dateTo) {
    console.error('Error: --from and --to are required when providing arguments');
    console.error('Use --help for usage information');
    process.exit(1);
  }

  const run = allTenants
    ? generateForAllTenants(
        options.dateFrom,
        options.dateTo,
        (options as any).domains || ['global'],
      )
    : generateSnapshots(options as GenerateSnapshotsOptions);

  run.catch((error) => {
    console.error('Failed to generate snapshots:', error);
    process.exit(1);
  });
}
