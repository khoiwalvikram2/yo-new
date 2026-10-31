import { AgentsRepo } from '@/repos/agents/AgentsRepo';
import { AgentCreditLedgerRepo } from '@/repos/agents/AgentCreditLedgerRepo';
import { AgentPlayerCreditsRepo } from '@/repos/agents/AgentPlayerCreditsRepo';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import { agents, users, wallets } from '@shared/db/schema.js';
import { eq, and } from 'drizzle-orm';
import * as usersRepo from '@/repos/users/usersRepo.js';
import { getWhitelabelCurrency } from '@src/shared/whitelabelConfig.js';
import {
	applyAgentCreditLimitDelta,
	applyPlayerCreditLimitDelta,
	lockAgentCreditRow,
	lockPlayerCreditRow,
} from '@/repos/agents/creditBalanceSql';
import {
	agentCreditUsedFromAllocations,
	creditAlertTypeFor,
	creditAvailableOf,
	shouldMoveWhitelabelPool,
} from './creditMath';

/** Who started a credit operation, for the credit-ledger row. */
export type CreditActor = { createdBy?: string; createdByType?: 'system' | 'admin' | 'agent' };

async function whitelabelCreditService() {
	const { WhitelabelCreditService } = await import('@src/domains/common/services/WhitelabelCreditService.js');
	const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js');
	return new WhitelabelCreditService(new WhitelabelCreditRepo());
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** agent_credit_ledger.created_by is a uuid column: pass only uuids through. */
function ledgerCreatedBy(actor?: CreditActor): string | undefined {
	return actor?.createdBy && UUID_RE.test(actor.createdBy) ? actor.createdBy : undefined;
}

export interface CreditAllocation {
	agentId: string;
	creditLimit: number;
	creditUsed: number;
	creditAvailable: number;
	creditAlertThreshold: number;
	settlementBalance: number;
	settlementBalanceSports: number;
	settlementBalanceCasino: number;
	settlementBalanceMatka: number;
	usagePercentage: number;
	isOverLimit: boolean;
	isNearThreshold: boolean;
}

export interface CreditAdjustment {
	agentId: string;
	amount: number;
	type: 'allocate' | 'release' | 'adjust';
	reason?: string;
}

export class CreditService {
	constructor(
		private agentsRepo: AgentsRepo,
		private creditLedgerRepo?: AgentCreditLedgerRepo,
		private playerCreditsRepo?: AgentPlayerCreditsRepo
	) {
		if (!this.creditLedgerRepo) {
			this.creditLedgerRepo = new AgentCreditLedgerRepo();
		}
		if (!this.playerCreditsRepo) {
			this.playerCreditsRepo = new AgentPlayerCreditsRepo();
		}
	}

	/**
	 * Get credit allocation details for an agent
	 */
	async getCreditAllocation(agentId: string): Promise<CreditAllocation> {
		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) {
			throw new Error('Agent not found');
		}

		// Use repository method instead of raw SQL
		const creditData = await this.agentsRepo.getCreditFields(agentId);
		if (!creditData) {
			throw new Error('Credit data not found');
		}

		const creditLimit = creditData.creditLimit;
		const creditUsed = creditData.creditUsed;
		const creditAvailable = creditData.creditAvailable;
		const creditAlertThreshold = creditData.creditAlertThreshold;
		const settlementBalance = creditData.settlementBalance;
		const settlementBalanceSports = creditData.settlementBalanceSports;
		const settlementBalanceCasino = creditData.settlementBalanceCasino;
		const settlementBalanceMatka = creditData.settlementBalanceMatka;

		const usagePercentage = creditLimit > 0 ? (creditUsed / creditLimit) * 100 : 0;
		const isOverLimit = creditUsed > creditLimit;
		const isNearThreshold = usagePercentage >= creditAlertThreshold;

		return {
			agentId,
			creditLimit,
			creditUsed,
			creditAvailable,
			creditAlertThreshold,
			settlementBalance,
			settlementBalanceSports,
			settlementBalanceCasino,
			settlementBalanceMatka,
			usagePercentage,
			isOverLimit,
			isNearThreshold,
		};
	}

	/**
	 * Allocate credit to a sub-agent from parent agent's credit.
	 *
	 * Owner decision 2: a sub-agent is funded by its parent, NOT by the whitelabel pool (the
	 * pool was already debited when the root agent's limit was set). The parent's
	 * credit_used grows by `amount` (validated under its FOR UPDATE lock) and the child's
	 * limit grows by `amount` as one SQL increment. The ALLOCATION ledger row is written in
	 * the same transaction.
	 */
	async allocateCreditToSubAgent(
		parentAgentId: string,
		subAgentId: string,
		amount: number,
		reason?: string,
		actor?: CreditActor
	): Promise<void> {
		if (!Number.isFinite(amount) || amount <= 0) {
			throw new Error('Credit amount must be greater than zero');
		}

		// Verify parent-child relationship
		const parentAgent = await this.agentsRepo.findById(parentAgentId);
		if (!parentAgent) {
			throw new Error('Parent agent not found');
		}

		const subAgent = await this.agentsRepo.findById(subAgentId);
		if (!subAgent || subAgent.parentAgentId !== parentAgentId) {
			throw new Error('Invalid parent-child agent relationship');
		}

		const currency = await getWhitelabelCurrency(parentAgent.tenantId);

		await db.transaction(async (tx) => {
			// Lock order for agent pairs: parent, then child (every allocation and release).
			// MONEY-CRITICAL (CR-9): the parent's availability is checked and its credit_used
			// moved under the same FOR UPDATE lock.
			const parentLocked = await this.agentsRepo.lockAndUpdateCredit(parentAgentId, {
				creditUsedDelta: amount,
				requireAvailableForDelta: true,
			}, tx);

			// Child: credit_limit += amount as one SQL increment (no stale read-then-write).
			await applyAgentCreditLimitDelta(tx, subAgentId, amount);

			await this.creditLedgerRepo!.recordTransaction({
				tenantId: parentAgent.tenantId,
				fromEntityType: 'agent',
				fromEntityId: parentAgentId,
				toEntityType: 'agent',
				toEntityId: subAgentId,
				transactionType: 'ALLOCATION',
				amount,
				currency,
				balanceBefore: creditAvailableOf({
					creditLimit: parentLocked.creditLimit,
					creditUsed: parentLocked.creditUsed - amount,
					settlementBalance: parentLocked.settlementBalance,
				}),
				balanceAfter: parentLocked.creditAvailable,
				reason: reason || `Allocated credit to sub-agent ${subAgentId}`,
				createdBy: ledgerCreatedBy(actor),
				createdByType: actor?.createdByType ?? 'agent',
				metadata: { subAgentId, allocationType: 'sub_agent_allocation' },
			}, tx);
		});

		await this.checkCreditAlerts(parentAgentId, subAgentId);

		// Create audit log entry
		const { recordAuditDb } = await import('@/repos/audit/auditRepo');
		// parentAgent is already declared above at line 94, reuse it
		await recordAuditDb({
			tenant: parentAgent?.tenantId || 'default',
			actorId: parentAgentId,
			domain: 'agents',
			action: 'allocate_credit',
			resourceType: 'agent',
			resourceId: subAgentId,
			after: {
				parentAgentId,
				subAgentId,
				amount,
				type: 'allocate',
				reason: reason || 'Credit allocation',
			},
		});
	}

	/**
	 * Release credit from sub-agent back to parent
	 */
	async releaseCreditFromSubAgent(
		parentAgentId: string,
		subAgentId: string,
		amount: number,
		reason?: string,
		actor?: CreditActor
	): Promise<void> {
		if (!Number.isFinite(amount) || amount <= 0) {
			throw new Error('Credit amount must be greater than zero');
		}

		// Verify parent-child relationship
		const subAgent = await this.agentsRepo.findById(subAgentId);
		if (!subAgent || subAgent.parentAgentId !== parentAgentId) {
			throw new Error('Invalid parent-child agent relationship');
		}

		const parentAgent = await this.agentsRepo.findById(parentAgentId);
		if (!parentAgent) {
			throw new Error('Parent agent not found');
		}

		const currency = await getWhitelabelCurrency(parentAgent.tenantId);

		// The exact mirror of allocateCreditToSubAgent: the credit goes back to the parent,
		// never to the whitelabel pool (the allocation never took it from the pool).
		await db.transaction(async (tx) => {
			// Lock order: parent, then child (same as the allocation).
			const parentLocked = await this.agentsRepo.lockAndUpdateCredit(parentAgentId, {
				creditUsedDelta: -amount,
			}, tx);

			// Child: credit_limit -= amount as one SQL decrement. Guarded on the row being
			// updated: the child must have `amount` available, and its limit must still cover
			// what it has handed down itself.
			try {
				await applyAgentCreditLimitDelta(tx, subAgentId, -amount, {
					requireAvailable: amount,
					keepLimitCoveringUsed: true,
				});
			} catch (err: any) {
				throw new Error(`Cannot release credit. ${err?.message ?? err}`);
			}

			await this.creditLedgerRepo!.recordTransaction({
				tenantId: parentAgent.tenantId,
				fromEntityType: 'agent',
				fromEntityId: subAgentId,
				toEntityType: 'agent',
				toEntityId: parentAgentId,
				transactionType: 'RELEASE',
				amount,
				currency,
				balanceBefore: creditAvailableOf({
					creditLimit: parentLocked.creditLimit,
					creditUsed: parentLocked.creditUsed + amount,
					settlementBalance: parentLocked.settlementBalance,
				}),
				balanceAfter: parentLocked.creditAvailable,
				reason: reason || `Released credit from sub-agent ${subAgentId}`,
				createdBy: ledgerCreatedBy(actor),
				createdByType: actor?.createdByType ?? 'agent',
				metadata: { subAgentId, releaseType: 'sub_agent_release' },
			}, tx);
		});

		await this.checkCreditAlerts(parentAgentId, subAgentId);

		// Create audit log entry
		const { recordAuditDb } = await import('@/repos/audit/auditRepo');
		// parentAgent is already declared above, reuse it
		await recordAuditDb({
			tenant: parentAgent?.tenantId || 'default',
			actorId: parentAgentId,
			domain: 'agents',
			action: 'release_credit',
			resourceType: 'agent',
			resourceId: subAgentId,
			after: {
				parentAgentId,
				subAgentId,
				amount,
				type: 'release',
				reason: reason || 'Credit release',
			},
		});
	}

	/**
	 * Adjust agent's credit limit (admin operation)
	 */
	async adjustCreditLimit(agentId: string, newLimit: number, reason?: string, actor?: CreditActor): Promise<void> {
		if (!Number.isFinite(newLimit) || newLimit < 0) {
			throw new Error('Credit limit cannot be negative');
		}

		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) {
			throw new Error('Agent not found');
		}
		// Only a ROOT agent's limit is set directly (from the whitelabel pool). A sub-agent's
		// limit is credit its parent handed down: it moves through allocateCreditToSubAgent /
		// releaseCreditFromSubAgent so the parent's credit_used moves with it.
		if (agent.parentAgentId) {
			throw new Error('A sub-agent\'s credit limit is allocated by its parent agent; adjust it through the parent.');
		}

		const currency = await getWhitelabelCurrency(agent.tenantId);
		const movesPool = shouldMoveWhitelabelPool(agent.tenantId, 'root_agent');

		let before = { creditLimit: 0, creditUsed: 0, creditAvailable: 0 };
		let after = { creditLimit: 0, creditUsed: 0, creditAvailable: 0 };

		await db.transaction(async (tx) => {
			// MONEY-CRITICAL: the limit delta, the "limit covers used" check and the written
			// availability all come from the FOR UPDATE-locked row (the old code computed
			// them from a plain read taken before the transaction and wrote absolutes).
			const locked = await lockAgentCreditRow(tx, agentId);
			if (!locked) {
				throw new Error('Agent not found');
			}
			before = { creditLimit: locked.creditLimit, creditUsed: locked.creditUsed, creditAvailable: locked.creditAvailable };

			// The limit itself must still cover what is already used; the settlement
			// balance is not headroom for lowering the limit.
			if (newLimit - locked.creditUsed < 0) {
				throw new Error(
					`Cannot set limit below current usage. Current usage: ${locked.creditUsed}, New limit: ${newLimit}`
				);
			}

			const limitDelta = Math.round((newLimit - locked.creditLimit) * 100) / 100;
			if (limitDelta === 0) {
				after = before;
				return;
			}

			// Pool: a root agent's limit is the only agent limit drawn from the whitelabel
			// pool. deductCredit / addCredit lock the whitelabel row and re-check under it.
			if (movesPool) {
				const wl = await whitelabelCreditService();
				if (limitDelta > 0) {
					await wl.deductCredit(
						agent.tenantId,
						limitDelta,
						`Root agent ${agentId} credit limit increased from ${locked.creditLimit} to ${newLimit}`,
						tx
					);
				} else {
					await wl.addCredit(
						agent.tenantId,
						Math.abs(limitDelta),
						`Root agent ${agentId} credit limit decreased from ${locked.creditLimit} to ${newLimit}`,
						tx
					);
				}
			}

			const available = creditAvailableOf({
				creditLimit: newLimit,
				creditUsed: locked.creditUsed,
				settlementBalance: locked.settlementBalance,
			});
			await this.agentsRepo.updateCreditBalance(agentId, {
				creditLimit: newLimit,
				creditAvailable: available,
			}, tx);
			after = { creditLimit: newLimit, creditUsed: locked.creditUsed, creditAvailable: available };

			await this.creditLedgerRepo!.recordTransaction({
				tenantId: agent.tenantId,
				fromEntityType: 'whitelabel',
				fromEntityId: agent.tenantId,
				toEntityType: 'agent',
				toEntityId: agentId,
				transactionType: 'ADJUSTMENT',
				amount: Math.abs(limitDelta),
				currency,
				balanceBefore: locked.creditLimit,
				balanceAfter: newLimit,
				reason: reason || 'Credit limit adjustment',
				createdBy: ledgerCreatedBy(actor),
				createdByType: actor?.createdByType ?? 'admin',
			}, tx);
		});

		if (after.creditLimit === before.creditLimit && after.creditAvailable === before.creditAvailable) {
			return;
		}

		// Create audit log entry
		const { recordAuditDb } = await import('@/repos/audit/auditRepo');
		await recordAuditDb({
			tenant: agent.tenantId,
			actorId: actor?.createdBy || 'system',
			domain: 'agents',
			action: 'adjust_credit_limit',
			resourceType: 'agent',
			resourceId: agentId,
			before: { creditLimit: before.creditLimit, creditUsed: before.creditUsed },
			after: { creditLimit: after.creditLimit, creditAvailable: after.creditAvailable, creditUsed: after.creditUsed },
		});

		await this.checkCreditAlerts(agentId);
	}

	/**
	 * Move an agent's credit_used by `amountDelta` (positive uses credit, negative releases
	 * it), then run the alert check.
	 *
	 * Under the credit model (creditMath.ts) an agent's credit_used is the credit it has
	 * handed down, so player bets and payouts do NOT call this. The old body read the row
	 * without a lock and wrote absolutes (and dropped the settlement term); it now applies
	 * a delta under the row's FOR UPDATE lock.
	 */
	async updateCreditUsage(agentId: string, amountDelta: number): Promise<void> {
		if (!Number.isFinite(amountDelta) || amountDelta === 0) return;
		await db.transaction(async (tx) => {
			const locked = await this.agentsRepo.lockAndUpdateCredit(agentId, {
				creditUsedDelta: amountDelta,
				requireAvailableForDelta: amountDelta > 0,
			}, tx);
			if (locked.creditUsed < 0) {
				throw new Error('Credit used cannot be negative');
			}
		});
		await this.checkCreditAlerts(agentId);
	}

	/**
	 * Threshold check for one or more agents, run AFTER a credit operation committed.
	 * Creates an active THRESHOLD_EXCEEDED / OVER_LIMIT alert (at most one active alert per
	 * type) when usage = credit_used / credit_limit reaches the agent's threshold.
	 *
	 * Never throws: alerting must not fail a money operation that already committed.
	 */
	async checkCreditAlerts(...agentIds: Array<string | null | undefined>): Promise<void> {
		const seen = new Set<string>();
		for (const agentId of agentIds) {
			if (!agentId || seen.has(agentId)) continue;
			seen.add(agentId);
			try {
				const creditData = await this.agentsRepo.getCreditFields(agentId);
				if (!creditData) continue;
				const decision = creditAlertTypeFor(creditData);
				if (!decision) continue;
				await this.triggerCreditAlert(agentId, decision.usagePercentage, creditData.creditLimit, creditData.creditUsed, decision.type);
			} catch {
				// Alerting is best-effort by design (see above).
			}
		}
	}

	/**
	 * Validate if agent has sufficient credit for a transaction
	 */
	async validateCreditAvailability(agentId: string, requiredAmount: number): Promise<boolean> {
		const credit = await this.getCreditAllocation(agentId);
		return credit.creditAvailable >= requiredAmount;
	}

	/**
	 * Get credit summary for all sub-agents
	 */
	async getSubAgentsCreditSummary(parentAgentId: string): Promise<CreditAllocation[]> {
		// Get all direct sub-agents
		const subAgents = await this.agentsRepo.listChildren(parentAgentId);

		const summaries = await Promise.all(
			subAgents.map((subAgent) => this.getCreditAllocation(subAgent.id))
		);

		return summaries;
	}

	/**
	 * Set credit alert threshold for an agent
	 */
	async setCreditAlertThreshold(agentId: string, threshold: number): Promise<void> {
		if (threshold < 0 || threshold > 100) {
			throw new Error('Threshold must be between 0 and 100');
		}

		await this.agentsRepo.updateCreditBalance(agentId, {
			creditAlertThreshold: threshold,
		});
	}

	/**
	 * Trigger credit alert (can be extended to send notifications)
	 */
	private async triggerCreditAlert(
		agentId: string,
		usagePercentage: number,
		creditLimit: number,
		creditUsed: number,
		type?: 'THRESHOLD_EXCEEDED' | 'OVER_LIMIT'
	): Promise<void> {
		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) return;

		// Determine alert type
		const alertType = type ?? (creditUsed > creditLimit ? 'OVER_LIMIT' : 'THRESHOLD_EXCEEDED');

		// Store alert in database: at most one ACTIVE alert per type (one statement, so a
		// burst of operations does not stack duplicates).
		const { AgentCreditAlertsRepo } = await import('@/repos/agents/AgentCreditAlertsRepo');
		const alertsRepo = new AgentCreditAlertsRepo();
		const created = await alertsRepo.createAlertIfNoneActive({
			agentId,
			alertType,
			threshold: usagePercentage,
			currentValue: creditUsed,
		});
		if (!created) {
			// Already alerted and not resolved yet: no new alert, no new audit row.
			return;
		}

		// Log to audit trail
		const { recordAuditDb } = await import('@/repos/audit/auditRepo');
		await recordAuditDb({
			tenant: agent.tenantId,
			actorId: 'system',
			domain: 'agents',
			action: 'credit_alert',
			resourceType: 'agent',
			resourceId: agentId,
			after: {
				usagePercentage: usagePercentage.toFixed(2),
				creditLimit,
				creditUsed,
				alertType,
				message: `Credit usage exceeded ${usagePercentage.toFixed(1)}% threshold`,
			},
		});

		// Log to console for monitoring

		// TODO: In production, also:
		// 1. Send email via email service
		// 2. Send in-app notification via websocket/pubsub
	}

	/**
	 * Recalculate credit available from credit limit and usage
	 */
	async recalculateCreditAvailable(agentId: string): Promise<void> {
		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) {
			throw new Error('Agent not found');
		}

		// creditLimit - creditUsed + settlementBalance, computed by Postgres from the row it
		// updates (a plain read followed by an absolute write could erase a concurrent change).
		await db.execute(sql`
			UPDATE agents
			SET credit_available = GREATEST(0, COALESCE(credit_limit, 0) - COALESCE(credit_used, 0) + COALESCE(settlement_balance, 0))
			WHERE id = ${agentId}
		`);
	}

	/**
	 * Allocate credit to a player from agent's credit
	 */
	async allocateCreditToPlayer(
		agentId: string,
		playerId: number,
		amount: number,
		reason?: string
	): Promise<void> {
		if (amount <= 0) {
			throw new Error('Credit amount must be greater than zero');
		}

		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) {
			throw new Error('Agent not found');
		}

		// Validate agent is CREDIT type only - credit operations are not for SHARING agents
		if (agent.schemeType !== 'CREDIT') {
			throw new Error('Credit allocation is only available for CREDIT scheme agents');
		}

		// Fetch currency before the transaction so the ledger insert (inside the tx) does not
		// need a network round-trip while holding row locks.
		const currency = await getWhitelabelCurrency(agent.tenantId);

		// Owner decision 2: an agent's player is funded by the agent, NOT by the whitelabel
		// pool (only WHITELABEL_CREDIT players draw on the pool).
		await db.transaction(async (tx) => {
			// Lock order: player, then agent, then agent_player_credits (as bets do).
			const playerLocked = await lockPlayerCreditRow(tx, playerId, agent.tenantId);
			if (!playerLocked || playerLocked.agentId !== agentId) {
				throw new Error('Player not found or not under this agent');
			}

			// MONEY-CRITICAL (CR-9): deduct from agent via a delta validated under the FOR UPDATE
			// lock so the availability check and the written value share the same locked row.
			const agentLocked = await this.agentsRepo.lockAndUpdateCredit(agentId, {
				creditUsedDelta: amount,
				requireAvailableForDelta: true,
			}, tx);

			// Player: credit_limit += amount as one SQL increment.
			const playerAfter = await applyPlayerCreditLimitDelta(tx, playerId, agent.tenantId, amount);

			// IM-1: the agent_player_credits row follows the player, in the same transaction.
			await this.playerCreditsRepo!.upsertFromPlayer({
				agentId,
				playerId,
				creditLimit: playerAfter.creditLimit,
				creditUsed: playerAfter.creditUsed,
				settlementBalance: playerAfter.settlementBalance,
			}, tx);

			// IM-1: record the ledger entry INSIDE the transaction, using the locked
			// before/after availability (not a separate non-transactional read).
			await this.creditLedgerRepo!.recordTransaction({
				tenantId: agent.tenantId,
				fromEntityType: 'agent',
				fromEntityId: agentId,
				toEntityType: 'player',
				toEntityId: playerId.toString(),
				transactionType: 'ALLOCATION',
				amount,
				currency,
				balanceBefore: creditAvailableOf({
					creditLimit: agentLocked.creditLimit,
					creditUsed: agentLocked.creditUsed - amount,
					settlementBalance: agentLocked.settlementBalance,
				}),
				balanceAfter: agentLocked.creditAvailable,
				reason: reason || 'Credit allocation to player',
				createdByType: 'agent',
			}, tx);
		});

		await this.checkCreditAlerts(agentId);
	}

	/**
	 * Deposit credit (increase credit limit)
	 */
	async depositCredit(
		agentId: string,
		targetEntityType: 'agent' | 'player',
		targetEntityId: string,
		amount: number,
		reason?: string
	): Promise<CreditAllocation> {
		if (amount <= 0) {
			throw new Error('Deposit amount must be greater than zero');
		}

		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) {
			throw new Error('Agent not found');
		}

		if (agent.schemeType !== 'CREDIT') {
			throw new Error('Credit operations are only available for CREDIT scheme agents');
		}

		// Fetch currency before the transaction so the in-tx ledger insert needs no round-trip.
		const currency = await getWhitelabelCurrency(agent.tenantId);
		let agentAvailableBefore = 0;
		let agentAvailableAfter = 0;

		// Owner decision 2: a deposit to a sub-agent or to the agent's own player comes out
		// of the agent's credit, NOT the whitelabel pool.
		await db.transaction(async (tx) => {
			if (targetEntityType === 'agent') {
				// Increase sub-agent's credit limit
				const subAgent = await this.agentsRepo.findById(targetEntityId);
				if (!subAgent || subAgent.parentAgentId !== agentId) {
					throw new Error('Invalid parent-child agent relationship');
				}

				// Lock order: parent, then child.
				// MONEY-CRITICAL (CR-9): deduct from parent via a delta validated under the FOR UPDATE lock.
				const agentLocked = await this.agentsRepo.lockAndUpdateCredit(agentId, {
					creditUsedDelta: amount,
					requireAvailableForDelta: true,
				}, tx);
				agentAvailableAfter = agentLocked.creditAvailable;
				agentAvailableBefore = creditAvailableOf({
					creditLimit: agentLocked.creditLimit,
					creditUsed: agentLocked.creditUsed - amount,
					settlementBalance: agentLocked.settlementBalance,
				});

				// Child: credit_limit += amount as one SQL increment.
				await applyAgentCreditLimitDelta(tx, targetEntityId, amount);
			} else {
				// Increase player's credit limit
				const playerId = parseInt(targetEntityId);
				// Lock order: player, then agent, then agent_player_credits.
				const playerLocked = await lockPlayerCreditRow(tx, playerId, agent.tenantId);
				if (!playerLocked || playerLocked.agentId !== agentId) {
					throw new Error('Player not found or not under this agent');
				}

				// MONEY-CRITICAL (CR-9): deduct from agent via a delta validated under the FOR UPDATE lock.
				const agentLocked = await this.agentsRepo.lockAndUpdateCredit(agentId, {
					creditUsedDelta: amount,
					requireAvailableForDelta: true,
				}, tx);
				agentAvailableAfter = agentLocked.creditAvailable;
				agentAvailableBefore = creditAvailableOf({
					creditLimit: agentLocked.creditLimit,
					creditUsed: agentLocked.creditUsed - amount,
					settlementBalance: agentLocked.settlementBalance,
				});

				// Player: credit_limit += amount as one SQL increment.
				const playerAfter = await applyPlayerCreditLimitDelta(tx, playerId, agent.tenantId, amount);

				// IM-1: the agent_player_credits row follows the player INSIDE the tx.
				await this.playerCreditsRepo!.upsertFromPlayer({
					agentId,
					playerId,
					creditLimit: playerAfter.creditLimit,
					creditUsed: playerAfter.creditUsed,
					settlementBalance: playerAfter.settlementBalance,
				}, tx);
			}

			// IM-1: record the ledger entry INSIDE the transaction using the locked
			// before/after availability so the balance change and ledger commit together.
			await this.creditLedgerRepo!.recordTransaction({
				tenantId: agent.tenantId,
				fromEntityType: 'agent',
				fromEntityId: agentId,
				toEntityType: targetEntityType,
				toEntityId: targetEntityId,
				transactionType: 'DEPOSIT',
				amount,
				currency,
				balanceBefore: agentAvailableBefore,
				balanceAfter: agentAvailableAfter,
				reason: reason || 'Credit deposit',
				createdByType: 'agent',
			}, tx);
		});

		await this.checkCreditAlerts(agentId, targetEntityType === 'agent' ? targetEntityId : null);

		// Return the agent full allocation snapshot after the committed transaction.
		const balanceAfter = await this.getCreditAllocation(agentId);
		return balanceAfter;
	}

	/**
	 * Withdraw credit (decrease credit limit)
	 */
	async withdrawCredit(
		agentId: string,
		targetEntityType: 'agent' | 'player',
		targetEntityId: string,
		amount: number,
		reason?: string
	): Promise<CreditAllocation> {
		if (amount <= 0) {
			throw new Error('Withdrawal amount must be greater than zero');
		}

		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) {
			throw new Error('Agent not found');
		}

		if (agent.schemeType !== 'CREDIT') {
			throw new Error('Credit operations are only available for CREDIT scheme agents');
		}

		// Fetch currency before the transaction so the in-tx ledger insert needs no round-trip.
		const currency = await getWhitelabelCurrency(agent.tenantId);
		let agentAvailableBefore = 0;
		let agentAvailableAfter = 0;

		// The exact mirror of depositCredit: the credit goes back to the agent, never to the
		// whitelabel pool (the deposit never took it from the pool).
		await db.transaction(async (tx) => {
			if (targetEntityType === 'agent') {
				// Decrease sub-agent's credit limit
				const subAgent = await this.agentsRepo.findById(targetEntityId);
				if (!subAgent || subAgent.parentAgentId !== agentId) {
					throw new Error('Invalid parent-child agent relationship');
				}

				// Lock order: parent, then child (same as the deposit).
				const agentLocked = await this.agentsRepo.lockAndUpdateCredit(agentId, {
					creditUsedDelta: -amount,
				}, tx);
				agentAvailableAfter = agentLocked.creditAvailable;
				agentAvailableBefore = creditAvailableOf({
					creditLimit: agentLocked.creditLimit,
					creditUsed: agentLocked.creditUsed + amount,
					settlementBalance: agentLocked.settlementBalance,
				});

				// Child: credit_limit -= amount as one SQL decrement, guarded on the row being
				// updated (enough available, and the limit still covers what it handed down).
				try {
					await applyAgentCreditLimitDelta(tx, targetEntityId, -amount, {
						requireAvailable: amount,
						keepLimitCoveringUsed: true,
					});
				} catch (err: any) {
					throw new Error(`Cannot withdraw credit from the sub-agent. ${err?.message ?? err}`);
				}
			} else {
				// Decrease player's credit limit
				const playerId = parseInt(targetEntityId);
				// Lock order: player, then agent, then agent_player_credits.
				const playerLocked = await lockPlayerCreditRow(tx, playerId, agent.tenantId);
				if (!playerLocked || playerLocked.agentId !== agentId) {
					throw new Error('Player not found or not under this agent');
				}

				// Player: credit_limit -= amount, guarded on the locked row's availability.
				let playerAfter;
				try {
					playerAfter = await applyPlayerCreditLimitDelta(tx, playerId, agent.tenantId, -amount, {
						requireAvailable: amount,
					});
				} catch {
					throw new Error('Player does not have enough available credit');
				}

				// Release credit back to agent (decrease used) via a delta from the locked row.
				const agentLocked = await this.agentsRepo.lockAndUpdateCredit(agentId, {
					creditUsedDelta: -amount,
				}, tx);
				agentAvailableAfter = agentLocked.creditAvailable;
				agentAvailableBefore = creditAvailableOf({
					creditLimit: agentLocked.creditLimit,
					creditUsed: agentLocked.creditUsed + amount,
					settlementBalance: agentLocked.settlementBalance,
				});

				// IM-1: the agent_player_credits row follows the player INSIDE the tx.
				await this.playerCreditsRepo!.upsertFromPlayer({
					agentId,
					playerId,
					creditLimit: playerAfter.creditLimit,
					creditUsed: playerAfter.creditUsed,
					settlementBalance: playerAfter.settlementBalance,
				}, tx);
			}

			// IM-1: record the ledger entry INSIDE the transaction using the locked
			// before/after availability so the balance change and ledger commit together.
			await this.creditLedgerRepo!.recordTransaction({
				tenantId: agent.tenantId,
				fromEntityType: targetEntityType,
				fromEntityId: targetEntityId,
				toEntityType: 'agent',
				toEntityId: agentId,
				transactionType: 'WITHDRAWAL',
				amount,
				currency,
				balanceBefore: agentAvailableBefore,
				balanceAfter: agentAvailableAfter,
				reason: reason || 'Credit withdrawal',
				createdByType: 'agent',
			}, tx);
		});

		await this.checkCreditAlerts(agentId, targetEntityType === 'agent' ? targetEntityId : null);

		// Return the agent full allocation snapshot after the committed transaction.
		const balanceAfter = await this.getCreditAllocation(agentId);
		return balanceAfter;
	}

	/**
	 * Transfer credit between sub-agents
	 */
	async transferCredit(
		parentAgentId: string,
		fromSubAgentId: string,
		toSubAgentId: string,
		amount: number,
		reason?: string
	): Promise<void> {
		if (amount <= 0) {
			throw new Error('Transfer amount must be greater than zero');
		}

		// Verify both sub-agents belong to the same parent
		const fromAgent = await this.agentsRepo.findById(fromSubAgentId);
		const toAgent = await this.agentsRepo.findById(toSubAgentId);

		if (!fromAgent || !toAgent) {
			throw new Error('Sub-agent not found');
		}

		if (fromAgent.parentAgentId !== parentAgentId || toAgent.parentAgentId !== parentAgentId) {
			throw new Error('Both sub-agents must belong to the same parent');
		}

		const parentAgent = await this.agentsRepo.findById(parentAgentId);
		if (!parentAgent) {
			throw new Error('Parent agent not found');
		}

		if (fromSubAgentId === toSubAgentId) {
			throw new Error('Source and destination sub-agents must differ');
		}

		// Transfer credit. The parent's credit_used (Σ its children's limits) and the whitelabel
		// pool are unchanged: the credit only moves between two of the parent's children.
		const currency = await getWhitelabelCurrency(parentAgent.tenantId);
		await db.transaction(async (tx) => {
			// Two SQL increments, applied in agent-id order so two opposite transfers between the
			// same pair cannot deadlock. The source is guarded on its own row (enough available,
			// limit still covering what it handed down); if it fails the whole transfer rolls back.
			const applyFrom = async () => {
				try {
					return await applyAgentCreditLimitDelta(tx, fromSubAgentId, -amount, {
						requireAvailable: amount,
						keepLimitCoveringUsed: true,
					});
				} catch (err: any) {
					throw new Error(`Insufficient credit in source sub-agent. ${err?.message ?? err}`);
				}
			};
			const applyTo = () => applyAgentCreditLimitDelta(tx, toSubAgentId, amount);
			let fromAfter;
			if (fromSubAgentId < toSubAgentId) {
				fromAfter = await applyFrom();
				await applyTo();
			} else {
				await applyTo();
				fromAfter = await applyFrom();
			}

			await this.creditLedgerRepo!.recordTransaction({
				tenantId: parentAgent.tenantId,
				fromEntityType: 'agent',
				fromEntityId: fromSubAgentId,
				toEntityType: 'agent',
				toEntityId: toSubAgentId,
				transactionType: 'TRANSFER',
				amount,
				currency,
				balanceBefore: creditAvailableOf({
					creditLimit: fromAfter.creditLimit + amount,
					creditUsed: fromAfter.creditUsed,
					settlementBalance: fromAfter.settlementBalance,
				}),
				balanceAfter: fromAfter.creditAvailable,
				reason: reason || 'Credit transfer between sub-agents',
				createdByType: 'agent',
			}, tx);
		});

		await this.checkCreditAlerts(fromSubAgentId, toSubAgentId);
	}

	/**
	 * Calculate credit used for an agent: the credit it has handed down,
	 * Σ child agents' credit_limit + Σ direct AGENT_CREDIT players' credit_limit.
	 * Player exposure is not part of it (see creditMath.ts).
	 */
	async calculateCreditUsed(agentId: string): Promise<number> {
		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) {
			throw new Error('Agent not found');
		}
		const { handedDownCreditLimits } = await import('@/repos/agents/CreditCalculationRepo');
		const { childAgentLimits, directPlayerLimits } = await handedDownCreditLimits(db, agentId);
		return agentCreditUsedFromAllocations(childAgentLimits, directPlayerLimits);
	}

	/**
	 * Recalculate credit for entire hierarchy (each agent recomputed under its own row lock).
	 */
	async recalculateCredit(agentId: string): Promise<void> {
		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) {
			throw new Error('Agent not found');
		}

		const { CreditCalculationRepo } = await import('@/repos/agents/CreditCalculationRepo');
		await new CreditCalculationRepo(this.agentsRepo).applyRecalculationForAgent(agentId);
		await this.checkCreditAlerts(agentId);

		// Recursively recalculate for all sub-agents
		const subAgents = await this.agentsRepo.listChildren(agentId);
		for (const subAgent of subAgents) {
			await this.recalculateCredit(subAgent.id);
		}
	}

	/**
	 * Validate if a credit operation is allowed
	 */
	async validateCreditOperation(
		agentId: string,
		operation: 'allocate' | 'deposit' | 'withdraw' | 'transfer',
		amount: number
	): Promise<{ valid: boolean; error?: string }> {
		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) {
			return { valid: false, error: 'Agent not found' };
		}

		if (agent.schemeType !== 'CREDIT') {
			return { valid: false, error: 'Credit operations are only available for CREDIT scheme agents' };
		}

		if (amount <= 0) {
			return { valid: false, error: 'Amount must be greater than zero' };
		}

		const credit = await this.getCreditAllocation(agentId);

		if (operation === 'allocate' || operation === 'deposit') {
			if (credit.creditAvailable < amount) {
				return {
					valid: false,
					error: `Insufficient credit. Available: ${credit.creditAvailable}, Requested: ${amount}`,
				};
			}
		}

		return { valid: true };
	}

	/**
	 * List all whitelabel credit players (players with playerType = 'WHITELABEL_CREDIT' and agentId = null)
	 */
	async listWhitelabelCreditPlayers(tenant: string): Promise<Array<{
		id: number;
		name: string;
		email: string | null;
		phone: string | null;
		creditLimit: number;
		creditUsed: number;
		creditAvailable: number;
	}>> {
		return await usersRepo.getWhitelabelCreditPlayersDb(tenant);
	}

	/**
	 * Adjust credit limit for a whitelabel credit player (no agent involved)
	 */
	async adjustWhitelabelPlayerCreditLimit(
		playerId: number,
		tenant: string,
		newLimit: number,
		reason?: string
	): Promise<void> {
		if (!Number.isFinite(newLimit) || newLimit < 0) {
			throw new Error('Credit limit cannot be negative');
		}

		const currency = await getWhitelabelCurrency(tenant);
		const movesPool = shouldMoveWhitelabelPool(tenant, 'whitelabel_player');

		// A WHITELABEL_CREDIT player's limit is drawn from the whitelabel pool (owner decision
		// 2), as at its creation and in adjustPlayerCredit: the pool moves by the limit delta.
		// Everything is computed from the player's FOR UPDATE-locked row, in one transaction.
		await db.transaction(async (tx) => {
			const locked = await lockPlayerCreditRow(tx, playerId, tenant);
			if (!locked) {
				throw new Error('Player not found');
			}
			if (locked.playerType !== 'WHITELABEL_CREDIT') {
				throw new Error('Player is not a whitelabel credit player');
			}
			if (locked.agentId !== null) {
				throw new Error('Whitelabel credit player must not have an agent');
			}
			if (newLimit < locked.creditUsed) {
				throw new Error(`Credit limit cannot be less than current used credit (${locked.creditUsed})`);
			}

			const limitDelta = Math.round((newLimit - locked.creditLimit) * 100) / 100;
			if (limitDelta === 0) return;

			if (movesPool) {
				const wl = await whitelabelCreditService();
				if (limitDelta > 0) {
					await wl.deductCredit(tenant, limitDelta, `WHITELABEL_CREDIT player limit increased - Player ID: ${playerId}, Limit: ${locked.creditLimit} → ${newLimit}`, tx);
				} else {
					await wl.addCredit(tenant, Math.abs(limitDelta), `WHITELABEL_CREDIT player limit decreased - Player ID: ${playerId}, Limit: ${locked.creditLimit} → ${newLimit}`, tx);
				}
			}

			await applyPlayerCreditLimitDelta(tx, playerId, tenant, limitDelta);

			await this.creditLedgerRepo!.recordTransaction({
				tenantId: tenant,
				fromEntityType: 'whitelabel',
				fromEntityId: tenant,
				toEntityType: 'player',
				toEntityId: playerId.toString(),
				transactionType: 'ADJUSTMENT',
				amount: Math.abs(limitDelta),
				currency,
				balanceBefore: locked.creditLimit,
				balanceAfter: newLimit,
				reason: reason || 'Credit limit adjustment for whitelabel credit player',
				createdByType: 'admin',
			}, tx);
		});
	}

	/**
	 * Deposit credit to a whitelabel credit player (increase credit limit)
	 */
	async depositCreditToWhitelabelPlayer(
		playerId: number,
		tenant: string,
		amount: number,
		reason?: string
	): Promise<void> {
		if (!Number.isFinite(amount) || amount <= 0) {
			throw new Error('Deposit amount must be greater than zero');
		}

		const currency = await getWhitelabelCurrency(tenant);
		const movesPool = shouldMoveWhitelabelPool(tenant, 'whitelabel_player');

		await db.transaction(async (tx) => {
			// Lock order: player, then whitelabel (as bet settlement does).
			const locked = await lockPlayerCreditRow(tx, playerId, tenant);
			if (!locked) {
				throw new Error('Player not found');
			}
			if (locked.playerType !== 'WHITELABEL_CREDIT') {
				throw new Error('Player is not a whitelabel credit player');
			}
			if (locked.agentId !== null) {
				throw new Error('Whitelabel credit player must not have an agent');
			}

			// The credit comes from the whitelabel pool (re-checked under the pool's lock).
			if (movesPool) {
				const wl = await whitelabelCreditService();
				await wl.deductCredit(tenant, amount, `Credit deposit to WHITELABEL_CREDIT player ${playerId}`, tx);
			}

			// Player: credit_limit += amount as one SQL increment.
			const after = await applyPlayerCreditLimitDelta(tx, playerId, tenant, amount);

			await this.creditLedgerRepo!.recordTransaction({
				tenantId: tenant,
				fromEntityType: 'whitelabel',
				fromEntityId: tenant,
				toEntityType: 'player',
				toEntityId: playerId.toString(),
				transactionType: 'DEPOSIT',
				amount,
				currency,
				balanceBefore: after.creditLimit - amount,
				balanceAfter: after.creditLimit,
				reason: reason || 'Credit deposit to whitelabel credit player',
				createdByType: 'admin',
			}, tx);
		});
	}

	/**
	 * Withdraw credit from a whitelabel credit player (decrease credit limit)
	 */
	async withdrawCreditFromWhitelabelPlayer(
		playerId: number,
		tenant: string,
		amount: number,
		reason?: string
	): Promise<void> {
		if (!Number.isFinite(amount) || amount <= 0) {
			throw new Error('Withdrawal amount must be greater than zero');
		}

		const currency = await getWhitelabelCurrency(tenant);
		const movesPool = shouldMoveWhitelabelPool(tenant, 'whitelabel_player');

		await db.transaction(async (tx) => {
			// Lock order: player, then whitelabel (as bet settlement does).
			const locked = await lockPlayerCreditRow(tx, playerId, tenant);
			if (!locked) {
				throw new Error('Player not found');
			}
			if (locked.playerType !== 'WHITELABEL_CREDIT') {
				throw new Error('Player is not a whitelabel credit player');
			}
			if (locked.agentId !== null) {
				throw new Error('Whitelabel credit player must not have an agent');
			}

			// Player: credit_limit -= amount, guarded on the locked row's availability.
			let after;
			try {
				after = await applyPlayerCreditLimitDelta(tx, playerId, tenant, -amount, { requireAvailable: amount });
			} catch {
				throw new Error('Player does not have enough available credit');
			}

			// The exact mirror of the deposit: the credit goes back to the whitelabel pool.
			if (movesPool) {
				const wl = await whitelabelCreditService();
				await wl.addCredit(tenant, amount, `Credit withdrawal from WHITELABEL_CREDIT player ${playerId}`, tx);
			}

			await this.creditLedgerRepo!.recordTransaction({
				tenantId: tenant,
				fromEntityType: 'player',
				fromEntityId: playerId.toString(),
				toEntityType: 'whitelabel',
				toEntityId: tenant,
				transactionType: 'WITHDRAWAL',
				amount,
				currency,
				balanceBefore: after.creditLimit + amount,
				balanceAfter: after.creditLimit,
				reason: reason || 'Credit withdrawal from whitelabel credit player',
				createdByType: 'admin',
			}, tx);
		});
	}
}

