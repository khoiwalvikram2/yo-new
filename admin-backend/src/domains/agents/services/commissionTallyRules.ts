/**
 * Pure tally rules for commission settlement: used by CommissionCalculationService.
 * Tally OFF: each domain contributes max(0, raw). Tally ON: selected domains form one net; contribution = max(0, groupNet).
 */

export interface EffectiveSettlementResult {
	effectiveSportsCommission: number;
	effectiveCasinoCommission: number;
	effectiveMatkaCommission: number;
	effectiveCalculatedTotal: number;
}

const DOMAINS: ('sports' | 'casino' | 'matka')[] = ['sports', 'casino', 'matka'];

export function applyTallyRulesForSettlement(
	sportsCommission: number,
	casinoCommission: number,
	matkaCommission: number,
	tallyEnabled: boolean,
	tallyDomains: string[] | null | undefined
): EffectiveSettlementResult {
	const raw: Record<'sports' | 'casino' | 'matka', number> = {
		sports: sportsCommission,
		casino: casinoCommission,
		matka: matkaCommission,
	};
	const talliedSet = new Set(
		(tallyDomains ?? []).filter((d): d is 'sports' | 'casino' | 'matka' =>
			DOMAINS.includes(d as 'sports' | 'casino' | 'matka')
		)
	);
	const canTally = Boolean(tallyEnabled) && talliedSet.size > 0;

	if (!canTally) {
		return {
			effectiveSportsCommission: Math.max(0, raw.sports),
			effectiveCasinoCommission: Math.max(0, raw.casino),
			effectiveMatkaCommission: Math.max(0, raw.matka),
			effectiveCalculatedTotal:
				Math.max(0, raw.sports) + Math.max(0, raw.casino) + Math.max(0, raw.matka),
		};
	}

	let effectiveSports = 0;
	let effectiveCasino = 0;
	let effectiveMatka = 0;

	const tallyGroupNet =
		(talliedSet.has('sports') ? raw.sports : 0) +
		(talliedSet.has('casino') ? raw.casino : 0) +
		(talliedSet.has('matka') ? raw.matka : 0);
	const tallyContribution = Math.max(0, tallyGroupNet);

	if (talliedSet.size > 0 && tallyGroupNet > 0) {
		const ratio = tallyContribution / tallyGroupNet;
		if (talliedSet.has('sports')) effectiveSports = raw.sports * ratio;
		if (talliedSet.has('casino')) effectiveCasino = raw.casino * ratio;
		if (talliedSet.has('matka')) effectiveMatka = raw.matka * ratio;
	}

	for (const d of DOMAINS) {
		if (talliedSet.has(d)) continue;
		const v = raw[d];
		if (d === 'sports') effectiveSports = Math.max(0, v);
		else if (d === 'casino') effectiveCasino = Math.max(0, v);
		else effectiveMatka = Math.max(0, v);
	}

	return {
		effectiveSportsCommission: effectiveSports,
		effectiveCasinoCommission: effectiveCasino,
		effectiveMatkaCommission: effectiveMatka,
		effectiveCalculatedTotal: effectiveSports + effectiveCasino + effectiveMatka,
	};
}

/**
 * What the floor removed from a raw commission, for the loss carry-forward: the
 * sum, over the floor buckets, of max(0, -bucket). Tally OFF (or no valid tallied
 * domain): one bucket per domain. Tally ON: the tallied domains form one bucket
 * (their signed sum) and every other domain is its own bucket. The buckets are
 * exactly those of applyTallyRulesForSettlement, so
 * effectiveCalculatedTotal - (sports + casino + matka) equals this figure.
 */
export function floorLossForSettlement(
	sportsCommission: number,
	casinoCommission: number,
	matkaCommission: number,
	tallyEnabled: boolean,
	tallyDomains: string[] | null | undefined
): number {
	const raw: Record<'sports' | 'casino' | 'matka', number> = {
		sports: sportsCommission,
		casino: casinoCommission,
		matka: matkaCommission,
	};
	const talliedSet = new Set(
		(tallyDomains ?? []).filter((d): d is 'sports' | 'casino' | 'matka' =>
			DOMAINS.includes(d as 'sports' | 'casino' | 'matka')
		)
	);
	const canTally = Boolean(tallyEnabled) && talliedSet.size > 0;
	let loss = 0;
	let groupNet = 0;
	for (const d of DOMAINS) {
		if (canTally && talliedSet.has(d)) groupNet += raw[d];
		else loss += Math.max(0, -raw[d]);
	}
	return loss + Math.max(0, -groupNet);
}
