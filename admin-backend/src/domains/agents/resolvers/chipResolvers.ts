/**
 * GraphQL for the CREDIT scheme on Deposit/Withdraw chips (spec
 * docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md §7). The rules and the SQL live in
 * services/ChipService.ts and repos/agents/ChipRepo.ts; this file only maps the API onto them.
 *
 * Reads sit under Query.agents (AgentsQuery). That namespace refuses a caller holding neither agents.list:view nor
 * credit.management:view, and every field but chipPool and chipDownline (CHIPS_PAGE_READS, the Chips page's reads)
 * then demands agents.list:view itself (resolvers/index.ts). ChipService applies the read scope: an agent sees
 * itself and its subtree, an admin the CREDIT accounts of its tenant.
 *
 * Moves sit under Mutation.agents (AgentsMutation). They are spread into buildAgentsMutationResolvers, so
 * guardAgentMutations demands agents.credit:update for each (AGENT_MUTATION_PERMISSIONS), and ChipService then lets
 * only the direct parent move chips or set a credit reference.
 *
 * The list fields AgentAccount.chips and User.chips resolve in batch, through one DataLoader per request and type,
 * so a list page costs a fixed number of queries however many rows it has.
 */
import DataLoader from 'dataloader';
import { db } from '@src/db/client.js';
import { ensureAgentCanMutate } from '@src/domains/common/auth.js';
import { recordAuditDb } from '@/repos/audit/auditRepo';
import { isCreditPlayer } from '@shared/services/credit/isCreditPlayer.js';
import { ChipRepo } from '@src/repos/agents/ChipRepo.js';
import {
	chipCallerFromCtx,
	chipService,
	type ChipAccount,
	type ChipCaller,
	type ChipDownlineArgs,
	type ChipService,
	type ChipStatementArgs,
	type ChipTransferInput,
	type ChipTransferResult,
	type CreditReferenceInput,
} from '../services/ChipService.js';

// ---------------------------------------------------------------------------------------------------------------
// AgentsQuery
// ---------------------------------------------------------------------------------------------------------------

export type ChipQueryService = Pick<ChipService, 'getAccount' | 'getMyAccount' | 'getDownline' | 'getStatement' | 'getPool'>;

export function buildChipQueryResolvers(service: ChipQueryService = chipService) {
	return {
		chipAccount: async (_: unknown, args: { accountType: string; accountId: string }, ctx: any) =>
			service.getAccount(chipCallerFromCtx(ctx), args?.accountType, args?.accountId),
		myChipAccount: async (_: unknown, _args: unknown, ctx: any) => service.getMyAccount(chipCallerFromCtx(ctx)),
		chipDownline: async (_: unknown, args: ChipDownlineArgs, ctx: any) => service.getDownline(chipCallerFromCtx(ctx), args ?? {}),
		chipStatement: async (_: unknown, args: ChipStatementArgs, ctx: any) => service.getStatement(chipCallerFromCtx(ctx), args),
		chipPool: async (_: unknown, _args: unknown, ctx: any) => service.getPool(chipCallerFromCtx(ctx)),
	};
}

// ---------------------------------------------------------------------------------------------------------------
// AgentsMutation
// ---------------------------------------------------------------------------------------------------------------

export type ChipMutationService = Pick<ChipService, 'depositChips' | 'withdrawChips' | 'setCreditReference'>;
export type ChipAuditWriter = (entry: Parameters<typeof recordAuditDb>[0]) => Promise<unknown>;

export function buildChipMutationResolvers(service: ChipMutationService = chipService, audit: ChipAuditWriter = recordAuditDb) {
	/**
	 * The activity-log row for a move. credit_chip_ledger is the record of every move and is written inside the
	 * money transaction; this row only feeds the audit screens, so it is best-effort and never fails a move that
	 * has already committed.
	 */
	const record = (caller: ChipCaller, action: string, account: ChipAccount, after: Record<string, unknown>) => {
		Promise.resolve()
			.then(() =>
				audit({
					tenant: caller.tenant,
					actorId: caller.kind === 'agent' ? caller.agentId : (caller.userId ?? 'admin'),
					domain: 'agents.chips',
					action,
					resourceType: account.accountType === 'AGENT' ? 'agent' : 'player',
					resourceId: account.id,
					after: { ...after, actorType: caller.kind },
				})
			)
			.catch(() => {});
	};

	const transferred = (caller: ChipCaller, action: string, input: ChipTransferInput, result: ChipTransferResult) => {
		record(caller, action, result.account, {
			amount: Number(input?.amount),
			remark: input?.remark ?? null,
			transferId: result.transferId,
			balanceAfter: result.account.balance,
			parentAgentId: result.parent?.id ?? null,
		});
	};

	return {
		depositChips: async (_: unknown, { input }: { input: ChipTransferInput }, ctx: any) => {
			ensureAgentCanMutate(ctx);
			const caller = chipCallerFromCtx(ctx);
			const result = await service.depositChips(caller, input);
			transferred(caller, 'deposit_chips', input, result);
			return result;
		},
		withdrawChips: async (_: unknown, { input }: { input: ChipTransferInput }, ctx: any) => {
			ensureAgentCanMutate(ctx);
			const caller = chipCallerFromCtx(ctx);
			const result = await service.withdrawChips(caller, input);
			transferred(caller, 'withdraw_chips', input, result);
			return result;
		},
		setCreditReference: async (_: unknown, { input }: { input: CreditReferenceInput }, ctx: any) => {
			ensureAgentCanMutate(ctx);
			const caller = chipCallerFromCtx(ctx);
			const account = await service.setCreditReference(caller, input);
			record(caller, 'set_credit_reference', account, {
				creditReference: account.creditReference,
				remark: input?.remark ?? null,
			});
			return account;
		},
	};
}

