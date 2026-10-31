import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import { db } from '@src/db/client.js';
import { settlementActivityRange as range, readSettlementDashboardActivity } from '../settlementDashboardActivity.js';

afterEach(() => mock.restoreAll());
describe('Settlement dashboard activity dates', () => {
  it('uses complete local days with an exclusive upper bound at the next midnight', () => {
    const result = range({ fromDate: '2026-10-01', toDate: '2026-10-01' }, 'Asia/Kolkata');
    assert.equal(result.from.toISOString(), '2026-09-30T18:30:00.000Z');
    assert.equal(result.toExclusive.toISOString(), '2026-10-01T18:30:00.000Z');
    assert.equal(result.trendFrom.toISODate(), '2026-10-01');
  });
  it('follows DST and leap days instead of adding a fixed 24 hours', () => {
    const spring = range({ fromDate: '2026-03-08', toDate: '2026-03-08' }, 'America/New_York');
    assert.equal(spring.toExclusive.getTime() - spring.from.getTime(), 23 * 3600000);
    const fall = range({ fromDate: '2026-11-01', toDate: '2026-11-01' }, 'America/New_York');
    assert.equal(fall.toExclusive.getTime() - fall.from.getTime(), 25 * 3600000);
    const leap = range({ fromDate: '2024-02-29', toDate: '2024-02-29' }, 'Asia/Kolkata');
    assert.equal(leap.toDate, '2024-02-29');
  });
  it('rejects partial, malformed, impossible and reversed date ranges', () => {
    for (const args of [{ fromDate: '2026-01-01' }, { toDate: '2026-01-01' }, { fromDate: '', toDate: '' },
      { fromDate: '2026-02-30', toDate: '2026-03-01' }, { fromDate: '2026-01-02', toDate: '2026-01-01' },
      { fromDate: '2026-01-01T00:00:00Z', toDate: '2026-01-02' }]) assert.throws(() => range(args, 'Asia/Kolkata'));
  });
  it('keeps the unfiltered legacy trend at twelve tenant-calendar months', () => {
    const result = range({}, 'Asia/Kolkata', new Date('2026-01-01T00:00:00Z'));
    assert.equal(result.fromDate, '2026-01-01');
    assert.equal(result.trendFrom.toISODate(), '2025-02-01');
  });
  it('aggregates selected activity, fills missing months, scopes all reads and avoids loading ledger rows', async () => {
    const responses = [[{ thisMonth: '500', last30Days: '600', settled: '150', paid: '100', collected: '50' }], [{ thisMonth: '300', paid: '25' }], [{ month: '2026-09', total: '150' }], [{ month: '2026-11', total: '25' }]];
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const dialect = new PgDialect(); let calls = 0;
    mock.method(db, 'select', () => {
      const rows = responses[calls++];
      const chain: any = { from: () => chain, where: (condition: any) => { statements.push(dialect.sqlToQuery(condition)); return chain; }, groupBy: () => chain,
        then: (resolve: (rows: unknown) => unknown) => Promise.resolve(rows).then(resolve) };
      return chain;
    });
    const result = await readSettlementDashboardActivity('tenant-one', 'agent-one', range({ fromDate: '2026-09-30', toDate: '2026-11-01' }, 'Asia/Kolkata', new Date('2026-10-23T12:00:00Z')));
    assert.equal(result.totalPaidToAgentsInPeriod, 100); assert.equal(result.totalCollectedFromAgentsInPeriod, 50); assert.equal(result.totalSettledInPeriod, 150); assert.equal(result.totalCommissionPaidInPeriod, 25);
    assert.equal(result.totalSettledThisMonth, 500); assert.equal(result.totalSettledLast30Days, 600);
    assert.deepEqual(result.monthlyTrend, [{ month: '2026-09', totalSettled: 150, commissionPaid: 0 }, { month: '2026-10', totalSettled: 0, commissionPaid: 0 }, { month: '2026-11', totalSettled: 0, commissionPaid: 25 }]);
    assert.equal(calls, 4);
    for (const statement of statements) { assert.ok(statement.params.includes('tenant-one')); assert.ok(statement.params.includes('agent-one')); assert.match(statement.sql, / >= /); assert.match(statement.sql, / < /); assert.doesNotMatch(statement.sql, / <= /); }
  });
});
