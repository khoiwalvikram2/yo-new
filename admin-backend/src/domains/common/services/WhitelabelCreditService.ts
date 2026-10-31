import { WhitelabelCreditRepo, WhitelabelCreditFields } from '@/repos/common/whitelabelCreditRepo.js';
import { db } from '@/db/client.js';
import { AgentCreditLedgerRepo } from '@/repos/agents/AgentCreditLedgerRepo.js';
import { getWhitelabelCurrency, getCurrencySymbol } from '@src/shared/whitelabelConfig.js';

export interface WhitelabelCreditAllocation {
	whitelabelId: string;
	creditLimit: number;
	creditUsed: number;
	creditAvailable: number;
	creditAlertThreshold: number;
	settlementBalance: number;
	usagePercentage: number;
	isOverLimit: boolean;
	isNearThreshold: boolean;
}

export class WhitelabelCreditService {
	constructor(
		private whitelabelCreditRepo: WhitelabelCreditRepo,
		private creditLedgerRepo?: AgentCreditLedgerRepo
	) {
		if (!this.creditLedgerRepo) {
			this.creditLedgerRepo = new AgentCreditLedgerRepo();
		}
	}

	/**
	 * Get credit allocation details for a whitelabel
	 */
	async getCreditAllocation(whitelabelId: string): Promise<WhitelabelCreditAllocation> {
		const creditData = await this.whitelabelCreditRepo.getCreditFields(whitelabelId);
		if (!creditData) {
			throw new Error('Whitelabel not found');
		}

		const creditLimit = creditData.creditLimit;
		const creditUsed = creditData.creditUsed;
		const creditAvailable = creditData.creditAvailable;
		const creditAlertThreshold = creditData.creditAlertThreshold;
		const settlementBalance = creditData.settlementBalance;

		const usagePercentage = creditLimit > 0 ? (creditUsed / creditLimit) * 100 : 0;
		const isOverLimit = creditUsed > creditLimit;
		const isNearThreshold = usagePercentage >= creditAlertThreshold;

		return {
			whitelabelId,
			creditLimit,
			creditUsed,
			creditAvailable,
			creditAlertThreshold,
			settlementBalance,
			usagePercentage,
			isOverLimit,
			isNearThreshold,
		};
	}

	/**
	 * Allocate credit to whitelabel (Super Admin assigns credit)
	 */
	async allocateCredit(
		whitelabelId: string,
		amount: number,
		reason?: string
	): Promise<WhitelabelCreditAllocation> {
		if (amount <= 0) {
			throw new Error('Credit amount must be greater than zero');
		}

		const balanceBefore = await this.getCreditAllocation(whitelabelId);

		await db.transaction(async (tx) => {
			const currentCredit = await this.whitelabelCreditRepo.getCreditFields(whitelabelId, tx);
			if (!currentCredit) {
				throw new Error('Whitelabel not found');
			}

			// Increase credit limit and available
			await this.whitelabelCreditRepo.lockAndUpdateCredit(whitelabelId, {
				creditLimit: currentCredit.creditLimit + amount,
				creditAvailable: currentCredit.creditAvailable + amount,
			}, tx);
		});

		// Log transaction
		const currency = await getWhitelabelCurrency(whitelabelId);
		const balanceAfter = await this.getCreditAllocation(whitelabelId);
		await this.creditLedgerRepo!.recordTransaction({
			tenantId: whitelabelId, // Using whitelabelId as tenant identifier
			fromEntityType: 'whitelabel',
			fromEntityId: whitelabelId,
			toEntityType: 'whitelabel',
			toEntityId: whitelabelId,
			transactionType: 'ALLOCATION',
			amount,
			currency,
			balanceBefore: balanceBefore.creditAvailable,
			balanceAfter: balanceAfter.creditAvailable,
			reason: reason || 'Credit allocation by Super Admin',
		});

		return balanceAfter;
	}

