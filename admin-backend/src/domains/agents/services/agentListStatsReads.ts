import { db } from '@src/db/client.js';
import { users, agents, depositRequests, withdrawalRequests, wallets, ledgerEntries, sportsBets, casinoBets, matkaBets } from '@shared/db/schema.js';
import { and, eq, gte, lte, inArray, sql } from 'drizzle-orm';

/** A player can appear once per listed ancestor; overlapping subtrees remain separate.
 * Group money in PostgreSQL per target to preserve numeric SUM semantics. One JSON
 * parameter also avoids a growing list of player bind parameters. */
export function agentListPlayerScope(players: ReadonlyMap<string, readonly number[]>) {
  const rows = [...players].flatMap(([agentId, ids]) => [...new Set(ids)].map(userId => ({ agent_id: agentId, user_id: userId })));
  return sql`jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS list_scope(agent_id uuid, user_id integer)`;
}
const target = sql<string>`list_scope.agent_id`;
const member = sql<number>`list_scope.user_id`;

/** Traverse actual parent edges, as the legacy walk does. UNION makes cycles stop;
 * this deliberately does not replace parent-edge membership with closure membership. */
export async function readAgentListHierarchy(ids: string[]) {
  if (!ids.length) return [];
  const result = await db.execute(sql`WITH RECURSIVE list_tree AS (
    SELECT id, parent_agent_id, scheme_type FROM ${agents} WHERE id IN (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)})
    UNION
    SELECT child.id, child.parent_agent_id, child.scheme_type FROM ${agents} child
    JOIN list_tree parent ON child.parent_agent_id = parent.id
  ) SELECT id, parent_agent_id AS "parentAgentId", scheme_type AS "schemeType" FROM list_tree`);
  return result.rows as Array<{ id: string; parentAgentId: string | null; schemeType: string }>;
}

export async function readAgentListPayments(players: ReadonlyMap<string, readonly number[]>, tenant: string) {
  const scope = agentListPlayerScope(players);
  const [deposits, withdrawals, manual] = await Promise.all([
    db.select({ agentId: target, total: sql<number>`COALESCE(SUM(${depositRequests.amount}::numeric), 0)` }).from(depositRequests)
      .innerJoin(scope, eq(depositRequests.userId, member))
      .where(and(eq(depositRequests.tenant, tenant), eq(depositRequests.status, 'APPROVED'))).groupBy(target),
    db.select({ agentId: target, total: sql<number>`COALESCE(SUM(${withdrawalRequests.amount}::numeric), 0)` }).from(withdrawalRequests)
      .innerJoin(scope, eq(withdrawalRequests.userId, member))
      .where(and(eq(withdrawalRequests.tenant, tenant), eq(withdrawalRequests.status, 'COMPLETED'))).groupBy(target),
    db.select({ agentId: target,
      deposits: sql<number>`COALESCE(SUM(ABS(NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric)) FILTER (WHERE ${ledgerEntries.type} = 'credit' AND ${ledgerEntries.meta}->>'type' IN ('deposit', 'admin_adjustment') AND (${ledgerEntries.meta}->>'depositRequestId' IS NULL OR ${ledgerEntries.meta}->>'depositRequestId' = '')), 0)`,
      withdrawals: sql<number>`COALESCE(SUM(ABS(NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric)) FILTER (WHERE ${ledgerEntries.type} = 'debit' AND ${ledgerEntries.meta}->>'type' IN ('withdrawal', 'admin_adjustment')), 0)`,
    }).from(wallets).innerJoin(scope, eq(wallets.userId, member)).innerJoin(ledgerEntries, eq(ledgerEntries.walletId, wallets.id))
      .where(and(eq(wallets.tenant, tenant), eq(ledgerEntries.tenant, tenant))).groupBy(target),
  ]);
  const directIn = new Map(deposits.map(row => [row.agentId, Number(row.total)]));
  const directOut = new Map(withdrawals.map(row => [row.agentId, Number(row.total)]));
  const adjustments = new Map(manual.map(row => [row.agentId, row]));
  return new Map([...players].filter(([, ids]) => ids.length).map(([id]) => [id, {
    totalDeposits: (directIn.get(id) || 0) + Number(adjustments.get(id)?.deposits || 0),
    totalWithdrawals: (directOut.get(id) || 0) + Number(adjustments.get(id)?.withdrawals || 0),
  }]));
}

