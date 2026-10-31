import { db } from '../../db/client';
import { agentCommissionConfig, agentSharingConfig } from '@shared/db/schema.js';
import { and, asc, eq } from 'drizzle-orm';
import type { RateRow } from '@src/domains/agents/services/agentMutationRules.js';

export type RateKind = 'commission' | 'sharing';
export type RateDomain = 'sports' | 'casino' | 'matka';

/**
 * Read-only view of an agent's rate history for one domain, for the cap checks
 * in setCommissionConfig / setSharingConfig. Rows are append-only: a new row
 * supersedes the earlier ones from its effectiveFrom on (see AgentConfigsRepo).
 */
export class AgentRateHistoryRepo {
	async listRows(kind: RateKind, agentId: string, domain: RateDomain): Promise<RateRow[]> {
		if (kind === 'commission') {
			const rows = await db
				.select({
					effectiveFrom: agentCommissionConfig.effectiveFrom,
					effectiveTo: agentCommissionConfig.effectiveTo,
					rate: agentCommissionConfig.commissionRate,
				})
				.from(agentCommissionConfig)
				.where(and(eq(agentCommissionConfig.agentId, agentId), eq(agentCommissionConfig.domain, domain)))
				.orderBy(asc(agentCommissionConfig.effectiveFrom));
			return rows.map(toRateRow);
		}
		const rows = await db
			.select({
				effectiveFrom: agentSharingConfig.effectiveFrom,
				effectiveTo: agentSharingConfig.effectiveTo,
				rate: agentSharingConfig.shareRate,
			})
			.from(agentSharingConfig)
			.where(and(eq(agentSharingConfig.agentId, agentId), eq(agentSharingConfig.domain, domain)))
			.orderBy(asc(agentSharingConfig.effectiveFrom));
		return rows.map(toRateRow);
	}

	/** The whitelabel's share rate for a domain (the cap on its agents), or null when none is configured. */
	async whitelabelShareCap(tenantId: string, domain: RateDomain): Promise<number | null> {
		const { getWhitelabelSharingConfig } = await import('@/repos/common/whitelabelRepo.js');
		const config = await getWhitelabelSharingConfig(tenantId, domain, new Date());
		return config ? Number(config.shareRate) : null;
	}

	/** The timezone the whitelabel's settlement periods are cut in. */
	async whitelabelTimezone(tenantId: string): Promise<string | null> {
		const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js');
		return getWhitelabelTimezone(tenantId);
	}
}

function toRateRow(r: { effectiveFrom: Date | string; effectiveTo: Date | string | null; rate: string | number }): RateRow {
	return {
		effectiveFrom: r.effectiveFrom instanceof Date ? r.effectiveFrom : new Date(r.effectiveFrom),
		effectiveTo: r.effectiveTo == null ? null : r.effectiveTo instanceof Date ? r.effectiveTo : new Date(r.effectiveTo),
		rate: Number(r.rate),
	};
}
