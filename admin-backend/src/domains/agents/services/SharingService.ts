import { AgentsRepo } from '../../../repos/agents/AgentsRepo';
import { AgentConfigsRepo } from '../../../repos/agents/AgentConfigsRepo';
import { AgentLedgerRepo } from '../../../repos/agents/AgentLedgerRepo';
import { VerticalReaders, ZeroReaders } from './VerticalReaders';
import { SharingSettlementEngine } from './SharingSettlementEngine';

export class SharingService {
	constructor(
		private readonly agentsRepo: AgentsRepo,
		private readonly configsRepo: AgentConfigsRepo,
		private readonly ledgerRepo: AgentLedgerRepo,
		private readonly readers: VerticalReaders = ZeroReaders
	) {}

	/**
	 * Posts the SHARE lines for [from, to) that are not posted yet.
	 *
	 * The share is computed by SharingSettlementEngine — the same function the
	 * pending figures use — so what is posted is what was shown:
	 *  - GGR x rate per rate segment (a rate change inside the window applies from
	 *    its effectiveFrom on; before, the rate at `from` applied to the whole
	 *    window);
	 *  - lines tile the window: when lines already sit inside it (an earlier partial
	 *    settlement of an extended window), only the difference is posted, for the
	 *    uncovered tail, so the window's lines never overlap and all-time SHARE
	 *    totals are not inflated.
	 *
	 * The SHARING settle mutation calls the engine directly, inside its
	 * transaction; this method remains for the legacy CREDIT path
	 * (SettlementService.settle).
	 */
	async computeAndPost(params: {
		agentId: string;
		from: Date;
		to: Date;
		currency: string;
		pubsub?: any;
	}) {
		const agent = await this.agentsRepo.findById(params.agentId);
		if (!agent) throw new Error('Agent not found');
		if (agent.schemeType !== 'SHARING' && agent.schemeType !== 'CREDIT') return [];

		const { AgentRateHistoryRepo } = await import('../../../repos/agents/AgentRateHistoryRepo');
		const { AgentSettlementsRepo } = await import('../../../repos/agents/AgentSettlementsRepo');
		const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js');
		const rateHistory = new AgentRateHistoryRepo();
		const settlementsRepo = new AgentSettlementsRepo();
		const engine = new SharingSettlementEngine({
			readers: this.readers,
			rateRows: (agentId, domain) => rateHistory.listRows('sharing', agentId, domain),
			ledgerLines: (agentId, from, to) => this.ledgerRepo.list(agentId, from, to),
			lastPostedSettlement: (agentId) => settlementsRepo.getLastPostedSettlement(agentId),
			timezone: (tenantId) => getWhitelabelTimezone(tenantId),
			now: () => new Date(),
		});
		const state = await engine.windowState(agent, params.from, params.to);

		const posted = [];
		for (const line of state.plan.newLines) {
			posted.push(
				await this.ledgerRepo.addLine({
					agentId: params.agentId,
					domain: line.domain,
					periodFrom: line.periodFrom,
					periodTo: line.periodTo,
					lineType: 'SHARE',
					amount: line.amount,
					currency: params.currency,
					refKey: undefined,
					meta: {
						basis: 'GGR',
						window: { from: params.from.toISOString(), to: params.to.toISOString() },
						windowShare: state.plan.shareByDomain[line.domain],
					},
				})
			);
		}

		// Publish subscription events if pubsub is provided
		if (params.pubsub && posted.length > 0) {
			try {
				// Publish agent sharing update
				const agentTopic = `AGENT_SHARING_${params.agentId}`;
				// Fetch updated sharing info to publish
				const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js');
				const { AgentConfigsRepo } = await import('@src/repos/agents/AgentConfigsRepo.js');
				const { AgentLedgerRepo } = await import('@src/repos/agents/AgentLedgerRepo.js');
				const agentsRepo = new AgentsRepo();
				const configsRepo = new AgentConfigsRepo();
				const ledgerRepo = new AgentLedgerRepo();
				
				const now = new Date();
				const sharingRates = [];
				const allowedDomains = agent.allowedDomains || [];
				for (const domain of allowedDomains) {
					try {
						const config = await configsRepo.getSharingConfig(agent.id, domain as 'sports' | 'casino' | 'matka', now);
						if (config) {
							const rate = Number(config.shareRate);
							if (Number.isFinite(rate) && rate >= 0) {
								sharingRates.push({
									domain,
									rate: rate * 100,
								});
							}
						}
					} catch (err) {
						// Continue with other domains
					}
				}
				
				const allTimeTotals = await ledgerRepo.getAllTimeTotalsByType(params.agentId, 'SHARE');
				const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js');
				const { getStartOfMonth, getEndOfMonth } = await import('@src/shared/dateUtils.js');
				const tz = await getWhitelabelTimezone(agent.tenantId);
				const periodFrom = getStartOfMonth(tz);
				const periodTo = getEndOfMonth(tz);
				const currentPeriodTotals = await ledgerRepo.getCurrentPeriodTotalsByType(params.agentId, 'SHARE', periodFrom, periodTo);
				
				const allDomains = ['sports', 'casino', 'matka'] as const;
				const allTimeTotalsMap = new Map(allTimeTotals.map(t => [t.domain, t.totalAmount]));
				const currentPeriodTotalsMap = new Map(currentPeriodTotals.map(t => [t.domain, t.totalAmount]));
				
				const sharingInfo = {
					sharingRates,
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
					payload: { agentSharingUpdated: sharingInfo },
				}).catch((err: Error) => {
				});

				// Publish whitelabel sharing update
				const whitelabelTopic = `WHITELABEL_SHARING_${agent.tenantId}`;
				// Fetch whitelabel sharing info
				const { getWhitelabelSharingConfig, getWhitelabelAllTimeSharingTotals, getWhitelabelCurrentPeriodSharingTotals } = await import('@src/repos/common/whitelabelRepo.js');
				const { getAppConfigDb } = await import('@src/repos/app-config/appConfigRepo.js');
				
				const nowDate = new Date();
				const whitelabelSharingRates = [];
				for (const domain of allDomains) {
					try {
						const config = await getWhitelabelSharingConfig(agent.tenantId, domain, nowDate);
						if (config) {
							const rate = Number(config.shareRate);
							if (Number.isFinite(rate) && rate >= 0) {
								whitelabelSharingRates.push({
									domain,
									rate: rate * 100,
								});
							} else {
								whitelabelSharingRates.push({
									domain,
									rate: 0,
								});
							}
						} else {
							whitelabelSharingRates.push({
								domain,
								rate: 0,
							});
						}
					} catch (err) {
						// Default to 0 rate on error
						whitelabelSharingRates.push({
							domain,
							rate: 0,
						});
					}
				}
				
				const whitelabelAllTimeTotals = await getWhitelabelAllTimeSharingTotals(agent.tenantId);
				const whitelabelCurrentPeriodTotals = await getWhitelabelCurrentPeriodSharingTotals(agent.tenantId, periodFrom, periodTo);
				
				const appConfig = await getAppConfigDb(agent.tenantId);
				const whitelabelCurrency = appConfig?.baseCurrency || appConfig?.currency || 'INR';
				const whitelabelAllTimeTotalsMap = new Map(whitelabelAllTimeTotals.map(t => [t.domain, t.totalAmount]));
				const whitelabelCurrentPeriodTotalsMap = new Map(whitelabelCurrentPeriodTotals.map(t => [t.domain, t.totalAmount]));
				
				const whitelabelSharingInfo = {
					sharingRates: whitelabelSharingRates,
					allTimeTotals: allDomains.map(domain => ({
						domain,
						totalAmount: whitelabelAllTimeTotalsMap.get(domain) || 0,
					})),
					currentPeriodTotals: allDomains.map(domain => ({
						domain,
						totalAmount: whitelabelCurrentPeriodTotalsMap.get(domain) || 0,
					})),
					currency: whitelabelCurrency,
				};
				
				params.pubsub.publish({
					topic: whitelabelTopic,
					payload: { whitelabelSharingUpdated: whitelabelSharingInfo },
				}).catch((err: Error) => {
				});
			} catch (err) {
			}
		}

		return posted;
	}
}

