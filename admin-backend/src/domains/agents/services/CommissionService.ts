import { AgentsRepo } from '../../../repos/agents/AgentsRepo';
import { AgentConfigsRepo } from '../../../repos/agents/AgentConfigsRepo';
import { AgentLedgerRepo } from '../../../repos/agents/AgentLedgerRepo';
import { VerticalReaders, ZeroReaders } from './VerticalReaders';

type Domain = 'sports' | 'casino' | 'matka';

export class CommissionService {
	constructor(
		private readonly agentsRepo: AgentsRepo,
		private readonly configsRepo: AgentConfigsRepo,
		private readonly ledgerRepo: AgentLedgerRepo,
		private readonly readers: VerticalReaders = ZeroReaders
	) {}

	// Computes and posts commission ledger lines for the given period.
	// Commission applies only when GGR > 0 (loss-only). For nested agents: parent earns (parent_rate - child_rate) on child's downline GGR.
	async computeAndPost(params: {
		agentId: string;
		from: Date;
		to: Date;
		currency: string;
		pubsub?: any;
	}) {
		const agent = await this.agentsRepo.findById(params.agentId);
		if (!agent) throw new Error('Agent not found');
		if (agent.schemeType !== 'COMMISSION') return [];

		const domainRates: Partial<Record<Domain, number>> = {};
		for (const d of (agent.allowedDomains as Domain[])) {
			const cfg = await this.configsRepo.getCommissionConfig(agent.id, d, params.from);
			if (cfg) domainRates[d] = Number(cfg.commissionRate);
		}

		const results: Array<{ domain: Domain; amount: number }> = [];
		let canTally = false;
		const children = (await this.agentsRepo.listChildren(agent.id)).filter((c) => c.schemeType === 'COMMISSION');
		const hasCommissionChildren = children.length > 0;
		const tenantId = agent.tenantId ?? 'default';

		if (hasCommissionChildren && typeof (this.readers as any).getSportsGGRByAgentIds === 'function') {
			// Hierarchical: direct GGR * rate + sum over children of (child downline GGR * (agent_rate - child_rate))
			const [directSports, directCasino, directMatka] = await Promise.all([
				this.readers.getSportsGGR({ agentId: agent.id, from: params.from, to: params.to, scope: 'direct' }),
				this.readers.getCasinoGGR({ agentId: agent.id, from: params.from, to: params.to, scope: 'direct' }),
				this.readers.getMatkaGGR({ agentId: agent.id, from: params.from, to: params.to, scope: 'direct' }),
			]);
			const directGGR: Record<Domain, number> = {
				sports: directSports.ggr,
				casino: directCasino.ggr,
				matka: directMatka.ggr,
			};

			for (const d of (agent.allowedDomains as Domain[])) {
				const rate = domainRates[d];
				if (rate == null) continue;
				let amount = 0;
				if (directGGR[d] > 0) {
					amount += directGGR[d] * rate;
				}
				for (const child of children) {
					const childCfg = await this.configsRepo.getCommissionConfig(child.id, d, params.from);
					const childRate = childCfg ? Number(childCfg.commissionRate) : 0;
					const diffRate = rate - childRate;
					if (diffRate <= 0) continue;
					const childDescendantIds = await this.agentsRepo.getDescendantIds(child.id);
					const getGgr = (this.readers as any)[`get${d.charAt(0).toUpperCase() + d.slice(1)}GGRByAgentIds`];
					if (typeof getGgr !== 'function') continue;
					const childDownline = await getGgr({
						agentIds: childDescendantIds,
						tenantId,
						from: params.from,
						to: params.to,
					});
					const ggr = childDownline?.ggr ?? 0;
					if (ggr > 0) {
						amount += ggr * diffRate;
					}
				}
				if (amount > 0) {
					results.push({ domain: d, amount });
				}
			}
		} else {
			// Standalone or no GGRByAgentIds: original direct-only logic
			const [sports, casino, matka] = await Promise.all([
				this.readers.getSportsGGR({ agentId: agent.id, from: params.from, to: params.to, scope: 'direct' }),
				this.readers.getCasinoGGR({ agentId: agent.id, from: params.from, to: params.to, scope: 'direct' }),
				this.readers.getMatkaGGR({ agentId: agent.id, from: params.from, to: params.to, scope: 'direct' }),
			]);
			const domainGGR: Record<Domain, number> = {
				sports: sports.ggr,
				casino: casino.ggr,
				matka: matka.ggr,
			};

			canTally =
				Boolean(agent.tallyEnabled) &&
				Array.isArray(agent.tallyDomains) &&
				(agent.tallyDomains as string[]).length > 0;

			if (canTally) {
				const tallyDomains = (agent.tallyDomains as Domain[]).filter(
					(d) => domainRates[d] != null
				);
				const rateValues = tallyDomains.map((d) => domainRates[d] as number);
				const allEqual = rateValues.every((v) => v === rateValues[0]);
				if (allEqual && tallyDomains.length > 0) {
					const combinedNet = tallyDomains.reduce((sum, d) => sum + domainGGR[d], 0);
					if (combinedNet > 0) {
						const amount = combinedNet * (rateValues[0] as number);
						const perDomainAmount = amount / tallyDomains.length;
						for (const d of tallyDomains) {
							results.push({ domain: d, amount: perDomainAmount });
						}
					}
				}
			}

			const talliedSet = new Set((agent.tallyDomains as Domain[] | null) ?? []);
			for (const d of (agent.allowedDomains as Domain[])) {
				const rate = domainRates[d];
				if (rate == null) continue;
				const inTally = canTally && talliedSet.has(d);
				if (inTally) continue;
				const ggr = domainGGR[d];
				if (ggr > 0) {
					results.push({ domain: d, amount: ggr * rate });
				}
			}
		}

		// Post ledger lines
		const posted = await Promise.all(
			results.map((r) =>
				this.ledgerRepo.addLine({
					agentId: params.agentId,
					domain: r.domain,
					periodFrom: params.from,
					periodTo: params.to,
					lineType: 'COMMISSION',
					amount: r.amount,
					currency: params.currency,
					refKey: undefined,
					meta: { basis: 'loss-only', tallied: canTally },
				})
			)
		);

		// Publish subscription events if pubsub is provided
		if (params.pubsub && posted.length > 0) {
			try {
				// Publish agent commission update
				const agentTopic = `AGENT_COMMISSION_${params.agentId}`;
				// Fetch updated commission info to publish
				const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js');
				const { AgentConfigsRepo } = await import('@src/repos/agents/AgentConfigsRepo.js');
				const { AgentLedgerRepo } = await import('@src/repos/agents/AgentLedgerRepo.js');
				const agentsRepo = new AgentsRepo();
				const configsRepo = new AgentConfigsRepo();
				const ledgerRepo = new AgentLedgerRepo();
				
				const now = new Date();
				const commissionRates = [];
				const allowedDomains = agent.allowedDomains || [];
				for (const domain of allowedDomains) {
					try {
						const config = await configsRepo.getCommissionConfig(agent.id, domain as 'sports' | 'casino' | 'matka', now);
						if (config) {
							const rate = Number(config.commissionRate);
							if (Number.isFinite(rate) && rate >= 0) {
								commissionRates.push({
									domain,
									rate: rate * 100,
								});
							}
						}
					} catch (err) {
						// Continue with other domains
					}
				}
				
				const allTimeTotals = await ledgerRepo.getAllTimeTotalsByType(params.agentId, 'COMMISSION');
				const { getCurrentCycleIST } = await import('@src/domains/agents/services/CommissionCycleUtils.js');
				const { from: periodFrom, to: periodTo } = getCurrentCycleIST();
				const currentPeriodTotals = await ledgerRepo.getCurrentPeriodTotalsByType(params.agentId, 'COMMISSION', periodFrom, periodTo);
				
				const allDomains = ['sports', 'casino', 'matka'] as const;
				const allTimeTotalsMap = new Map(allTimeTotals.map(t => [t.domain, t.totalAmount]));
				const currentPeriodTotalsMap = new Map(currentPeriodTotals.map(t => [t.domain, t.totalAmount]));
				
				const commissionInfo = {
					commissionRates,
					allTimeTotals: allDomains.map(domain => ({
						domain,
						totalAmount: allTimeTotalsMap.get(domain) || 0,
					})),
					currentPeriodTotals: allDomains.map(domain => ({
						domain,
						totalAmount: currentPeriodTotalsMap.get(domain) || 0,
					})),
					currency: params.currency,
				};
				
				params.pubsub.publish({
					topic: agentTopic,
					payload: { agentCommissionUpdated: commissionInfo },
				}).catch((err: Error) => {
				});
			} catch (err) {
			}
		}

		return posted;
	}
}

