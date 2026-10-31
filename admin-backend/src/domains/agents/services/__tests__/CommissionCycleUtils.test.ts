/**
 * Unit tests for CommissionCycleUtils (IST Monday->Monday).
 * Run with: npx tsx src/domains/agents/services/__tests__/CommissionCycleUtils.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getMondayToMondayPeriodIST,
  validateCycleIST,
  getCycleKey,
  isCurrentCycleIST,
} from '../CommissionCycleUtils.js';

describe('CommissionCycleUtils', () => {
  it('getMondayToMondayPeriodIST returns 7-day period containing the given date', () => {
    const wed = new Date('2025-03-05T12:00:00.000Z');
    const period = getMondayToMondayPeriodIST(wed);
    assert.ok(period.from <= wed);
    assert.ok(period.to > wed);
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    assert.ok(Math.abs((period.to.getTime() - period.from.getTime()) - sevenDays) < 1000);
    assert.strictEqual(validateCycleIST(period.from, period.to).isValid, true);
  });

  it('treats Sunday as part of previous Monday-started week (IST)', () => {
    // 1 Mar 2026 is Sunday IST. Expected cycle: 23 Feb -> 2 Mar (IST).
    const sunday = new Date('2026-03-01T12:00:00+05:30');
    const period = getMondayToMondayPeriodIST(sunday);
    assert.strictEqual(
      period.from.toISOString(),
      new Date('2026-02-23T00:00:00+05:30').toISOString(),
    );
    assert.strictEqual(
      period.to.toISOString(),
      new Date('2026-03-02T00:00:00+05:30').toISOString(),
    );
  });

  it('validateCycleIST accepts valid Monday->Monday period in IST', () => {
    const mondayStart = new Date('2025-03-03T00:00:00+05:30');
    const nextMonday = new Date('2025-03-10T00:00:00+05:30');
    const result = validateCycleIST(mondayStart, nextMonday);
    assert.strictEqual(result.isValid, true, result.error);
  });

  it('validateCycleIST rejects non-Monday start', () => {
    const tue = new Date('2025-03-04T00:00:00+05:30');
    const next = new Date('2025-03-11T00:00:00+05:30');
    const result = validateCycleIST(tue, next);
    assert.strictEqual(result.isValid, false);
    assert.ok(result.error?.includes('Monday'));
  });

  it('getCycleKey produces deterministic key', () => {
    const from = new Date('2025-03-03T00:00:00Z');
    const to = new Date('2025-03-10T00:00:00Z');
    const key = getCycleKey('agent-1', from, to);
    assert.ok(key.startsWith('agent-1:'));
    assert.strictEqual(getCycleKey('agent-1', from, to), key);
  });

  it('isCurrentCycleIST returns true only for current week bounds', () => {
    const current = getMondayToMondayPeriodIST(new Date());
    const isCurrent = isCurrentCycleIST(current.from, current.to);
    assert.strictEqual(isCurrent, true);
    const past = new Date(current.from.getTime() - 7 * 24 * 60 * 60 * 1000);
    const pastTo = new Date(current.to.getTime() - 7 * 24 * 60 * 60 * 1000);
    assert.strictEqual(isCurrentCycleIST(past, pastTo), false);
  });

  it('isCurrentCycleIST: current Monday->Monday bounds (derived via utils) are open; previous week is closed (CR-14)', () => {
    // Current open cycle, bounds derived from the same util payCommission uses.
    const current = getMondayToMondayPeriodIST(new Date());
    assert.strictEqual(validateCycleIST(current.from, current.to).isValid, true);
    assert.strictEqual(isCurrentCycleIST(current.from, current.to), true);

    // Previous completed cycle: derive its Monday->Monday bounds via the same util by
    // landing a date inside the prior week (one day before this week's Monday).
    const insidePrevWeek = new Date(current.from.getTime() - 24 * 60 * 60 * 1000);
    const prev = getMondayToMondayPeriodIST(insidePrevWeek);
    assert.strictEqual(validateCycleIST(prev.from, prev.to).isValid, true);
    // The previous cycle's end is exactly the current cycle's start.
    assert.strictEqual(prev.to.getTime(), current.from.getTime());
    // A past/closed cycle must NOT be treated as the current open cycle.
    assert.strictEqual(isCurrentCycleIST(prev.from, prev.to), false);
  });
});
