import { AgentsRepo } from '../../../repos/agents/AgentsRepo';
import { AgentConfigsRepo } from '../../../repos/agents/AgentConfigsRepo';
import { AgentLedgerRepo } from '../../../repos/agents/AgentLedgerRepo';
import { AgentSettlementsRepo } from '../../../repos/agents/AgentSettlementsRepo';
import { CreditService } from '../services/CreditService';
import { CommissionService } from '../services/CommissionService';
import { SharingService } from '../services/SharingService';
import { SettlementService } from '../services/SettlementService';
import { HybridGGRReader } from '../services/HybridGGRReader';
import { HierarchyService } from '../services/HierarchyService';
import { hashPassword, verifyPassword, signJwt, ensureAgentCanMutate } from '../../common/auth';
import {
	deriveAgentPermissions,
	isAgentActive,
	canAgentLogin,
	agentAccessVerdict,
} from '../services/AgentPermissionsService';
import { recordAuditDb } from '@/repos/audit/auditRepo';
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js';
import { checkLoginRateLimit, recordFailedLoginAttempt, clearLoginAttempts } from '@/middleware/loginRateLimiter.js';
import { getClientIp, getClientUserAgent } from '@src/utils/getClientIp.js';
import { validateAgentUsername } from '../agentUsernameValidation.js';
import {
	ensureAgentMayActOn,
	requireCallerTenant,
	ensureAdminCaller,
	ensureDirectChildForAgent,
} from '@src/domains/agents/services/agentSubtree.js'
import {
	assertLevelAllowed,
	assertDomainsWithinParent,
	removedDomains,
	restrictedAgentFieldChanges,
	governingWindow,
	firstCapBreach,
	firstChildAbove,
	firstRatePeriodStart,
	clampFirstRateEffectiveFrom,
	type RateRow,
} from '../services/agentMutationRules.js';
import { AgentRateHistoryRepo } from '../../../repos/agents/AgentRateHistoryRepo';
import { ensureAgentMayChangeStatus } from '../services/agentStatusGuard';

