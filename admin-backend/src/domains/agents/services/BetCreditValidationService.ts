import { AgentsRepo } from '@/repos/agents/AgentsRepo';
import { AgentPlayerCreditsRepo } from '@/repos/agents/AgentPlayerCreditsRepo';
import { db } from '@/db/client';
import { users, wallets, agentPlayerCredits } from '@shared/db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import * as usersRepo from '@/repos/users/usersRepo.js';
import { getWhitelabelCurrency } from '@src/shared/whitelabelConfig.js';
import { applySettlementDeltas, domainDelta } from '@/repos/agents/creditBalanceSql';

export interface BetCreditValidationResult {
	valid: boolean;
	error?: string;
	creditAvailable?: number;
	creditRequired?: number;
}

export class BetCreditValidationService {
	constructor(
		private agentsRepo: AgentsRepo,
		private playerCreditsRepo: AgentPlayerCreditsRepo
	) {}

	/**
	 * Validate if player has sufficient credit for a bet
	 */
	async validateBetAgainstCredit(
		playerId: number,
		betAmount: number,
		tenant: string = 'default'
	): Promise<BetCreditValidationResult> {
		// Input validation
		if (!Number.isFinite(betAmount) || betAmount <= 0) {
			return {
				valid: false,
				error: `Invalid bet amount: ${betAmount}. Must be a positive number.`,
				creditRequired: betAmount,
			};
		}

		// Get player info
		const [player] = await db
			.select({
				id: users.id,
				playerType: users.playerType,
				agentId: users.agentId,
				creditLimit: users.creditLimit,
				creditUsed: users.creditUsed,
				creditAvailable: users.creditAvailable,
			})
			.from(users)
			.where(and(eq(users.id, playerId), eq(users.tenant, tenant)))
			.limit(1);

		if (!player) {
			return { valid: false, error: 'Player not found' };
		}

		// Only validate credit for credit-based players
		if (player.playerType !== 'AGENT_CREDIT' && player.playerType !== 'WHITELABEL_CREDIT') {
			// Regular players don't use credit system
			return { valid: true };
		}

		const creditLimit = Number(player.creditLimit || 0);
		const creditUsed = Number(player.creditUsed || 0);
		const creditAvailable = Number(player.creditAvailable || 0);

		// Check if bet amount exceeds available credit
		if (creditAvailable < betAmount) {
			return {
				valid: false,
				error: `Insufficient credit. Available: ${creditAvailable}, Required: ${betAmount}`,
				creditAvailable,
				creditRequired: betAmount,
			};
		}

		return {
			valid: true,
			creditAvailable,
			creditRequired: betAmount,
		};
	}

	/**
	 * Lock credit when bet is placed.
	 *
	 * Not called anywhere today (casino locks go through shared casinoCredit.ts and sports
	 * through the exposure recalculation); kept consistent with the credit model (plan W7):
	 * the player's credit_used grows by the stake, agent_player_credits follows, and the
	 * agent's own credit_used is NOT touched (it is the credit the agent handed down).
	 */
	async lockCreditForBet(
		playerId: number,
		betAmount: number,
		tenant: string = 'default',
		betId?: string
	): Promise<void> {
		// Input validation
		if (!Number.isFinite(betAmount) || betAmount <= 0) {
			throw new Error(`Invalid bet amount: ${betAmount}. Must be a positive number.`);
		}

		// Use transaction to ensure atomicity and prevent race conditions
		await db.transaction(async (tx) => {
			// Read player data WITH lock inside transaction to prevent race conditions
			const result = await tx.execute<{
				id: number;
				player_type: string | null;
				agent_id: string | null;
				credit_limit: string | null;
				credit_used: string | null;
				credit_available: string | null;
				settlement_balance: string | null;
			}>(sql`
				SELECT
					id,
					player_type,
					agent_id,
					credit_limit,
					credit_used,
					credit_available,
					settlement_balance
				FROM users
				WHERE id = ${playerId} AND tenant = ${tenant}
				FOR UPDATE
				LIMIT 1
			`);
			const row = (result as any).rows?.[0] || (result as any)[0] || null;

			if (!row) {
				throw new Error('Player not found');
			}

			// Only lock credit for credit-based players
			if (row.player_type !== 'AGENT_CREDIT' && row.player_type !== 'WHITELABEL_CREDIT') {
				return;
			}

			const agentId = row.agent_id;
			// Note: WHITELABEL_CREDIT players don't have an agentId (it's null)
			// Only AGENT_CREDIT players have an agentId

			const currentUsed = Number(row.credit_used || 0);
			const newUsed = currentUsed + betAmount;
			const creditLimit = Number(row.credit_limit || 0);
			const settlementBalance = Number(row.settlement_balance || 0);
			// The player invariant: available = max(0, limit - used + settlement).
			const newAvailable = Math.max(0, creditLimit - newUsed + settlementBalance);

			await usersRepo.lockAndUpdatePlayerCredit(playerId, tenant, {
				creditUsed: newUsed,
				creditAvailable: newAvailable,
			}, tx);

			// AGENT_CREDIT: only the agent's view of this player follows the exposure (one
			// SQL increment). The agent's own row is not touched.
			if (agentId) {
				await tx
					.update(agentPlayerCredits)
					.set({
						openExposure: sql`COALESCE(${agentPlayerCredits.openExposure}, 0)::numeric + ${betAmount}::numeric`,
						creditUsed: sql`COALESCE(${agentPlayerCredits.openExposure}, 0)::numeric + ${betAmount}::numeric`,
						creditAvailable: sql`GREATEST(0, COALESCE(${agentPlayerCredits.creditLimit}, 0)::numeric - (COALESCE(${agentPlayerCredits.openExposure}, 0)::numeric + ${betAmount}::numeric) + COALESCE(${agentPlayerCredits.currentBalance}, 0)::numeric)`,
						updatedAt: new Date(),
					})
					.where(and(
						eq(agentPlayerCredits.agentId, agentId),
						eq(agentPlayerCredits.playerId, playerId)
					));
			}
		});
	}

