import { after, afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import { db, pool } from '@src/db/client.js';
import { AgentSettlementsRepo } from '@src/repos/agents/AgentSettlementsRepo.js';
import { AgentListStatsService } from '../AgentListStatsService.js';
import { agentListPlayerScope, readAgentListHierarchy, readAgentListPayments, readAgentListGgr, readAgentListTurnover } from '../agentListStatsReads.js';

afterEach(() => mock.restoreAll());
after(async () => { await pool.end(); });
type Query = { text: string; values: unknown[] };
function database(reply: (query: Query) => unknown[][]) {
  const queries: Query[] = [];
  mock.method(pool as any, 'query', async (config: { text: string }, values: unknown[]) => {
    const query = { text: config.text, values };
    queries.push(query);
    return { rows: reply(query) };
  });
  return queries;
}
const players = new Map([['root', [1, 2]], ['child', [2]], ['empty', []]]);

describe('Agent list grouped reads', () => {
  it('keeps overlapping ancestors separate and deduplicates players per target', () => {
    const query = new PgDialect().sqlToQuery(agentListPlayerScope(new Map([['a', [1, 1, 2]], ['b', [2]]])));
    assert.equal(query.params.length, 1);
    assert.deepEqual(JSON.parse(String(query.params[0])), [
      { agent_id: 'a', user_id: 1 }, { agent_id: 'a', user_id: 2 }, { agent_id: 'b', user_id: 2 },
    ]);
  });

  it('combines approved/completed volumes with manual adjustments without filling absent player sets', async () => {
    const queries = database(query => query.text.includes('"deposit_requests"') ? [['root', '100.25']]
      : query.text.includes('"withdrawal_requests"') ? [['root', '20.10']]
      : [['root', '3.25', '2.50']]);
    const result = await readAgentListPayments(players, 'brand-a');
    assert.equal(queries.length, 3);
    assert.deepEqual(result.get('root'), { totalDeposits: 103.5, totalWithdrawals: 22.6 });
    assert.deepEqual(result.get('child'), { totalDeposits: 0, totalWithdrawals: 0 });
    assert.equal(result.has('empty'), false, 'an agent without players retains null amounts in the service');
    assert.ok(queries.some(query => query.values.includes('APPROVED')));
    assert.ok(queries.some(query => query.values.includes('COMPLETED')));
    const manual = queries.find(query => query.text.includes('"ledger_entries"'))!;
    assert.match(manual.text, /ABS\(NULLIF/);
    assert.match(manual.text, /depositRequestId/);
    assert.match(manual.text, /FILTER \(WHERE/);
    assert.equal(manual.values.filter(value => value === 'brand-a').length, 2, 'wallet and ledger must both belong to the tenant');
  });

  it('preserves negative domain GGR, created-at bounds and commission-player exclusion', async () => {
    const from = new Date('2026-09-01T00:00:00Z');
    const to = new Date('2026-10-01T00:00:00Z');
    const queries = database(query => query.text.includes('"sports_bets"') ? [['root', '-20.25', '20.25']]
      : query.text.includes('"casino_bets"') ? [['root', '40.5', '-40.5']] : []);
    const result = await readAgentListGgr(players, 'brand-a', { from, to });
    assert.equal(queries.length, 3);
    assert.deepEqual(result.get('root'), { ggr: 20.25, profitLoss: -20.25, plByDomain: { sports: 20.25, casino: -40.5, matka: 0 } });
    assert.deepEqual(result.get('child'), { ggr: 0, profitLoss: 0, plByDomain: { sports: 0, casino: 0, matka: 0 } });
    assert.equal(result.has('empty'), false);
    for (const query of queries) {
      assert.match(query.text, /IS DISTINCT FROM 'COMMISSION_AGENT_PLAYER'/, 'null player types are eligible');
      assert.match(query.text, /"created_at" >=/);
      assert.match(query.text, /"created_at" <=/);
      assert.ok(query.values.includes(from.toISOString()) && query.values.includes(to.toISOString()));
    }
    assert.ok(queries.find(query => query.text.includes('"casino_bets"'))!.values.includes('cash'));
  });

  it('turnover stays all-time/all-status, with casino cash only and all player types', async () => {
    const queries = database(query => query.text.includes('"sports_bets"') ? [['root', '100.25']]
      : query.text.includes('"casino_bets"') ? [['root', '50.50']] : [['root', '10']]);
    const result = await readAgentListTurnover(players, 'brand-a');
    assert.equal(queries.length, 3);
    assert.equal(result.get('root'), 160.75);
    assert.equal(result.get('empty'), 0);
    for (const query of queries) assert.doesNotMatch(query.text, /"status"|"created_at"|"player_type"/);
    assert.ok(queries.find(query => query.text.includes('"casino_bets"'))!.values.includes('cash'));
  });

  it('empty stats and hierarchy requests issue no database reads', async () => {
    const queries = database(() => { throw new Error('Empty request must not issue SQL'); });
    assert.deepEqual(await readAgentListHierarchy([]), []);
    assert.deepEqual(await new AgentListStatsService().getStatsForAgents([], 'brand-a'), new Map());
    assert.equal(queries.length, 0);
  });

  it('keeps CREDIT balance absolute, SHARING pending signed, and POSTED settlement history separate', async () => {
    const roster = [
      { id: 'credit-negative', schemeType: 'CREDIT', settlementBalance: '-120.25' },
      { id: 'credit-positive', schemeType: 'CREDIT', settlementBalance: '45' },
      { id: 'credit-zero', schemeType: 'CREDIT', settlementBalance: null },
      { id: 'sharing', schemeType: 'SHARING' }, { id: 'commission', schemeType: 'COMMISSION' },
    ];
    const chain: any = { from: () => chain, where: async () => roster };
    mock.method(db, 'select', () => chain);
    mock.method(AgentSettlementsRepo.prototype, 'listBatch', async () => [
      { agentId: 'sharing', status: 'OPEN', totalAmount: '1000', periodTo: new Date('2026-10-24') },
      { agentId: 'sharing', status: 'POSTED', totalAmount: '15.50', periodTo: new Date('2026-10-15') },
      { agentId: 'sharing', status: 'POSTED', totalAmount: '5.25', periodTo: new Date('2026-10-01') },
    ] as any);
    const service = new AgentListStatsService() as any;
    service.sharingEngine = { pending: async (agent: { id: string }) => {
      assert.equal(agent.id, 'sharing');
      return { remaining: -67.50 };
    } };
    const stats = new Map<string, any>(roster.map(row => [row.id, service.getDefaultStats()]));
    await service.fetchSettlementInfo(roster.map(row => row.id), stats);
    assert.equal(stats.get('credit-negative').pendingSettlement, 120.25);
    assert.equal(stats.get('credit-positive').pendingSettlement, 45);
    assert.equal(stats.get('credit-zero').pendingSettlement, 0);
    assert.equal(stats.get('sharing').pendingSettlement, -67.5);
    assert.equal(stats.get('sharing').totalSettled, 20.75);
    assert.equal(stats.get('sharing').lastSettlementDate, '2026-10-15T00:00:00.000Z');
    assert.equal(stats.get('commission').pendingSettlement, 0);
    assert.equal(stats.get('commission').totalSettled, null);
  });
});
