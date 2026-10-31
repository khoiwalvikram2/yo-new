import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDashboardReportKPIs, type DashboardReportDeps } from '../dashboardService.js';

const range = { dateFrom: '2026-10-01', dateTo: '2026-10-23' };
function recording() {
  const calls: Array<{ source: string; tenant?: string; from?: Date; to?: Date }> = [];
  const deps: DashboardReportDeps = {
    players: async (tenant, from, to) => { calls.push({ source: 'players', tenant, from, to }); return { activePlayers: 2, newPlayers: 1, totalPlayers: 7 }; },
    ledger: async args => { calls.push({ source: 'ledger', tenant: args.tenant, from: args.dateFrom, to: args.dateTo }); return { depositVolume: 100, withdrawalVolume: 40, depositCount: 3, withdrawalCount: 1 }; },
    manual: async args => { calls.push({ source: 'manual', tenant: args.tenant, from: args.dateFrom, to: args.dateTo }); return { manualDepositVolume: 30, manualWithdrawalVolume: 5, manualDepositCount: 1, manualWithdrawalCount: 1 }; },
    tenants: async () => { calls.push({ source: 'tenants' }); return ['a', 'b']; },
  };
  return { deps, calls };
}
describe('Dashboard report-only reads', () => {
  it('an active player count reads only player statistics in the caller tenant and keeps the original date instants', async () => {
    const { deps, calls } = recording();
    assert.deepEqual(await getDashboardReportKPIs('brand', 'brand', range, new Set(['activePlayers']), deps), { activePlayers: 2 });
    assert.deepEqual(calls.map(c => c.source), ['players']); assert.equal(calls[0].tenant, 'brand');
    assert.equal(calls[0].from?.toISOString(), '2026-10-01T00:00:00.000Z'); assert.equal(calls[0].to?.toISOString(), '2026-10-23T00:00:00.000Z');
  });
  it('money totals combine completed request and manual amounts once without player or commission reads', async () => {
    const { deps, calls } = recording();
    assert.deepEqual(await getDashboardReportKPIs('brand', 'brand', range, new Set(['totalDeposits', 'totalWithdrawals', 'netDeposits']), deps), { totalDeposits: 130, totalWithdrawals: 45, netDeposits: 85 });
    assert.deepEqual(calls.map(c => c.source).sort(), ['ledger', 'manual']);
    assert.ok(calls.every(c => c.tenant === 'brand'));
  });
  it('mixed selections reuse each reader and return only the requested fields', async () => {
    const { deps, calls } = recording();
    assert.deepEqual(await getDashboardReportKPIs('brand', 'brand', range, new Set(['newPlayers', 'activePlayers', 'netDeposits']), deps), { newPlayers: 1, activePlayers: 2, netDeposits: 85 });
    assert.deepEqual(calls.map(c => c.source).sort(), ['ledger', 'manual', 'players']);
  });
  it('unknown, financial commission or non-GraphQL selections fall back without running partial reads', async () => {
    const { deps, calls } = recording();
    for (const fields of [undefined, new Set(['activePlayers', 'agentCommission']), new Set(['ggr'])]) assert.equal(await getDashboardReportKPIs('brand', 'brand', range, fields, deps), null);
    assert.deepEqual(await getDashboardReportKPIs('brand', 'brand', range, new Set(), deps), {});
    assert.equal(calls.length, 0);
  });
  it('core mode aggregates tenant-scoped reads across brands instead of reading one unscoped ledger', async () => {
    const { deps, calls } = recording();
    assert.deepEqual(await getDashboardReportKPIs(undefined, undefined, range, new Set(['activePlayers', 'totalDeposits']), deps), { activePlayers: 4, totalDeposits: 260 });
    for (const brand of ['a', 'b']) for (const source of ['players', 'ledger', 'manual']) assert.equal(calls.filter(c => c.tenant === brand && c.source === source).length, 1);
  });
  it('keeps core per-reader fallbacks and propagates a whitelabel read failure as the complete service does', async () => {
    const { deps } = recording();
    deps.players = async () => { throw new Error('Unavailable'); };
    assert.deepEqual(await getDashboardReportKPIs(undefined, undefined, range, new Set(['activePlayers', 'totalDeposits']), deps), { activePlayers: 0, totalDeposits: 260 });
    await assert.rejects(getDashboardReportKPIs('brand', 'brand', range, new Set(['activePlayers']), deps), /Unavailable/);
  });
  it('a later refresh reads current values and an empty platform returns zero counts', async () => {
    const { deps } = recording(); let active = 2;
    deps.players = async () => ({ activePlayers: active, newPlayers: 0, totalPlayers: 7 });
    assert.deepEqual(await getDashboardReportKPIs('brand', 'brand', range, new Set(['activePlayers']), deps), { activePlayers: 2 });
    active = 5;
    assert.deepEqual(await getDashboardReportKPIs('brand', 'brand', range, new Set(['activePlayers']), deps), { activePlayers: 5 });
    deps.tenants = async () => [];
    assert.deepEqual(await getDashboardReportKPIs(undefined, undefined, range, new Set(['activePlayers', 'totalDeposits']), deps), { activePlayers: 0, totalDeposits: 0 });
  });
});
