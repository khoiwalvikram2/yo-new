import { db } from '../../db/client';
import {
	agentCommissionConfig,
	agentSharingConfig,
} from '@shared/db/schema.js';
import { and, desc, eq } from 'drizzle-orm';

export type AgentDomain = 'sports' | 'casino' | 'matka';

export class AgentConfigsRepo {
	async setCommissionConfig(params: {
		agentId: string;
		domain: AgentDomain;
		commissionRate: number;
		effectiveFrom: Date;
		effectiveTo?: Date | null;
	}) {
		const [row] = await db
			.insert(agentCommissionConfig)
			.values({
				agentId: params.agentId,
				domain: params.domain,
				commissionRate: String(params.commissionRate),
				effectiveFrom: params.effectiveFrom,
				effectiveTo: params.effectiveTo ?? null,
			})
			.returning();
		return row;
	}

	async getCommissionConfig(agentId: string, domain: AgentDomain, at: Date) {
		const rows = await db
			.select()
			.from(agentCommissionConfig)
			.where(
				and(
					eq(agentCommissionConfig.agentId, agentId),
					eq(agentCommissionConfig.domain, domain)
				)
			)
			.orderBy(desc(agentCommissionConfig.effectiveFrom));
		
		if (rows.length === 0) return null;
		
		// naive effective range resolution
		// If no effectiveTo is set, it means the config is active indefinitely
		// Allow a small buffer (1 second) for timing issues
		const bufferTime = new Date(at.getTime() + 1000);
		const matching = rows.find(
			(r) => {
				const effectiveFrom = new Date(r.effectiveFrom);
				const effectiveTo = r.effectiveTo ? new Date(r.effectiveTo) : null;
				return effectiveFrom <= bufferTime && (!effectiveTo || effectiveTo >= at);
			}
		);
		
		// Return null when no row's [effectiveFrom, effectiveTo] window contains `at`.
		// Do NOT fall back to the latest row: a future-dated or end-dated rate must not
		// apply to out-of-window periods (corrupts commission math / parent-rate-cap checks).
		return matching ?? null;
	}

	async setSharingConfig(params: {
		agentId: string;
		domain: AgentDomain;
		shareRate: number;
		basis?: 'GGR';
		effectiveFrom: Date;
		effectiveTo?: Date | null;
	}) {
		const [row] = await db
			.insert(agentSharingConfig)
			.values({
				agentId: params.agentId,
				domain: params.domain,
				shareRate: String(params.shareRate),
				basis: params.basis ?? 'GGR',
				effectiveFrom: params.effectiveFrom,
				effectiveTo: params.effectiveTo ?? null,
			})
			.returning();
		return row;
	}

	async getSharingConfig(agentId: string, domain: AgentDomain, at: Date) {
		const rows = await db
			.select()
			.from(agentSharingConfig)
			.where(and(eq(agentSharingConfig.agentId, agentId), eq(agentSharingConfig.domain, domain)))
			.orderBy(desc(agentSharingConfig.effectiveFrom));
		
		if (rows.length === 0) return null;
		
		// Allow a small buffer (1 second) for timing issues
		const bufferTime = new Date(at.getTime() + 1000);
		const matching = rows.find(
			(r) => {
				const effectiveFrom = new Date(r.effectiveFrom);
				const effectiveTo = r.effectiveTo ? new Date(r.effectiveTo) : null;
				return effectiveFrom <= bufferTime && (!effectiveTo || effectiveTo >= at);
			}
		);
		
		// Return null when no row's [effectiveFrom, effectiveTo] window contains `at`.
		// Do NOT fall back to the latest row: a future-dated or end-dated rate must not
		// apply to out-of-window periods (corrupts settlement math / parent-rate-cap checks).
		return matching ?? null;
	}
}

