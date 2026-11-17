/**
 * Creating a CREDIT agent or a credit player on Deposit/Withdraw chips (spec
 * docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md §4.4). createAgent, the admin createPlayer and the
 * agent's createPlayerForAgent share these rules:
 *
 *   - `creditLimit` on the create input is the account's credit reference: the figure its Ref P/L is measured
 *     against. It gates nothing, so creating an account no longer allocates a limit, debits the parent's
 *     credit_used or debits the whitelabel pool.
 *   - `openingChips` > 0 is a DEPOSIT from the new account's own parent (its parent agent, or the whitelabel pool
 *     for a root CREDIT agent or a WHITELABEL_CREDIT player), made with every rule of depositChips, inside the
 *     creation transaction: a refused deposit rolls the new account back with it.
 *   - Only that parent's chips fund them (decision 3: chips move only between a direct parent and its child). The
 *     parent itself gives them, or an admin acting for it in one case: owner decision 2026-11-04 lets an admin who
 *     creates an AGENT_CREDIT player under a CREDIT agent set its credit reference and opening chips, as the agent
 *     can for its own player, and the chips come out of that agent's own free chips (one level, parent to child;
 *     the admin is recorded as the actor). Any other creator, such as an admin creating a sub-agent under an agent,
 *     or an agent creating a player for its sub-agent, creates the account with 0 opening chips, and the upline
 *     deposits afterwards (openingChipsUplineRefusal).
 */
import { isCreditPlayer } from '@shared/services/credit/isCreditPlayer.js';
import { ChipRepo, parsePlayerId, type ChipExecutor } from '@src/repos/agents/ChipRepo.js';
import {
	ChipError,
	chipService,
	roundChips,
	toChipAmount,
	toCreditReference,
	type ChipAccountType,
	type ChipActor,
	type ChipService,
	type ChipTx,
} from './ChipService.js';

/** The opening chips asked for: 0 when missing (no deposit); refuses NaN, Infinity and negatives. */
export function openingChipsOf(raw: unknown): number {
	if (raw === undefined || raw === null || raw === '') return 0;
	const n = typeof raw === 'number' ? raw : Number(raw);
	if (!Number.isFinite(n)) throw new ChipError('INVALID_INPUT', 'Opening chips must be a number');
	if (n < 0) throw new ChipError('INVALID_INPUT', 'Opening chips cannot be negative');
	// Less than a cent is no deposit at all, rather than a refusal.
	if (roundChips(n) === 0) return 0;
	return toChipAmount(n);
}

/** The credit reference from a create input's creditLimit: 0 when missing; refuses NaN, Infinity and negatives. */
export function creditReferenceOf(raw: unknown): number {
	if (raw === undefined || raw === null || raw === '') return 0;
	return toCreditReference(raw);
}

/** Who creates the account, as the opening deposit's ledger rows record it (created_by / created_by_type). */
export function creatorActorOf(ctx: any): ChipActor {
	if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
		return { createdBy: String(ctx.user.agentId), createdByType: 'agent' };
	}
	const id = ctx?.user?.sub ?? ctx?.user?.id;
	return { createdBy: id != null && String(id) !== '' ? String(id) : null, createdByType: 'admin' };
}

/** The refusal when the creator is not the new account's direct upline (decision 3). */
export const OPENING_CHIPS_DIRECT_UPLINE_ONLY =
	'Opening chips can only come from the direct upline. Create the account with 0 opening chips; its upline can then deposit.';

/**
 * Where a new account sits in the chip tree: an agent under its parent agent (null for a root agent, which sits
 * under the whitelabel), or a player of its type under its agent.
 */
export type OpeningChipsPlace =
	| { accountType: 'AGENT'; parentAgentId: string | null }
	| { accountType: 'PLAYER'; playerType: string | null; agentId: string | null };