	/**
	 * Release credit when bet settles.
	 * When `tx` is provided (e.g. from settlement), runs inside that transaction.
	 * Otherwise starts its own transaction (e.g. matka/casino callers).
	 */
	async releaseCreditForBet(
		playerId: number,
		betAmount: number,
		betResult: 'win' | 'loss' | 'void',
		payoutAmount: number,
		tenant: string = 'default',
		betId?: string,
		domain: 'sports' | 'casino' | 'matka' = 'sports',
		externalTx?: any
	): Promise<void> {
		// Input validation
		if (!Number.isFinite(betAmount) || betAmount <= 0) {
			throw new Error(`Invalid bet amount: ${betAmount}. Must be a positive number.`);
		}
		if (!Number.isFinite(payoutAmount) || payoutAmount < 0) {
			throw new Error(`Invalid payout amount: ${payoutAmount}. Must be a non-negative number.`);
		}
		if (!['win', 'loss', 'void'].includes(betResult)) {
			throw new Error(`Invalid bet result: ${betResult}. Must be 'win', 'loss', or 'void'.`);
		}

		let agentId: string | null = null;
		let balanceDelta = 0;
		const exposureRelease = betAmount;

		const run = async (tx: any) => {
			const playerResult = await (tx as any).execute(sql`
				SELECT 
					id,
					player_type,
					agent_id,
					credit_limit,
					credit_used,
					credit_available,
					settlement_balance,
					settlement_balance_sports,
					settlement_balance_casino,
					settlement_balance_matka
				FROM users
				WHERE id = ${playerId} AND tenant = ${tenant}
				FOR UPDATE
				LIMIT 1
			`);
			const playerRow = (playerResult as any).rows?.[0] || (playerResult as any)[0] || null;

			if (!playerRow) {
				throw new Error('Player not found');
			}

			// Only process credit for credit-based players
			if (playerRow.player_type !== 'AGENT_CREDIT' && playerRow.player_type !== 'WHITELABEL_CREDIT') {
				return;
			}

			agentId = playerRow.agent_id;
			// Note: WHITELABEL_CREDIT players don't have an agentId (it's null)
			// Only AGENT_CREDIT players have an agentId

			// Get current domain-specific settlement balances (must match SELECT columns)
			const currentSettlementBalanceSports = Number(playerRow.settlement_balance_sports || 0);
			const currentSettlementBalanceCasino = Number(playerRow.settlement_balance_casino || 0);
			const currentSettlementBalanceMatka = Number(playerRow.settlement_balance_matka || 0);

			// Calculate settlementBalance delta based on bet result
			// When bet settles:
			// - Win: settlementBalance increases by payout (profit)
			// - Loss: settlementBalance decreases by loss amount
			// - Void: no change to settlementBalance

			if (betResult === 'win') {
				// Player wins: settlementBalance increases by payout (profit)
				balanceDelta = payoutAmount;
			} else if (betResult === 'loss') {
				// Player loses: settlementBalance decreases by the actual loss amount
				// For loss, payoutAmount represents the actual loss (may differ from betAmount for fancy markets)
				// Use payoutAmount if provided and positive, otherwise fall back to betAmount
				const actualLoss = payoutAmount > 0 ? payoutAmount : betAmount;
				balanceDelta = -actualLoss;
			} else {
				// Void: just release exposure, no settlementBalance change
				balanceDelta = 0;
			}

			// Update domain-specific settlement balance
			let newSettlementBalanceSports = currentSettlementBalanceSports;
			let newSettlementBalanceCasino = currentSettlementBalanceCasino;
			let newSettlementBalanceMatka = currentSettlementBalanceMatka;

			if (domain === 'sports') {
				newSettlementBalanceSports = currentSettlementBalanceSports + balanceDelta;
			} else if (domain === 'casino') {
				newSettlementBalanceCasino = currentSettlementBalanceCasino + balanceDelta;
			} else if (domain === 'matka') {
				newSettlementBalanceMatka = currentSettlementBalanceMatka + balanceDelta;
			}

			// Update total settlementBalance (sum of all domains)
			const newSettlementBalance = newSettlementBalanceSports + newSettlementBalanceCasino + newSettlementBalanceMatka;

			// Sports: credit_used is book-based; recalc sets it after settlement. Only update settlement here.
			// Casino/Matka: release exposure (credit_used -= betAmount) as before.
			const creditLimit = Number(playerRow.credit_limit || 0);
			let newUsed: number;
			let newAvailable: number;
			if (domain === 'sports') {
				newUsed = Number(playerRow.credit_used || 0); // unchanged; recalc will set
				newAvailable = Math.max(0, creditLimit - newUsed + newSettlementBalance);
			} else {
				const currentUsed = Number(playerRow.credit_used || 0);
				newUsed = Math.max(0, currentUsed - exposureRelease);
				newAvailable = Math.max(0, creditLimit - newUsed + newSettlementBalance);
			}

			// Update player's credit and settlementBalance (including domain-specific balances)
			await usersRepo.lockAndUpdatePlayerCredit(playerId, tenant, {
				creditUsed: newUsed,
				creditAvailable: newAvailable,
				settlementBalance: newSettlementBalance,
				settlementBalanceSports: newSettlementBalanceSports,
				settlementBalanceCasino: newSettlementBalanceCasino,
				settlementBalanceMatka: newSettlementBalanceMatka,
			}, tx);

			// Agent (AGENT_CREDIT players): the settlement delta cascades into the agent's
			// domain settlement balance, as ONE SQL increment (the old code read the agent with
			// a plain SELECT and wrote absolutes back, erasing concurrent settlements).
			// The agent's credit_used is NOT released: it is the credit the agent handed down,
			// not its players' exposure (plan W7), for every domain.
			if (agentId) {
				await applySettlementDeltas(tx, 'agents', agentId, domainDelta(domain, balanceDelta));
			}

			// Whitelabel (WHITELABEL_CREDIT players): the same settlement cascade, also as one
			// SQL increment; whitelabel credit_used is untouched.
			if (!agentId && playerRow.player_type === 'WHITELABEL_CREDIT') {
				const isWhitelabel = tenant && tenant !== 'default';
				if (isWhitelabel) {
					await applySettlementDeltas(tx, 'whitelabels', tenant, domainDelta(domain, balanceDelta));
				}
			}

			// Update player credits record (only for AGENT_CREDIT players)
			// Sports: exposure updated by recalc (book-based). Only balance delta here.
			// Runs inside tx so settlement rollback also reverts agentPlayerCredits.
			if (agentId) {
				const playerCredit = await this.playerCreditsRepo.getPlayerCreditSummary(agentId, playerId, tx);
				if (playerCredit) {
					const exposureDelta = domain === 'sports' ? 0 : -exposureRelease;
					await this.playerCreditsRepo.updatePlayerBalance(
						agentId,
						playerId,
						balanceDelta,
						exposureDelta,
						tx
					);
				}
			}
		};

		if (externalTx) {
			await run(externalTx);
		} else {
			await db.transaction(async (tx) => { await run(tx); });
		}
	}

