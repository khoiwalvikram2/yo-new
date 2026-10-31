/**
 * Commission settlement cycle utilities — IST only.
 * Used exclusively for COMMISSION agent weekly settlement (Monday 00:00 IST to next Monday 00:00 IST).
 * CREDIT and SHARING flows use tenant timezone via SettlementPeriodUtils; do not use this file for them.
 */

import { DateTime } from 'luxon';
import { getEnv } from '@src/config/env.js';

export const COMMISSION_SETTLEMENT_IST = 'Asia/Kolkata';

export interface CycleBounds {
	from: Date;
	to: Date;
}

/**
 * Get the Monday 00:00 IST to next Monday 00:00 IST period that contains the given date.
 */
export function getMondayToMondayPeriodIST(date: Date): CycleBounds {
	const dt = DateTime.fromJSDate(date, { zone: COMMISSION_SETTLEMENT_IST });
	let monday: DateTime;
	if (dt.weekday === 1) {
		monday = dt;
	} else {
		// Sunday belongs to the same Monday-started week; move back 6 days.
		const daysToSubtract = dt.weekday === 7 ? 6 : dt.weekday - 1;
		monday = dt.minus({ days: daysToSubtract });
	}
	const periodFrom = monday.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });
	const periodTo = periodFrom.plus({ weeks: 1 });
	return {
		from: periodFrom.toJSDate(),
		to: periodTo.toJSDate(),
	};
}

/**
 * Current IST cycle (the open week).
 * For testing: set env COMMISSION_CYCLE_NOW_OVERRIDE to an ISO date (e.g. next Monday) so that
 * "current" cycle shifts and the previous week appears as CLOSED_UNSETTLED for Pay.
 */
export function getCurrentCycleIST(): CycleBounds {
	const override = getEnv().COMMISSION_CYCLE_NOW_OVERRIDE;
	const now =
		override != null && String(override).trim() !== ''
			? (() => {
					const d = new Date(String(override).trim());
					return Number.isNaN(d.getTime()) ? new Date() : d;
				})()
			: new Date();
	const bounds = getMondayToMondayPeriodIST(now);
	return bounds;
}

/**
 * Parse a date string (YYYY-MM-DD or ISO) as midnight 00:00:00 in IST.
 * Frontend often sends YYYY-MM-DD which JS parses as UTC midnight; this re-interprets as IST
 * so commission cycle validation (Monday 00:00 IST) works for last week / any past week.
 */
export function parseCycleDateIST(dateInput: string | Date): Date {
	const s = typeof dateInput === 'string' ? dateInput.trim() : dateInput.toISOString().slice(0, 10);
	const [y, m, d] = s.split('-').map(Number);
	if (!y || !m || !d) return new Date(dateInput);
	const dt = DateTime.fromObject({ year: y, month: m, day: d }, { zone: COMMISSION_SETTLEMENT_IST }).set({
		hour: 0,
		minute: 0,
		second: 0,
		millisecond: 0,
	});
	return dt.toJSDate();
}

/**
 * Validate that from/to form an exact IST Monday->Monday week.
 */
export function validateCycleIST(from: Date, to: Date): { isValid: boolean; error?: string } {
	const fromDt = DateTime.fromJSDate(from, { zone: COMMISSION_SETTLEMENT_IST });
	const toDt = DateTime.fromJSDate(to, { zone: COMMISSION_SETTLEMENT_IST });
	if (fromDt.weekday !== 1) {
		return { isValid: false, error: `Period start must be Monday IST. Got: ${fromDt.toFormat('EEEE')}` };
	}
	if (fromDt.hour !== 0 || fromDt.minute !== 0 || fromDt.second !== 0) {
		return { isValid: false, error: 'Period start must be 00:00:00 IST' };
	}
	const expectedTo = fromDt.plus({ weeks: 1 });
	if (!toDt.hasSame(expectedTo, 'day') || toDt.hour !== 0 || toDt.minute !== 0 || toDt.second !== 0) {
		return { isValid: false, error: 'Period end must be next Monday 00:00:00 IST' };
	}
	return { isValid: true };
}

/**
 * Idempotency/key identity for agent-cycle.
 */
export function getCycleKey(agentId: string, cycleFrom: Date, cycleTo: Date): string {
	const f = DateTime.fromJSDate(cycleFrom, { zone: COMMISSION_SETTLEMENT_IST }).toISO();
	const t = DateTime.fromJSDate(cycleTo, { zone: COMMISSION_SETTLEMENT_IST }).toISO();
	return `${agentId}:${f}:${t}`;
}

/**
 * Whether the given cycle is the current (open) week in IST.
 */
export function isCurrentCycleIST(cycleFrom: Date, cycleTo: Date): boolean {
	const current = getCurrentCycleIST();
	return (
		cycleFrom.getTime() === current.from.getTime() &&
		cycleTo.getTime() === current.to.getTime()
	);
}

/**
 * Return the bounds of the last N completed Monday→Monday IST cycles, ordered
 * newest-first (index 0 = most recent completed cycle, index N-1 = oldest).
 *
 * Safe to call with N=0 (returns []).  Each entry is a { periodFrom, periodTo }
 * pair suitable for passing directly to accrueCommission.
 *
 * Pure utility — no I/O, safe to unit-test without mocking.
 */
export function getLastNCompletedCycles(n: number, now: Date = new Date()): Array<{ periodFrom: Date; periodTo: Date }> {
	if (n <= 0) return [];
	const currentCycle = getMondayToMondayPeriodIST(now);
	const cycles: Array<{ periodFrom: Date; periodTo: Date }> = [];
	for (let w = 1; w <= n; w++) {
		const cycleEnd = DateTime.fromJSDate(currentCycle.from, { zone: COMMISSION_SETTLEMENT_IST })
			.minus({ weeks: w - 1 })
			.toJSDate();
		const cycleStart = DateTime.fromJSDate(cycleEnd, { zone: COMMISSION_SETTLEMENT_IST })
			.minus({ weeks: 1 })
			.toJSDate();
		cycles.push({ periodFrom: cycleStart, periodTo: cycleEnd });
	}
	return cycles;
}

/**
 * Loss carry-forward (one week, approach A) starts with the week of Monday
 * 2026-10-19 00:00 IST: that week's loss is the first that carries into the next
 * week. The loss of an earlier week never carries, so weeks closed before the
 * rule are not recomputed (owner decision 2, 2026-10-22).
 */
export const CARRY_FORWARD_FROM: Date = DateTime.fromObject(
	{ year: 2026, month: 10, day: 19 },
	{ zone: COMMISSION_SETTLEMENT_IST }
).toJSDate();

/** Whether the loss of the cycle that starts at `cycleFrom` carries into the next cycle. */
export function lossCarriesForward(cycleFrom: Date, carryForwardFrom: Date = CARRY_FORWARD_FROM): boolean {
	return cycleFrom.getTime() >= carryForwardFrom.getTime();
}
