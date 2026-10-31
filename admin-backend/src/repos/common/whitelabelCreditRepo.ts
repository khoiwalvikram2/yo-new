import { db } from '@src/db/client.js';
import { whitelabels } from '@shared/db/schema.js';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { canApplyCreditDelta } from '@src/domains/agents/services/creditMath.js';

export interface WhitelabelCreditFields {
	creditLimit: number;
	creditUsed: number;
	creditAvailable: number;
	creditAlertThreshold: number;
	settlementBalance: number;
	settlementBalanceSports: number;
	settlementBalanceCasino: number;
	settlementBalanceMatka: number;
}

export class WhitelabelCreditRepo {
	/**
	 * Get current credit fields for a whitelabel
	 */
	async getCreditFields(
		whitelabelId: string,
		executor: any = db
	): Promise<WhitelabelCreditFields | null> {
		const [whitelabel] = await executor
			.select({
				creditLimit: whitelabels.creditLimit,
				creditUsed: whitelabels.creditUsed,
				creditAvailable: whitelabels.creditAvailable,
				creditAlertThreshold: whitelabels.creditAlertThreshold,
				settlementBalance: whitelabels.settlementBalance,
				settlementBalanceSports: whitelabels.settlementBalanceSports,
				settlementBalanceCasino: whitelabels.settlementBalanceCasino,
				settlementBalanceMatka: whitelabels.settlementBalanceMatka,
			})
			.from(whitelabels)
			.where(eq(whitelabels.id, whitelabelId))
			.limit(1);

		if (!whitelabel) {
			return null;
		}

		return {
			creditLimit: Number(whitelabel.creditLimit || 0),
			creditUsed: Number(whitelabel.creditUsed || 0),
			creditAvailable: Number(whitelabel.creditAvailable || 0),
			creditAlertThreshold: Number(whitelabel.creditAlertThreshold || 80),
			settlementBalance: Number(whitelabel.settlementBalance || 0),
			settlementBalanceSports: Number(whitelabel.settlementBalanceSports || 0),
			settlementBalanceCasino: Number(whitelabel.settlementBalanceCasino || 0),
			settlementBalanceMatka: Number(whitelabel.settlementBalanceMatka || 0),
		};
	}

