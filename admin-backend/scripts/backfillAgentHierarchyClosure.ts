/**
 * One-time backfill: populate agent_hierarchy_closure for existing COMMISSION, SHARING, and CREDIT
 * agents so getDescendantIds() returns full downline and commission accrual writes ledger lines
 * for all hierarchy levels (not just the leaf).
 *
 * Env:
 *   CLOSURE_BACKFILL_TENANT  Optional. Single tenant id; if set, only that tenant's agents are processed.
 *
 * Usage (from admin-backend):
 *   npx tsx scripts/backfillAgentHierarchyClosure.ts
 *   CLOSURE_BACKFILL_TENANT=my-tenant npx tsx scripts/backfillAgentHierarchyClosure.ts
 */
import 'dotenv/config';
import { db } from '../src/db/client.js';
import { agents, agentHierarchyClosure } from '@shared/db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { listWhitelabelsDb } from '../src/repos/common/whitelabelRepo.js';

const SCHEME_TYPES = ['COMMISSION', 'SHARING', 'CREDIT'] as const;

type AgentRow = { id: string; parentAgentId: string | null };

function topologicalOrder(agentRows: AgentRow[]): AgentRow[] {
  const byId = new Map(agentRows.map((a) => [a.id, a]));
  const idSet = new Set(byId.keys());
  const ordered: AgentRow[] = [];
  const added = new Set<string>();

  // Roots: no parent or parent not in our set
  const roots = agentRows.filter(
    (a) => !a.parentAgentId || !idSet.has(a.parentAgentId)
  );
  const queue: AgentRow[] = [...roots];
  for (const a of roots) added.add(a.id);

  while (queue.length > 0) {
    const a = queue.shift()!;
    ordered.push(a);
    const children = agentRows.filter(
      (c) => c.parentAgentId === a.id && !added.has(c.id)
    );
    for (const c of children) {
      added.add(c.id);
      queue.push(c);
    }
  }

  // Any remaining (e.g. parent outside tenant) append at end
  for (const a of agentRows) {
    if (!added.has(a.id)) ordered.push(a);
  }
  return ordered;
}

async function existsClosureRow(
  ancestorId: string,
  descendantId: string
): Promise<boolean> {
  const rows = await db
    .select({ ancestorId: agentHierarchyClosure.ancestorId })
    .from(agentHierarchyClosure)
    .where(
      and(
        eq(agentHierarchyClosure.ancestorId, ancestorId),
        eq(agentHierarchyClosure.descendantId, descendantId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

async function main() {
  const tenantFilter = process.env.CLOSURE_BACKFILL_TENANT ?? null;

  console.log('Backfill: agent_hierarchy_closure');
  if (tenantFilter) console.log('  Tenant filter:', tenantFilter);
  console.log('');

  const tenantIds: string[] = tenantFilter
    ? [tenantFilter]
    : (await listWhitelabelsDb()).map((w) => w.id);

  if (tenantIds.length === 0) {
    console.log('No tenants to process.');
    return;
  }

  const agentRows = await db
    .select({
      id: agents.id,
      parentAgentId: agents.parentAgentId,
    })
    .from(agents)
    .where(
      and(
        inArray(agents.tenantId, tenantIds),
        inArray(agents.schemeType, [...SCHEME_TYPES])
      )
    );

  if (agentRows.length === 0) {
    console.log('No COMMISSION/SHARING/CREDIT agents found.');
    return;
  }

  const ordered = topologicalOrder(agentRows);
  let selfInserted = 0;
  let selfSkipped = 0;
  let chainInserted = 0;
  let chainSkipped = 0;

  for (const agent of ordered) {
    const { id: agentId, parentAgentId } = agent;

    // 1. Self row (agentId, agentId, 0)
    const selfExists = await existsClosureRow(agentId, agentId);
    if (!selfExists) {
      await db.insert(agentHierarchyClosure).values({
        ancestorId: agentId,
        descendantId: agentId,
        depth: 0,
      });
      selfInserted++;
    } else {
      selfSkipped++;
    }

    // 2. Parent chain: for each (ancestorId, parentAgentId, depth) add (ancestorId, agentId, depth+1)
    if (parentAgentId) {
      const parentRows = await db
        .select({
          ancestorId: agentHierarchyClosure.ancestorId,
          depth: agentHierarchyClosure.depth,
        })
        .from(agentHierarchyClosure)
        .where(eq(agentHierarchyClosure.descendantId, parentAgentId));

      for (const row of parentRows) {
        const exists = await existsClosureRow(row.ancestorId, agentId);
        if (!exists) {
          await db.insert(agentHierarchyClosure).values({
            ancestorId: row.ancestorId,
            descendantId: agentId,
            depth: row.depth + 1,
          });
          chainInserted++;
        } else {
          chainSkipped++;
        }
      }
    }
  }

  console.log('Done.');
  console.log('  Agents processed:', ordered.length);
  console.log('  Self rows: inserted', selfInserted, ', skipped (existing)', selfSkipped);
  console.log('  Ancestor rows: inserted', chainInserted, ', skipped (existing)', chainSkipped);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
