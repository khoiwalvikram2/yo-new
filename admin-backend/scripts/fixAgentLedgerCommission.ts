/**
 * Manual commission-ledger correction utility.
 *
 * Use this when earnedPosted in `agent_ledger` drifts from calculatedTotal.
 * Script inserts COMMISSION correction rows (positive or negative) with a refKey.
 *
 * Safety:
 * - Dry-run by default (no writes unless LEDGER_FIX_APPLY=true)
 * - Idempotent by refKey per agent (skips if already inserted)
 *
 * Env:
 *   LEDGER_FIX_TENANT           Required. Tenant id.
 *   LEDGER_FIX_AGENT_IDS        Optional. Comma-separated agent UUIDs.
 *   LEDGER_FIX_ALL              Optional. true/false. If true, run for all active COMMISSION agents in tenant.
 *                               If LEDGER_FIX_AGENT_IDS is provided, that list is used.
 *   LEDGER_FIX_CALC_FROM        Optional. YYYY-MM-DD. Default: 2000-01-01.
 *   LEDGER_FIX_CALC_TO          Optional. YYYY-MM-DD. Default: today (IST).
 *   LEDGER_FIX_ENTRY_DATE       Optional. YYYY-MM-DD for correction line periodFrom/periodTo.
 *                               Default: 2000-01-01 (keeps weekly/cycle views unaffected).
 *   LEDGER_FIX_APPLY            Optional. true/false. Default: false (dry-run).
 *   LEDGER_FIX_REF_KEY          Optional. Default: commission-manual-fix-<entryDate>.
 *   LEDGER_FIX_THRESHOLD        Optional. Default: 0.01 (skip tiny corrections).
 *   LEDGER_FIX_CURRENCY         Optional. Override currency. Default: tenant base currency.
 *   LEDGER_FIX_DOMAIN           Optional. sports|casino|matka. Default: sports.
 *
 * Usage:
 *   # Dry-run (recommended first)
 *   LEDGER_FIX_TENANT=grandwinn-com \
 *   LEDGER_FIX_AGENT_IDS=id1,id2 \
 *   npx tsx scripts/fixAgentLedgerCommission.ts
 *
 *   # Dry-run for all active COMMISSION agents in tenant
 *   LEDGER_FIX_TENANT=grandwinn-com \
 *   LEDGER_FIX_ALL=true \
 *   npx tsx scripts/fixAgentLedgerCommission.ts
 *
 *   # Apply
 *   LEDGER_FIX_TENANT=grandwinn-com \
 *   LEDGER_FIX_AGENT_IDS=id1,id2 \
 *   LEDGER_FIX_APPLY=true \
 *   LEDGER_FIX_REF_KEY=commission-correction-2026-03-01-alltime-v2 \
 *   npx tsx scripts/fixAgentLedgerCommission.ts
 */