	/**
	 * Lock whitelabel row and update credit fields (for use in transactions)
	 */
	async lockAndUpdateCredit(
		whitelabelId: string,
		updates: {
			creditLimit?: number;
			creditUsed?: number;
			creditAvailable?: number;
			creditAlertThreshold?: number;
			settlementBalance?: number;
			settlementBalanceSports?: number;
			settlementBalanceCasino?: number;
			settlementBalanceMatka?: number;
			/**
			 * MONEY-CRITICAL (CR-9): delta to apply to credit_used, computed and validated
			 * against the FOR-UPDATE-locked row (NOT a stale pre-lock read). When provided,
			 * takes precedence over `creditUsed`/`creditAvailable`; new values are derived from
			 * the locked snapshot, closing the read-check-write race.
			 */
			creditUsedDelta?: number;
			/**
			 * When true and `creditUsedDelta` is positive, rejects if the delta exceeds the
			 * availability of the LOCKED row.
			 */
			requireAvailableForDelta?: boolean;
		},
		tx: any = db
	): Promise<{ creditUsed: number; creditAvailable: number; creditLimit: number; settlementBalance: number }> {
		// Get current values with row lock (FOR UPDATE)
		const result = await (tx as any).execute(sql`
			SELECT 
				credit_limit,
				credit_used,
				credit_available,
				credit_alert_threshold,
				settlement_balance,
				settlement_balance_sports,
				settlement_balance_casino,
				settlement_balance_matka
			FROM whitelabels
			WHERE id = ${whitelabelId}
			FOR UPDATE
			LIMIT 1
		`);
		const row = (result as any).rows?.[0] || (result as any)[0] || null;
		if (!row) {
			throw new Error('Whitelabel not found');
		}
		const currentWhitelabel = {
			creditLimit: row.credit_limit,
			creditUsed: row.credit_used,
			creditAvailable: row.credit_available,
			creditAlertThreshold: row.credit_alert_threshold,
			settlementBalance: row.settlement_balance,
			settlementBalanceSports: row.settlement_balance_sports,
			settlementBalanceCasino: row.settlement_balance_casino,
			settlementBalanceMatka: row.settlement_balance_matka,
		};

		// Calculate new values
		const currentLimit = Number(currentWhitelabel.creditLimit || 0);
		const currentUsed = Number(currentWhitelabel.creditUsed || 0);
		const currentAvailable = Number(currentWhitelabel.creditAvailable || 0);
		const currentThreshold = Number(currentWhitelabel.creditAlertThreshold || 80);
		const currentSettlementBalance = Number(currentWhitelabel.settlementBalance || 0);
		const currentSettlementBalanceSports = Number(currentWhitelabel.settlementBalanceSports || 0);
		const currentSettlementBalanceCasino = Number(currentWhitelabel.settlementBalanceCasino || 0);
		const currentSettlementBalanceMatka = Number(currentWhitelabel.settlementBalanceMatka || 0);

		const newLimit = updates.creditLimit !== undefined ? updates.creditLimit : currentLimit;
		const newSettlementBalanceSports = updates.settlementBalanceSports !== undefined ? updates.settlementBalanceSports : currentSettlementBalanceSports;
		const newSettlementBalanceCasino = updates.settlementBalanceCasino !== undefined ? updates.settlementBalanceCasino : currentSettlementBalanceCasino;
		const newSettlementBalanceMatka = updates.settlementBalanceMatka !== undefined ? updates.settlementBalanceMatka : currentSettlementBalanceMatka;

		// Calculate total settlementBalance (sum of all domains) if not explicitly provided
		const newSettlementBalance = updates.settlementBalance !== undefined
			? updates.settlementBalance
			: (newSettlementBalanceSports + newSettlementBalanceCasino + newSettlementBalanceMatka);

		// MONEY-CRITICAL (CR-9): in delta mode, derive credit_used from the LOCKED snapshot and
		// re-validate availability under the lock so the check and write share the same FOR UPDATE row.
		const usesDelta = updates.creditUsedDelta !== undefined;
		let newUsed: number;
		if (usesDelta) {
			const delta = Number(updates.creditUsedDelta);
			if (updates.requireAvailableForDelta && delta > 0) {
				const check = canApplyCreditDelta(
					{ creditLimit: newLimit, creditUsed: currentUsed, settlementBalance: newSettlementBalance },
					delta,
				);
				if (!check.ok) {
					const available = newLimit - currentUsed + newSettlementBalance;
					throw new Error(
						`Insufficient whitelabel credit. Available: ${available}, Requested: ${delta}`
					);
				}
				newUsed = check.newUsed;
			} else {
				newUsed = currentUsed + delta;
			}
		} else {
			newUsed = updates.creditUsed !== undefined ? updates.creditUsed : currentUsed;
		}

		// Calculate creditAvailable using new formula: creditLimit - creditUsed + settlementBalance.
		// In delta mode always derive from the locked snapshot (ignore stale pre-lock creditAvailable).
		const newAvailable = (!usesDelta && updates.creditAvailable !== undefined)
			? updates.creditAvailable
			: Math.max(0, newLimit - newUsed + newSettlementBalance);
		const newThreshold = updates.creditAlertThreshold !== undefined
			? updates.creditAlertThreshold
			: currentThreshold;

		// Update using Drizzle ORM
		const setValues: any = {};
		if (updates.creditLimit !== undefined) setValues.creditLimit = newLimit.toString();
		if (updates.creditUsed !== undefined || usesDelta) setValues.creditUsed = newUsed.toString();
		if (updates.settlementBalance !== undefined) setValues.settlementBalance = newSettlementBalance.toString();
		if (updates.settlementBalanceSports !== undefined) setValues.settlementBalanceSports = newSettlementBalanceSports.toString();
		if (updates.settlementBalanceCasino !== undefined) setValues.settlementBalanceCasino = newSettlementBalanceCasino.toString();
		if (updates.settlementBalanceMatka !== undefined) setValues.settlementBalanceMatka = newSettlementBalanceMatka.toString();
		if (updates.creditAvailable !== undefined || usesDelta) setValues.creditAvailable = newAvailable.toString();
		if (updates.creditAlertThreshold !== undefined) setValues.creditAlertThreshold = newThreshold.toString();

		setValues.updatedAt = new Date();

		await tx
			.update(whitelabels)
			.set(setValues)
			.where(eq(whitelabels.id, whitelabelId));

		// Return the resulting locked snapshot so callers can record accurate ledger
		// balances derived from the FOR-UPDATE row (not a stale pre-lock read).
		return {
			creditUsed: newUsed,
			creditAvailable: newAvailable,
			creditLimit: newLimit,
			settlementBalance: newSettlementBalance,
		};
	}

