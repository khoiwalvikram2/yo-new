import { db } from '../../db/client';
import { agentCreditAlerts } from '@shared/db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

export interface CreditAlert {
	id: string;
	agentId: string;
	alertType: string;
	threshold: number | null;
	currentValue: number | null;
	isActive: boolean;
	notifiedAt: Date | null;
	createdAt: Date;
}

export interface CreateAlertInput {
	agentId: string;
	alertType: string;
	threshold?: number;
	currentValue?: number;
}

export class AgentCreditAlertsRepo {
	/**
	 * Create a new alert
	 */
	async createAlert(input: CreateAlertInput): Promise<CreditAlert> {
		const [alert] = await db
			.insert(agentCreditAlerts)
			.values({
				agentId: input.agentId,
				alertType: input.alertType,
				threshold: input.threshold ? input.threshold.toString() : null,
				currentValue: input.currentValue ? input.currentValue.toString() : null,
				isActive: true,
			})
			.returning();

		return this.mapToCreditAlert(alert);
	}

	/**
	 * Create an alert unless the agent already has an active alert of the same type.
	 * One statement (INSERT ... WHERE NOT EXISTS), so a burst of credit operations does not
	 * stack duplicate alerts. Returns the new alert, or null when one was already active.
	 */
	async createAlertIfNoneActive(input: CreateAlertInput): Promise<CreditAlert | null> {
		const threshold = input.threshold !== undefined && Number.isFinite(input.threshold)
			? (Math.round(input.threshold * 100) / 100).toString()
			: null;
		const currentValue = input.currentValue !== undefined && Number.isFinite(input.currentValue)
			? input.currentValue.toString()
			: null;
		const result = await db.execute(sql`
			INSERT INTO agent_credit_alerts (agent_id, alert_type, threshold, current_value, is_active)
			SELECT ${input.agentId}, ${input.alertType}, ${threshold}, ${currentValue}, true
			WHERE NOT EXISTS (
				SELECT 1 FROM agent_credit_alerts
				WHERE agent_id = ${input.agentId} AND alert_type = ${input.alertType} AND is_active = true
			)
			RETURNING id, agent_id, alert_type, threshold, current_value, is_active, notified_at, created_at
		`);
		const row = (result as any)?.rows?.[0] ?? (result as any)?.[0] ?? null;
		if (!row) return null;
		return {
			id: row.id,
			agentId: row.agent_id,
			alertType: row.alert_type,
			threshold: row.threshold != null ? Number(row.threshold) : null,
			currentValue: row.current_value != null ? Number(row.current_value) : null,
			isActive: row.is_active,
			notifiedAt: row.notified_at ?? null,
			createdAt: row.created_at,
		};
	}

	/**
	 * Get active alerts for an agent
	 */
	async getActiveAlerts(agentId: string): Promise<CreditAlert[]> {
		const alerts = await db
			.select()
			.from(agentCreditAlerts)
			.where(
				and(
					eq(agentCreditAlerts.agentId, agentId),
					eq(agentCreditAlerts.isActive, true)
				)
			);

		return alerts.map((a) => this.mapToCreditAlert(a));
	}

	/**
	 * Resolve an alert (mark as inactive)
	 */
	async resolveAlert(alertId: string): Promise<void> {
		await db
			.update(agentCreditAlerts)
			.set({ isActive: false })
			.where(eq(agentCreditAlerts.id, alertId));
	}

	/**
	 * Mark alert as notified
	 */
	async markNotified(alertId: string): Promise<void> {
		await db
			.update(agentCreditAlerts)
			.set({ notifiedAt: new Date() })
			.where(eq(agentCreditAlerts.id, alertId));
	}

	/**
	 * Get all alerts for an agent (active and resolved)
	 */
	async getAllAlerts(agentId: string): Promise<CreditAlert[]> {
		const alerts = await db
			.select()
			.from(agentCreditAlerts)
			.where(eq(agentCreditAlerts.agentId, agentId));

		return alerts.map((a) => this.mapToCreditAlert(a));
	}

	/**
	 * Map database row to CreditAlert
	 */
	private mapToCreditAlert(row: any): CreditAlert {
		return {
			id: row.id,
			agentId: row.agentId,
			alertType: row.alertType,
			threshold: row.threshold ? Number(row.threshold) : null,
			currentValue: row.currentValue ? Number(row.currentValue) : null,
			isActive: row.isActive,
			notifiedAt: row.notifiedAt,
			createdAt: row.createdAt,
		};
	}
}