import 'dotenv/config';
import { DateTime } from 'luxon';
import { and, eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { agentLedger } from '@shared/db/schema.js';
import { AgentsRepo } from '../src/repos/agents/AgentsRepo.js';
import { AgentConfigsRepo } from '../src/repos/agents/AgentConfigsRepo.js';
import { AgentLedgerRepo } from '../src/repos/agents/AgentLedgerRepo.js';
import { CommissionPayoutsRepo } from '../src/repos/settlements/CommissionPayoutsRepo.js';
import { DomainGGRReadersAdapter } from '../src/domains/agents/services/DomainGGRReadersAdapter.js';
import { CommissionCalculationService } from '../src/domains/agents/services/CommissionCalculationService.js';
import { getWhitelabelCurrency } from '../src/shared/whitelabelConfig.js';

type Domain = 'sports' | 'casino' | 'matka';

function parseBool(v: string | undefined, defaultValue: boolean): boolean {
  if (v == null) return defaultValue;
  const val = v.trim().toLowerCase();
  if (val === 'true' || val === '1' || val === 'yes') return true;
  if (val === 'false' || val === '0' || val === 'no') return false;
  return defaultValue;
}

function parseDate(value: string, name: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`${name} invalid date: ${value}`);
  }
  return d;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function main() {
  const tenant = process.env.LEDGER_FIX_TENANT?.trim();
  const idsRaw = process.env.LEDGER_FIX_AGENT_IDS?.trim();
  const allAgentsMode = parseBool(process.env.LEDGER_FIX_ALL, false);
  if (!tenant) {
    throw new Error('LEDGER_FIX_TENANT is required');
  }
  let agentIds = (idsRaw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const nowIst = DateTime.now().setZone('Asia/Kolkata').toFormat('yyyy-MM-dd');
  const calcFromStr = process.env.LEDGER_FIX_CALC_FROM?.trim() || '2000-01-01';
  const calcToStr = process.env.LEDGER_FIX_CALC_TO?.trim() || nowIst;
  const entryDateStr = process.env.LEDGER_FIX_ENTRY_DATE?.trim() || '2000-01-01';
  const apply = parseBool(process.env.LEDGER_FIX_APPLY, false);
  const threshold = Number(process.env.LEDGER_FIX_THRESHOLD ?? '0.01');
  const domain = (process.env.LEDGER_FIX_DOMAIN?.trim().toLowerCase() || 'sports') as Domain;
  const refKey =
    process.env.LEDGER_FIX_REF_KEY?.trim() || `commission-manual-fix-${entryDateStr}`;

  if (!['sports', 'casino', 'matka'].includes(domain)) {
    throw new Error('LEDGER_FIX_DOMAIN must be one of: sports, casino, matka');
  }
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error('LEDGER_FIX_THRESHOLD must be a non-negative number');
  }

  const calcFrom = parseDate(calcFromStr, 'LEDGER_FIX_CALC_FROM');
  const calcTo = parseDate(calcToStr, 'LEDGER_FIX_CALC_TO');
  if (calcFrom > calcTo) {
    throw new Error('LEDGER_FIX_CALC_FROM must be <= LEDGER_FIX_CALC_TO');
  }
  const entryDate = parseDate(entryDateStr, 'LEDGER_FIX_ENTRY_DATE');

  const agentsRepo = new AgentsRepo();
  if (agentIds.length === 0 && allAgentsMode) {
    const all: string[] = [];
    const PAGE_SIZE = 500;
    let offset = 0;
    let page: Awaited<ReturnType<AgentsRepo['list']>>;
    do {
      page = await agentsRepo.list(
        tenant,
        { schemeType: 'COMMISSION', status: 'ACTIVE' },
        { offset, limit: PAGE_SIZE },
      );
      for (const a of page) {
        all.push(a.id);
      }
      offset += PAGE_SIZE;
    } while (page.length === PAGE_SIZE);
    agentIds = all;
  }
  if (agentIds.length === 0) {
    throw new Error('Provide LEDGER_FIX_AGENT_IDS or set LEDGER_FIX_ALL=true');
  }

  const ledgerRepo = new AgentLedgerRepo();
  const service = new CommissionCalculationService(
    agentsRepo,
    new AgentConfigsRepo(),
    ledgerRepo,
    new DomainGGRReadersAdapter(),
    new CommissionPayoutsRepo(),
  );

  const currency =
    process.env.LEDGER_FIX_CURRENCY?.trim() ||
    (await getWhitelabelCurrency(tenant).catch(() => 'INR'));

  console.log('Commission ledger fix');
  console.log(`  Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`  Tenant: ${tenant}`);
  console.log(`  Agents: ${agentIds.length}`);
  console.log(`  Selection: ${idsRaw ? 'explicit IDs' : allAgentsMode ? 'ALL active commission agents' : 'explicit IDs'}`);
  console.log(`  Calc window: ${calcFromStr} .. ${calcToStr}`);
  console.log(`  Entry date: ${entryDateStr}`);
  console.log(`  Currency: ${currency}`);
  console.log(`  Domain: ${domain}`);
  console.log(`  Ref key: ${refKey}`);
  console.log('');
  console.log('agentId\tcalculatedTotal\tearnedPosted\tcorrection\taction');

  let inserted = 0;
  let skipped = 0;
  let noop = 0;

  for (const agentId of agentIds) {
    const agent = await agentsRepo.findById(agentId);
    if (!agent || agent.tenantId !== tenant || agent.schemeType !== 'COMMISSION') {
      console.log(`${agentId}\t-\t-\t-\tskip(not commission agent in tenant)`);
      skipped++;
      continue;
    }

    const existing = await db
      .select({ id: agentLedger.id })
      .from(agentLedger)
      .where(
        and(
          eq(agentLedger.agentId, agentId),
          eq(agentLedger.refKey, refKey),
          eq(agentLedger.lineType, 'COMMISSION'),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      console.log(`${agentId}\t-\t-\t-\tskip(existing refKey)`);
      skipped++;
      continue;
    }

    const unified = await service.getUnifiedCommission(agentId, currency, tenant, {
      periodFrom: calcFrom,
      periodTo: calcTo,
    });
    const correction = round2(unified.calculatedTotal - unified.earnedPosted);
    if (!Number.isFinite(correction) || Math.abs(correction) < threshold) {
      console.log(
        `${agentId}\t${unified.calculatedTotal.toFixed(2)}\t${unified.earnedPosted.toFixed(
          2,
        )}\t${correction.toFixed(2)}\tno-op`,
      );
      noop++;
      continue;
    }

    if (!apply) {
      console.log(
        `${agentId}\t${unified.calculatedTotal.toFixed(2)}\t${unified.earnedPosted.toFixed(
          2,
        )}\t${correction.toFixed(2)}\tdry-run`,
      );
      continue;
    }

    await ledgerRepo.addLine({
      agentId,
      domain,
      periodFrom: entryDate,
      periodTo: entryDate,
      lineType: 'COMMISSION',
      amount: correction,
      currency,
      refKey,
      meta: {
        reason: 'manual ledger correction',
        calculatedTotal: unified.calculatedTotal,
        earnedPosted: unified.earnedPosted,
        calcFrom: calcFrom.toISOString(),
        calcTo: calcTo.toISOString(),
      },
    });
    inserted++;
    console.log(
      `${agentId}\t${unified.calculatedTotal.toFixed(2)}\t${unified.earnedPosted.toFixed(
        2,
      )}\t${correction.toFixed(2)}\tinserted`,
    );
  }

  console.log('');
  console.log('Done.');
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  No-op: ${noop}`);
  if (!apply) {
    console.log('  Dry-run only. Set LEDGER_FIX_APPLY=true to write corrections.');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
