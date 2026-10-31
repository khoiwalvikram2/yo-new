/**
 * EMERGENCY / MANUAL RECOVERY ONLY. Do not use for routine operations.
 *
 * Routine commission ledger posting is handled by the commission accrual scheduler
 * (see src/services/commissionScheduler.ts). Run this script only when:
 *   - Recovering after a prolonged scheduler outage or missing data
 *   - Backfilling historical periods before the scheduler was enabled
 *   - Fixing gaps identified by reconcile:commission (RECONCILE_TENANT=... npm run reconcile:commission)
 *
 * One-time backfill: accrue commission for all COMMISSION agents for a date range.
 * Uses CommissionCalculationService.accrueCommission (idempotent: skips if ledger line already exists).
 * Requires reporting snapshots to exist for the period (GGR is read from reportingDailySnapshots).
 *
 * IMPORTANT: Commission cycles are weekly (Monday 00:00 IST → next Monday 00:00 IST).
 * This script generates ledger entries aligned to weekly IST cycles so they match
 * the readiness check (which compares calculatedTotal vs postedTotal for exact cycle bounds).
 *
 * Runbook: run closure backfill first, then this script.
 *   npm run backfill:closure
 *   npm run backfill:commission
 *
 * Env:
 *   COMMISSION_BACKFILL_FROM     Optional. Start date (YYYY-MM-DD). Default: 12 weeks ago (IST Monday).
 *   COMMISSION_BACKFILL_TO       Optional. End date (YYYY-MM-DD). Default: Sunday before current open cycle.
 *   COMMISSION_BACKFILL_TENANT   Optional. Single tenant id; if set, only that tenant's agents are processed.
 *   COMMISSION_BACKFILL_AUDIT_FILE Optional. Write audit CSV (agentId, domain, periodFrom, periodTo, action) to this path.
 *
 * Usage (from admin-backend):
 *   npx tsx scripts/backfillCommission.ts
 *   COMMISSION_BACKFILL_FROM=2024-01-01 COMMISSION_BACKFILL_TO=2025-02-24 npx tsx scripts/backfillCommission.ts
 *   COMMISSION_BACKFILL_TENANT=my-tenant COMMISSION_BACKFILL_AUDIT_FILE=audit.csv npx tsx scripts/backfillCommission.ts
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { DateTime } from 'luxon';
import { listWhitelabelsDb } from '../src/repos/common/whitelabelRepo.js';
import { AgentsRepo } from '../src/repos/agents/AgentsRepo.js';
import { AgentConfigsRepo } from '../src/repos/agents/AgentConfigsRepo.js';
import { AgentLedgerRepo } from '../src/repos/agents/AgentLedgerRepo.js';
import { DomainGGRReadersAdapter } from '../src/domains/agents/services/DomainGGRReadersAdapter.js';
import { CommissionCalculationService } from '../src/domains/agents/services/CommissionCalculationService.js';
import { getWhitelabelCurrency } from '../src/shared/whitelabelConfig.js';

const PAGE_SIZE = 200;
const IST = 'Asia/Kolkata';

/** Get the Monday 00:00 IST at or before the given IST DateTime. */
function toMondayIST(dt: DateTime): DateTime {
  const daysBack = dt.weekday === 7 ? 6 : dt.weekday - 1;
  return dt.minus({ days: daysBack }).set({ hour: 0, minute: 0, second: 0, millisecond: 0 });
}

/**
 * Yield weekly Monday→Monday IST cycles covering the range [from, to].
 * Aligns to actual commission settlement weeks.
 */
function* weeklyCyclesIST(fromStr: string, toStr: string): Generator<{ periodFrom: Date; periodTo: Date }> {
  const fromDt = DateTime.fromISO(fromStr, { zone: IST });
  const toDt = DateTime.fromISO(toStr, { zone: IST });
  if (!fromDt.isValid || !toDt.isValid) throw new Error(`Invalid date range: ${fromStr} .. ${toStr}`);

  let cycleStart = toMondayIST(fromDt);
  const endBound = toDt.endOf('day');

  while (cycleStart < endBound) {
    const cycleEnd = cycleStart.plus({ weeks: 1 });
    yield {
      periodFrom: cycleStart.toJSDate(),
      periodTo: cycleEnd.toJSDate(),
    };
    cycleStart = cycleEnd;
  }
}