	/**
	 * Deduct credit from whitelabel (on deposit or credit allocation)
	 * @param whitelabelId - The whitelabel ID (tenant)
	 * @param amount - Amount to deduct
	 * @param reason - Reason for deduction
	 * @param tx - Optional transaction executor (if provided, uses it; otherwise creates new transaction)
	 * @param playerInfo - Optional player information to store in transaction meta
	 */
	async deductCredit(
		whitelabelId: string,
		amount: number,
		reason?: string,
		tx?: any,
		playerInfo?: { userId: number; playerName?: string; playerEmail?: string; playerUsername?: string }
	): Promise<void> {
		if (amount <= 0) {
			throw new Error('Credit amount must be greater than zero');
		}

		const balanceBefore = await this.getCreditAllocation(whitelabelId);

		const executeInTransaction = async (executor: any) => {
			// MONEY-CRITICAL (CR-9): validate availability AND derive the new used/available
			// under the same FOR UPDATE lock as the write. The delta is re-checked against the
			// locked row, so two concurrent deductions can no longer both pass the check and
			// over-allocate. lockAndUpdateCredit throws if the locked row lacks availability.
			const locked = await this.whitelabelCreditRepo.lockAndUpdateCredit(whitelabelId, {
				creditUsedDelta: amount,
				requireAvailableForDelta: true,
			}, executor);
			const newCreditAvailable = locked.creditAvailable;

			// Log transaction WITHIN the transaction to ensure atomicity
			// This ensures deposits are recorded in credit adjustment history
			// Use 'DEPOSIT' type for better UX clarity when reason indicates a deposit
			const transactionType = reason && reason.toLowerCase().includes('deposit') ? 'DEPOSIT' : 'USAGE';
			const currency = await getWhitelabelCurrency(whitelabelId);
			await this.creditLedgerRepo!.recordTransaction({
				tenantId: whitelabelId,
				fromEntityType: 'whitelabel',
				fromEntityId: whitelabelId,
				toEntityType: 'whitelabel',
				toEntityId: whitelabelId,
				transactionType: transactionType as any,
				amount,
				currency,
				balanceBefore: balanceBefore.creditAvailable,
				balanceAfter: newCreditAvailable,
				reason: reason || 'Credit deduction',
				meta: playerInfo ? {
					playerId: playerInfo.userId,
					playerName: playerInfo.playerName,
					playerEmail: playerInfo.playerEmail,
					playerUsername: playerInfo.playerUsername,
				} : undefined,
			}, executor);
		};

		// Use provided transaction or create new one
		if (tx) {
			await executeInTransaction(tx);
		} else {
			await db.transaction(async (tx) => {
				await executeInTransaction(tx);
			});
		}

		// Check threshold and create notification (only if not in a parent transaction to avoid blocking)
		if (!tx) {
			const balanceAfter = await this.getCreditAllocation(whitelabelId);
			const wasBelowThreshold = balanceBefore.usagePercentage < balanceBefore.creditAlertThreshold;
			const isNowAboveThreshold = balanceAfter.usagePercentage >= balanceAfter.creditAlertThreshold;
			if (wasBelowThreshold && isNowAboveThreshold) {
				try {
					const currency = await getWhitelabelCurrency(whitelabelId);
					const sym = getCurrencySymbol(currency);
					const { NotificationsRepo } = await import('@/repos/notifications/notificationsRepo.js');
					const { NotificationService } = await import('@/domains/notifications/services/NotificationService.js');
					const notificationsRepo = new NotificationsRepo();
					const notificationService = new NotificationService(notificationsRepo);
					const formattedUsage = balanceAfter.usagePercentage.toFixed(1);
					const formattedUsed = balanceAfter.creditUsed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
					const formattedLimit = balanceAfter.creditLimit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
					await notificationService.createNotification(
						{
							tenant: whitelabelId,
							whitelabelId,
							type: 'SYSTEM',
							category: 'general',
							title: 'Whitelabel credit threshold exceeded',
							message: `Whitelabel ${whitelabelId} credit usage (${formattedUsage}%) has exceeded the alert threshold (${balanceAfter.creditAlertThreshold}%). Used: ${sym}${formattedUsed} / Limit: ${sym}${formattedLimit}`,
							actionUrl: `/config/whitelabels/${whitelabelId}`,
							metadata: { whitelabelId, usagePercentage: balanceAfter.usagePercentage, creditUsed: balanceAfter.creditUsed, creditLimit: balanceAfter.creditLimit, threshold: balanceAfter.creditAlertThreshold },
						},
						undefined // No pubsub in service layer
					);
				} catch (err: any) {
				}
			}
		}
	}