function sameAgentId(a: string | null | undefined, b: string | null | undefined): boolean {
	return a != null && b != null && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/**
 * Decision 3 (only the direct upline moves chips) at creation. Opening chips are a deposit from the new account's
 * parent, so they are given:
 *   - by an agent, to its own direct CREDIT sub-agent or its own AGENT_CREDIT player;
 *   - by an admin, acting as the whitelabel, to a root CREDIT agent or a WHITELABEL_CREDIT player (from the pool);
 *   - by an admin creating an AGENT_CREDIT player under a CREDIT agent (owner decision 2026-11-04): the deposit is
 *     still the player's direct parent's, from that agent's own chips to its new player, with every rule of
 *     depositChips (enough free chips, the agent ACTIVE); the admin is only the actor on its ledger rows.
 * Any other creator is refused: an admin creating a sub-agent under an agent (the owner's decision covers players
 * only), or an agent creating for its sub-agent. A 'system' creator is nobody's upline. Returns the refusal, or
 * null when the creator may give them.
 */
export function openingChipsUplineRefusal(creator: ChipActor, place: OpeningChipsPlace): ChipError | null {
	let direct = false;
	if (creator.createdByType === 'agent') {
		direct =
			place.accountType === 'AGENT'
				? sameAgentId(place.parentAgentId, creator.createdBy)
				: place.playerType === 'AGENT_CREDIT' && sameAgentId(place.agentId, creator.createdBy);
	} else if (creator.createdByType === 'admin') {
		direct =
			place.accountType === 'AGENT'
				? place.parentAgentId == null
				: place.playerType === 'WHITELABEL_CREDIT' || (place.playerType === 'AGENT_CREDIT' && place.agentId != null);
	}
	return direct ? null : new ChipError('NOT_DIRECT_PARENT', OPENING_CHIPS_DIRECT_UPLINE_ONLY);
}

/**
 * Owner decision 1 (2026-10-21) for an admin giving an AGENT_CREDIT player opening chips out of its agent's chips:
 * an agent below a SUSPENDED or BLOCKED upline cannot sign in, and one below an INACTIVE upline is read-only, so it
 * could not move those chips itself; an admin does not move them for it either. `restricting` is the nearest upline
 * that restricts the agent (AgentsRepo.findRestrictingAncestor). Returns the refusal, or null when there is none.
 * The agent's own status is the deposit's to check (planChipTransfer).
 */
export function openingChipsRestrictedUplineRefusal(
	agentName: string,
	restricting: { id: string; username: string | null; status: string } | null
): ChipError | null {
	if (!restricting) return null;
	const upline = restricting.username || restricting.id;
	return new ChipError(
		'NOT_ACTIVE',
		`Opening chips: Chips cannot be deposited while agent ${agentName}'s upline ${upline} is ${String(restricting.status).toLowerCase()}`
	);
}

/**
 * The same rule for a create path that knows the new account's place before it writes anything: throws the refusal
 * when openingChips > 0 and the creator is not the direct upline. depositOpeningChipsInTx applies the rule again on
 * the creation transaction, so a path that does not call this is still covered.
 */
export function assertOpeningChipsFromDirectUpline(creator: ChipActor, place: OpeningChipsPlace, openingChips: number): void {
	if (!(openingChips > 0)) return;
	const refusal = openingChipsUplineRefusal(creator, place);
	if (refusal) throw refusal;
}

/**
 * Reads where the account just created sits, on its creation transaction (its rows are visible only there). Null
 * when it is missing, in another tenant, or not on CREDIT chips: the deposit refuses those with its own message.
 */
export async function readOpeningChipsPlace(
	tx: ChipExecutor,
	tenant: string,
	accountType: ChipAccountType,
	accountId: string | number,
	repo: Pick<ChipRepo, 'readAgent' | 'readPlayer'> = new ChipRepo()
): Promise<OpeningChipsPlace | null> {
	if (accountType === 'AGENT') {
		const agent = await repo.readAgent(tx, String(accountId ?? ''));
		if (!agent || agent.tenantId !== tenant || agent.schemeType !== 'CREDIT') return null;
		return { accountType: 'AGENT', parentAgentId: agent.parentAgentId };
	}
	const playerId = parsePlayerId(accountId);
	if (playerId == null) return null;
	const player = await repo.readPlayer(tx, playerId, tenant);
	if (!player || !isCreditPlayer(player.playerType)) return null;
	return { accountType: 'PLAYER', playerType: player.playerType, agentId: player.agentId };
}

/**
 * Locks the parent whose chips fund a new player's opening deposit, at the start of the creation transaction and
 * before the player's rows are inserted. The parent is always locked before the child (spec §4), and two players
 * created under one agent at the same moment then queue on this lock. Without it each would first take the
 * foreign-key share lock that the agent_player_credits insert holds on the agent row, and the two upgrades to
 * FOR UPDATE would deadlock. A tenant with no pool row is left to the deposit itself, which refuses it.
 */
export async function lockOpeningChipsParent(
	tx: ChipExecutor,
	tenant: string,
	parentAgentId: string | null,
	repo: Pick<ChipRepo, 'lockAgent' | 'lockPool'> = new ChipRepo()
): Promise<void> {
	if (parentAgentId) {
		const row = await repo.lockAgent(tx, parentAgentId);
		if (!row || row.tenantId !== tenant) throw new ChipError('NOT_FOUND', 'Agent not found');
		return;
	}
	await repo.lockPool(tx, tenant);
}

/**
 * The opening DEPOSIT for the account just created, on its creation transaction. First the creator (`p.actor`) must
 * be the new account's direct upline (openingChipsUplineRefusal): that is decided before any chip moves, and the
 * refusal rolls the new account back with the transaction. A refusal from the deposit itself says it was the
 * opening chips that failed, so the create form points at the right field.
 */
export async function depositOpeningChipsInTx(
	p: { tenant: string; accountType: ChipAccountType; accountId: string | number; amount: number; actor: ChipActor },
	tx: ChipTx,
	service: Pick<ChipService, 'depositOpeningChips'> = chipService,
	repo: Pick<ChipRepo, 'readAgent' | 'readPlayer'> = new ChipRepo()
): Promise<{ transferId: string }> {
	const place = await readOpeningChipsPlace(tx, String(p.tenant ?? '').trim(), p.accountType, p.accountId, repo);
	if (place) {
		const refusal = openingChipsUplineRefusal(p.actor, place);
		if (refusal) throw refusal;
	}
	try {
		return await service.depositOpeningChips({ ...p, remark: 'Opening chips' }, tx);
	} catch (err) {
		if (err instanceof ChipError) throw new ChipError(err.code, `Opening chips: ${err.message}`);
		throw err;
	}
}