async function main() {
  const nowIst = DateTime.now().setZone(IST);
  const currentCycleMonday = toMondayIST(nowIst);
  const defaultFrom = toMondayIST(nowIst.minus({ weeks: 12 })).toFormat('yyyy-MM-dd');
  const defaultTo = currentCycleMonday.minus({ days: 1 }).toFormat('yyyy-MM-dd');
  const fromStr = process.env.COMMISSION_BACKFILL_FROM ?? defaultFrom;
  const toStr = process.env.COMMISSION_BACKFILL_TO ?? defaultTo;
  const tenantFilter = process.env.COMMISSION_BACKFILL_TENANT ?? null;

  const fromDt = DateTime.fromISO(fromStr, { zone: IST });
  const toDt = DateTime.fromISO(toStr, { zone: IST });
  if (!fromDt.isValid || !toDt.isValid || fromDt > toDt) {
    console.error('COMMISSION_BACKFILL_FROM must be <= COMMISSION_BACKFILL_TO (valid YYYY-MM-DD)');
    process.exit(1);
  }

  const cycles = [...weeklyCyclesIST(fromStr, toStr)];
  console.log('Commission backfill (weekly IST cycles)');
  console.log('  From:', fromStr, 'To:', toStr);
  console.log('  Weekly cycles to process:', cycles.length);
  if (tenantFilter) console.log('  Tenant filter:', tenantFilter);
  console.log('');

  const agentsRepo = new AgentsRepo();
  const configsRepo = new AgentConfigsRepo();
  const ledgerRepo = new AgentLedgerRepo();
  const ggrReaders = new DomainGGRReadersAdapter();
  const commissionService = new CommissionCalculationService(agentsRepo, configsRepo, ledgerRepo, ggrReaders);

  const tenantIds: string[] = tenantFilter
    ? [tenantFilter]
    : (await listWhitelabelsDb()).map((w) => w.id);

  if (tenantIds.length === 0) {
    console.log('No tenants to process.');
    return;
  }

  let totalAgents = 0;
  let totalPeriodsProcessed = 0;
  let totalInsertedLines = 0;
  let totalSkippedLines = 0;
  const perAgentStats = new Map<string, { inserted: number; skipped: number; periods: number }>();
  const errors: Array<{ agentId: string; period: string; message: string }> = [];
  const auditFilePath = process.env.COMMISSION_BACKFILL_AUDIT_FILE ?? null;
  let auditStream: fs.WriteStream | null = null;
  if (auditFilePath) {
    auditStream = fs.createWriteStream(auditFilePath, { flags: 'w' });
    auditStream.write('agentId,domain,periodFrom,periodTo,action\n');
  }

  for (const tenantId of tenantIds) {
    let offset = 0;
    let agentsPage: Awaited<ReturnType<AgentsRepo['list']>>;
    const currency = await getWhitelabelCurrency(tenantId).catch(() => 'USD');

    do {
      agentsPage = await agentsRepo.list(tenantId, { schemeType: 'COMMISSION', status: 'ACTIVE' }, { offset, limit: PAGE_SIZE });
      for (const agent of agentsPage) {
        totalAgents++;
        for (const { periodFrom, periodTo } of cycles) {
          try {
            const result = await commissionService.accrueCommission(agent.id, periodFrom, periodTo, currency);
            totalInsertedLines += result.inserted;
            totalSkippedLines += result.skipped;
            const prev = perAgentStats.get(agent.id) ?? { inserted: 0, skipped: 0, periods: 0 };
            prev.inserted += result.inserted;
            prev.skipped += result.skipped;
            prev.periods += 1;
            perAgentStats.set(agent.id, prev);
            totalPeriodsProcessed++;
            if (auditStream && result.details) {
              const periodFromStr = periodFrom.toISOString().slice(0, 10);
              const periodToStr = periodTo.toISOString().slice(0, 10);
              for (const domain of ['sports', 'casino', 'matka'] as const) {
                const action = result.details[domain];
                if (action) {
                  auditStream.write(`${agent.id},${domain},${periodFromStr},${periodToStr},${action}\n`);
                }
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push({
              agentId: agent.id,
              period: `${periodFrom.toISOString().slice(0, 10)}..${periodTo.toISOString().slice(0, 10)}`,
              message: msg,
            });
            if (errors.length <= 10) {
              console.error(`  Error agent=${agent.id} period=${periodFrom.toISOString().slice(0, 10)}: ${msg}`);
            }
          }
        }
        if (totalAgents % 50 === 0 && totalAgents > 0) {
          console.log(`  Processed ${totalAgents} agents...`);
        }
      }
      offset += PAGE_SIZE;
    } while (agentsPage.length === PAGE_SIZE);
  }

  if (auditStream) {
    auditStream.end();
    console.log(`  Audit file written: ${path.resolve(auditFilePath!)}`);
  }
  console.log('');
  console.log('Done.');
  console.log(`  Agents processed: ${totalAgents}`);
  console.log(`  Periods accrued (agent×week): ${totalPeriodsProcessed}`);
  console.log(`  Ledger commission lines inserted: ${totalInsertedLines}`);
  console.log(`  Ledger commission lines skipped(existing): ${totalSkippedLines}`);
  console.log(`  Errors: ${errors.length}`);
  const sortedAgents = Array.from(perAgentStats.entries()).sort((a, b) => b[1].inserted - a[1].inserted);
  if (sortedAgents.length > 0) {
    console.log('  Top agents by inserted lines (max 15):');
    for (const [agentId, st] of sortedAgents.slice(0, 15)) {
      console.log(`    ${agentId}: inserted=${st.inserted}, skipped=${st.skipped}, periods=${st.periods}`);
    }
  }
  if (errors.length > 10) {
    console.log(`  (First 10 errors logged above; total ${errors.length} errors)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