	/**
	 * Update credit balance (used and available, recalculating available from limit - used)
	 */
	async updateCreditBalance(
		whitelabelId: string,
		updates: {
			creditUsed?: number;
			creditAvailable?: number;
			settlementBalance?: number;
			settlementBalanceSports?: number;
			settlementBalanceCasino?: number;
			settlementBalanceMatka?: number;
		}
	): Promise<void> {
		const current = await this.getCreditFields(whitelabelId);
		if (!current) {
			throw new Error('Whitelabel not found');
		}

		const newUsed = updates.creditUsed !== undefined ? updates.creditUsed : current.creditUsed;
		const newSettlementBalanceSports = updates.settlementBalanceSports !== undefined ? updates.settlementBalanceSports : current.settlementBalanceSports;
		const newSettlementBalanceCasino = updates.settlementBalanceCasino !== undefined ? updates.settlementBalanceCasino : current.settlementBalanceCasino;
		const newSettlementBalanceMatka = updates.settlementBalanceMatka !== undefined ? updates.settlementBalanceMatka : current.settlementBalanceMatka;
		
		// Calculate total settlementBalance (sum of all domains) if not explicitly provided
		const newSettlementBalance = updates.settlementBalance !== undefined 
			? updates.settlementBalance 
			: (newSettlementBalanceSports + newSettlementBalanceCasino + newSettlementBalanceMatka);
		
		const newAvailable = updates.creditAvailable !== undefined 
			? updates.creditAvailable 
			: Math.max(0, current.creditLimit - newUsed + newSettlementBalance);

		const setValues: any = {
			creditUsed: newUsed.toString(),
			creditAvailable: newAvailable.toString(),
			updatedAt: new Date(),
		};
		if (updates.settlementBalance !== undefined) {
			setValues.settlementBalance = newSettlementBalance.toString();
		}
		if (updates.settlementBalanceSports !== undefined) {
			setValues.settlementBalanceSports = newSettlementBalanceSports.toString();
		}
		if (updates.settlementBalanceCasino !== undefined) {
			setValues.settlementBalanceCasino = newSettlementBalanceCasino.toString();
		}
		if (updates.settlementBalanceMatka !== undefined) {
			setValues.settlementBalanceMatka = newSettlementBalanceMatka.toString();
		}
		
		await db
			.update(whitelabels)
			.set(setValues)
			.where(eq(whitelabels.id, whitelabelId));
	}

	/**
	 * Adjust credit limit (increase or decrease)
	 */
	async adjustCreditLimit(
		whitelabelId: string,
		newLimit: number,
		reason?: string
	): Promise<void> {
		if (newLimit < 0) {
			throw new Error('Credit limit cannot be negative');
		}

		const current = await this.getCreditFields(whitelabelId);
		if (!current) {
			throw new Error('Whitelabel not found');
		}

		const limitDelta = newLimit - current.creditLimit;
		// Calculate new available using formula: creditLimit - creditUsed + settlementBalance
		const newAvailable = Math.max(0, newLimit - current.creditUsed + current.settlementBalance);

		if (newAvailable < 0) {
			throw new Error('Cannot reduce credit limit below current usage');
		}

		await db
			.update(whitelabels)
			.set({
				creditLimit: newLimit.toString(),
				creditAvailable: newAvailable.toString(),
				updatedAt: new Date(),
			})
			.where(eq(whitelabels.id, whitelabelId));
	}
}

