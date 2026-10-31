/**
 * Manual Trigger Report – generates reporting snapshots for the previous day (IST).
 * Run with: npm run trigger:report
 * Optional args: --tenant, --whitelabel, --currency, --date
 */

import 'dotenv/config';
import { DateTime } from 'luxon';
import { generateSnapshotsForRange } from '../src/services/reportingSnapshotService.js';

const DEFAULT_TZ = 'Asia/Kolkata';

function getYesterday(): string {
  return DateTime.now().setZone(DEFAULT_TZ).minus({ days: 1 }).toFormat('yyyy-MM-dd');
}

async function main() {
  const args = process.argv.slice(2);
  let tenant = 'default';
  let whitelabelId = 'example-com';
  let currency = 'INR';
  let dateStr = getYesterday();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tenant' && args[i + 1]) {
      tenant = args[++i];
    } else if (args[i] === '--whitelabel' && args[i + 1]) {
      whitelabelId = args[++i];
    } else if (args[i] === '--currency' && args[i + 1]) {
      currency = args[++i];
    } else if (args[i] === '--date' && args[i + 1]) {
      dateStr = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Manual Trigger Report – generates snapshots for reporting (sports, casino, matka).

Usage: npm run trigger:report [options]

Options:
  --tenant <id>       Tenant (default: default)
  --whitelabel <id>   Whitelabel (default: example-com)
  --currency <code>   Currency (default: INR)
  --date <YYYY-MM-DD> Single date (default: yesterday)
  --help, -h          Show this help
`);
      process.exit(0);
    }
  }

  console.log('\n=== Manual Trigger Report ===\n');
  console.log(`Tenant: ${tenant}`);
  console.log(`Whitelabel: ${whitelabelId}`);
  console.log(`Currency: ${currency}`);
  console.log(`Date: ${dateStr}`);
  console.log('Domains: sports, casino, matka\n');

  const dateDt = DateTime.fromISO(dateStr, { zone: 'Asia/Kolkata' }).startOf('day');
  if (!dateDt.isValid) {
    console.error('Invalid --date. Use YYYY-MM-DD.');
    process.exit(1);
  }
  const date = dateDt.toJSDate();

  try {
    await generateSnapshotsForRange(
      tenant,
      whitelabelId,
      date,
      date,
      ['sports', 'casino', 'matka'],
      currency,
    );
    console.log('\n✅ Report snapshots generated successfully.\n');
  } catch (err) {
    console.error('\n❌ Failed:', err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  }
}

main();