export async function readAgentListGgr(players: ReadonlyMap<string, readonly number[]>, tenant: string, range?: { from?: Date; to?: Date }) {
  const scope = agentListPlayerScope(players);
  const playerConditions = [eq(users.tenant, tenant), sql`${users.playerType} IS DISTINCT FROM 'COMMISSION_AGENT_PLAYER'`];
  const conditions = (table: typeof sportsBets | typeof casinoBets | typeof matkaBets, statuses: string[]) => [
    ...playerConditions, eq(table.tenant, tenant), inArray(table.status as any, statuses),
    ...(range?.from ? [gte(table.createdAt, range.from)] : []), ...(range?.to ? [lte(table.createdAt, range.to)] : []),
  ];
  const [sports, casino, matka] = await Promise.all([
    db.select({ agentId: target, ggr: sql<number>`COALESCE(SUM(CASE WHEN ${sportsBets.pl} IS NOT NULL THEN -${sportsBets.pl}::numeric ELSE 0 END), 0)`,
              pl: sql<number>`COALESCE(SUM(${sportsBets.pl}::numeric), 0)`, }).from(sportsBets)
      .innerJoin(users, eq(sportsBets.userId, users.id)).innerJoin(scope, eq(users.id, member))
      .where(and(...conditions(sportsBets, ['won', 'lost', 'settled']))).groupBy(target),
    db.select({ agentId: target, ggr: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric - COALESCE(${casinoBets.payout}::numeric, ${casinoBets.winAmount}::numeric, 0)), 0)`,
              pl: sql<number>`COALESCE(SUM(COALESCE(${casinoBets.payout}::numeric, ${casinoBets.winAmount}::numeric, 0) - ${casinoBets.stake}::numeric), 0)`, }).from(casinoBets)
      .innerJoin(users, eq(casinoBets.userId, users.id)).innerJoin(scope, eq(users.id, member))
      .where(and(...conditions(casinoBets, ['won', 'lost']), eq(casinoBets.walletType, 'cash'))).groupBy(target),
    db.select({ agentId: target, ggr: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric - COALESCE(${matkaBets.actualWin}::numeric, 0)), 0)`,
              pl: sql<number>`COALESCE(SUM(COALESCE(${matkaBets.actualWin}::numeric, 0) - ${matkaBets.betAmount}::numeric), 0)`, }).from(matkaBets)
      .innerJoin(users, eq(matkaBets.userId, users.id)).innerJoin(scope, eq(users.id, member))
      .where(and(...conditions(matkaBets, ['won', 'lost']))).groupBy(target),
  ]);
  const domains = [sports, casino, matka].map(rows => new Map(rows.map(row => [row.agentId, row])));
  return new Map([...players].filter(([, ids]) => ids.length).map(([id]) => {
    const values = domains.map(rows => rows.get(id));
    const pl = values.map(row => Number(row?.pl || 0));
    return [id, { ggr: values.reduce((sum, row) => sum + Number(row?.ggr || 0), 0),
      profitLoss: pl.reduce((sum, value) => sum + value, 0), plByDomain: { sports: pl[0], casino: pl[1], matka: pl[2] } }];
  }));
}

/** Turnover remains all-time/all-status, including commission-player bets. */
export async function readAgentListTurnover(players: ReadonlyMap<string, readonly number[]>, tenant: string) {
  const scope = agentListPlayerScope(players);
  const [sports, casino, matka] = await Promise.all([
    db.select({ agentId: target, turnover: sql<number>`COALESCE(SUM(${sportsBets.liability})::numeric, 0)` }).from(sportsBets)
      .innerJoin(scope, eq(sportsBets.userId, member)).where(and(eq(sportsBets.tenant, tenant))).groupBy(target),
    db.select({ agentId: target, turnover: sql<number>`COALESCE(SUM(${casinoBets.stake})::numeric, 0)` }).from(casinoBets)
      .innerJoin(scope, eq(casinoBets.userId, member)).where(and(eq(casinoBets.tenant, tenant), eq(casinoBets.walletType, 'cash'))).groupBy(target),
    db.select({ agentId: target, turnover: sql<number>`COALESCE(SUM(${matkaBets.betAmount})::numeric, 0)` }).from(matkaBets)
      .innerJoin(scope, eq(matkaBets.userId, member)).where(and(eq(matkaBets.tenant, tenant))).groupBy(target),
  ]);
  const domains = [sports, casino, matka].map(rows => new Map(rows.map(row => [row.agentId, row.turnover])));
  return new Map([...players.keys()].map(id => [id, domains.reduce((sum, rows) => sum + Number(rows.get(id) || 0), 0)]));
}