export function buildAgentsMutationResolvers() {
	const agentsRepo = new AgentsRepo();
	const configsRepo = new AgentConfigsRepo();
	const ledgerRepo = new AgentLedgerRepo();
	const settlementsRepo = new AgentSettlementsRepo();
	const readers = new HybridGGRReader();
	const hierarchyService = new HierarchyService(agentsRepo);
	const commissionService = new CommissionService(agentsRepo, configsRepo, ledgerRepo, readers);
	const sharingService = new SharingService(agentsRepo, configsRepo, ledgerRepo, readers);
	const settlementService = new SettlementService(
		agentsRepo,
		ledgerRepo,
		settlementsRepo,
		commissionService,
		sharingService
	);
	const creditService = new CreditService(agentsRepo);
	const rateHistoryRepo = new AgentRateHistoryRepo();

	/**
	 * Decides the effectiveFrom/effectiveTo of a new commission or sharing rate row
	 * and refuses rates that break the hierarchy. Shared by setCommissionConfig and
	 * setSharingConfig.
	 *
	 * - First row for the domain: effectiveFrom moves back to the agent's first
	 *   period (creation day for SHARING/CREDIT, creation-cycle Monday 00:00 IST
	 *   for COMMISSION), so the first period has a rate.
	 * - Caps are checked over the window the new row will govern (from its
	 *   effectiveFrom to the agent's next row), not at "now".
	 * - A child may not exceed its parent. Where the parent has no rate, a SHARING
	 *   or CREDIT agent is capped by the whitelabel's share (there is no whitelabel
	 *   commission cap).
	 * - A parent may not drop below any direct child's rate for the domain.
	 */
	const resolveRateRow = async (params: {
		kind: 'commission' | 'sharing';
		agent: { id: string; parentAgentId: string | null; schemeType: string; tenantId: string; createdAt: Date | string };
		domain: 'sports' | 'casino' | 'matka';
		rate: number;
		effectiveFromInput: unknown;
		effectiveToInput: unknown;
		ctx: any;
	}): Promise<{ effectiveFrom: Date; effectiveTo: Date | null }> => {
		const { kind, agent, domain, rate, ctx } = params;
		const requested = new Date(params.effectiveFromInput as any);
		if (Number.isNaN(requested.getTime())) {
			throw new Error('effectiveFrom must be a valid date');
		}
		let effectiveTo: Date | null = null;
		if (params.effectiveToInput !== null && params.effectiveToInput !== undefined && params.effectiveToInput !== '') {
			effectiveTo = new Date(params.effectiveToInput as any);
			if (Number.isNaN(effectiveTo.getTime())) {
				throw new Error('effectiveTo must be a valid date');
			}
		}
		const pct = (r: number) => (r * 100).toFixed(2);
		const day = (d: Date) => d.toISOString().slice(0, 10);

		// First row for this agent and domain: back-date it to the first period.
		const ownRows = await rateHistoryRepo.listRows(kind, agent.id, domain);
		const earliestExisting = ownRows.length ? ownRows[0].effectiveFrom : null;
		const createdAt = agent.createdAt instanceof Date ? agent.createdAt : new Date(agent.createdAt);
		let effectiveFrom = requested;
		if (!Number.isNaN(createdAt.getTime())) {
			const timezone = kind === 'sharing' ? await rateHistoryRepo.whitelabelTimezone(agent.tenantId).catch(() => null) : null;
			const periodStart = firstRatePeriodStart(agent.schemeType, createdAt, timezone);
			effectiveFrom = clampFirstRateEffectiveFrom({ requested, earliestExisting, periodStart });
		}
		if (effectiveTo && effectiveTo.getTime() <= effectiveFrom.getTime()) {
			throw new Error('effectiveTo must be after effectiveFrom');
		}
		const window = governingWindow(ownRows, effectiveFrom, effectiveTo);

		// Cap from above: the parent's rate, or the whitelabel's where the parent has none.
		let fallbackCap: number | null | undefined = undefined;
		if (kind === 'sharing') {
			const tenant = String(agent.tenantId ?? '').trim();
			const cap = await rateHistoryRepo.whitelabelShareCap(tenant, domain);
			if (cap !== null) {
				fallbackCap = cap;
			} else {
				const { hasSuperAdminRoleName } = await import('@src/domains/common/roleNames.js');
				// A whitelabel without a sharing rate for the domain cannot give its agents one.
				// The core tenant and Super Admins keep the previous behaviour (no cap).
				fallbackCap = tenant === 'default' || hasSuperAdminRoleName(ctx?.user?.roles) ? undefined : null;
			}
		}
		const parentRows: RateRow[] = agent.parentAgentId
			? await rateHistoryRepo.listRows(kind, agent.parentAgentId, domain)
			: [];
		const breach = firstCapBreach({ rate, window, parentRows, fallbackCap });
		if (breach) {
			const label = kind === 'sharing' ? 'Agent share rate' : 'Commission rate';
			if (breach.source === 'parent') {
				throw new Error(
					`${label} (${pct(rate)}%) cannot exceed parent agent's rate (${pct(breach.cap ?? 0)}%) for ${domain} (in force on ${day(breach.at)})`
				);
			}
			if (breach.cap === null) {
				throw new Error(`Whitelabel has no sharing configured for ${domain}. Cannot assign sharing to agent.`);
			}
			throw new Error(
				`${label} (${pct(rate)}%) cannot exceed whitelabel's rate (${pct(breach.cap)}%) for ${domain}`
			);
		}

		// Cap from below: no direct child may sit above the new rate.
		const children = await agentsRepo.listChildren(agent.id);
		for (const child of children) {
			const childRows = await rateHistoryRepo.listRows(kind, child.id, domain);
			const above = firstChildAbove({ rate, window, childRows });
			if (above) {
				throw new Error(
					`Cannot set the ${domain} rate to ${pct(rate)}%: sub-agent ${child.username ?? child.id} has ${pct(above.childRate)}% (in force on ${day(above.at)}). Lower the sub-agent's rate first.`
				);
			}
		}

		return { effectiveFrom, effectiveTo };
	};

	return {
		createAgent: async (_: any, { input }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// Get tenantId from context (should be UUID)
			// CRITICAL: For Director Admin, use effective tenant based on mode
			const directorTenant = getEffectiveTenantForDirector(ctx)
			const tenantId = directorTenant ?? (ctx?.tenant || ctx?.whitelabel?.id);
			if (!tenantId) {
				throw new Error('Tenant ID is required. Please ensure you are authenticated.');
			}

			// Validate username is provided and format (lowercase, digits, underscore only)
			const usernameValidation = validateAgentUsername(input.username ?? '');
			if (!usernameValidation.valid) {
				throw new Error(usernameValidation.message ?? 'Invalid username');
			}

			// Validate password is provided
			if (!input.password || typeof input.password !== 'string' || input.password.trim() === '') {
				throw new Error('Password is required and cannot be empty');
			}

			// Validate levelIndex if provided (must be >= 1; max 4 for SHARING/CREDIT, unlimited for COMMISSION)
			if (input.levelIndex !== null && input.levelIndex !== undefined) {
				if (typeof input.levelIndex !== 'number' || input.levelIndex < 1) {
					throw new Error('Hierarchy level must be at least 1');
				}
				if (input.schemeType !== 'COMMISSION' && input.levelIndex > 4) {
					throw new Error('Hierarchy level must be between 1 and 4 for sharing/credit agents');
				}
			}

			// A credit limit at creation applies to CREDIT agents only.
			if (input.creditLimit !== null && input.creditLimit !== undefined) {
				const limit = Number(input.creditLimit);
				if (!Number.isFinite(limit) || limit < 0) {
					throw new Error(`Invalid credit limit: ${input.creditLimit}. Must be zero or a positive number.`);
				}
				if (limit > 0 && input.schemeType !== 'CREDIT') {
					throw new Error('A credit limit can only be set for CREDIT agents');
				}
			}

			// If parentAgentId is provided, validate hierarchy level and scheme type matching
			if (input.parentAgentId) {
				// Scoped to the caller's tenant: a parent id from another whitelabel is "not found".
				const parentAgent = await agentsRepo.findByIdScoped(input.parentAgentId, tenantId);
				if (!parentAgent) {
					throw new Error('Parent agent not found');
				}
				
				// CRITICAL: Enforce scheme type matching - parent and child must have the same scheme type
				// SHARING/CREDIT/COMMISSION agents can only have same-type parents
				if (parentAgent.schemeType !== input.schemeType) {
					throw new Error(
						`Cannot create ${input.schemeType} agent under a ${parentAgent.schemeType} parent. ` +
						`${input.schemeType} agents can only have ${input.schemeType} parents.`
					);
				}
				
				// Validate that child's level is greater than parent's level
				const parentLevel = parentAgent.levelIndex || 1;
				let childLevel = input.levelIndex || (parentLevel + 1);
				
				// Auto-correct levelIndex if it's invalid (≤ parent level)
				if (childLevel <= parentLevel) {
					childLevel = parentLevel + 1;
					input.levelIndex = childLevel;
				}
				
				// SHARING/CREDIT: max 4 levels; COMMISSION: unlimited
				if (input.schemeType !== 'COMMISSION' && childLevel > 4) {
					throw new Error('Maximum hierarchy depth (4 levels) reached. Cannot create agent at level ' + childLevel);
				}
				
				// Auto-set levelIndex if not provided
				if (!input.levelIndex) {
					input.levelIndex = parentLevel + 1;
				}

				// Validate child's allowedDomains ⊆ parent's allowedDomains (admin create or any parent selection)
				const parentDomains = new Set(parentAgent.allowedDomains || []);
				const childDomains = Array.isArray(input.allowedDomains) ? input.allowedDomains : [];
				for (const d of childDomains) {
					if (!parentDomains.has(d)) {
						throw new Error(`Domain '${d}' is not allowed for the selected parent agent. Choose only from parent's domains.`);
					}
				}
			} else if (!input.levelIndex && (input.schemeType === 'SHARING' || input.schemeType === 'CREDIT' || input.schemeType === 'COMMISSION')) {
				// No parent and no level specified - default to level 1
				input.levelIndex = 1;
			}

			// Note: Sharing rates validation happens in setSharingConfig mutation
			// because CreateAgentInput doesn't include sharingRates - they're set separately
			// after agent creation via setSharingConfig mutation

			// If an agent is creating a sub-agent, validate the hierarchy
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				// Agent creating sub-agent: set parentAgentId and validate
				const parentAgentId = ctx.user.agentId;
				const parentAgent = await agentsRepo.findById(parentAgentId);
				
				// Only sharing/credit/commission agents can create sub-agents (same scheme type)
				if (parentAgent?.schemeType !== 'SHARING' && parentAgent?.schemeType !== 'CREDIT' && parentAgent?.schemeType !== 'COMMISSION') {
					throw new Error('Only sharing, credit, or commission agents can create sub-agents.');
				}
				
				// Sub-agent must have the same scheme type as parent
				if (input.schemeType !== parentAgent?.schemeType) {
					throw new Error(
						`Cannot create ${input.schemeType} sub-agent under a ${parentAgent?.schemeType} parent. ` +
						`${parentAgent?.schemeType} agents can only create ${parentAgent?.schemeType} sub-agents.`
					);
				}
				
				// SAFEGUARD: If parentAgentId was already set in input, validate it matches logged-in agent
				// This prevents edge cases where input.parentAgentId might be set incorrectly
				if (input.parentAgentId && input.parentAgentId !== parentAgentId) {
					throw new Error('Agents can only create sub-agents under themselves. Parent agent ID mismatch.');
				}
				
				// Validate sub-agent creation
				const validation = await hierarchyService.validateSubAgentCreation(
					parentAgentId,
					{
						allowedDomains: input.allowedDomains,
						creditLimit: input.creditLimit,
						commissionRate: input.commissionRate,
						shareRate: input.shareRate,
					}
				);

				if (!validation.valid) {
					throw new Error(validation.error || 'Cannot create sub-agent');
				}

				// Override parentAgentId to ensure it's set correctly
				input.parentAgentId = parentAgentId;
				
				// Use frontend-provided levelIndex if valid, otherwise auto-increment
				const parentLvl = parentAgent?.levelIndex || 0;
				if (input.levelIndex && input.levelIndex > parentLvl) {
					// Respect the manually selected level (already validated above for max depth)
				} else {
					input.levelIndex = parentLvl + 1;
				}
			}

			// Re-check the depth now that the level is final. The agent branch above sets
			// levelIndex = parent + 1 after the early check ran, so a level-4 SHARING/CREDIT
			// agent omitting parentAgentId would otherwise create level 5.
			if (input.levelIndex !== null && input.levelIndex !== undefined) {
				assertLevelAllowed(input.schemeType, input.levelIndex);
			}

			// Get whitelabel base currency from app config
			const { getAppConfigDb } = await import('@/repos/app-config/appConfigRepo.js');
			const appConfig = await getAppConfigDb(tenantId);
			const whitelabelBaseCurrency = appConfig?.baseCurrency || 'INR';

			// For SHARING and CREDIT agents, currency must be whitelabel base currency
			if (input.schemeType === 'SHARING' || input.schemeType === 'CREDIT') {
				if (input.currency && input.currency !== whitelabelBaseCurrency) {
					throw new Error(`Sharing and credit agents must use the whitelabel's base currency (${whitelabelBaseCurrency})`);
				}
				// Force currency to whitelabel base currency for SHARING/CREDIT agents
				input.currency = whitelabelBaseCurrency;
			}

			// ENFORCE WHITELABEL CREDIT: Validate BEFORE creating agent to avoid orphaned agents if validation fails
			const isRootAgent = !input.parentAgentId;
			const isCreditAgent = input.schemeType === 'CREDIT';
			
			// Validate whitelabel credit BEFORE creating agent
			if (isRootAgent && isCreditAgent && input.creditLimit) {
				const isWhitelabel = tenantId && tenantId !== 'default';
				if (isWhitelabel) {
					const requestedCreditLimit = Number(input.creditLimit);
					
					// Validate credit limit is positive and finite
					if (!Number.isFinite(requestedCreditLimit) || requestedCreditLimit <= 0) {
						throw new Error(`Invalid credit limit: ${input.creditLimit}. Must be a positive number.`);
					}

					const { WhitelabelCreditService } = await import('@src/domains/common/services/WhitelabelCreditService.js');
					const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js');
					const whitelabelCreditService = new WhitelabelCreditService(new WhitelabelCreditRepo());
					
					// Validate whitelabel exists
					const whitelabelCredit = await whitelabelCreditService.getCreditAllocation(tenantId);
					if (!whitelabelCredit) {
						throw new Error(`Whitelabel not found: ${tenantId}`);
					}
					
					// Validate whitelabel has enough credit available (BEFORE creating agent)
					const hasCredit = await whitelabelCreditService.validateCreditAvailable(tenantId, requestedCreditLimit);
					if (!hasCredit) {
						throw new Error(
							`Insufficient whitelabel credit. Available: ${whitelabelCredit.creditAvailable.toFixed(2)}, Requested: ${requestedCreditLimit.toFixed(2)}`
						);
					}
				}
			}

			// A CREDIT sub-agent's limit at creation is allocated from its parent's credit.
			// Checked before the insert so a parent without enough credit leaves no agent behind.
			const requestedSubAgentCredit = !isRootAgent && isCreditAgent ? Number(input.creditLimit ?? 0) : 0;
			if (requestedSubAgentCredit > 0) {
				const parentCredit = await creditService.getCreditAllocation(input.parentAgentId);
				if (requestedSubAgentCredit > parentCredit.creditAvailable) {
					throw new Error(
						`Insufficient credit available from parent agent. Available: ${parentCredit.creditAvailable}, Requested: ${requestedSubAgentCredit}`
					);
				}
			}

			const passwordHash = await hashPassword(input.password);
			const row = await agentsRepo.createAgent({
				tenantId: tenantId,
				schemeType: input.schemeType,
				allowedDomains: input.allowedDomains,
				status: input.status ?? 'ACTIVE',
				phone: input.phone ?? null,
				parentAgentId: input.parentAgentId ?? null,
				levelIndex: input.levelIndex ?? null,
				tallyEnabled: Boolean(input.tallyEnabled),
				tallyDomains: input.tallyDomains ?? [],
				username: usernameValidation.normalized!,
				passwordHash,
				currency: input.currency || whitelabelBaseCurrency,
			});

			// Now that agent is created, deduct whitelabel credit and set credit limit in a transaction
			if (isRootAgent && isCreditAgent && input.creditLimit) {
				const isWhitelabel = tenantId && tenantId !== 'default';
				if (isWhitelabel) {
					const requestedCreditLimit = Number(input.creditLimit);
					const { WhitelabelCreditService } = await import('@src/domains/common/services/WhitelabelCreditService.js');
					const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js');
					const whitelabelCreditService = new WhitelabelCreditService(new WhitelabelCreditRepo());

					// Use transaction to ensure atomicity
					const { db } = await import('@/db/client.js');
					await db.transaction(async (tx) => {
						// Deduct from whitelabel credit (with row-level locking)
						await whitelabelCreditService.deductCredit(
							tenantId,
							requestedCreditLimit,
							`Root CREDIT agent created - Agent ID: ${row.id}, Credit Limit: ${requestedCreditLimit}`,
							tx
						);
						
						// Set agent credit limit directly (avoid calling adjustCreditLimit which would deduct whitelabel credit again)
						await agentsRepo.lockAndUpdateCredit(row.id, {
							creditLimit: requestedCreditLimit,
							creditUsed: 0,
							creditAvailable: requestedCreditLimit,
						}, tx);
					});
				} else if (input.creditLimit) {
					// For non-whitelabel tenants, just set the credit limit without whitelabel deduction
					const { CreditService } = await import('@src/domains/agents/services/CreditService.js');
					const creditService = new CreditService(agentsRepo);
					await creditService.adjustCreditLimit(row.id, Number(input.creditLimit), 'Initial credit limit on agent creation');
				}
			}

			if (requestedSubAgentCredit > 0) {
				try {
					await creditService.allocateCreditToSubAgent(
						input.parentAgentId,
						row.id,
						requestedSubAgentCredit,
						'Initial credit limit on agent creation',
						{
							createdBy: ctx?.user?.id || ctx?.user?.agentId,
							createdByType: ctx?.user?.type === 'agent' ? 'agent' : 'admin',
						}
					);
				} catch (err: any) {
					throw new Error(
						`Agent '${usernameValidation.normalized}' was created, but its credit limit could not be allocated: ${err?.message ?? err}. Set it from the agent's credit page.`
					);
				}
			}

			return row;
		},
		updateAgent: async (_: any, { input }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// Get tenantId from context
			// CRITICAL: For Director Admin, use effective tenant based on mode
			const directorTenant = getEffectiveTenantForDirector(ctx)
			const tenantId = directorTenant ?? (ctx?.tenant || ctx?.whitelabel?.id);
			if (!tenantId) {
				throw new Error('Tenant ID is required. Please ensure you are authenticated.');
			}

			// Validate agent ID
			if (!input.id) {
				throw new Error('Agent ID is required');
			}

			// Get the agent to verify it exists and check permissions
			const agent = await agentsRepo.findById(input.id);
			if (!agent) {
				throw new Error('Agent not found');
			}

			// Verify tenant matches
			if (agent.tenantId !== tenantId) {
				throw new Error('Unauthorized: Agent does not belong to your tenant');
			}

			// An agent may update its sub-agents at any depth (closure table), never
			// itself: every field here (domains, status, level, tally) widens or
			// unlocks the caller's own account. And not the level or the tally
			// settings even below it; those stay with the whitelabel's admins.
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				await ensureAgentMayActOn(ctx, input.id, { allowSelf: false, action: 'update agent settings' });
				const restricted = restrictedAgentFieldChanges(agent as any, input);
				if (restricted.length > 0) {
					throw new Error(`Forbidden: an agent cannot change ${restricted.join(', ')}. Ask an administrator.`);
				}
			}

			// Validate levelIndex if provided: 1-4 for SHARING/CREDIT, any level >= 1 for
			// COMMISSION (createAgent allows deeper COMMISSION agents, so they must stay editable).
			if (input.levelIndex !== null && input.levelIndex !== undefined) {
				assertLevelAllowed(agent.schemeType, input.levelIndex);
			}

			// Validate parentAgentId if provided
			if (input.parentAgentId !== null && input.parentAgentId !== undefined) {
				const parentAgent = await agentsRepo.findByIdScoped(input.parentAgentId, tenantId);
				if (!parentAgent) {
					throw new Error('Parent agent not found');
				}

				// Validate hierarchy level
				const parentLevel = parentAgent.levelIndex || 1;
				const childLevel = input.levelIndex || agent.levelIndex || (parentLevel + 1);

				if (childLevel <= parentLevel) {
					throw new Error(`Agent level (${childLevel}) must be greater than parent's level (${parentLevel})`);
				}

				assertLevelAllowed(agent.schemeType, childLevel);
			}

			// Domains stay within the parent's. (Re-parenting is refused by the repo,
			// so the parent is always the current one.)
			if (input.allowedDomains !== undefined && input.allowedDomains !== null && agent.parentAgentId) {
				const currentParent = await agentsRepo.findById(agent.parentAgentId);
				if (!currentParent) {
					throw new Error('Parent agent not found');
				}
				assertDomainsWithinParent(input.allowedDomains, currentParent.allowedDomains as string[]);
			}
			// Narrowing an agent's domains narrows its whole subtree in the same transaction.
			const narrowedDomains = removedDomains(agent.allowedDomains as string[], input.allowedDomains);

			// Build update input
			const updateInput: any = {
				id: input.id,
			};

			// Only include fields that are provided
			if (input.allowedDomains !== undefined) {
				updateInput.allowedDomains = input.allowedDomains;
			}
			if (input.status !== undefined) {
				await ensureAgentMayChangeStatus(ctx, { id: String(agent.id), status: String(agent.status) }, input.status);
				updateInput.status = input.status;
			}
			if (input.parentAgentId !== undefined) {
				updateInput.parentAgentId = input.parentAgentId;
			}
			if (input.levelIndex !== undefined) {
				updateInput.levelIndex = input.levelIndex;
			}
			if (input.tallyEnabled !== undefined) {
				updateInput.tallyEnabled = input.tallyEnabled;
			}
			if (input.tallyDomains !== undefined) {
				updateInput.tallyDomains = input.tallyDomains;
			}

			// Update the agent; a narrowing also strips the removed domains from every
			// descendant (allowed and tally domains) in the same transaction.
			let updatedAgent: any;
			if (narrowedDomains.length > 0) {
				const { db } = await import('@/db/client.js');
				updatedAgent = await db.transaction(async (tx: any) => {
					const row = await agentsRepo.updateAgent(updateInput, tx);
					await agentsRepo.narrowSubtreeDomains(input.id, narrowedDomains, tx);
					if (row && Array.isArray(row.tallyDomains)) {
						row.tallyDomains = row.tallyDomains.filter((d: string) => !narrowedDomains.includes(d));
					}
					return row;
				});
			} else {
				updatedAgent = await agentsRepo.updateAgent(updateInput);
			}

			// Log the update
			// CRITICAL: Reuse directorTenant from above (already declared at line 163)
			const tenant = directorTenant ?? (ctx?.tenant || agent.tenantId || 'default');
			await recordAuditDb({
				tenant,
				actorId: ctx?.user?.id || ctx?.user?.agentId || 'system',
				domain: 'agents',
				action: 'update_agent',
				resourceType: 'agent',
				resourceId: input.id,
				before: {
					allowedDomains: agent.allowedDomains,
					status: agent.status,
					parentAgentId: agent.parentAgentId,
					levelIndex: agent.levelIndex,
					tallyEnabled: agent.tallyEnabled,
					tallyDomains: agent.tallyDomains,
				},
				after: {
					allowedDomains: updatedAgent.allowedDomains,
					status: updatedAgent.status,
					parentAgentId: updatedAgent.parentAgentId,
					levelIndex: updatedAgent.levelIndex,
					tallyEnabled: updatedAgent.tallyEnabled,
					tallyDomains: updatedAgent.tallyDomains,
				},
			});

			return updatedAgent;
		},
		setAgentCredentials: async (_: any, { input }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// The agent model authorises downward. Without this, an agent could name
			// its own parent or a sibling here. See services/agentSubtree.ts.
			await ensureAgentMayActOn(ctx, input.agentId, { allowSelf: true, action: 'set credentials' });
			// CR-11: enforce target agent belongs to caller's tenant
			const directorTenant = getEffectiveTenantForDirector(ctx)
			const callerTenant = directorTenant ?? (ctx?.tenant || ctx?.whitelabel?.id);
			if (!callerTenant) {
				throw new Error('Tenant ID is required. Please ensure you are authenticated.');
			}
			const agent = await agentsRepo.findByIdScoped(input.agentId, callerTenant);
			if (!agent) {
				throw new Error('Forbidden');
			}
			const usernameValidation = validateAgentUsername(input.username ?? '');
			if (!usernameValidation.valid) {
				throw new Error(usernameValidation.message ?? 'Invalid username');
			}
			const passwordHash = await hashPassword(input.password);
			await agentsRepo.setCredentials(input.agentId, usernameValidation.normalized!, passwordHash);
			return true;
		},
		setCommissionConfig: async (_: any, { input }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// The agent model authorises downward. Without this, an agent could name
			// its own parent or a sibling here. See services/agentSubtree.ts.
			await ensureAgentMayActOn(ctx, input.agentId, { allowSelf: false, action: 'set a commission rate' });
			// Validate required fields
			if (!input.agentId) {
				throw new Error('Agent ID is required');
			}
			if (!input.domain || !['sports', 'casino', 'matka'].includes(input.domain)) {
				throw new Error('Valid domain (sports, casino, matka) is required');
			}
			if (input.commissionRate === null || input.commissionRate === undefined) {
				throw new Error(`Commission rate is required for ${input.domain} domain`);
			}
			// Commission rate is stored as decimal (0..1), but can be passed as percentage (0-100) or decimal (0-1)
			// Accept both formats for flexibility
			let commissionRateDecimal: number;
			if (input.commissionRate > 1) {
				// If > 1, assume it's a percentage and convert to decimal
				if (input.commissionRate > 100) {
					throw new Error('Commission rate must be between 0 and 100 (percentage) or 0 and 1 (decimal)');
				}
				commissionRateDecimal = input.commissionRate / 100;
			} else {
				// If <= 1, assume it's already a decimal
				if (input.commissionRate < 0 || input.commissionRate > 1) {
					throw new Error('Commission rate must be between 0 and 100 (percentage) or 0 and 1 (decimal)');
				}
				commissionRateDecimal = input.commissionRate;
			}

			// CR-11: enforce target agent belongs to caller's tenant
			const directorTenant = getEffectiveTenantForDirector(ctx)
			const callerTenant = directorTenant ?? (ctx?.tenant || ctx?.whitelabel?.id);
			if (!callerTenant) {
				throw new Error('Tenant ID is required. Please ensure you are authenticated.');
			}
			// Verify agent exists and is a COMMISSION agent
			const agent = await agentsRepo.findByIdScoped(input.agentId, callerTenant);
			if (!agent) {
				throw new Error('Forbidden');
			}
			if (agent.schemeType !== 'COMMISSION') {
				throw new Error('Commission configuration can only be set for COMMISSION agents');
			}

			// If an agent is setting commission config, allow self or direct sub-agent (with child rate <= parent rate)
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				if (ctx.user.agentId !== input.agentId) {
					if (agent.parentAgentId !== ctx.user.agentId) {
						throw new Error('Unauthorized: Commission agents can only set commission config for themselves or their direct sub-agents');
					}
				}
			}

			// Verify domain is in agent's allowed domains
			if (!agent.allowedDomains?.includes(input.domain)) {
				throw new Error(`Domain '${input.domain}' is not in agent's allowed domains`);
			}

			// Child <= parent over the window the row governs, parent >= every direct
			// child, and the first row back-dated to the creation cycle. See resolveRateRow.
			const commissionDates = await resolveRateRow({
				kind: 'commission',
				agent: agent as any,
				domain: input.domain,
				rate: commissionRateDecimal,
				effectiveFromInput: input.effectiveFrom,
				effectiveToInput: input.effectiveTo,
				ctx,
			});

			return configsRepo.setCommissionConfig({
				agentId: input.agentId,
				domain: input.domain,
				commissionRate: commissionRateDecimal,
				effectiveFrom: commissionDates.effectiveFrom,
				effectiveTo: commissionDates.effectiveTo,
			});
		},
		setSharingConfig: async (_: any, { input }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// The agent model authorises downward. Without this, an agent could name
			// its own parent or a sibling here. See services/agentSubtree.ts.
			await ensureAgentMayActOn(ctx, input.agentId, { allowSelf: false, action: 'set a sharing rate' });
			// Validate required fields
			if (!input.agentId) {
				throw new Error('Agent ID is required');
			}
			if (!input.domain || !['sports', 'casino', 'matka'].includes(input.domain)) {
				throw new Error('Valid domain (sports, casino, matka) is required');
			}
			if (input.shareRate === null || input.shareRate === undefined) {
				throw new Error(`Share rate is required for ${input.domain} domain`);
			}
			if (typeof input.shareRate !== 'number' || input.shareRate < 0 || input.shareRate > 1) {
				throw new Error('Share rate must be a number between 0 and 1 (representing 0-100%)');
			}

			// CR-11: enforce target agent belongs to caller's tenant
			const directorTenant = getEffectiveTenantForDirector(ctx)
			const callerTenant = directorTenant ?? (ctx?.tenant || ctx?.whitelabel?.id);
			if (!callerTenant) {
				throw new Error('Tenant ID is required. Please ensure you are authenticated.');
			}
			// Verify agent exists and is a SHARING agent
			const agent = await agentsRepo.findByIdScoped(input.agentId, callerTenant);
			if (!agent) {
				throw new Error('Forbidden');
			}
			if (agent.schemeType !== 'SHARING' && agent.schemeType !== 'CREDIT') {
				throw new Error('Sharing configuration can only be set for SHARING or CREDIT agents');
			}

			// Verify domain is in agent's allowed domains
			if (!agent.allowedDomains?.includes(input.domain)) {
				throw new Error(`Domain '${input.domain}' is not in agent's allowed domains`);
			}

			// The parent's rate caps the child (the whitelabel's where the parent has
			// none, or for a root agent), checked over the window the new row governs;
			// a parent may not drop below a direct child; and the first row is
			// back-dated to the creation day. See resolveRateRow.
			const sharingDates = await resolveRateRow({
				kind: 'sharing',
				agent: agent as any,
				domain: input.domain,
				rate: input.shareRate,
				effectiveFromInput: input.effectiveFrom,
				effectiveToInput: input.effectiveTo,
				ctx,
			});

			return configsRepo.setSharingConfig({
				agentId: input.agentId,
				domain: input.domain,
				shareRate: input.shareRate,
				effectiveFrom: sharingDates.effectiveFrom,
				effectiveTo: sharingDates.effectiveTo,
			});
		},
		settleAgent: async (_: any, { input }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// Legacy (deprecated; the admin UI uses the top-level settleAgent). Kept, but
			// scoped: the target must be in the caller's tenant, and an agent may settle
			// only its DIRECT children, never itself. See services/agentSubtree.ts.
			const settleTarget = await agentsRepo.findByIdScoped(input.agentId, requireCallerTenant(ctx));
			if (!settleTarget) {
				throw new Error('Agent not found');
			}
			ensureDirectChildForAgent(ctx, settleTarget, 'settle');
			// Block commission agents from accessing settlement operations
			// Settlements for commission agents should be handled via commission payouts
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js');
				const agentsRepo = new AgentsRepo();
				const loggedInAgent = await agentsRepo.findById(ctx.user.agentId);
				if (loggedInAgent?.schemeType === 'COMMISSION') {
					throw new Error('Commission agents cannot access settlement operations. Use commission payouts instead.');
				}
			}
			
			return settlementService.settle({
				agentId: input.agentId,
				from: new Date(input.periodFrom),
				to: new Date(input.periodTo),
				currency: input.currency,
				postedBy: ctx?.user?.id ?? null,
				pubsub: ctx?.pubsub,
			});
		},
		postSettlement: async (_: any, { settlementId }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// CR-16: verify the settlement belongs to the caller's tenant before posting.
			// Previously this posted any settlementId with no ownership check.
			const directorTenant = getEffectiveTenantForDirector(ctx);
			const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
			const settlement = await settlementsRepo.getById(settlementId);
			if (!settlement) {
				throw new Error('Settlement not found');
			}
			const owningAgent = await agentsRepo.findById(settlement.agentId);
			if (!owningAgent || owningAgent.tenantId !== tenant) {
				throw new Error('Settlement not found or does not belong to this tenant');
			}
			// When caller is an agent, they may only post a DIRECT sub-agent's settlement,
			// never their own (a settlement is posted by the counterparty above).
			ensureDirectChildForAgent(ctx, owningAgent, 'post a settlement');
			return settlementsRepo.post({ settlementId, postedBy: ctx?.user?.id ?? null });
		},
		agentLogin: async (_: any, { input }: any, ctx: any) => {
			const { username, password } = input;

			// Normalize tenant from context
			const directorTenant = getEffectiveTenantForDirector(ctx)
			let tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
			if (typeof tenant !== 'string' || tenant.trim() === '') {
				tenant = 'default'
			} else {
				tenant = tenant.trim()
			}

			const trimmedUsername = (username?.trim?.() ?? '').toLowerCase()
			const req = ctx?.request
			const auditIp = getClientIp(req)
			const auditUserAgent = getClientUserAgent(req)
			const ip = auditIp ?? 'unknown'

			checkLoginRateLimit(ip, trimmedUsername || 'unknown')

			try {
				if (!username || typeof username !== 'string' || trimmedUsername === '') {
					recordFailedLoginAttempt(ip, trimmedUsername || 'unknown')
					throw new Error('Username is required');
				}
				if (!password || typeof password !== 'string' || password.trim() === '') {
					recordFailedLoginAttempt(ip, trimmedUsername || 'unknown')
					throw new Error('Password is required');
				}

				// Find agent by username with credentials (use trimmed username).
				// Task 24: scope by the context tenant — usernames are unique per tenant, so a
				// username-only lookup could return an arbitrary cross-tenant row. The post-lookup
				// tenant-match check below remains as defense-in-depth.
				const agentWithCreds = await agentsRepo.findByUsernameWithCredentials(trimmedUsername, tenant);
				if (!agentWithCreds) {
					recordFailedLoginAttempt(ip, trimmedUsername || 'unknown')
					await recordAuditDb({
						tenant,
						actorId: trimmedUsername || 'unknown',
						domain: 'agents',
						action: 'login_failed',
						resourceType: 'agent',
						resourceId: trimmedUsername || 'unknown',
						after: { success: false, reason: 'invalid_credentials', ipAddress: auditIp, userAgent: auditUserAgent },
					}).catch(() => {});
					throw new Error('Invalid credentials');
				}

				// Verify tenant matches (normalize agent tenantId for comparison)
				const agentTenant = (agentWithCreds.tenantId && typeof agentWithCreds.tenantId === 'string')
					? agentWithCreds.tenantId.trim()
					: null
				if (!agentTenant || agentTenant !== tenant) {
					recordFailedLoginAttempt(ip, trimmedUsername || 'unknown')
					await recordAuditDb({
						tenant,
						actorId: String(agentWithCreds.id),
						domain: 'agents',
						action: 'login_failed',
						resourceType: 'agent',
						resourceId: String(agentWithCreds.id),
						after: { success: false, reason: 'tenant_mismatch', ipAddress: auditIp, userAgent: auditUserAgent },
					}).catch(() => {});
					throw new Error('Invalid credentials');
				}

				// Verify password
				const passwordValid = await verifyPassword(password, agentWithCreds.passwordHash);
				if (!passwordValid) {
					recordFailedLoginAttempt(ip, trimmedUsername || 'unknown')
					await recordAuditDb({
						tenant,
						actorId: String(agentWithCreds.id),
						domain: 'agents',
						action: 'login_failed',
						resourceType: 'agent',
						resourceId: String(agentWithCreds.id),
						after: { success: false, reason: 'invalid_credentials', ipAddress: auditIp, userAgent: auditUserAgent },
					}).catch(() => {});
					throw new Error('Invalid credentials');
				}

				// Check agent status - SUSPENDED cannot login; INACTIVE can login (read-only)
				if (!canAgentLogin(agentWithCreds.status)) {
					recordFailedLoginAttempt(ip, trimmedUsername || 'unknown')
					await recordAuditDb({
						tenant,
						actorId: String(agentWithCreds.id),
						domain: 'agents',
						action: 'login_failed',
						resourceType: 'agent',
						resourceId: String(agentWithCreds.id),
						after: {
							success: false,
							reason: agentWithCreds.status === 'SUSPENDED' ? 'suspended' : 'inactive',
							ipAddress: auditIp,
							userAgent: auditUserAgent,
						},
					}).catch(() => {});
					throw new Error(
						agentWithCreds.status === 'SUSPENDED'
							? 'Agent account is suspended'
							: 'Agent account is not active'
					);
				}

				// Owner decision 1: a SUSPENDED/BLOCKED ancestor blocks the whole subtree;
				// an INACTIVE ancestor makes it read-only. buildAuthContext applies the
				// same verdict on every request, so tokens issued earlier stop working too.
				const ancestorStatuses = await agentsRepo.listNonActiveAncestorStatuses(String(agentWithCreds.id));
				const access = agentAccessVerdict(agentWithCreds.status, ancestorStatuses);
				if (!access.allowed) {
					recordFailedLoginAttempt(ip, trimmedUsername || 'unknown')
					await recordAuditDb({
						tenant,
						actorId: String(agentWithCreds.id),
						domain: 'agents',
						action: 'login_failed',
						resourceType: 'agent',
						resourceId: String(agentWithCreds.id),
						after: { success: false, reason: access.reason ?? 'ancestor_suspended', ipAddress: auditIp, userAgent: auditUserAgent },
					}).catch(() => {});
					throw new Error('Agent account is suspended because a parent agent is suspended');
				}

				clearLoginAttempts(ip, trimmedUsername || 'unknown')
				const isReadOnly = access.isReadOnly;

				// Update last login timestamp
				await agentsRepo.updateLastLogin(agentWithCreds.id);

				// Generate JWT with agent info (include isReadOnly and token version for force-logout)
				const tokenVersion = (agentWithCreds as any).tokenVersion ?? 0;
				const token = signJwt({
					sub: agentWithCreds.id,
					name: agentWithCreds.username || agentWithCreds.id,
					roles: [],
					agentId: agentWithCreds.id,
					type: 'agent',
					isReadOnly,
					v: tokenVersion,
				});

				// Derive permissions from allowedDomains
				const allowedDomains = Array.isArray(agentWithCreds.allowedDomains)
					? agentWithCreds.allowedDomains
					: []
				const permissions = deriveAgentPermissions(allowedDomains as any[], agentWithCreds.schemeType);

				// Audit: successful agent login
				await recordAuditDb({
					tenant,
					actorId: String(agentWithCreds.id),
					domain: 'agents',
					action: 'login',
					resourceType: 'agent',
					resourceId: String(agentWithCreds.id),
					after: { success: true, ipAddress: auditIp, userAgent: auditUserAgent },
				}).catch(() => {});

				// Return agent account without password hash
				const { passwordHash, ...agent } = agentWithCreds;

				return {
					token,
					agent,
					permissions,
					tenant,
					isReadOnly,
				};
			} catch (err: any) {
				// Re-throw; audit already recorded in each failure path above
				throw err;
			}
		},

		// Hierarchy management mutations
		adjustSubAgentCredit: async (_: any, { agentId, creditLimit }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// An agent may adjust a sub-agent's limit at any depth, never its own:
			// canManageAgent, used here before, returns true for SELF, so a CREDIT agent
			// could raise its own limit. See services/agentSubtree.ts.
			await ensureAgentMayActOn(ctx, agentId, { allowSelf: false, action: 'adjust a credit limit' });

			// CR-11: enforce target agent belongs to caller's tenant
			const callerDirectorTenant = getEffectiveTenantForDirector(ctx)
			const callerTenant = callerDirectorTenant ?? (ctx?.tenant || ctx?.whitelabel?.id);
			if (!callerTenant) {
				throw new Error('Tenant ID is required. Please ensure you are authenticated.');
			}
			// Implement credit limit adjustment
			const agent = await agentsRepo.findByIdScoped(agentId, callerTenant);
			if (!agent) {
				throw new Error('Forbidden');
			}

			// Store parentAgentId before operations to avoid stale data issues
			const agentParentId = agent.parentAgentId;

			// Validate CREDIT agent only - credit operations are not available for SHARING agents
			if (agent.schemeType !== 'CREDIT') {
				throw new Error('Credit operations are only available for CREDIT scheme agents');
			}

			// Validate credit limit
			if (creditLimit < 0) {
				throw new Error('Credit limit cannot be negative');
			}

			// Get current credit to validate against used credit
			const currentCredit = await creditService.getCreditAllocation(agentId);
			
			// Validate that new limit is not less than current used credit
			if (creditLimit < currentCredit.creditUsed) {
				throw new Error(
					`Credit limit cannot be less than current used credit (${currentCredit.creditUsed})`
				);
			}

			// If agent has a parent, validate against parent's available credit
			let parentCreditBefore: any = null;
			const creditDelta = creditLimit - currentCredit.creditLimit;
			
			if (agentParentId) {
				parentCreditBefore = await creditService.getCreditAllocation(agentParentId);
				
				if (creditDelta > 0 && creditDelta > parentCreditBefore.creditAvailable) {
					throw new Error(
						`Insufficient credit available from parent. Available: ${parentCreditBefore.creditAvailable}, Requested: ${creditDelta}`
					);
				}

				// Adjust credit allocation only if there's a change. The service writes the
				// parent's ALLOCATION / RELEASE credit-ledger row inside its transaction.
				const creditActor = {
					createdBy: ctx?.user?.id || ctx?.user?.agentId,
					createdByType: (ctx?.user?.type === 'agent' ? 'agent' : 'admin') as 'agent' | 'admin',
				};
				if (creditDelta > 0) {
					await creditService.allocateCreditToSubAgent(
						agentParentId,
						agentId,
						creditDelta,
						`Allocated credit to sub-agent ${agentId}`,
						creditActor
					);
				} else if (creditDelta < 0) {
					await creditService.releaseCreditFromSubAgent(
						agentParentId,
						agentId,
						Math.abs(creditDelta),
						`Released credit from sub-agent ${agentId}`,
						creditActor
					);
				} else {
					// creditDelta === 0, no change needed
					// Return early since no update was made
					const updatedAgent = await agentsRepo.findById(agentId);
					if (!updatedAgent) {
						throw new Error('Agent not found');
					}
					return {
						success: true,
						message: 'Credit limit unchanged (no update needed)',
						agent: updatedAgent,
					};
				}
			} else {
				// Root agent - just adjust the limit directly
				// Check if limit actually changed to avoid unnecessary updates
				if (creditLimit === currentCredit.creditLimit) {
					// No change needed
					const updatedAgent = await agentsRepo.findById(agentId);
					if (!updatedAgent) {
						throw new Error('Agent not found');
					}
					return {
						success: true,
						message: 'Credit limit unchanged (no update needed)',
						agent: updatedAgent,
					};
				}
				// adjustCreditLimit already creates an audit log, so we don't need to create another one
				await creditService.adjustCreditLimit(agentId, creditLimit, 'Credit limit adjustment', {
					createdBy: ctx?.user?.id || ctx?.user?.agentId,
					createdByType: ctx?.user?.type === 'agent' ? 'agent' : 'admin',
				});
			}

			// Log the change for sub-agents only (root agents are already logged by adjustCreditLimit)
			// CRITICAL: For Director Admin, use effective tenant based on mode
			// Use agentParentId (stored before operations) to avoid stale data
			const directorTenant = getEffectiveTenantForDirector(ctx)
			const tenant = directorTenant ?? (ctx?.tenant || agent.tenantId || 'default');
			
			if (agentParentId) {
				await recordAuditDb({
					tenant,
					actorId: ctx?.user?.id || ctx?.user?.agentId || 'system',
					domain: 'agents',
					action: 'adjust_credit_limit',
					resourceType: 'agent',
					resourceId: agentId,
					before: { creditLimit: currentCredit.creditLimit },
					after: { creditLimit },
				});
			}

			// Create credit ledger transactions for sub-agents (root agents are handled by adjustCreditLimit)
			if (agentParentId) {
				try {
					const { AgentCreditLedgerRepo } = await import('@/repos/agents/AgentCreditLedgerRepo.js');
					const creditLedgerRepo = new AgentCreditLedgerRepo();
					
					// Get currency from app config
					const { getAppConfigDb } = await import('@src/repos/app-config/appConfigRepo.js');
					const appConfig = await getAppConfigDb(tenant);
					const currency = appConfig?.baseCurrency || appConfig?.currency || 'INR';
					
					// Get updated credit allocations AFTER the operations
					const updatedCredit = await creditService.getCreditAllocation(agentId);

					// Convert userId to UUID format if needed
					let createdByUuid: string | null = null;
					const userId = ctx?.user?.id || ctx?.user?.agentId || null;
					if (userId) {
						const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
						if (uuidRegex.test(userId)) {
							createdByUuid = userId;
						}
					}
					
					// Create transaction for sub-agent (CREDIT_LIMIT_ADJUSTMENT)
					await creditLedgerRepo.recordTransaction({
						tenantId: tenant,
						fromEntityType: 'agent',
						fromEntityId: agentParentId,
						toEntityType: 'agent',
						toEntityId: agentId,
						transactionType: 'CREDIT_LIMIT_ADJUSTMENT',
						amount: Math.abs(creditDelta),
						currency,
						balanceBefore: currentCredit.creditLimit,
						balanceAfter: updatedCredit.creditLimit,
						reason: `Credit limit adjustment by ${ctx?.user?.type === 'agent' ? 'agent' : 'admin'}`,
						createdBy: createdByUuid ?? undefined,
						createdByType: ctx?.user?.type === 'agent' ? 'agent' : 'admin',
						metadata: {
							adjustmentType: 'LIMIT_CHANGE',
							previousLimit: currentCredit.creditLimit,
							newLimit: creditLimit,
							parentAgentId: agentParentId,
						},
					});
					
					// The parent's ALLOCATION / RELEASE row is written by
					// allocateCreditToSubAgent / releaseCreditFromSubAgent inside their
					// transaction (balances from the locked parent row), so every caller of
					// those services gets it, not only this mutation.
				} catch (err) {
					// Don't fail the mutation if transaction logging fails
				}
			}

			// Get updated credit allocation
			const updatedCredit = await creditService.getCreditAllocation(agentId);

			// Publish subscription event for the sub-agent
			if (ctx?.pubsub && typeof ctx.pubsub.publish === 'function') {
				try {
					const topic = `AGENT_CREDIT_${agentId}`;
					const publishResult = ctx.pubsub.publish({
						topic,
						payload: { agentCreditUpdated: updatedCredit },
					});
					if (publishResult && typeof publishResult.catch === 'function') {
						publishResult.catch((err: Error) => {
							// Ignore EOF errors (stream already closed)
							if (err?.message?.includes('EOF') || err?.message?.includes('stream.push')) {
								return;
							}
						});
					}
				} catch (err: any) {
					// Ignore EOF errors (stream already closed)
					if (err?.message?.includes('EOF') || err?.message?.includes('stream.push')) {
						// Ignore
					} else {
					}
				}
			}

			// If this is a sub-agent, also publish subscription for parent agent (parent's credit also changed)
			// Use agentParentId (stored before operations) to avoid stale data
			if (agentParentId && ctx?.pubsub && typeof ctx.pubsub.publish === 'function') {
				try {
					const parentCredit = await creditService.getCreditAllocation(agentParentId);
					const parentTopic = `AGENT_CREDIT_${agentParentId}`;
					const publishResult = ctx.pubsub.publish({
						topic: parentTopic,
						payload: { agentCreditUpdated: parentCredit },
					});
					if (publishResult && typeof publishResult.catch === 'function') {
						publishResult.catch((err: Error) => {
							// Ignore EOF errors (stream already closed)
							if (err?.message?.includes('EOF') || err?.message?.includes('stream.push')) {
								return;
							}
						});
					}
				} catch (err: any) {
					// Ignore EOF errors (stream already closed)
					if (err?.message?.includes('EOF') || err?.message?.includes('stream.push')) {
						// Ignore
					} else {
					}
					// Don't fail the mutation if parent subscription fails
				}
			}

			const updatedAgent = await agentsRepo.findById(agentId);
			if (!updatedAgent) {
				throw new Error('Agent not found after credit update');
			}
			return {
				success: true,
				message: 'Credit limit adjusted successfully',
				agent: updatedAgent,
			};
		},

		adjustAgentCredit: async (_: any, { input }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// The agent model authorises downward. Without this, an agent could name
			// its own parent or a sibling here. See services/agentSubtree.ts.
			await ensureAgentMayActOn(ctx, input.agentId, { allowSelf: false, action: 'adjust credit' });
			// CRITICAL: For Director Admin, use effective tenant based on mode
			const directorTenant = getEffectiveTenantForDirector(ctx)
			const tenant = directorTenant ?? (ctx?.tenant || 'default');
			const userId = ctx?.user?.id || ctx?.user?.agentId || 'system';

			// Validate input
			if (!input.agentId || !input.adjustmentType || !input.amount) {
				return {
					success: false,
					message: 'Missing required fields: agentId, adjustmentType, and amount are required',
					adjustment: null,
				};
			}

			// Provide default notes if not provided or empty
			const notes = input.notes?.trim() || `Credit ${input.adjustmentType === 'INCREASE' ? 'increased' : input.adjustmentType === 'DECREASE' ? 'decreased' : 'adjusted'} by ${input.amount}`;

			if (input.amount <= 0) {
				return {
					success: false,
					message: 'Adjustment amount must be greater than 0',
					adjustment: null,
				};
			}

			// Prevent sharing agents from adjusting agent credit
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
				const agentsRepo = new AgentsRepo()
				const loggedInAgent = await agentsRepo.findById(ctx.user.agentId)
				if (loggedInAgent?.schemeType === 'SHARING') {
					return {
						success: false,
						message: 'Sharing agents cannot adjust credit',
						adjustment: null,
					}
				}
			}

			// Verify agent exists, is CREDIT type, and belongs to caller's tenant (CR-11)
			const agent = await agentsRepo.findByIdScoped(input.agentId, tenant);
			if (!agent) {
				return {
					success: false,
					message: 'Forbidden',
					adjustment: null,
				};
			}

			if (agent.schemeType !== 'CREDIT') {
				return {
					success: false,
					message: 'Only CREDIT agents can have credit adjustments',
					adjustment: null,
				};
			}

			// Store parentAgentId before operations to avoid stale data issues
			const agentParentId = agent.parentAgentId;

			// Get current credit values
			const creditData = await creditService.getCreditAllocation(input.agentId);
			const previousLimit = creditData.creditLimit;
			const previousUsed = creditData.creditUsed;

			let newLimit = previousLimit;
			let newUsed = previousUsed;

			// Apply adjustment with validation
			if (input.adjustmentType === 'INCREASE') {
				// MONEY-CRITICAL (CR-9 family): validate-and-write under the FOR UPDATE lock.
				// A positive creditUsedDelta consumes availability; the lock guarantees the
				// availability decision and the written value come from the same locked row,
				// closing the read-check-write race that the prior getCreditAllocation +
				// updateCreditBalance pair was exposed to.
				const { db: dbInc } = await import('@/db/client.js');
				try {
					const result = await dbInc.transaction(async (tx: any) => {
						return await agentsRepo.lockAndUpdateCredit(input.agentId, {
							creditUsedDelta: input.amount,
							requireAvailableForDelta: true,
						}, tx);
					});
					newLimit = result.creditLimit;
					newUsed = result.creditUsed;
				} catch (err: any) {
					return {
						success: false,
						message: `Increasing credit by ${input.amount} would exceed the credit limit of ${previousLimit}. Maximum increase allowed: ${Math.max(0, previousLimit - previousUsed)}`,
						adjustment: null,
					};
				}
			} else if (input.adjustmentType === 'DECREASE') {
				// Lowering an agent's credit_used frees credit out of nothing (no limit is
				// released back to anyone), so it is an admin correction, not an agent action.
				if (ctx?.user?.type === 'agent') {
					return {
						success: false,
						message: 'Only an administrator can decrease an agent\'s used credit',
						adjustment: null,
					};
				}
				// Validate that decrease amount doesn't exceed current used before calculating
				// (friendly pre-check; the authoritative release is performed under the lock below)
				if (input.amount > previousUsed) {
					return {
						success: false,
						message: `Decrease amount cannot be greater than current used credit (${previousUsed})`,
						adjustment: null,
					};
				}
				// MONEY-CRITICAL: release used credit via a negative delta derived from the
				// FOR-UPDATE-locked row (cannot over-allocate; race-free).
				const { db: dbDec } = await import('@/db/client.js');
				const result = await dbDec.transaction(async (tx: any) => {
					return await agentsRepo.lockAndUpdateCredit(input.agentId, {
						creditUsedDelta: -input.amount,
					}, tx);
				});
				newLimit = result.creditLimit;
				newUsed = Math.max(0, result.creditUsed);
			} else if (input.adjustmentType === 'LIMIT_CHANGE') {
				// Validate that new limit is not less than current used credit
				if (input.amount < previousUsed) {
					return {
						success: false,
						message: `Credit limit cannot be less than current used credit (${previousUsed})`,
						adjustment: null,
					};
				}
				newLimit = input.amount;
				
				// Check if limit actually changed to avoid unnecessary updates
				const limitDelta = newLimit - previousLimit;
				if (limitDelta === 0) {
					// No change needed, return early
					return {
						success: true,
						message: 'Credit limit unchanged (no update needed)',
						adjustment: {
							id: `adj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
							agentId: input.agentId,
							adjustmentType: input.adjustmentType,
							amount: input.amount,
							previousLimit,
							newLimit,
							previousUsed,
							newUsed,
							notes: notes,
							createdAt: new Date().toISOString(),
						},
					};
				}
				
				// If agent has a parent, validate against parent's available credit before updating
				// Use agentParentId (stored before operations) to avoid stale data
				if (agentParentId) {
					const parentCredit = await creditService.getCreditAllocation(agentParentId);
					
					if (limitDelta > 0 && limitDelta > parentCredit.creditAvailable) {
						return {
							success: false,
							message: `Insufficient credit available from parent. Available: ${parentCredit.creditAvailable}, Requested: ${limitDelta}`,
							adjustment: null,
						};
					}
					
					const creditActor = {
						createdBy: ctx?.user?.id || ctx?.user?.agentId,
						createdByType: (ctx?.user?.type === 'agent' ? 'agent' : 'admin') as 'agent' | 'admin',
					};
					if (limitDelta > 0) {
						// Increase: allocate credit from parent (writes the parent's ALLOCATION row)
						await creditService.allocateCreditToSubAgent(
							agentParentId,
							input.agentId,
							limitDelta,
							'Credit limit adjustment via adjustAgentCredit',
							creditActor
						);
					} else {
						// Decrease: release credit back to parent (limitDelta < 0; writes the RELEASE row)
						await creditService.releaseCreditFromSubAgent(
							agentParentId,
							input.agentId,
							Math.abs(limitDelta),
							'Credit limit adjustment via adjustAgentCredit',
							creditActor
						);
					}
				} else {
					// Root agent - just update directly (the whitelabel pool moves with it)
					await creditService.adjustCreditLimit(input.agentId, newLimit, 'Credit limit adjustment via adjustAgentCredit', {
						createdBy: ctx?.user?.id || ctx?.user?.agentId,
						createdByType: ctx?.user?.type === 'agent' ? 'agent' : 'admin',
					});
				}

				// Create notification for significant credit limit increases (LIMIT_CHANGE with increase)
				if (limitDelta > 0) {
					const increasePercent = previousLimit > 0 ? (limitDelta / previousLimit) * 100 : 100;
					// Notify for increases >= 10% or >= 10000 INR
					if (increasePercent >= 10 || limitDelta >= 10000) {
						try {
							const whitelabelId = directorTenant ?? tenant;
							const { getWhitelabelCurrency, getCurrencySymbol } = await import('@src/shared/whitelabelConfig.js');
							const currency = await getWhitelabelCurrency(whitelabelId);
							const sym = getCurrencySymbol(currency);
							const { NotificationsRepo } = await import('@/repos/notifications/notificationsRepo.js');
							const { NotificationService } = await import('@/domains/notifications/services/NotificationService.js');
							const notificationsRepo = new NotificationsRepo();
							const notificationService = new NotificationService(notificationsRepo);
							const formattedAmount = limitDelta.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
							const formattedNewLimit = newLimit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
							await notificationService.createNotification(
								{
									tenant,
									whitelabelId: whitelabelId || tenant,
									agentId: input.agentId,
									type: 'AGENT',
									category: 'task',
									title: 'Agent credit limit increased',
									message: `Agent credit limit increased by ${sym}${formattedAmount} to ${sym}${formattedNewLimit}.${notes ? ` Notes: ${notes}` : ''}`,
									actionUrl: `/agents/${input.agentId}/credit`,
									metadata: { agentId: input.agentId, previousLimit, newLimit, limitDelta, notes: notes || null },
								},
								ctx?.pubsub
							);
						} catch (err: any) {
						}
					}
				}
			}

			// NOTE: INCREASE/DECREASE now perform their balance write under the FOR UPDATE lock
			// (see above), and LIMIT_CHANGE is handled in its own branch. No separate
			// non-transactional updateCreditBalance is needed here anymore (CR-9 race fix).

			// Credit alerts (plan W7): INCREASE/DECREASE moved credit_used directly; the
			// LIMIT_CHANGE services run the check themselves. Best-effort, never throws.
			if (input.adjustmentType === 'INCREASE' || input.adjustmentType === 'DECREASE') {
				await creditService.checkCreditAlerts(input.agentId);
			}

			// Create adjustment record (we'll need to create a repo for this, similar to PlayerCreditAdjustmentsRepo)
			// For now, we'll just log it in audit
			const adjustmentId = `adj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

			// Log audit event
			// For LIMIT_CHANGE on root agents, adjustCreditLimit already creates an audit log, so skip to avoid duplicate
			// For LIMIT_CHANGE on sub-agents, we need to log the user action (adjustCreditLimit doesn't log for sub-agents)
			// For INCREASE/DECREASE, always log the user action
			if (!(input.adjustmentType === 'LIMIT_CHANGE' && !agentParentId)) {
				await recordAuditDb({
					tenant,
					actorId: userId,
					domain: 'agents',
					action: 'adjust_agent_credit',
					resourceType: 'agent',
					resourceId: input.agentId,
					before: { creditLimit: previousLimit, creditUsed: previousUsed },
					after: { creditLimit: newLimit, creditUsed: newUsed, creditAvailable: Math.max(0, newLimit - newUsed) },
				});
			}

			// Get updated credit allocation
			const updatedCredit = await creditService.getCreditAllocation(input.agentId);

			// Publish subscription event for the agent
			if (ctx?.pubsub) {
				try {
					const topic = `AGENT_CREDIT_${input.agentId}`;
					const publishResult = ctx.pubsub.publish({
						topic,
						payload: { agentCreditUpdated: updatedCredit },
					});
					
					// Check if publish returns a Promise before calling .catch()
					if (publishResult && typeof publishResult.then === 'function') {
						publishResult.catch((err: Error) => {
						});
					}
				} catch (err: any) {
					// Don't fail mutation if subscription fails
				}
			}

			// If this is a sub-agent and LIMIT_CHANGE was used, also publish subscription for parent agent
			// Use agentParentId (stored before operations) to avoid stale data
			if (input.adjustmentType === 'LIMIT_CHANGE' && agentParentId && ctx?.pubsub) {
				try {
					const parentCredit = await creditService.getCreditAllocation(agentParentId);
					const parentTopic = `AGENT_CREDIT_${agentParentId}`;
					const publishResult = ctx.pubsub.publish({
						topic: parentTopic,
						payload: { agentCreditUpdated: parentCredit },
					});
					
					// Check if publish returns a Promise before calling .catch()
					if (publishResult && typeof publishResult.then === 'function') {
						publishResult.catch((err: Error) => {
						});
					}
				} catch (err) {
					// Don't fail the mutation if parent subscription fails
				}
			}

			return {
				success: true,
				message: 'Credit adjusted successfully',
				adjustment: {
					id: adjustmentId,
					agentId: input.agentId,
					adjustmentType: input.adjustmentType,
					amount: input.amount,
					previousLimit,
					newLimit,
					previousUsed,
					newUsed,
					notes: notes,
					createdAt: new Date().toISOString(),
				},
			};
		},

		updateAgentStatus: async (_: any, { agentId, status }: { agentId: string; status: string }, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// Validate status value (BLOCKED removed; only Active, Inactive, Suspended allowed)
			const validStatuses = ['ACTIVE', 'INACTIVE', 'SUSPENDED'];
			if (!validStatuses.includes(status)) {
				throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
			}

			// CR-11: enforce target agent belongs to caller's tenant
			const callerDirectorTenant = getEffectiveTenantForDirector(ctx)
			const callerTenant = callerDirectorTenant ?? (ctx?.tenant || ctx?.whitelabel?.id);
			if (!callerTenant) {
				throw new Error('Tenant ID is required. Please ensure you are authenticated.');
			}
			// Get the agent to check current status and ownership
			const agent = await agentsRepo.findByIdScoped(agentId, callerTenant);
			if (!agent) {
				throw new Error('Forbidden');
			}

			// An agent may change the status of agents below it only, never its own (it could lift
			// its own restriction), and may not lift a restriction set above it (agentStatusGuard).
			await ensureAgentMayActOn(ctx, agentId, { allowSelf: false, action: 'change the status' });
			await ensureAgentMayChangeStatus(ctx, { id: String(agent.id), status: String(agent.status) }, status);

			const previousStatus = agent.status;

			// Update the status
			const updatedAgent = await agentsRepo.updateAgent({
				id: agentId,
				status,
			});

			// When suspending, increment token version to force-logout all existing sessions
			if (status === 'SUSPENDED') {
				await agentsRepo.incrementTokenVersion(agentId);
			}

			// Log the status change
			// CRITICAL: For Director Admin, use effective tenant based on mode
			const directorTenant = getEffectiveTenantForDirector(ctx)
			const tenant = directorTenant ?? (ctx?.tenant || agent.tenantId || 'default');
			await recordAuditDb({
				tenant,
				actorId: ctx?.user?.id || ctx?.user?.agentId || 'system',
				domain: 'agents',
				action: 'update_agent_status',
				resourceType: 'agent',
				resourceId: agentId,
				before: { status: previousStatus },
				after: { status },
			});

			return updatedAgent;
		},

		suspendSubAgent: async (_: any, { agentId, reason }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// An agent may suspend agents below it only, never itself.
			await ensureAgentMayActOn(ctx, agentId, { allowSelf: false, action: 'suspend' });

			// CR-11: enforce target agent belongs to caller's tenant
			const directorTenant = getEffectiveTenantForDirector(ctx)
			const callerTenant = directorTenant ?? (ctx?.tenant || ctx?.whitelabel?.id);
			if (!callerTenant) {
				throw new Error('Tenant ID is required. Please ensure you are authenticated.');
			}
			const targetAgent = await agentsRepo.findByIdScoped(agentId, callerTenant);
			if (!targetAgent) {
				throw new Error('Forbidden');
			}
			await ensureAgentMayChangeStatus(ctx, { id: String(targetAgent.id), status: String(targetAgent.status) }, 'SUSPENDED');
			const statusBeforeSuspend = targetAgent.status;

			const updatedAgent = await agentsRepo.updateAgent({
				id: agentId,
				status: 'SUSPENDED',
			});

			// Force-logout: invalidate all existing sessions for this agent
			await agentsRepo.incrementTokenVersion(agentId);

			// Log the suspension with reason
			const tenant = ctx?.tenant || updatedAgent.tenantId || 'default';
			await recordAuditDb({
				tenant,
				actorId: ctx?.user?.id || ctx?.user?.agentId || 'system',
				domain: 'agents',
				action: 'suspend_agent',
				resourceType: 'agent',
				resourceId: agentId,
				before: { status: statusBeforeSuspend },
				after: { status: 'SUSPENDED', reason: reason || 'Agent suspended' },
			});

			return updatedAgent;
		},

		blockSubAgent: async (_: any, { agentId, reason }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// An agent may block agents below it only, never itself.
			await ensureAgentMayActOn(ctx, agentId, { allowSelf: false, action: 'block' });

			// CR-11: enforce target agent belongs to caller's tenant
			const directorTenant = getEffectiveTenantForDirector(ctx)
			const callerTenant = directorTenant ?? (ctx?.tenant || ctx?.whitelabel?.id);
			if (!callerTenant) {
				throw new Error('Tenant ID is required. Please ensure you are authenticated.');
			}
			const targetAgent = await agentsRepo.findByIdScoped(agentId, callerTenant);
			if (!targetAgent) {
				throw new Error('Forbidden');
			}
			await ensureAgentMayChangeStatus(ctx, { id: String(targetAgent.id), status: String(targetAgent.status) }, 'BLOCKED');
			const statusBeforeBlock = targetAgent.status;

			const updatedAgent = await agentsRepo.updateAgent({
				id: agentId,
				status: 'BLOCKED',
			});

			// M1/M2: Force-logout — invalidate all existing sessions so a blocked agent's
			// live JWT is rejected immediately (mirrors suspendSubAgent).
			await agentsRepo.incrementTokenVersion(agentId);

			// Log the block action with reason
			const tenant = ctx?.tenant || updatedAgent.tenantId || 'default';
			await recordAuditDb({
				tenant,
				actorId: ctx?.user?.id || ctx?.user?.agentId || 'system',
				domain: 'agents',
				action: 'block_agent',
				resourceType: 'agent',
				resourceId: agentId,
				before: { status: statusBeforeBlock },
				after: { status: 'BLOCKED', reason: reason || 'Agent blocked' },
			});

			return updatedAgent;
		},

		allocateCreditToPlayer: async (_: any, { input }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// The agent model authorises downward. Without this, an agent could name
			// its own parent or a sibling here. See services/agentSubtree.ts.
			await ensureAgentMayActOn(ctx, input.agentId, { allowSelf: true, action: 'allocate credit' });
			const agent = await agentsRepo.findByIdScoped(input.agentId, requireCallerTenant(ctx));
			if (!agent) {
				throw new Error('Agent not found');
			}

			// Validate CREDIT agent only - credit operations are not available for SHARING agents
			if (agent.schemeType !== 'CREDIT') {
				throw new Error('Credit allocation is only available for CREDIT scheme agents');
			}

			// Check authorization
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId !== input.agentId) {
				throw new Error('Unauthorized: You can only allocate credit from your own account');
			}

			await creditService.allocateCreditToPlayer(
				input.agentId,
				parseInt(input.playerId),
				input.amount,
				input.reason
			);

			const { AgentPlayerCreditsRepo } = await import('../../../repos/agents/AgentPlayerCreditsRepo');
			const playerCreditsRepo = new AgentPlayerCreditsRepo();
			const summary = await playerCreditsRepo.getPlayerCreditSummary(input.agentId, parseInt(input.playerId));
			
			if (!summary) {
				throw new Error('Player credit summary not found');
			}

			return {
				playerId: summary.playerId.toString(),
				playerName: summary.playerName,
				creditLimit: summary.creditLimit,
				currentBalance: summary.currentBalance,
				openExposure: summary.openExposure,
				creditUsed: summary.creditUsed,
				creditAvailable: summary.creditAvailable,
			};
		},

		depositCredit: async (_: any, { input }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// The agent model authorises downward. Without this, an agent could name
			// its own parent or a sibling here. See services/agentSubtree.ts.
			await ensureAgentMayActOn(ctx, input.agentId, { allowSelf: true, action: 'deposit credit' });
			const agent = await agentsRepo.findByIdScoped(input.agentId, requireCallerTenant(ctx));
			if (!agent) {
				throw new Error('Agent not found');
			}

			// Validate CREDIT agent only - credit operations are not available for SHARING agents
			if (agent.schemeType !== 'CREDIT') {
				throw new Error('Credit operations are only available for CREDIT scheme agents');
			}

			// Check authorization
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId !== input.agentId) {
				throw new Error('Unauthorized: You can only deposit credit from your own account');
			}

			const result = await creditService.depositCredit(
				input.agentId,
				input.targetEntityType,
				input.targetEntityId,
				input.amount,
				input.reason
			);

			return result;
		},

		withdrawCredit: async (_: any, { input }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// The agent model authorises downward. Without this, an agent could name
			// its own parent or a sibling here. See services/agentSubtree.ts.
			await ensureAgentMayActOn(ctx, input.agentId, { allowSelf: true, action: 'withdraw credit' });
			const agent = await agentsRepo.findByIdScoped(input.agentId, requireCallerTenant(ctx));
			if (!agent) {
				throw new Error('Agent not found');
			}

			// Validate CREDIT agent only - credit operations are not available for SHARING agents
			if (agent.schemeType !== 'CREDIT') {
				throw new Error('Credit operations are only available for CREDIT scheme agents');
			}

			// Check authorization
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId !== input.agentId) {
				throw new Error('Unauthorized: You can only withdraw credit from your own account');
			}

			const result = await creditService.withdrawCredit(
				input.agentId,
				input.targetEntityType,
				input.targetEntityId,
				input.amount,
				input.reason
			);

			return result;
		},

		transferCredit: async (_: any, { input }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// Check authorization
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId !== input.parentAgentId) {
				throw new Error('Unauthorized: You can only transfer credit between your own sub-agents');
			}

			// Validate parent agent is CREDIT and in the caller's tenant (CreditService
			// then requires both sub-agents to be its direct children).
			const parentAgent = await agentsRepo.findByIdScoped(input.parentAgentId, requireCallerTenant(ctx));
			if (!parentAgent) {
				throw new Error('Parent agent not found');
			}
			if (parentAgent.schemeType !== 'CREDIT') {
				throw new Error('Credit operations are only available for CREDIT scheme agents');
			}

			await creditService.transferCredit(
				input.parentAgentId,
				input.fromSubAgentId,
				input.toSubAgentId,
				input.amount,
				input.reason
			);

			return true;
		},

		settleSharingAgent: async (_: any, { input }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// Legacy (no admin UI calls it). Scoped to the caller's tenant, and an agent
			// may settle only a DIRECT child, never itself. See services/agentSubtree.ts.
			const agent = await agentsRepo.findByIdScoped(input.agentId, requireCallerTenant(ctx));
			if (!agent) {
				throw new Error('Agent not found');
			}
			ensureDirectChildForAgent(ctx, agent, 'settle');

			// Validate CREDIT agent only - credit operations are not available for SHARING agents
			if (agent.schemeType !== 'CREDIT') {
				throw new Error('Settlement with credit release is only available for CREDIT scheme agents');
			}

			const periodFrom = new Date(input.periodFrom);
			const periodTo = new Date(input.periodTo);

			// Run settlement
			const settlement = await settlementService.settle({
				pubsub: ctx?.pubsub,
				agentId: input.agentId,
				from: periodFrom,
				to: periodTo,
				currency: 'INR',
				postedBy: ctx?.user?.id || ctx?.user?.agentId || null,
			});

			// If resetPlayerBalances is true, reset player balances to zero
			if (input.resetPlayerBalances) {
				const { AgentPlayerCreditsRepo } = await import('../../../repos/agents/AgentPlayerCreditsRepo');
				const playerCreditsRepo = new AgentPlayerCreditsRepo();
				const playerCredits = await playerCreditsRepo.listAgentPlayers(input.agentId);

				for (const pc of playerCredits) {
					await playerCreditsRepo.updatePlayerCredit({
						id: pc.id,
						currentBalance: 0,
					});
				}
			}

			return settlement;
		},
		applyCreditReconciliation: async (_: any, { agentId }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// An agent may reconcile its sub-agents, never itself (rewriting your own
			// credit_used is the escalation); admins are bound to their tenant.
			await ensureAgentMayActOn(ctx, agentId, { allowSelf: false, action: 'reconcile credit' });
			const agent = await agentsRepo.findByIdScoped(agentId, requireCallerTenant(ctx));
			if (!agent) {
				throw new Error('Agent not found');
			}

			// Validate CREDIT agent only - credit operations are not available for SHARING agents
			if (agent.schemeType !== 'CREDIT') {
				throw new Error('Credit reconciliation is only available for CREDIT scheme agents');
			}

			const { CreditCalculationRepo } = await import('../../../repos/agents/CreditCalculationRepo');
			// CRITICAL: For Director Admin, use effective tenant based on mode
			const directorTenant = getEffectiveTenantForDirector(ctx)
			const tenant = directorTenant ?? (ctx?.tenant || agent.tenantId || 'default');
			const calcRepo = new CreditCalculationRepo(agentsRepo);

			// Preview reconciliation to get calculated values
			const preview = await calcRepo.recalculateCreditUsedForAgent(agentId, tenant);

			// Apply reconciliation for each affected player first (credit_used = open exposure,
			// recomputed under each player's row lock), then for the agent:
			// credit_used = Σ child agents' limits + Σ direct players' limits, recomputed under
			// the agent's row lock (plan W7). Player exposure is not part of the agent's figure.
			for (const player of preview.affectedPlayers) {
				await calcRepo.applyRecalculationForPlayer(player.playerId, tenant);
			}
			const applied = await calcRepo.applyRecalculationForAgent(agentId);
			await creditService.checkCreditAlerts(agentId);

			// Log audit
			const { recordAuditDb } = await import('@/repos/audit/auditRepo');
			await recordAuditDb({
				tenant,
				actorId: ctx?.user?.id || ctx?.user?.agentId || 'system',
				domain: 'agents',
				action: 'apply_credit_reconciliation',
				resourceType: 'agent',
				resourceId: agentId,
				before: { creditUsed: applied.previousUsed },
				after: {
					creditUsed: applied.creditUsed,
					creditAvailable: applied.creditAvailable,
					delta: Math.round((applied.creditUsed - applied.previousUsed) * 100) / 100,
				},
			});

			return true;
		},
		setAgentCreditAlertThreshold: async (_: any, { agentId, threshold }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// Self (its own alert) or its subtree for an agent; the tenant for an admin.
			await ensureAgentMayActOn(ctx, agentId, { allowSelf: true, action: 'set a credit alert threshold' });
			const agent = await agentsRepo.findByIdScoped(agentId, requireCallerTenant(ctx));
			if (!agent) {
				throw new Error('Agent not found');
			}

			// Validate CREDIT agent only - credit operations are not available for SHARING agents
			if (agent.schemeType !== 'CREDIT') {
				throw new Error('Credit operations are only available for CREDIT scheme agents');
			}

			await creditService.setCreditAlertThreshold(agentId, threshold);

			return await creditService.getCreditAllocation(agentId);
		},
		adjustWhitelabelPlayerCredit: async (_: any, { input }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// WHITELABEL_CREDIT players draw on the whitelabel's own pool: admins only.
			// (This used to refuse COMMISSION agents only, so any SHARING or CREDIT
			// agent could move the whitelabel's credit.)
			ensureAdminCaller(ctx, 'adjusting whitelabel player credit');

			const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default';
			const playerId = parseInt(input.playerId);
			await creditService.adjustWhitelabelPlayerCreditLimit(playerId, tenant, input.creditLimit, input.reason);
			const players = await creditService.listWhitelabelCreditPlayers(tenant);
			const player = players.find((p) => p.id === playerId);
			if (!player) {
				throw new Error('Player not found');
			}
			return {
				id: player.id.toString(),
				name: player.name,
				email: player.email,
				phone: player.phone,
				creditLimit: player.creditLimit,
				creditUsed: player.creditUsed,
				creditAvailable: player.creditAvailable,
			};
		},

		depositCreditToWhitelabelPlayer: async (_: any, { input }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// WHITELABEL_CREDIT players draw on the whitelabel's own pool: admins only.
			ensureAdminCaller(ctx, 'managing whitelabel player credit');

			const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default';
			const playerId = parseInt(input.playerId);
			await creditService.depositCreditToWhitelabelPlayer(playerId, tenant, input.amount, input.reason);
			const players = await creditService.listWhitelabelCreditPlayers(tenant);
			const player = players.find((p) => p.id === playerId);
			if (!player) {
				throw new Error('Player not found');
			}
			return {
				id: player.id.toString(),
				name: player.name,
				email: player.email,
				phone: player.phone,
				creditLimit: player.creditLimit,
				creditUsed: player.creditUsed,
				creditAvailable: player.creditAvailable,
			};
		},

		withdrawCreditFromWhitelabelPlayer: async (_: any, { input }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// WHITELABEL_CREDIT players draw on the whitelabel's own pool: admins only.
			ensureAdminCaller(ctx, 'managing whitelabel player credit');

			const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default';
			const playerId = parseInt(input.playerId);
			await creditService.withdrawCreditFromWhitelabelPlayer(playerId, tenant, input.amount, input.reason);
			const players = await creditService.listWhitelabelCreditPlayers(tenant);
			const player = players.find((p) => p.id === playerId);
			if (!player) {
				throw new Error('Player not found');
			}
			return {
				id: player.id.toString(),
				name: player.name,
				email: player.email,
				phone: player.phone,
				creditLimit: player.creditLimit,
				creditUsed: player.creditUsed,
				creditAvailable: player.creditAvailable,
			};
		},

		resolveAgentCreditAlert: async (_: any, { alertId }: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			// The alert's agent must be in the caller's tenant, and for an agent caller
			// itself or in its subtree. Before this any alert id could be resolved.
			const alertIdStr = typeof alertId === 'string' ? alertId.trim() : '';
			if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(alertIdStr)) {
				throw new Error('Alert not found');
			}
			const { db: alertDb } = await import('@/db/client.js');
			const { agentCreditAlerts } = await import('@shared/db/schema.js');
			const { eq: eqAlert } = await import('drizzle-orm');
			const [alertRow] = await alertDb
				.select({ agentId: agentCreditAlerts.agentId })
				.from(agentCreditAlerts)
				.where(eqAlert(agentCreditAlerts.id, alertIdStr))
				.limit(1);
			if (!alertRow) {
				throw new Error('Alert not found');
			}
			const alertAgent = await agentsRepo.findByIdScoped(String(alertRow.agentId), requireCallerTenant(ctx));
			if (!alertAgent) {
				throw new Error('Alert not found');
			}
			await ensureAgentMayActOn(ctx, alertAgent.id, { allowSelf: true, action: 'resolve a credit alert' });
			const { AgentCreditAlertsRepo } = await import('../../../repos/agents/AgentCreditAlertsRepo');
			const alertsRepo = new AgentCreditAlertsRepo();
			await alertsRepo.resolveAlert(alertId);
			return true;
		},

		changeAgentPassword: async (_: any, args: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			const { z } = await import('zod');
			const p = z.object({
				currentPassword: z.string().min(1),
				newPassword: z.string().min(6, 'Password must be at least 6 characters')
			}).safeParse(args);
			
			if (!p.success) {
      throw new Error(p.error.issues.map(e => e.message).join(', '));
			}

			const agentId = ctx?.user?.agentId;
			if (!agentId) {
				throw new Error('Unauthorized: Agent not authenticated');
			}

			// Get agent to find username
			const agent = await agentsRepo.findById(agentId);
			if (!agent) {
				throw new Error('Agent not found');
			}

			// Get agent with credentials using username
			// First try to get from agent credentials directly
			const { db } = await import('../../../db/client');
			const { agentCredentials } = await import('@shared/db/schema.js');
			const { eq } = await import('drizzle-orm');
			
			const credRows = await db
				.select({
					username: agentCredentials.username,
					passwordHash: agentCredentials.passwordHash,
				})
				.from(agentCredentials)
				.where(eq(agentCredentials.agentId, agentId))
				.limit(1);

			if (!credRows.length || !credRows[0].passwordHash) {
				throw new Error('Agent credentials not found');
			}

			const currentPasswordHash = credRows[0].passwordHash;
			const username = credRows[0].username;

			// Verify current password
			const isCurrentPasswordValid = await verifyPassword(
				p.data.currentPassword,
				currentPasswordHash
			);
			
			if (!isCurrentPasswordValid) {
				throw new Error('Current password is incorrect');
			}

			// Check if new password is different from current password
			const isSamePassword = await verifyPassword(
				p.data.newPassword,
				currentPasswordHash
			);
			
			if (isSamePassword) {
				throw new Error('New password must be different from current password');
			}

			// Hash new password
			const newPasswordHash = await hashPassword(p.data.newPassword);

			// Update password using setCredentials (only password, keep username)
			await agentsRepo.setCredentials(agentId, username, newPasswordHash);

			// Audit logging
			const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default';
			const actorId = agentId;
			recordAuditDb({
				tenant,
				actorId,
				domain: 'agents.security',
				action: 'change_password',
				resourceType: 'agent',
				resourceId: agentId,
				after: { passwordChanged: true },
			}).catch(() => {});

			return { success: true, message: 'Password changed successfully' };
		},

		adminResetAgentPassword: async (_: any, args: any, ctx: any) => {
			ensureAgentCanMutate(ctx);
			const { z } = await import('zod');
			const p = z.object({
				agentId: z.string().min(1),
				newPassword: z.string().min(6, 'Password must be at least 6 characters'),
				adminPassword: z.string().min(1, 'Admin password is required'),
			}).safeParse(args);
			if (p.success) {
				// Same rule as the rest: an agent may reset a password beneath it,
				// including its own, but not its parent's or a sibling's.
				await ensureAgentMayActOn(ctx, p.data.agentId, { allowSelf: true, action: 'reset a password' });
			}

			if (!p.success) {
				throw new Error(p.error.issues.map(e => e.message).join(', '));
			}

			const adminUserId = ctx?.user?.sub;
			if (!adminUserId) {
				throw new Error('Unauthorized: Not authenticated');
			}

			// Verify the caller's own password
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const { db } = await import('../../../db/client');
				const { agentCredentials } = await import('@shared/db/schema.js');
				const { eq } = await import('drizzle-orm');
				const credRows = await db
					.select({ passwordHash: agentCredentials.passwordHash })
					.from(agentCredentials)
					.where(eq(agentCredentials.agentId, ctx.user.agentId))
					.limit(1);
				if (!credRows.length || !credRows[0].passwordHash) throw new Error('Caller credentials not found');
				const valid = await verifyPassword(p.data.adminPassword, credRows[0].passwordHash);
				if (!valid) throw new Error('Invalid admin password. Please enter your correct login password to confirm.');
			} else {
				const { getUserPasswordHashDb } = await import('@/repos/users/usersRepo.js');
				const adminIdNum = Number(adminUserId);
				if (!Number.isFinite(adminIdNum)) throw new Error('Invalid admin ID');
				const adminPasswordHash = await getUserPasswordHashDb(adminIdNum);
				if (!adminPasswordHash) throw new Error('Admin user not found');
				const valid = await verifyPassword(p.data.adminPassword, adminPasswordHash);
				if (!valid) throw new Error('Invalid admin password. Please enter your correct login password to confirm.');
			}

			// CR-11: enforce target agent belongs to caller's tenant
			const directorTenant = getEffectiveTenantForDirector(ctx)
			const callerTenant = directorTenant ?? (ctx?.tenant || ctx?.whitelabel?.id);
			if (!callerTenant) {
				throw new Error('Tenant ID is required. Please ensure you are authenticated.');
			}
			// Get target agent credentials to preserve username
			const targetAgent = await agentsRepo.findByIdScoped(p.data.agentId, callerTenant);
			if (!targetAgent) throw new Error('Forbidden');

			const { db } = await import('../../../db/client');
			const { agentCredentials } = await import('@shared/db/schema.js');
			const { eq } = await import('drizzle-orm');
			const credRows = await db
				.select({ username: agentCredentials.username })
				.from(agentCredentials)
				.where(eq(agentCredentials.agentId, p.data.agentId))
				.limit(1);

			if (!credRows.length) throw new Error('Agent credentials not found');
			const username = credRows[0].username;

			const newPasswordHash = await hashPassword(p.data.newPassword);
			await agentsRepo.setCredentials(p.data.agentId, username, newPasswordHash);
			// End every existing session of the agent, as a player password reset does:
			// a reset is how a leaked or shared password is revoked.
			await agentsRepo.incrementTokenVersion(p.data.agentId);

			const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default';
			const actorId = ctx?.user?.agentId || ctx?.user?.sub || 'system';
			recordAuditDb({
				tenant,
				actorId: String(actorId),
				domain: 'agents.security',
				action: 'admin_reset_agent_password',
				resourceType: 'agent',
				resourceId: p.data.agentId,
				after: { passwordReset: true, resetBy: ctx?.user?.type || 'admin' },
			}).catch(() => {});

			return { success: true, message: 'Agent password reset successfully' };
		},
	};
}
