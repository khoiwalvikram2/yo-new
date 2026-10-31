/**
 * Commission reconciliation: compare calculatedTotal, earnedPosted, paid, pending per agent/period.
 * Use to validate cross-surface consistency (listing, report, dashboard, settlement) and spot backfill gaps.
 *
 * Env:
 *   RECONCILE_TENANT   Required. Tenant id.
 *   RECONCILE_AGENT_ID Optional. Single agent id; if omitted, all COMMISSION agents in tenant.
 *   RECONCILE_FROM     Optional. Period start (YYYY-MM-DD). Default: start of current month.
 *   RECONCILE_TO       Optional. Period end (YYYY-MM-DD). Default: today.
 *
 * Usage (from admin-backend):
 *   RECONCILE_TENANT=my-tenant npx tsx scripts/reconcileCommission.ts
 *   RECONCILE_TENANT=my-tenant RECONCILE_AGENT_ID=uuid npx tsx scripts/reconcileCommission.ts
 */
import 'dotenv/config';
import { DateTime } from 'luxon';
import { AgentsRepo } from '../src/repos/agents/AgentsRepo.js';
import { AgentConfigsRepo } from '../src/repos/agents/AgentConfigsRepo.js';
import { AgentLedgerRepo } from '../src/repos/agents/AgentLedgerRepo.js';
import { CommissionPayoutsRepo } from '../src/repos/settlements/CommissionPayoutsRepo.js';
import { DomainGGRReadersAdapter } from '../src/domains/agents/services/DomainGGRReadersAdapter.js';
import { CommissionCalculationService } from '../src/domains/agents/services/CommissionCalculationService.js';
import { getWhitelabelCurrency } from '../src/shared/whitelabelConfig.js';

const TOLERANCE = 0.01;

function parseDate(s: string): Date {
  const d = new Date(s);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${s}`);
  return d;
}

async function main() {
  const tenant = process.env.RECONCILE_TENANT ?? null;
  const agentIdFilter = process.env.RECONCILE_AGENT_ID ?? null;
  const ist = DateTime.now().setZone('Asia/Kolkata');
  const defaultFrom = ist.startOf('month').toFormat('yyyy-MM-dd');
  const defaultTo = ist.toFormat('yyyy-MM-dd');
  const fromStr = process.env.RECONCILE_FROM ?? defaultFrom;
  const toStr = process.env.RECONCILE_TO ?? defaultTo;
  const periodFrom = parseDate(fromStr);
  const periodTo = parseDate(toStr);

  if (!tenant) {
    console.error('RECONCILE_TENANT is required.');
    process.exit(1);
  }
  if (periodFrom > periodTo) {
    console.error('RECONCILE_FROM must be <= RECONCILE_TO');
    process.exit(1);
  }

  const agentsRepo = new AgentsRepo();
  const configsRepo = new AgentConfigsRepo();
  const ledgerRepo = new AgentLedgerRepo();
  const payoutsRepo = new CommissionPayoutsRepo();
  const ggrReaders = new DomainGGRReadersAdapter();
  const commissionService = new CommissionCalculationService(
    agentsRepo,
    configsRepo,
    ledgerRepo,
    ggrReaders,
    payoutsRepo,
  );
  const currency = await getWhitelabelCurrency(tenant).catch(() => 'USD');

  type AgentRow = { id: string };
  let agents: AgentRow[];
  if (agentIdFilter) {
    const one = await agentsRepo.findById(agentIdFilter);
    if (!one) {
      console.log('Agent not found.');
      return;
    }
    if (one.tenantId !== tenant) {
      console.error(`Agent ${agentIdFilter} does not belong to tenant ${tenant}.`);
      process.exit(1);
    }
    agents = [{ id: one.id }];
  } else {
    const PAGE_SIZE = 500;
    let offset = 0;
    const all: AgentRow[] = [];
    let page: Awaited<ReturnType<AgentsRepo['list']>>;
    do {
      page = await agentsRepo.list(tenant, { schemeType: 'COMMISSION', status: 'ACTIVE' }, { offset, limit: PAGE_SIZE });
      for (const a of page) {
        all.push({ id: a.id });
      }
      offset += PAGE_SIZE;
    } while (page.length === PAGE_SIZE);
    agents = all;
  }

  if (agents.length === 0) {
    console.log('No COMMISSION agents found.');
    return;
  }

  console.log('Commission reconciliation');
  console.log('  Tenant:', tenant);
  console.log('  Period:', fromStr, '..', toStr);
  console.log('  Agents:', agents.length);
  console.log('');
  console.log('agentId\tcalculatedTotal\tearnedPosted\tpaid\tpending\twarn');

  let warnCount = 0;
  for (const a of agents) {
    try {
      const unified = await commissionService.getUnifiedCommission(a.id, currency, tenant, {
        periodFrom,
        periodTo,
      });
      const drift = Math.abs(unified.earnedPosted - unified.calculatedTotal);
      const warn = drift > TOLERANCE ? 'LEDGER_GAP' : '';
      if (warn) warnCount++;
      console.log(
        [a.id, unified.calculatedTotal.toFixed(2), unified.earnedPosted.toFixed(2), unified.paid.toFixed(2), unified.pending.toFixed(2), warn].join('\t'),
      );
    } catch (err) {
      console.log(a.id, '\tERROR\t', err instanceof Error ? err.message : String(err));
    }
  }

  console.log('');
  console.log('Done.');
  if (warnCount > 0) {
    console.log(`  ${warnCount} agent(s) with |earnedPosted - calculatedTotal| > ${TOLERANCE} (run backfill:commission if needed).`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
