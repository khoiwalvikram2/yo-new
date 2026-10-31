import { test } from 'vitest';
import assert from 'node:assert/strict';
import { settlementDashboardPeriod as period, settlementPeriodLabel, type SettlementDatePreset } from './settlementDashboardPeriod';

test('quick periods count calendar days inclusively and survive leap/month/year boundaries', () => {
  const now = new Date('2024-03-01T02:00:00Z');
  const expected: Record<Exclude<SettlementDatePreset, 'custom'>, [string, string]> = {
    today: ['2024-03-01', '2024-03-01'], yesterday: ['2024-02-29', '2024-02-29'],
    last7Days: ['2024-02-24', '2024-03-01'], last30Days: ['2024-02-01', '2024-03-01'],
    thisMonth: ['2024-03-01', '2024-03-01'], lastMonth: ['2024-02-01', '2024-02-29'], allTime: ['2000-01-01', '2024-03-01'],
  };
  for (const [preset, [fromDate, toDate]] of Object.entries(expected)) assert.deepEqual(period({ preset: preset as Exclude<SettlementDatePreset, 'custom'> }, 'Asia/Kolkata', now), { fromDate, toDate });
  assert.deepEqual(period({ preset: 'lastMonth' }, 'Asia/Kolkata', new Date('2026-01-02T00:00:00Z')), { fromDate: '2025-12-01', toDate: '2025-12-31' });
});
test('presets use the tenant day independently of the browser day', () => {
  const now = new Date('2026-10-22T19:00:00Z');
  assert.deepEqual(period({ preset: 'today' }, 'Asia/Kolkata', now), { fromDate: '2026-10-23', toDate: '2026-10-23' });
  assert.deepEqual(period({ preset: 'today' }, 'America/New_York', now), { fromDate: '2026-10-22', toDate: '2026-10-22' });
});
test('custom dates stay exact and invalid or reversed ranges are refused', () => {
  assert.deepEqual(period({ preset: 'custom', from: '2026-09-30', to: '2026-10-01' }, 'Asia/Kolkata'), { fromDate: '2026-09-30', toDate: '2026-10-01' });
  for (const [from, to] of [['2026-02-30', '2026-03-01'], ['', '2026-03-01'], ['2026-03-02', '2026-03-01']]) assert.throws(() => period({ preset: 'custom', from, to }, 'Asia/Kolkata'));
  assert.equal(settlementPeriodLabel('2026-10-23', '2026-10-23', 'Asia/Kolkata'), '23 Oct 2026');
});
