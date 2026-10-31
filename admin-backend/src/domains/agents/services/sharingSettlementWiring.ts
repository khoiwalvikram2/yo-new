import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { AgentLedgerRepo } from '@/repos/agents/AgentLedgerRepo';
import { AgentSettlementsRepo } from '@/repos/agents/AgentSettlementsRepo';
import { AgentRateHistoryRepo } from '@/repos/agents/AgentRateHistoryRepo';
import { AgentSettlementTransactionsRepo } from '@/repos/settlements/AgentSettlementTransactionsRepo';
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js';
import { HybridGGRReader } from './HybridGGRReader';
import { LiveGGRReader } from './LiveGGRReader';
import type { VerticalReaders } from './VerticalReaders';
import { SharingSettlementEngine, type SharingEngineDeps, type SharingSettlementWriter } from './SharingSettlementEngine';

/**
 * The real dependencies of SharingSettlementEngine.
 *
 * GGR comes from the same reader the SHARE posting has always used
 * (HybridGGRReader, which delegates to LiveGGRReader: settled bets, operator
 * GGR = stakes − payouts, half-open createdAt window, whitelabel filter, the
 * agent's 'downline' players). Pending figures therefore use the same maths and
 * window as the payout. Rates come from the rate history W1's resolveRateRow
 * writes and checks (AgentRateHistoryRepo.listRows('sharing')), resolved per
 * instant with the same rule as AgentConfigsRepo.getSharingConfig.
 *
 * Open bets: the open window ends before the earliest still-open bet of the
 * same 'downline' players (LiveGGRReader.earliestOpenBetForAgent, the open-bet
 * definition commission readiness uses), so a bet open at settlement time is
 * shared in a later window once it settles. `earliestOpenBetAt: null` turns the
 * hold-back off (tests that inject their own readers).
 */
export function createSharingSettlementEngine(
	opts: {
		readers?: Pick<VerticalReaders, 'getSportsGGR' | 'getCasinoGGR' | 'getMatkaGGR'>;
		earliestOpenBetAt?: SharingEngineDeps['earliestOpenBetAt'] | null;
	} = {}
) {
	const ledgerRepo = new AgentLedgerRepo();
	const settlementsRepo = new AgentSettlementsRepo();
	const rateHistory = new AgentRateHistoryRepo();
	const readers = opts.readers ?? new HybridGGRReader();
	const tzCache = new Map<string, string>();
	let earliestOpenBetAt: SharingEngineDeps['earliestOpenBetAt'];
	if (opts.earliestOpenBetAt !== undefined) {
		earliestOpenBetAt = opts.earliestOpenBetAt ?? undefined;
	} else {
		const openBets = new LiveGGRReader();
		earliestOpenBetAt = (agent, from, to) => openBets.earliestOpenBetForAgent({ agentId: agent.id, from, to, scope: 'downline' });
	}
	return new SharingSettlementEngine({
		readers,
		rateRows: (agentId, domain) => rateHistory.listRows('sharing', agentId, domain),
		ledgerLines: (agentId, from, to) => ledgerRepo.list(agentId, from, to),
		lastPostedSettlement: (agentId) => settlementsRepo.getLastPostedSettlement(agentId),
		timezone: async (tenantId) => {
			const cached = tzCache.get(tenantId);
			if (cached) return cached;
			const tz = await getWhitelabelTimezone(tenantId);
			tzCache.set(tenantId, tz);
			return tz;
		},
		now: () => new Date(),
		earliestOpenBetAt,
	});
}

/**
 * The engine's writes, bound to one transaction. `lockAgent` takes a
 * transaction-scoped advisory lock on the agent, so concurrent settlements of
 * the same SHARING agent run one after the other: the second derives its window
 * and remaining only after the first has committed.
 */
export function createSharingSettlementWriter(tx: any): SharingSettlementWriter {
	const ledgerRepo = new AgentLedgerRepo();
	const settlementsRepo = new AgentSettlementsRepo();
	const transactionsRepo = new AgentSettlementTransactionsRepo();
	return {
		async lockAgent(agentId) {
			await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'sharing-settlement:' + agentId}))`);
		},
		async addLedgerLine(line) {
			await ledgerRepo.addLine(
				{
					agentId: line.agentId,
					domain: line.domain,
					periodFrom: line.periodFrom,
					periodTo: line.periodTo,
					lineType: line.lineType,
					amount: line.amount,
					currency: line.currency,
					refKey: line.refKey ?? null,
					meta: line.meta ?? null,
				},
				tx
			);
		},
		async openAndPostSettlement(p) {
			const row = await settlementsRepo.open(
				{
					agentId: p.agentId,
					periodFrom: p.periodFrom,
					periodTo: p.periodTo,
					totalAmount: p.totalAmount,
					currency: p.currency,
					settledByAgentId: p.settledByAgentId,
				},
				tx
			);
			await settlementsRepo.post({ settlementId: row.id, postedBy: p.postedBy }, tx);
			return { id: row.id };
		},
		async creditWallet(agentId, currency, amount) {
			await settlementsRepo.creditWallet(agentId, currency, amount, tx);
		},
		async recordTransaction(p) {
			return transactionsRepo.create(
				{
					tenant: p.tenant,
					agentId: p.agentId,
					settlementType: p.settlementType,
					amount: p.amount,
					direction: p.direction,
					previousBalance: p.previousBalance,
					newBalance: p.newBalance,
					notes: p.notes,
					settledBy: p.settledBy,
				} as any,
				tx
			);
		},
	};
}

/** Runs a SHARING settlement in one transaction (lock, SHARE top-up, settlement, wallets, ledger, audit row). */
export async function runSharingSettlement(
	params: Omit<Parameters<SharingSettlementEngine['settle']>[0], 'writer'> & { engine?: SharingSettlementEngine }
) {
	const engine = params.engine ?? createSharingSettlementEngine();
	return db.transaction(async (tx) => engine.settle({ ...params, writer: createSharingSettlementWriter(tx) }));
}
