/**
 * Unit tests for getLastNCompletedCycles — pure helper in CommissionCycleUtils.
 * No I/O, no DB. Run with:
 *   node --import tsx --test src/services/__tests__/commissionSchedulerCycles.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getLastNCompletedCycles, validateCycleIST } from '../../domains/agents/services/CommissionCycleUtils.js';

// A known Wednesday in IST: 2026-06-10 (IST), current cycle = Mon 2026-06-08 → Mon 2026-06-15
const KNOWN_WEDNESDAY = new Date('2026-06-10T12:00:00+05:30');

describe('getLastNCompletedCycles', () => {
  it('returns empty array for n=0', () => {
    const result = getLastNCompletedCycles(0, KNOWN_WEDNESDAY);
    assert.deepStrictEqual(result, []);
  });

  it('returns N entries for n=2', () => {
    const result = getLastNCompletedCycles(2, KNOWN_WEDNESDAY);
    assert.strictEqual(result.length, 2);
  });

  it('each returned cycle is a valid Monday->Monday IST period', () => {
    const result = getLastNCompletedCycles(3, KNOWN_WEDNESDAY);
    for (const { periodFrom, periodTo } of result) {
      const { isValid, error } = validateCycleIST(periodFrom, periodTo);
      assert.ok(isValid, `Expected valid cycle but got: ${error ?? 'unknown error'}`);
    }
  });

  it('index 0 is the most recent completed cycle (the week before current)', () => {
    const result = getLastNCompletedCycles(2, KNOWN_WEDNESDAY);
    // Current cycle starts 2026-06-08 IST; most recent completed = 2026-06-01 -> 2026-06-08
    const expectedEnd = new Date('2026-06-08T00:00:00+05:30');
    const expectedStart = new Date('2026-06-01T00:00:00+05:30');
    assert.strictEqual(result[0].periodTo.getTime(), expectedEnd.getTime(), 'periodTo of most recent cycle');
    assert.strictEqual(result[0].periodFrom.getTime(), expectedStart.getTime(), 'periodFrom of most recent cycle');
  });

  it('cycles are contiguous and non-overlapping (newest-first)', () => {
    const result = getLastNCompletedCycles(4, KNOWN_WEDNESDAY);
    for (let i = 0; i < result.length - 1; i++) {
      // Each cycle's periodFrom == next (older) cycle's periodTo
      assert.strictEqual(
        result[i].periodFrom.getTime(),
        result[i + 1].periodTo.getTime(),
        `Cycle ${i} periodFrom should equal cycle ${i + 1} periodTo`
      );
    }
  });

  it('all returned cycles are strictly before current cycle (no current/future cycle)', () => {
    const result = getLastNCompletedCycles(2, KNOWN_WEDNESDAY);
    // Current cycle starts 2026-06-08; all returned periodTo must be <= that
    const currentStart = new Date('2026-06-08T00:00:00+05:30');
    for (const { periodTo } of result) {
      assert.ok(periodTo.getTime() <= currentStart.getTime(), `Unexpected future cycle end: ${periodTo.toISOString()}`);
    }
  });

  it('handles n=1 correctly', () => {
    const result = getLastNCompletedCycles(1, KNOWN_WEDNESDAY);
    assert.strictEqual(result.length, 1);
    const { isValid } = validateCycleIST(result[0].periodFrom, result[0].periodTo);
    assert.ok(isValid);
  });
});
