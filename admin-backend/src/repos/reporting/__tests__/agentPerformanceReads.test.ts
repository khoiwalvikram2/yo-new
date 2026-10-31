import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';

let reads: typeof import('../agentPerformanceReads.js');
before(async () => {
  process.env.DATABASE_URL ||= 'postgresql://unused:unused@localhost/unused';
  reads = await import('../agentPerformanceReads.js');
});
after(async () => { await (await import('@src/db/client.js')).pool.end(); });

const from = new Date('2026-09-01T00:00:00Z');
const to = new Date('2026-09-30T23:59:59Z');
const config = (domain: string, rate: number, effectiveFrom = '2026-09-01', effectiveTo: string | null = null, agentId = 'agent-a') =>
  ({ agentId, domain, rate, effectiveFrom, effectiveTo });
const zero = { sports: 0, casino: 0, matka: 0 };

describe('batched Agent Performance hierarchy', () => {
  it('deduplicates each subtree while preserving membership in different targets', () => {
    const scope = reads.performanceScope(new Map([
      ['agent-a', ['agent-a', 'agent-b', 'agent-b']], ['agent-b', ['agent-b']],
    ]));
    const query = new PgDialect().sqlToQuery(scope);
    assert.equal(query.params.length, 1);
    assert.deepEqual(JSON.parse(String(query.params[0])), [
      { target_id: 'agent-a', agent_id: 'agent-a' },
      { target_id: 'agent-a', agent_id: 'agent-b' },
      { target_id: 'agent-b', agent_id: 'agent-b' },
    ]);
  });
});

describe('Agent Performance rate selection', () => {
  it('chooses the latest overlapping rate per domain, ignoring other agents', () => {
    const rows = { commission: [config('sports', .1), config('sports', .2, '2026-09-15'),
      config('casino', .3, '2026-08-01', '2026-09-01'), config('sports', .9, '2026-10-01'),
      config('sports', .8, '2026-09-20', null, 'agent-b')], share: [] };
    assert.deepEqual(reads.performanceRates('agent-a', 'COMMISSION', rows, from, to, false), {
      commission: { sports: .2, casino: .3, matka: 0 }, share: zero,
    });
  });

  it('uses latest configs when all applicable commission rates are non-positive', () => {
    const rows = { commission: [config('sports', 0), config('sports', .7, '2026-10-01')], share: [] };
    assert.equal(reads.performanceRates('agent-a', 'COMMISSION', rows, from, to, false).commission.sports, .7);
  });

  it('keeps CREDIT period rates when either commission or sharing is positive', () => {
    const rows = { commission: [config('sports', 0), config('sports', .8, '2026-10-01')],
      share: [config('casino', .2), config('casino', .9, '2026-10-01')] };
    const result = reads.performanceRates('agent-a', 'CREDIT', rows, from, to, false);
    assert.deepEqual(result.commission, zero);
    assert.deepEqual(result.share, { sports: 0, casino: .2, matka: 0 });
  });

  it('uses both latest CREDIT rates only when neither period rate is positive', () => {
    const rows = { commission: [config('sports', 0), config('sports', .8, '2026-10-01')],
      share: [config('casino', 0), config('casino', .9, '2026-10-01')] };
    const result = reads.performanceRates('agent-a', 'CREDIT', rows, from, to, false);
    assert.equal(result.commission.sports, .8);
    assert.equal(result.share.casino, .9);
  });

  it('keeps SHARING separate from commission and reads latest configs for cuts', () => {
    const rows = { commission: [config('sports', .8)],
      share: [config('sports', .1), config('sports', .4, '2026-10-01')] };
    assert.deepEqual(reads.performanceRates('agent-a', 'SHARING', rows, from, to, true), {
      commission: zero, share: { sports: .4, casino: 0, matka: 0 },
    });
  });
});

describe('Agent Performance raw-bet fallback', () => {
  it('preserves negative domain GGR and applies each domain rate before summing', () => {
    const data = new reads.AgentPerformanceReads(new Map([['agent-a', 4]]), new Map([
      ['sports', new Map([['agent-a', { agentId: 'agent-a', stakes: '100', payouts: '40', count: '2' }]])],
      ['casino', new Map([['agent-a', { agentId: 'agent-a', stakes: '50', payouts: '80', count: '3' }]])],
    ]), { commission: [config('sports', .1), config('casino', .2)], share: [config('sports', .3), config('casino', .1)] }, from, to);
    assert.deepEqual(data.breakdown('agent-a').map(row => row.ggr), [60, -30, 0]);
    assert.deepEqual(data.fromBets('agent-a', 'CREDIT'), {
      totalTurnover: 150, totalGGR: 30, playerCount: 4, betCount: 5, commissionEarned: 0, shareEarned: 15,
    });
    assert.equal(data.fromBets('agent-a', 'COMMISSION')?.shareEarned, 0);
    assert.equal(data.fromBets('agent-a', 'SHARING')?.commissionEarned, 0);
  });

  it('distinguishes no assigned players from assigned players without settled bets', () => {
    const data = new reads.AgentPerformanceReads(new Map([['agent-a', 2]]), new Map(), { commission: [], share: [] }, from, to);
    assert.equal(data.fromBets('missing', 'COMMISSION'), null);
    assert.deepEqual(data.fromBets('agent-a', 'COMMISSION'), {
      totalTurnover: 0, totalGGR: 0, playerCount: 2, betCount: 0, commissionEarned: 0, shareEarned: 0,
    });
  });
});