	/**
	 * Add credit to whitelabel (on withdrawal)
	 * @param whitelabelId - The whitelabel ID (tenant)
	 * @param amount - Amount to add
	 * @param reason - Reason for addition
	 * @param tx - Optional transaction executor (if provided, uses it; otherwise creates new transaction)
	 * @param playerInfo - Optional player information to store in transaction meta
	 */
	async addCredit(
		whitelabelId: string,
		amount: number,
		reason?: string,
		tx?: any,
		playerInfo?: { userId: number; playerName?: string; playerEmail?: string; playerUsername?: string }
	): Promise<void> {
		if (amount <= 0) {
			throw new Error('Credit amount must be greater than zero');
		}

		const balanceBefore = await this.getCreditAllocation(whitelabelId);

		const executeInTransaction = async (executor: any) => {
			// MONEY-CRITICAL: this used to read the row with an unlocked SELECT,
			// compute `creditUsed - amount`, and write that ABSOLUTE value. A
			// `deductCredit` committing between the read and the write was erased —
			// the release put back credit the deduction had just taken, and the
			// whitelabel got the money for free. `deductCredit` was fixed for exactly
			// this (CR-9) and derives its value under the FOR UPDATE lock; a release
			// is the same operation with the opposite sign, so it uses the same route.
			const locked = await this.whitelabelCreditRepo.lockAndUpdateCredit(whitelabelId, {
				creditUsedDelta: -amount,
			}, executor);
			const newAvailable = locked.creditAvailable;

			// Log transaction WITHIN the transaction to ensure atomicity
			// This ensures withdrawals are recorded in credit adjustment history
			const currency = await getWhitelabelCurrency(whitelabelId);
			await this.creditLedgerRepo!.recordTransaction({
				tenantId: whitelabelId,
				fromEntityType: 'whitelabel',
				fromEntityId: whitelabelId,
				toEntityType: 'whitelabel',
				toEntityId: whitelabelId,
				transactionType: 'RELEASE',
				amount,
				currency,
				balanceBefore: balanceBefore.creditAvailable,
				balanceAfter: newAvailable,
				reason: reason || 'Credit release on withdrawal',
				meta: playerInfo ? {
					playerId: playerInfo.userId,
					playerName: playerInfo.playerName,
					playerEmail: playerInfo.playerEmail,
					playerUsername: playerInfo.playerUsername,
				} : undefined,
			}, executor);
		};

		// Use provided transaction or create new one
		if (tx) {
			await executeInTransaction(tx);
		} else {
			await db.transaction(async (tx) => {
				await executeInTransaction(tx);
			});
		}
	}

	/**
	 * Validate if whitelabel has enough credit available
	 * @param whitelabelId - The whitelabel ID (tenant)
	 * @param amount - Amount to validate
	 * @param tx - Optional transaction executor (if provided, uses it for locked read)
	 */
	async validateCreditAvailable(whitelabelId: string, amount: number, tx?: any): Promise<boolean> {
		const executor = tx || db;
		const creditData = await this.whitelabelCreditRepo.getCreditFields(whitelabelId, executor);
		if (!creditData) {
			throw new Error('Whitelabel not found');
		}
		return creditData.creditAvailable >= amount;
	}

	/**
	 * Adjust credit limit (Super Admin adjusts whitelabel credit)
	 */
	async adjustCreditLimit(
		whitelabelId: string,
		newLimit: number,
		reason?: string
	): Promise<WhitelabelCreditAllocation> {
		const balanceBefore = await this.getCreditAllocation(whitelabelId);
		const limitDelta = newLimit - balanceBefore.creditLimit;

		await this.whitelabelCreditRepo.adjustCreditLimit(whitelabelId, newLimit, reason);

		// Log transaction if limit changed
		if (limitDelta !== 0) {
			const currency = await getWhitelabelCurrency(whitelabelId);
			const balanceAfter = await this.getCreditAllocation(whitelabelId);
			await this.creditLedgerRepo!.recordTransaction({
				tenantId: whitelabelId,
				fromEntityType: 'whitelabel',
				fromEntityId: whitelabelId,
				toEntityType: 'whitelabel',
				toEntityId: whitelabelId,
				transactionType: 'ADJUSTMENT',
				amount: Math.abs(limitDelta),
				currency,
				balanceBefore: balanceBefore.creditAvailable,
				balanceAfter: balanceAfter.creditAvailable,
				reason: reason || 'Credit limit adjustment',
			});
		}

		return await this.getCreditAllocation(whitelabelId);
	}
}