// ---------------------------------------------------------------------------------------------------------------
// AgentAccount.chips and User.chips, in batch
// ---------------------------------------------------------------------------------------------------------------

export type ChipListService = Pick<ChipService, 'chipAccountsForAgents' | 'chipAccountsForPlayers'>;
/** Which of `agentIds` are `ancestorId` itself or below it (agent_hierarchy_closure). */
export type SubtreeReader = (ancestorId: string, agentIds: readonly string[]) => Promise<Set<string>>;

export interface ChipListLoaders {
	/** Keyed by lower-case agent id; null for an agent that is not a visible CREDIT agent. */
	agents: DataLoader<string, ChipAccount | null>;
	/** Keyed by player id as a string; null for a player that is not a visible credit player. */
	players: DataLoader<string, ChipAccount | null>;
}

const chipRepo = new ChipRepo();
const readSubtree: SubtreeReader = (ancestorId, agentIds) => chipRepo.agentsInSubtree(db, ancestorId, agentIds);

/**
 * The batch loaders of one request. Each list costs one ChipService batch read (plus, for an agent caller, one
 * closure query), whatever its length.
 *
 * ChipService's batch reads do not check scope; they read the caller's tenant only. The list queries have already
 * scoped their rows, and for an agent caller the loaders keep only accounts inside its own subtree as well: a row
 * that reached these fields some other way (an upline's parentAgent, say) must not carry chip figures from outside
 * the caller's subtree. A WHITELABEL_CREDIT player belongs to the whitelabel, so an agent never sees its chips here.
 */
export function createChipListLoaders(
	caller: ChipCaller,
	service: ChipListService = chipService,
	subtree: SubtreeReader = readSubtree
): ChipListLoaders {
	const insideCaller = async (agentIds: readonly string[]): Promise<(agentId: string | null) => boolean> => {
		if (caller.kind !== 'agent') return () => true;
		const inside = agentIds.length ? await subtree(caller.agentId, agentIds) : new Set<string>();
		return (agentId) => agentId != null && inside.has(agentId.trim().toLowerCase());
	};
	return {
		agents: new DataLoader<string, ChipAccount | null>(async (ids) => {
			const accounts = await service.chipAccountsForAgents(caller.tenant, ids);
			const visible = await insideCaller([...accounts.keys()]);
			return ids.map((id) => {
				const account = accounts.get(id.trim().toLowerCase());
				return account && visible(account.id) ? account : null;
			});
		}),
		players: new DataLoader<string, ChipAccount | null>(async (ids) => {
			const accounts = await service.chipAccountsForPlayers(caller.tenant, ids);
			const owners = [...new Set([...accounts.values()].map((a) => a.parentAgentId).filter((id): id is string => !!id))];
			const visible = await insideCaller(owners);
			return ids.map((id) => {
				const account = accounts.get(id.trim());
				if (!account) return null;
				return caller.kind === 'agent' && !visible(account.parentAgentId) ? null : account;
			});
		}),
	};
}

const loadersByRequest = new WeakMap<object, ChipListLoaders>();

function loadersFor(ctx: any): ChipListLoaders {
	const caller = chipCallerFromCtx(ctx);
	let loaders = loadersByRequest.get(ctx);
	if (!loaders) {
		loaders = createChipListLoaders(caller);
		loadersByRequest.set(ctx, loaders);
	}
	return loaders;
}

/** AgentAccount.chips: a CREDIT agent's chip figures; null for every other scheme. */
export async function agentAccountChips(parent: { id?: unknown; schemeType?: unknown } | null, _args: unknown, ctx: any): Promise<ChipAccount | null> {
	if (!parent?.id || parent.schemeType !== 'CREDIT') return null;
	return loadersFor(ctx).agents.load(String(parent.id).trim().toLowerCase());
}

/**
 * User.chips: a credit player's chip figures (AGENT_CREDIT or WHITELABEL_CREDIT); null for every other type. A row
 * that a list query has already filled through attachPlayerChips keeps that value.
 */
export async function userChips(
	parent: { id?: unknown; playerType?: unknown; chips?: ChipAccount | null } | null,
	_args: unknown,
	ctx: any
): Promise<ChipAccount | null> {
	if (parent?.chips !== undefined) return parent.chips;
	if (parent?.id == null || !isCreditPlayer(parent.playerType as string | null | undefined)) return null;
	return loadersFor(ctx).players.load(String(parent.id).trim());
}

/**
 * Fills `chips` on every row of a players list with one batch read: the figures of each visible credit player,
 * null for every other row. usersPage calls it so a whole page costs one read; the live User.chips field resolver
 * (commonResolvers.User, which domains/index.ts maps User to) then keeps the value it finds on the row.
 * A failed read leaves chips null on the page rather than failing the whole list.
 */
export async function attachPlayerChips(rows: Array<Record<string, any>>, ctx: any): Promise<void> {
	const credit = rows.filter((row) => row && row.id != null && isCreditPlayer(row.playerType));
	for (const row of rows) if (row) row.chips = null;
	if (credit.length === 0) return;
	const loaded = await loadersFor(ctx).players.loadMany(credit.map((row) => String(row.id).trim()));
	credit.forEach((row, i) => {
		const account = loaded[i];
		if (account instanceof Error) {
			console.error('[chips] players list chip figures failed:', account.message);
			return;
		}
		row.chips = account ?? null;
	});
}
