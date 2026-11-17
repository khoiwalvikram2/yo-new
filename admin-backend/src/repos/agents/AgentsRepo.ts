import { db } from '../../db/client';
import {
	agents,
	agentCredentials,
	agentWallets,
	agentHierarchyClosure,
	agentSharingConfig,
} from '@shared/db/schema.js';
import { and, eq, ilike, or, ne, isNull, inArray, gt, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

export type AgentScheme = 'COMMISSION' | 'SHARING' | 'CREDIT';
export type AgentDomain = 'sports' | 'casino' | 'matka';

export interface CreateAgentInput {
	tenantId: string;
	schemeType: AgentScheme;
	allowedDomains: AgentDomain[];
	status?: string;
	phone?: string | null;
	// Commission
	tallyEnabled?: boolean;
	tallyDomains?: AgentDomain[];
	// Sharing
	parentAgentId?: string | null;
	levelIndex?: number | null;
	// Credentials
	username: string;
	passwordHash: string;
	// Wallet
	currency: string;
	/** CREDIT agents: the credit reference (agents.credit_limit). A reference figure only; it gates nothing. */
	creditLimit?: number | null;
	/**
	 * Runs on the creation transaction once the agent, its credentials and its closure rows exist (the opening
	 * chips deposit). A throw rolls the whole creation back.
	 */
	afterInsert?: (tx: any, agentRow: typeof agents.$inferSelect) => Promise<unknown>;
}

export interface UpdateAgentInput {
	id: string;
	allowedDomains?: AgentDomain[];
	status?: string;
	// Commission
	tallyEnabled?: boolean;
	tallyDomains?: AgentDomain[];
	// Sharing
	parentAgentId?: string | null;
	levelIndex?: number | null;
}

/** UUID v4 regex for validation; agents.id is uuid type in DB */
const AGENT_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The agents list's search (list and count share it, so the two cannot drift): the username or phone containing the
 * text, or the agent's id. `%` and `_` are LIKE wildcards, so they are escaped and match themselves: a search for
 * '_' finds usernames with an underscore, not every agent. The id matches whole (a UUID) or by its start (6+ hex
 * characters), which is what the profile head shows: the first 8 characters.
 */
export function agentSearchCondition(text: string) {
	const q = text.trim();
	const term = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
	const byText = [ilike(agentCredentials.username, term), ilike(agents.phone, term)];
	if (AGENT_UUID_REGEX.test(q)) return or(eq(agents.id, q), ...byText);
	if (/^[0-9a-f]{6,}$/i.test(q)) return or(sql`${agents.id}::text like ${`${q.toLowerCase()}%`}`, ...byText);
	return or(...byText);
}

export class AgentsRepo {
	async createAgent(input: CreateAgentInput) {
		// Validate username is provided and not empty
		if (!input.username || input.username.trim() === '') {
			throw new Error('Username is required and cannot be empty');
		}

		// Use transaction to ensure atomicity (validation inside transaction to prevent race conditions)
		const row = await db.transaction(async (tx) => {
			// Validate username uniqueness inside transaction to prevent race conditions.
			// Task 24: scope uniqueness to the new agent's tenant (usernames are unique per tenant).
			await this.validateUsernameUniqueness(input.username.trim().toLowerCase(), undefined, tx, input.tenantId);
			const [agentRow] = await tx
				.insert(agents)
				.values({
					tenantId: input.tenantId,
					schemeType: input.schemeType,
					allowedDomains: input.allowedDomains as unknown as string[],
					status: input.status ?? 'ACTIVE',
					phone: input.phone ?? null,
					parentAgentId: input.parentAgentId ?? null,
					levelIndex: input.levelIndex ?? null,
					tallyEnabled: input.schemeType === 'COMMISSION' ? Boolean(input.tallyEnabled) : false,
					tallyDomains:
						input.schemeType === 'COMMISSION'
							? (input.tallyDomains as unknown as string[]) ?? null
							: null,
					...(input.schemeType === 'CREDIT' && input.creditLimit != null
						? { creditLimit: input.creditLimit.toFixed(2) }
						: {}),
				})
				.returning();

			// Insert credentials with proper error handling
			try {
				await tx.insert(agentCredentials).values({
					agentId: agentRow.id,
					tenantId: input.tenantId,
					username: input.username.trim().toLowerCase(),
					passwordHash: input.passwordHash,
				});
			} catch (error: any) {
				// Transaction will rollback automatically
				// Check if it's a unique constraint violation
				if (error?.code === '23505' || error?.message?.includes('unique') || error?.message?.includes('duplicate')) {
					throw new Error(`Username '${input.username}' is already taken`);
				}
				throw new Error(`Failed to create agent credentials: ${error.message || 'Unknown error'}`);
			}

			// Insert wallet in same transaction for atomicity
			await tx.insert(agentWallets).values({
				agentId: agentRow.id,
				currency: input.currency,
				balance: '0',
				lockedBalance: '0',
			});

			// For sharing/credit/commission agents with hierarchy, seed closure table with self-depth 0 (inside transaction to avoid race)
			if (agentRow.schemeType === 'SHARING' || agentRow.schemeType === 'CREDIT' || agentRow.schemeType === 'COMMISSION') {
				await tx.insert(agentHierarchyClosure).values({
					ancestorId: agentRow.id,
					descendantId: agentRow.id,
					depth: 0,
				});
				// If parent exists, also add ancestor relationships (parent chain should be maintained by service)
				if (input.parentAgentId) {
					// Fetch all ancestors of parent and insert for this new agent (using tx for same-transaction read)
					const parentAncestors = await tx
						.select()
						.from(agentHierarchyClosure)
						.where(eq(agentHierarchyClosure.descendantId, input.parentAgentId));
					if (parentAncestors.length > 0) {
						await tx.insert(agentHierarchyClosure).values(
							parentAncestors.map((a) => ({
								ancestorId: a.ancestorId,
								descendantId: agentRow.id,
								depth: a.depth + 1,
							}))
						);
					}
				}
			}

			if (input.afterInsert) await input.afterInsert(tx, agentRow);

			return agentRow;
		});
		return row;
	}

	async updateAgent(input: UpdateAgentInput, tx?: any) {
		// CR-12: Re-parenting an agent via updateAgent is NOT supported. updateAgent only writes
		// agents.parent_agent_id and never touches agent_hierarchy_closure, so changing the parent
		// here would desync parent_agent_id (permission checks) from the closure table (financial
		// roll-ups) AND has no cycle check (A->B & B->A would stack-overflow recursive walkers).
		// A safe re-parent is a larger feature nobody is requesting (YAGNI); reject changes here.
		// Callers still send the agent's existing parentAgentId (echoed back from the edit form),
		// so we only reject when it actually DIFFERS from the current value.
		if (input.parentAgentId !== undefined) {
			// Reuse findById (no new query shape) to read the agent's current parent.
			const current = await this.findById(input.id);
			const currentParent = current?.parentAgentId ?? null;
			const requestedParent = input.parentAgentId ?? null;
			if (current && currentParent !== requestedParent) {
				throw new Error('Re-parenting an agent is not supported');
			}
		}

		// NOTE: parent_agent_id is intentionally NOT in the update set (see CR-12 above).
		const [row] = await (tx ?? db)
			.update(agents)
			.set({
				allowedDomains: input.allowedDomains as unknown as string[] | undefined,
				status: input.status,
				levelIndex: input.levelIndex,
				tallyEnabled: input.tallyEnabled,
				tallyDomains: input.tallyDomains as unknown as string[] | undefined,
			})
			.where(eq(agents.id, input.id))
			.returning();
		return row;
	}

	async setCredentials(agentId: string, username: string, passwordHash: string) {
		// Wrap validation and update in transaction to prevent race conditions
		await db.transaction(async (tx) => {
			// Validate username uniqueness if username is being changed
			const existing = await tx
				.select()
				.from(agentCredentials)
				.where(eq(agentCredentials.agentId, agentId));

			// Task 24: derive the agent's tenant so uniqueness is scoped per tenant. Prefer the
			// existing credential row's tenant; fall back to the owning agent's tenant (covers the
			// new-credentials case where no credential row exists yet).
			let agentTenantId: string | undefined =
				existing.length > 0 && existing[0].tenantId ? String(existing[0].tenantId).trim() : undefined;
			if (!agentTenantId) {
				const [agentRow] = await tx
					.select({ tenantId: agents.tenantId })
					.from(agents)
					.where(eq(agents.id, agentId));
				agentTenantId = agentRow?.tenantId ? String(agentRow.tenantId).trim() : undefined;
			}

			const isNewCredentials = existing.length === 0;
			// Normalize both for comparison (existing username is already lowercase in DB)
			const normalizedNewUsername = username.trim().toLowerCase();
			const normalizedExistingUsername = existing.length > 0 ? (existing[0].username || '').trim().toLowerCase() : '';
			const isUsernameChanged = !isNewCredentials && normalizedExistingUsername !== normalizedNewUsername;

			if (isNewCredentials || isUsernameChanged) {
				await this.validateUsernameUniqueness(normalizedNewUsername, agentId, tx, agentTenantId);
			}

			if (isNewCredentials) {
				try {
					await tx.insert(agentCredentials).values({ agentId, tenantId: agentTenantId ?? 'default', username: normalizedNewUsername, passwordHash });
				} catch (error: any) {
					// Catch unique constraint violations and provide user-friendly error
					if (error?.code === '23505' || error?.message?.includes('unique') || error?.message?.includes('duplicate')) {
						throw new Error(`Username '${username}' is already taken`);
					}
					throw error;
				}
			} else {
				try {
					await tx
						.update(agentCredentials)
						.set({ username: normalizedNewUsername, passwordHash })
						.where(eq(agentCredentials.agentId, agentId));
				} catch (error: any) {
					// Catch unique constraint violations and provide user-friendly error
					if (error?.code === '23505' || error?.message?.includes('unique') || error?.message?.includes('duplicate')) {
						throw new Error(`Username '${username}' is already taken`);
					}
					throw error;
				}
			}
		});
	}

	/** UUID v4 regex for validation; agents.id is uuid type in DB */
	private static readonly UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

	async findById(id: string) {
		const idStr = typeof id === 'string' ? id.trim() : '';
		if (!idStr) {
			return null;
		}
		if (!AgentsRepo.UUID_REGEX.test(idStr)) {
			return null;
		}
		try {
			// Use leftJoin to ensure username is always included, same approach as list method
			const [result] = await db
				.select({
				id: agents.id,
				tenantId: agents.tenantId,
				schemeType: agents.schemeType,
				allowedDomains: agents.allowedDomains,
				status: agents.status,
				phone: agents.phone,
				parentAgentId: agents.parentAgentId,
				levelIndex: agents.levelIndex,
				tallyEnabled: agents.tallyEnabled,
				tallyDomains: agents.tallyDomains,
				creditLimit: agents.creditLimit,
				creditUsed: agents.creditUsed,
				creditAvailable: agents.creditAvailable,
				creditAlertThreshold: agents.creditAlertThreshold,
				tokenVersion: agents.tokenVersion,
				settlementBalance: agents.settlementBalance,
				settlementBalanceSports: agents.settlementBalanceSports,
				settlementBalanceCasino: agents.settlementBalanceCasino,
				settlementBalanceMatka: agents.settlementBalanceMatka,
				createdAt: agents.createdAt,
				username: agentCredentials.username,
			})
			.from(agents)
			.leftJoin(agentCredentials, eq(agents.id, agentCredentials.agentId))
			.where(eq(agents.id, idStr));

			if (!result) {
				return null;
			}

			// Return the result with username (will be null if credentials don't exist)
			return {
				id: result.id,
				tenantId: result.tenantId,
				schemeType: result.schemeType,
				allowedDomains: result.allowedDomains,
				status: result.status,
				phone: result.phone,
				parentAgentId: result.parentAgentId,
				levelIndex: result.levelIndex,
				tallyEnabled: result.tallyEnabled,
				tallyDomains: result.tallyDomains,
				creditLimit: result.creditLimit,
				creditUsed: result.creditUsed,
				creditAvailable: result.creditAvailable,
				creditAlertThreshold: result.creditAlertThreshold,
				tokenVersion: result.tokenVersion ?? 0,
				settlementBalance: result.settlementBalance,
				settlementBalanceSports: result.settlementBalanceSports,
				settlementBalanceCasino: result.settlementBalanceCasino,
				settlementBalanceMatka: result.settlementBalanceMatka,
				createdAt: result.createdAt,
				username: result.username || null,
			};
		} catch (err: any) {
			// Drizzle wraps the real PostgreSQL error in .cause (DrizzleQueryError)
			const cause = err?.cause ?? err;
			const causeMessage = cause?.message ?? cause?.toString?.() ?? String(cause);
			throw err;
		}
	}

	/**
	 * Tenant-scoped lookup. Returns the agent ONLY if it belongs to `tenantId`,
	 * otherwise null. Use this in all admin resolvers that resolve a target agent
	 * by a caller-supplied id, to prevent cross-tenant access (CR-11).
	 */
	async findByIdScoped(id: string, tenantId: string) {
		const tenant = typeof tenantId === 'string' ? tenantId.trim() : '';
		if (!tenant) {
			return null;
		}
		const agent = await this.findById(id);
		if (!agent) {
			return null;
		}
		const agentTenant = typeof agent.tenantId === 'string' ? agent.tenantId.trim() : agent.tenantId;
		if (agentTenant !== tenant) {
			return null;
		}
		return agent;
	}

	async incrementTokenVersion(agentId: string): Promise<void> {
		await db
			.update(agents)
			.set({ tokenVersion: sql`${agents.tokenVersion} + 1` })
			.where(eq(agents.id, agentId));
	}

	/** The agent's stored password hash, or null when it has no credentials. */
	async getPasswordHash(agentId: string): Promise<string | null> {
		const [row] = await db
			.select({ passwordHash: agentCredentials.passwordHash })
			.from(agentCredentials)
			.where(eq(agentCredentials.agentId, agentId))
			.limit(1);
		return row?.passwordHash ?? null;
	}

	/**
	 * Statuses of this agent's ancestors (closure depth > 0) that are not ACTIVE.
	 * Empty when every ancestor is ACTIVE. One indexed query; it runs on every
	 * agent request (buildAuthContext), because a suspended or blocked ancestor
	 * blocks its whole subtree (owner decision 1, 2026-10-21).
	 */
	async listNonActiveAncestorStatuses(agentId: string): Promise<string[]> {
		const rows = await db
			.select({ status: agents.status })
			.from(agentHierarchyClosure)
			.innerJoin(agents, eq(agents.id, agentHierarchyClosure.ancestorId))
			.where(
				and(
					eq(agentHierarchyClosure.descendantId, agentId),
					gt(agentHierarchyClosure.depth, 0),
					ne(agents.status, 'ACTIVE')
				)
			);
		return rows.map((r) => String(r.status));
	}

	/**
	 * The ancestor that restricts this agent although its own status may be ACTIVE (owner decision 1): the nearest
	 * one that blocks it (SUSPENDED, BLOCKED) or, when none does, the nearest INACTIVE one, which makes it read-only.
	 * null when every ancestor is ACTIVE. The same closure rows listNonActiveAncestorStatuses reads at sign-in.
	 */
	async findRestrictingAncestor(agentId: string): Promise<{ id: string; username: string | null; status: string } | null> {
		const [row] = await db
			.select({ id: agents.id, username: agentCredentials.username, status: agents.status })
			.from(agentHierarchyClosure)
			.innerJoin(agents, eq(agents.id, agentHierarchyClosure.ancestorId))
			.leftJoin(agentCredentials, eq(agentCredentials.agentId, agents.id))
			.where(
				and(
					eq(agentHierarchyClosure.descendantId, agentId),
					gt(agentHierarchyClosure.depth, 0),
					ne(agents.status, 'ACTIVE')
				)
			)
			.orderBy(sql`(${agents.status} = 'INACTIVE')`, agentHierarchyClosure.depth)
			.limit(1);
		return row ? { id: String(row.id), username: row.username ?? null, status: String(row.status) } : null;
	}

	/**
	 * Removes `removed` domains from allowed_domains and tally_domains of every
	 * agent in the subtree of `agentId` (itself included, through its depth-0
	 * closure row). Called with the parent's own update in one transaction, so a
	 * narrowed parent never leaves a child holding a domain the parent lacks.
	 * Returns the number of agents changed.
	 */
	async narrowSubtreeDomains(agentId: string, removed: string[], tx?: any): Promise<number> {
		const domains = Array.from(new Set(removed.filter((d) => typeof d === 'string' && d !== '')));
		if (domains.length === 0) return 0;
		const strip = (column: string) =>
			domains.reduce((acc, d) => sql`array_remove(${acc}, ${d}::text)`, sql.raw(column));
		const removedArray = sql`ARRAY[${sql.join(domains.map((d) => sql`${d}::text`), sql`, `)}]::text[]`;
		// A tally is on only with a domain to tally (tallyIsOn, AGE-09). When this narrowing removes an agent's last
		// tally domain, its tally goes off with it, as commission already pays it, instead of a flag left on over an
		// empty list. A tally that had no domain before is not this narrowing's to change.
		const result = await (tx ?? db).execute(sql`
			UPDATE agents
			   SET allowed_domains = ${strip('allowed_domains')},
			       tally_domains = CASE WHEN tally_domains IS NULL THEN NULL ELSE ${strip('tally_domains')} END,
			       tally_enabled = CASE
			         WHEN tally_enabled
			          AND COALESCE(tally_domains && ${removedArray}, false)
			          AND NOT COALESCE(${strip('tally_domains')} && ARRAY['sports', 'casino', 'matka']::text[], false)
			         THEN false ELSE tally_enabled END
			 WHERE id IN (
			         SELECT descendant_id FROM agent_hierarchy_closure
			          WHERE ancestor_id = ${agentId} AND depth >= 0
			       )
			   AND (allowed_domains && ${removedArray} OR COALESCE(tally_domains && ${removedArray}, false))
			RETURNING id`);
		return Array.isArray((result as any)?.rows) ? (result as any).rows.length : 0;
	}

	async findByUsername(username: string, excludeAgentId?: string, tx?: any, tenantId?: string) {
		// Normalize username (trim and lowercase for case-insensitive comparison)
		const normalizedUsername = username?.trim().toLowerCase() || '';

		// Handle null/empty username gracefully
		if (!normalizedUsername) {
			return null;
		}

		const dbInstance = tx || db;

		// Build where conditions
		const conditions = [eq(agentCredentials.username, normalizedUsername)];

		// Task 24: scope by tenant when provided (usernames are unique per tenant, not globally).
		// Callers in auth/uniqueness-critical paths MUST pass tenantId; reporting lookups may omit it.
		if (tenantId !== undefined && tenantId !== null) {
			conditions.push(eq(agentCredentials.tenantId, String(tenantId).trim()));
		}

		// Exclude current agent if provided
		if (excludeAgentId) {
			conditions.push(ne(agentCredentials.agentId, excludeAgentId));
		}
		
		const [cred] = await dbInstance
			.select()
			.from(agentCredentials)
			.where(and(...conditions));
		if (!cred) return null;
		return this.findById(cred.agentId);
	}

	async checkUsernameAvailable(username: string, excludeAgentId?: string, tx?: any, tenantId?: string): Promise<boolean> {
		// Null/empty username is considered unavailable
		if (!username || username.trim() === '') {
			return false;
		}

		const existing = await this.findByUsername(username, excludeAgentId, tx, tenantId);
		return existing === null;
	}

	async validateUsernameUniqueness(username: string, excludeAgentId?: string, tx?: any, tenantId?: string): Promise<void> {
		// Skip validation if username is null/empty (will be caught by other validations)
		if (!username || username.trim() === '') {
			return;
		}

		const existing = await this.findByUsername(username, excludeAgentId, tx, tenantId);
		if (existing) {
			throw new Error(`Username '${username}' is already taken`);
		}
	}

	async findByUsernameWithCredentials(username: string, tenantId?: string) {
		// Normalize to match the case-insensitive DB index (tenant_id, lower(username)).
		const normalizedUsername = username?.trim().toLowerCase() || '';
		if (!normalizedUsername) return null;

		// Task 24: scope login lookup by tenant when provided so two tenants can share a username
		// without this returning an arbitrary cross-tenant row.
		const conditions = [eq(agentCredentials.username, normalizedUsername)];
		if (tenantId !== undefined && tenantId !== null) {
			conditions.push(eq(agentCredentials.tenantId, String(tenantId).trim()));
		}

		const [cred] = await db
			.select({
				agentId: agentCredentials.agentId,
				username: agentCredentials.username,
				passwordHash: agentCredentials.passwordHash,
			})
			.from(agentCredentials)
			.where(and(...conditions));
		if (!cred) return null;
		const agent = await this.findById(cred.agentId);
		if (!agent) return null;
		return {
			...agent,
			username: cred.username, // Use username from credentials (not from findById which might be null)
			passwordHash: cred.passwordHash,
		};
	}

	async updateLastLogin(agentId: string) {
		await db
			.update(agentCredentials)
			.set({ lastLoginAt: new Date() })
			.where(eq(agentCredentials.agentId, agentId));
	}

	async listRootAgentIds(tenantId: string): Promise<string[]> {
		const rows = await db
			.select({ id: agents.id })
			.from(agents)
			.where(and(eq(agents.tenantId, tenantId), isNull(agents.parentAgentId)));
		return rows.map((r) => r.id);
	}

	async listRootAgents(tenantId: string): Promise<{ id: string; username: string | null; schemeType: string; rate: number | null }[]> {
		const rows = await db
			.select({
				id: agents.id,
				schemeType: agents.schemeType,
			})
			.from(agents)
			.where(and(eq(agents.tenantId, tenantId), isNull(agents.parentAgentId)));

		// Get usernames and rates for each agent
		const results = await Promise.all(
			rows.map(async (row) => {
				const creds = await db
					.select({ username: agentCredentials.username })
					.from(agentCredentials)
					.where(eq(agentCredentials.agentId, row.id))
					.limit(1);

				// Get sharing rate for sports domain
				const configs = await db
					.select({ shareRate: agentSharingConfig.shareRate })
					.from(agentSharingConfig)
					.where(and(eq(agentSharingConfig.agentId, row.id), eq(agentSharingConfig.domain, 'sports')))
					.limit(1);

				return {
					id: row.id,
					username: creds[0]?.username ?? null,
					schemeType: row.schemeType,
					rate: configs[0]?.shareRate ? Number(configs[0].shareRate) * 100 : null,
				};
			})
		);

		return results;
	}

	async listChildren(parentAgentId: string) {
		const rows = await db
			.select({
				id: agents.id,
				tenantId: agents.tenantId,
				schemeType: agents.schemeType,
				allowedDomains: agents.allowedDomains,
				status: agents.status,
				phone: agents.phone,
				parentAgentId: agents.parentAgentId,
				levelIndex: agents.levelIndex,
				tallyEnabled: agents.tallyEnabled,
				tallyDomains: agents.tallyDomains,
				createdAt: agents.createdAt,
				username: agentCredentials.username,
				creditLimit: agents.creditLimit,
				creditUsed: agents.creditUsed,
				creditAvailable: agents.creditAvailable,
				creditAlertThreshold: agents.creditAlertThreshold,
			})
			.from(agents)
			.leftJoin(agentCredentials, eq(agents.id, agentCredentials.agentId))
			.where(eq(agents.parentAgentId, parentAgentId));

		return rows.map((r) => ({
			...r,
			allowedDomains: r.allowedDomains as AgentDomain[],
			tallyDomains: r.tallyDomains as AgentDomain[] | null,
			creditLimit: Number(r.creditLimit || 0),
			creditUsed: Number(r.creditUsed || 0),
			creditAvailable: Number(r.creditAvailable || 0),
			creditAlertThreshold: Number(r.creditAlertThreshold || 80),
		}));
	}

	/** Get all descendant agent IDs (including self) using hierarchy closure. Returns empty array if agent has no closure rows. */
	async getDescendantIds(ancestorId: string): Promise<string[]> {
		const rows = await db
			.select({ descendantId: agentHierarchyClosure.descendantId })
			.from(agentHierarchyClosure)
			.where(eq(agentHierarchyClosure.ancestorId, ancestorId));
		const ids = Array.from(new Set([ancestorId, ...rows.map((r) => r.descendantId)]));
		return ids;
	}

	/** For exclusion list: id, name (username), code (username), phone by IDs. Preserves order of requested ids. */
	async findByIdsForExclusion(ids: string[], tenantId: string): Promise<Array<{ id: string; name: string; code: string; phone?: string | null }>> {
		if (!ids.length) return [];
		const tenant = typeof tenantId === 'string' ? tenantId.trim() : '';
		if (!tenant) return [];
		const conditions = [inArray(agents.id, ids), eq(agents.tenantId, tenant)];
		const rows = await db
			.select({
				id: agents.id,
				username: agentCredentials.username,
				phone: agents.phone,
			})
			.from(agents)
			.leftJoin(agentCredentials, eq(agents.id, agentCredentials.agentId))
			.where(and(...conditions));
		const byId = new Map(rows.map((r) => [r.id, { id: r.id, name: r.username ?? r.id, code: r.username ?? r.id, phone: r.phone ?? null }]));
		return ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => r != null);
	}

	/** Resolve agent usernames to agent IDs (for exclusion list upload). Normalizes usernames to lowercase. */
	async getAgentIdsByUsernames(usernames: string[], tenantId: string): Promise<string[]> {
		if (!usernames.length) return [];
		const tenant = typeof tenantId === 'string' ? tenantId.trim() : '';
		if (!tenant) return [];
		const normalized = usernames
			.map((u) => (typeof u === 'string' ? u.trim().toLowerCase() : ''))
			.filter(Boolean);
		const unique = [...new Set(normalized)];
		if (!unique.length) return [];
		const conditions = [
			sql`lower(${agentCredentials.username}) in (${sql.join(unique.map((u) => sql`${u}`), sql`, `)})`,
			eq(agents.tenantId, tenant),
		];
		const rows = await db
			.select({ agentId: agentCredentials.agentId })
			.from(agentCredentials)
			.innerJoin(agents, eq(agents.id, agentCredentials.agentId))
			.where(and(...conditions));
		return rows.map((r) => r.agentId);
	}

	async list(tenantId?: string, filters?: { schemeType?: AgentScheme; status?: string; query?: string; parentAgentId?: string; directOnly?: boolean }, pagination?: { offset: number; limit: number }) {
		try {
			let queryBuilder = db
				.select({
					id: agents.id,
					tenantId: agents.tenantId,
					schemeType: agents.schemeType,
					allowedDomains: agents.allowedDomains,
					status: agents.status,
					phone: agents.phone,
					parentAgentId: agents.parentAgentId,
					levelIndex: agents.levelIndex,
					tallyEnabled: agents.tallyEnabled,
					tallyDomains: agents.tallyDomains,
					creditLimit: agents.creditLimit,
					creditUsed: agents.creditUsed,
					creditAvailable: agents.creditAvailable,
					creditAlertThreshold: agents.creditAlertThreshold,
					settlementBalance: agents.settlementBalance,
					settlementBalanceSports: agents.settlementBalanceSports,
					settlementBalanceCasino: agents.settlementBalanceCasino,
					settlementBalanceMatka: agents.settlementBalanceMatka,
					createdAt: agents.createdAt,
					username: agentCredentials.username,
				})
				.from(agents)
				.leftJoin(agentCredentials, eq(agents.id, agentCredentials.agentId));
			
			const conditions = [];
			
			if (tenantId) {
				conditions.push(eq(agents.tenantId, tenantId));
			}
			if (filters?.schemeType) {
				conditions.push(eq(agents.schemeType, filters.schemeType));
			}
			if (filters?.status) {
				conditions.push(eq(agents.status, filters.status));
			}
			if (filters?.parentAgentId) {
				conditions.push(eq(agents.parentAgentId, filters.parentAgentId));
			}
			if (filters?.directOnly) {
				conditions.push(isNull(agents.parentAgentId));
			}
			
			// Add search query filter - search by id, username or phone (agentSearchCondition)
			if (filters?.query && filters.query.trim().length > 0) {
				conditions.push(agentSearchCondition(filters.query));
			}

			if (conditions.length > 0) {
				queryBuilder = queryBuilder.where(and(...conditions)) as any;
			}

			queryBuilder = queryBuilder.orderBy(desc(agents.createdAt), desc(agents.id)) as any;
			if (pagination) {
				queryBuilder = queryBuilder.limit(pagination.limit).offset(pagination.offset) as any;
			}
			
			const results = await queryBuilder;
			return results || [];
		} catch (error) {
			return [];
		}
	}

	/**
	 * Batch-fetch parent chain (ancestors) for multiple agents using the closure table.
	 * Returns a map of agentId -> ordered list of ancestors (root first, direct parent last).
	 * Each ancestor has id, username, levelIndex, and route for navigation.
	 */
	async getParentChainsBatch(agentIds: string[]): Promise<Map<string, Array<{ id: string; username: string; levelIndex: number | null; route: string }>>> {
		const uniqueIds = [...new Set(agentIds)].filter(Boolean);
		if (uniqueIds.length === 0) return new Map();

		const rows = await db
			.select({
				descendantId: agentHierarchyClosure.descendantId,
				ancestorId: agentHierarchyClosure.ancestorId,
				depth: agentHierarchyClosure.depth,
				username: agentCredentials.username,
				levelIndex: agents.levelIndex,
			})
			.from(agentHierarchyClosure)
			.innerJoin(agents, eq(agents.id, agentHierarchyClosure.ancestorId))
			.leftJoin(agentCredentials, eq(agents.id, agentCredentials.agentId))
			.where(
				and(
					inArray(agentHierarchyClosure.descendantId, uniqueIds),
					gt(agentHierarchyClosure.depth, 0)
				)
			)
			.orderBy(agentHierarchyClosure.descendantId, desc(agentHierarchyClosure.depth));

		const map = new Map<string, Array<{ id: string; username: string; levelIndex: number | null; route: string }>>();
		for (const id of uniqueIds) {
			map.set(id, []);
		}
		for (const r of rows) {
			const list = map.get(r.descendantId);
			if (list) {
				list.push({
					id: r.ancestorId,
					username: r.username ?? `Agent ${r.ancestorId}`,
					levelIndex: r.levelIndex ?? null,
					route: `/agents/${r.ancestorId}`,
				});
			}
		}
		return map;
	}

	async count(tenantId?: string, filters?: { schemeType?: AgentScheme; status?: string; query?: string; parentAgentId?: string; directOnly?: boolean }) {
		try {
			// Join with credentials if we need to search by username
			const needsCredentialsJoin = filters?.query && filters.query.trim().length > 0;
			
			let queryBuilder = needsCredentialsJoin
				? db.select({ count: sql<number>`count(*)::int` }).from(agents).leftJoin(agentCredentials, eq(agents.id, agentCredentials.agentId))
				: db.select({ count: sql<number>`count(*)::int` }).from(agents);
			
			const conditions = [];
			
			if (tenantId) {
				conditions.push(eq(agents.tenantId, tenantId));
			}
			if (filters?.schemeType) {
				conditions.push(eq(agents.schemeType, filters.schemeType));
			}
			if (filters?.status) {
				conditions.push(eq(agents.status, filters.status));
			}
			if (filters?.parentAgentId) {
				conditions.push(eq(agents.parentAgentId, filters.parentAgentId));
			}
			if (filters?.directOnly) {
				conditions.push(isNull(agents.parentAgentId));
			}
			
			// Add search query filter - the same search as list (agentSearchCondition)
			if (filters?.query && filters.query.trim().length > 0) {
				conditions.push(agentSearchCondition(filters.query));
			}

			if (conditions.length > 0) {
				queryBuilder = queryBuilder.where(and(...conditions)) as any;
			}

			const result = await queryBuilder;
			return Number(result[0]?.count || 0);
		} catch (error) {
			return 0;
		}
	}

	/**
	 * Get credit fields for an agent
	 */
	async getCreditFields(agentId: string, executor: any = db): Promise<{
		creditLimit: number;
		creditUsed: number;
		creditAvailable: number;
		creditAlertThreshold: number;
		settlementBalance: number;
		settlementBalanceSports: number;
		settlementBalanceCasino: number;
		settlementBalanceMatka: number;
	} | null> {
		const [agent] = await executor
			.select({
				creditLimit: agents.creditLimit,
				creditUsed: agents.creditUsed,
				creditAvailable: agents.creditAvailable,
				creditAlertThreshold: agents.creditAlertThreshold,
				settlementBalance: agents.settlementBalance,
				settlementBalanceSports: agents.settlementBalanceSports,
				settlementBalanceCasino: agents.settlementBalanceCasino,
				settlementBalanceMatka: agents.settlementBalanceMatka,
			})
			.from(agents)
			.where(eq(agents.id, agentId))
			.limit(1);

		if (!agent) {
			return null;
		}

		return {
			creditLimit: Number(agent.creditLimit || 0),
			creditUsed: Number(agent.creditUsed || 0),
			creditAvailable: Number(agent.creditAvailable || 0),
			creditAlertThreshold: Number(agent.creditAlertThreshold || 80),
			settlementBalance: Number(agent.settlementBalance || 0),
			settlementBalanceSports: Number(agent.settlementBalanceSports || 0),
			settlementBalanceCasino: Number(agent.settlementBalanceCasino || 0),
			settlementBalanceMatka: Number(agent.settlementBalanceMatka || 0),
		};
	}
}