	/**
	 * Re-lock credit when a bet settlement is reversed/rolled back
	 * This reverses the credit release that happened during settlement.
	 * Pass externalTx to run inside an existing transaction (e.g. reversal).
	 */
	async reLockCreditForBet(
		playerId: number,
		betAmount: number,
		balanceChange: number, // The balance change to reverse (positive = decrease balance, negative = increase balance)
		tenant: string = 'default',
		betId?: string,
		domain: 'sports' | 'casino' | 'matka' = 'sports',
		externalTx?: any
	): Promise<void> {
		// Input validation
		if (!Number.isFinite(betAmount) || betAmount <= 0) {
			throw new Error(`Invalid bet amount: ${betAmount}. Must be a positive number.`);
		}
		if (!Number.isFinite(balanceChange)) {
			throw new Error(`Invalid balance change: ${balanceChange}. Must be a finite number.`);
		}

		let agentId: string | null = null;
		let balanceDelta = 0;
		let exposureReLock = betAmount;
		let currentUsedBefore = 0;
		let newUsedAfter = 0;

		const run = async (tx: any) => {
			const playerResult = await (tx as any).execute(sql`
				SELECT 
					id,
					player_type,
					agent_id,
					credit_limit,
					credit_used,
					credit_available,
					settlement_balance,
					settlement_balance_sports,
					settlement_balance_casino,
					settlement_balance_matka
				FROM users
				WHERE id = ${playerId} AND tenant = ${tenant}
				FOR UPDATE
				LIMIT 1
			`);
			const playerRow = (playerResult as any).rows?.[0] || (playerResult as any)[0] || null;

			if (!playerRow) {
				throw new Error('Player not found');
			}

			if (playerRow.player_type !== 'AGENT_CREDIT' && playerRow.player_type !== 'WHITELABEL_CREDIT') {
				return;
			}

			agentId = playerRow.agent_id;

			const currentSettlementBalance = Number(playerRow.settlement_balance || 0);
			const currentSettlementBalanceSports = Number(playerRow.settlement_balance_sports || 0);
			const currentSettlementBalanceCasino = Number(playerRow.settlement_balance_casino || 0);
			const currentSettlementBalanceMatka = Number(playerRow.settlement_balance_matka || 0);

			balanceDelta = -balanceChange;
			exposureReLock = betAmount;

			let newSettlementBalanceSports = currentSettlementBalanceSports;
			let newSettlementBalanceCasino = currentSettlementBalanceCasino;
			let newSettlementBalanceMatka = currentSettlementBalanceMatka;

			if (domain === 'sports') {
				newSettlementBalanceSports = currentSettlementBalanceSports + balanceDelta;
			} else if (domain === 'casino') {
				newSettlementBalanceCasino = currentSettlementBalanceCasino + balanceDelta;
			} else if (domain === 'matka') {
				newSettlementBalanceMatka = currentSettlementBalanceMatka + balanceDelta;
			}

			const newSettlementBalance = newSettlementBalanceSports + newSettlementBalanceCasino + newSettlementBalanceMatka;
			currentUsedBefore = Number(playerRow.credit_used || 0);
			newUsedAfter = domain === 'sports' ? currentUsedBefore : Math.max(0, currentUsedBefore + exposureReLock);
			const creditLimit = Number(playerRow.credit_limit || 0);
			const newAvailable = Math.max(0, creditLimit - newUsedAfter + newSettlementBalance);

			// Sports: recalc sets credit_used (book-based). Only update settlementBalance here.
			// Casino/Matka: re-lock exposure (credit_used += exposureReLock).
			await usersRepo.lockAndUpdatePlayerCredit(playerId, tenant, {
				creditUsed: newUsedAfter,
				creditAvailable: newAvailable,
				settlementBalance: newSettlementBalance,
				settlementBalanceSports: newSettlementBalanceSports,
				settlementBalanceCasino: newSettlementBalanceCasino,
				settlementBalanceMatka: newSettlementBalanceMatka,
			}, tx);

			// Agent: reverse the settlement delta only, as one SQL increment. Its credit_used
			// (the credit it handed down) is not re-locked with the player's exposure (plan W7).
			if (agentId) {
				await applySettlementDeltas(tx, 'agents', agentId, domainDelta(domain, balanceDelta));
			}

			if (!agentId && playerRow.player_type === 'WHITELABEL_CREDIT') {
				const isWhitelabel = tenant && tenant !== 'default';
				if (isWhitelabel) {
					await applySettlementDeltas(tx, 'whitelabels', tenant, domainDelta(domain, balanceDelta));
				}
			}

			if (agentId) {
				const playerCredit = await this.playerCreditsRepo.getPlayerCreditSummary(agentId, playerId, tx);
				if (playerCredit) {
					const exposureDelta = domain === 'sports' ? 0 : exposureReLock;
					await this.playerCreditsRepo.updatePlayerBalance(
						agentId,
						playerId,
						balanceDelta,
						exposureDelta,
						tx
					);
				}
			}

			const currency = await getWhitelabelCurrency(tenant);
			const { AgentCreditLedgerRepo } = await import('@/repos/agents/AgentCreditLedgerRepo.js');
			const creditLedgerRepo = new AgentCreditLedgerRepo();
			await creditLedgerRepo.recordTransaction({
				tenantId: tenant,
				fromEntityType: 'player',
				fromEntityId: playerId.toString(),
				toEntityType: 'player',
				toEntityId: playerId.toString(),
				transactionType: 'USAGE',
				amount: betAmount,
				currency,
				balanceBefore: currentUsedBefore,
				balanceAfter: newUsedAfter,
				reason: 'Bet settlement reversal - re-lock credit',
				betId: betId,
				createdByType: 'system',
			}, tx);
		};

		if (externalTx) {
			await run(externalTx);
		} else {
			await db.transaction(async (tx) => { await run(tx); });
		}
	}
}

