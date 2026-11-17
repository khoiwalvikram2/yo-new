/**
 * ChipService: the CREDIT scheme on Deposit/Withdraw chips (D/W).
 * Spec (the contract): docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md, §2 figures, §4 operations,
 * §7 read scope. SQL lives in repos/agents/ChipRepo.ts.
 *
 * Who holds chips:
 *   - a CREDIT agent holds agents.chip_balance;
 *   - a credit player (AGENT_CREDIT / WHITELABEL_CREDIT) holds wallets.cash and plays on the cash-wallet path, with
 *     its open sports liability in wallets.exposure;
 *   - the whitelabel's credit pool (WhitelabelCreditService) feeds root CREDIT agents and WHITELABEL_CREDIT players.
 * credit_limit (agents and users) is each account's credit reference. It gates nothing; Ref P/L is measured
 * against it: positive means the upline owes the account, negative means the account owes the upline.
 *
 * Only the direct parent moves chips or sets the credit reference: an agent for its direct CREDIT sub-agents and
 * its own AGENT_CREDIT players, an admin (as the whitelabel) for root CREDIT agents and WHITELABEL_CREDIT players.
 *
 * Money rules, for every operation:
 *   - one transaction; the parent is locked before the child (the parent agent's row, or the whitelabels row for
 *     the pool), and a player's users row before its wallet row. Locks are only ever taken top-down, so two
 *     operations can never wait on each other in a cycle;
 *   - amounts are > 0 and rounded to 2 decimals; NaN, Infinity and negatives are refused;
 *   - a deposit is refused to or by an account that is not ACTIVE; a withdrawal is always allowed, so chips can
 *     be recovered from a suspended account, but it may take only free chips;
 *   - a deposit to a player under a responsible gambling block (users.rg_blocked_until) is refused: chips arriving
 *     are money in (shared/src/services/rgEnforcement.ts). Taking chips back is money out and is never gated;
 *   - both credit_chip_ledger rows (one transfer_id) and a player's wallet statement rows are written inside the
 *     money transaction, and no error is swallowed.
 *
 * Callers: the GraphQL resolvers build a ChipCaller with chipCallerFromCtx(ctx) (after ensureAgentCanMutate for
 * mutations); account creation calls depositOpeningChips inside its own transaction; list field resolvers call
 * chipAccountsForAgents / chipAccountsForPlayers once per list.
 */
import { randomUUID } from 'node:crypto';
import { db } from '@src/db/client.js';
import { isCreditPlayer } from '@shared/services/credit/isCreditPlayer.js';
import { assertPlayerCanFund, RgBlockedError } from '@shared/services/rgEnforcement.js';
import { getWhitelabelCurrency } from '@src/shared/whitelabelConfig.js';
import { WhitelabelCreditService } from '@src/domains/common/services/WhitelabelCreditService.js';
import { WhitelabelCreditRepo } from '@src/repos/common/whitelabelCreditRepo.js';
import { requireCallerTenant } from './agentSubtree.js';
import {
	ChipRepo,
	isUuid,
	parsePlayerId,
	type ChipExecutor,
	type ChipLedgerAccountType,
	type ChipLedgerInsert,
	type ChipStatementDbRow,
	type ChipWalletRow,
} from '@src/repos/agents/ChipRepo.js';

// ---------------------------------------------------------------------------------------------------------------
// Types (field names match the GraphQL contract in spec §7)
// ---------------------------------------------------------------------------------------------------------------

export type ChipAccountType = 'AGENT' | 'PLAYER';
export type ChipMovementKind = 'OPENING' | 'DEPOSIT' | 'WITHDRAW' | 'CREDIT_REFERENCE';
export type ChipDirection = 'DEPOSIT' | 'WITHDRAW';

/** A CREDIT-scheme account with its figures (GraphQL ChipAccount). */
export interface ChipAccount {
	accountType: ChipAccountType;
	id: string;
	username: string;
	name: string | null;
	/** Raw status: agents use ACTIVE / INACTIVE / SUSPENDED / BLOCKED, players active / inactive / suspended. */
	status: string | null;
	/** Direct parent agent; null when the parent is the whitelabel. */
	parentAgentId: string | null;
	/** PLAYER only: AGENT_CREDIT or WHITELABEL_CREDIT. */
	playerType: string | null;
	currency: string;
	creditReference: number;
	balance: number;
	exposure: number;
	available: number;
	downlineBalance: number;
	refPnl: number;
	/** Direct downline accounts (agents + players); 0 for a player. */
	downlineCount: number;
}

export interface ChipPool {
	currency: string;
	creditLimit: number;
	used: number;
	available: number;
}

export interface ChipTotals {
	creditReference: number;
	balance: number;
	exposure: number;
	available: number;
	downlineBalance: number;
	refPnl: number;
}

export interface ChipDownline {
	/** The agent whose downline this is; null for the whitelabel's (admin's) downline. */
	parent: ChipAccount | null;
	/** Only for an admin's own downline: the pool that feeds root accounts. */
	pool: ChipPool | null;
	items: ChipAccount[];
	total: number;
	/** Over every matching account, not just this page. */
	totals: ChipTotals;
}

export interface ChipStatementRow {
	id: string;
	/** ISO-8601, UTC. */
	createdAt: string;
	kind: ChipMovementKind;
	/** Signed for this account: + chips in, - chips out. */
	amount: number;
	balanceBefore: number;
	balanceAfter: number;
	creditReferenceBefore: number | null;
	creditReferenceAfter: number | null;
	/** AGENT, PLAYER or WHITELABEL (upper case, like ChipAccountType); null for OPENING rows. */
	counterpartyType: string | null;
	counterpartyId: string | null;
	counterpartyName: string | null;
	remark: string | null;
	/** Who made the move: the agent's username, the admin's username/name/email, or "System". */
	createdBy: string | null;
}

export interface ChipStatementPage {
	rows: ChipStatementRow[];
	total: number;
}

export interface ChipTransferResult {
	/** The account that received or gave the chips. */
	account: ChipAccount;
	/** The parent agent on the other side; null when it was the whitelabel. */
	parent: ChipAccount | null;
	/** Set when the whitelabel pool was the other side. */
	pool: ChipPool | null;
	transferId: string;
}

export interface ChipTransferInput {
	accountType: ChipAccountType | string;
	accountId: string | number;
	amount: number;
	remark?: string | null;
}

export interface CreditReferenceInput {
	accountType: ChipAccountType | string;
	accountId: string | number;
	creditReference: number;
	remark?: string | null;
}

export interface ChipDownlineArgs {
	parentAgentId?: string | null;
	query?: string | null;
	accountType?: ChipAccountType | string | null;
	offset?: number | null;
	limit?: number | null;
}

export interface ChipStatementArgs {
	accountType: ChipAccountType | string;
	accountId: string | number;
	/** ISO timestamp (inclusive) or YYYY-MM-DD (start of that UTC day). */
	from?: string | null;
	/** ISO timestamp (inclusive) or YYYY-MM-DD (through the end of that UTC day). */
	to?: string | null;
	offset?: number | null;
	limit?: number | null;
}

/**
 * The principal calling the service, in the shape the resolvers already use: an agent principal
 * (ctx.user.type === 'agent', ctx.user.agentId) or an admin acting as the whitelabel. tenant is the caller's tenant
 * (requireCallerTenant: director-mode aware).
 */
export type ChipCaller =
	| { kind: 'admin'; tenant: string; userId: string | null }
	| { kind: 'agent'; tenant: string; agentId: string; readOnly?: boolean };

/** Recorded on ledger rows as created_by / created_by_type. */
export interface ChipActor {
	createdBy: string | null;
	createdByType: 'admin' | 'agent' | 'system';
}

export interface OpeningChipsInput {
	tenant: string;
	accountType: ChipAccountType;
	accountId: string | number;
	amount: number;
	remark?: string | null;
	actor: ChipActor;
}

/** A transaction handle (drizzle tx): depositOpeningChips must not run its locks in autocommit mode. */
export interface ChipTx extends ChipExecutor {
	rollback(): unknown;
}

/**
 * The whitelabel pool, moved only through WhitelabelCreditService (injectable for tests). `debit` throws
 * ChipError('INSUFFICIENT') when the pool's own check under its lock refuses (see poolRefusalFrom).
 */
export interface ChipPoolPort {
	debit(tenant: string, amount: number, reason: string, tx: ChipExecutor, player?: PoolPlayerInfo): Promise<void>;
	credit(tenant: string, amount: number, reason: string, tx: ChipExecutor, player?: PoolPlayerInfo): Promise<void>;
	read(tenant: string): Promise<{ creditLimit: number; creditUsed: number; creditAvailable: number } | null>;
}

export interface PoolPlayerInfo {
	userId: number;
	playerName?: string;
	playerUsername?: string;
}

export type ChipErrorCode =
	| 'INVALID_INPUT'
	| 'NOT_FOUND'
	| 'NOT_CREDIT'
	| 'NOT_DIRECT_PARENT'
	| 'NOT_ACTIVE'
	| 'RG_BLOCKED'
	| 'INSUFFICIENT'
	| 'FORBIDDEN';

/** A refusal the UI can show as-is. `code` is for callers and tests; the message is the user-facing text. */
export class ChipError extends Error {
	constructor(
		readonly code: ChipErrorCode,
		message: string
	) {
		super(message);
		this.name = 'ChipError';
	}
}

export const CHIP_MESSAGES = {
	onlyDirectUpline: 'Only the direct upline can move chips for this account',
	notCreditAccount: 'Chips are only for CREDIT agents and credit players',
	parentNotCredit: 'Only CREDIT agents hold chips',
	amountNotPositive: 'Amount must be greater than zero',
	amountNotNumber: 'Amount must be a number',
	amountTooLarge: 'Amount is too large',
	creditReferenceNegative: 'Credit reference cannot be negative',
	creditReferenceNotNumber: 'Credit reference must be a number',
	creditReferenceTooLarge: 'Credit reference is too large',
	remarkTooLong: 'Remark must be 500 characters or fewer',
	readOnly: 'Your account is inactive. You cannot perform this action.',
	agentNotFound: 'Agent not found',
	playerNotFound: 'Player not found',
	noPool: 'This whitelabel has no credit pool',
} as const;

// ---------------------------------------------------------------------------------------------------------------
// Pure rules (unit-tested without a database)
// ---------------------------------------------------------------------------------------------------------------

/** Largest amount accepted; agents.chip_balance and agents.credit_limit are numeric(15,2). */
const MAX_CHIP_AMOUNT = 1_000_000_000_000;
const MAX_REMARK = 500;

/**
 * Round to 2 decimals, half away from zero. toPrecision(15) first removes binary noise, so 1.005 rounds to 1.01
 * (plain Math.round(1.005 * 100) gives 100).
 */
export function roundChips(n: number): number {
	if (!Number.isFinite(n)) return n;
	const cents = Math.round(Math.abs(Number((n * 100).toPrecision(15))));
	const rounded = (n < 0 ? -cents : cents) / 100;
	return rounded === 0 ? 0 : rounded;
}

/** Integer cents, for exact comparisons. */
export function chipCents(n: number): number {
	return Math.round(roundChips(n) * 100);
}

/** "1,200.00" */
export function formatChips(n: number): string {
	return roundChips(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toNumber(raw: unknown): number {
	if (typeof raw === 'number') return raw;
	if (typeof raw === 'string' && raw.trim() !== '') return Number(raw);
	return Number.NaN;
}

/** A transfer amount: finite, rounded to 2 decimals, > 0. */
export function toChipAmount(raw: unknown): number {
	const n = toNumber(raw);
	if (!Number.isFinite(n)) throw new ChipError('INVALID_INPUT', CHIP_MESSAGES.amountNotNumber);
	const amount = roundChips(n);
	if (amount <= 0) throw new ChipError('INVALID_INPUT', CHIP_MESSAGES.amountNotPositive);
	if (amount > MAX_CHIP_AMOUNT) throw new ChipError('INVALID_INPUT', CHIP_MESSAGES.amountTooLarge);
	return amount;
}

/** A credit reference: finite, rounded to 2 decimals, >= 0. */
export function toCreditReference(raw: unknown): number {
	const n = toNumber(raw);
	if (!Number.isFinite(n)) throw new ChipError('INVALID_INPUT', CHIP_MESSAGES.creditReferenceNotNumber);
	const value = roundChips(n);
	if (value < 0) throw new ChipError('INVALID_INPUT', CHIP_MESSAGES.creditReferenceNegative);
	if (value > MAX_CHIP_AMOUNT) throw new ChipError('INVALID_INPUT', CHIP_MESSAGES.creditReferenceTooLarge);
	return value;
}

/** Trimmed remark, null when empty. */
export function cleanRemark(raw: unknown): string | null {
	if (raw == null) return null;
	const remark = String(raw).trim();
	if (!remark) return null;
	if (remark.length > MAX_REMARK) throw new ChipError('INVALID_INPUT', CHIP_MESSAGES.remarkTooLong);
	return remark;
}

export interface ChipFigures {
	creditReference: number;
	balance: number;
	exposure: number;
	available: number;
	downlineBalance: number;
	refPnl: number;
}

/**
 * A CREDIT agent: available = its own balance; Ref P/L = balance + downline balance - credit reference.
 * `downlineBalance` is every descendant agent's chips plus the chips of every credit player in the subtree;
 * `exposure` is the open sports liability of those players.
 */
export function agentChipFigures(i: {
	creditReference: number;
	balance: number;
	downlineBalance: number;
	exposure: number;
}): ChipFigures {
	return {
		creditReference: roundChips(i.creditReference),
		balance: roundChips(i.balance),
		exposure: roundChips(i.exposure),
		available: roundChips(i.balance),
		downlineBalance: roundChips(i.downlineBalance),
		refPnl: roundChips(i.balance + i.downlineBalance - i.creditReference),
	};
}

/** A credit player: balance = wallets.cash; available = balance - exposure; Ref P/L = balance - credit reference. */
export function playerChipFigures(i: { creditReference: number; cash: number; exposure: number }): ChipFigures {
	return {
		creditReference: roundChips(i.creditReference),
		balance: roundChips(i.cash),
		exposure: roundChips(i.exposure),
		available: roundChips(i.cash - i.exposure),
		downlineBalance: 0,
		refPnl: roundChips(i.cash - i.creditReference),
	};
}

export function sumChipTotals(accounts: readonly ChipFigures[]): ChipTotals {
	const cents = { creditReference: 0, balance: 0, exposure: 0, available: 0, downlineBalance: 0, refPnl: 0 };
	for (const a of accounts) {
		cents.creditReference += chipCents(a.creditReference);
		cents.balance += chipCents(a.balance);
		cents.exposure += chipCents(a.exposure);
		cents.available += chipCents(a.available);
		cents.downlineBalance += chipCents(a.downlineBalance);
		cents.refPnl += chipCents(a.refPnl);
	}
	return {
		creditReference: cents.creditReference / 100,
		balance: cents.balance / 100,
		exposure: cents.exposure / 100,
		available: cents.available / 100,
		downlineBalance: cents.downlineBalance / 100,
		refPnl: cents.refPnl / 100,
	};
}

/** The side that gives chips on a deposit: a CREDIT agent or the whitelabel pool. */
export type ChipParentRef = { kind: 'agent'; agentId: string } | { kind: 'whitelabel' };

/** The parent as read under its lock. `available` is the pool's credit_available. */
export type LockedChipParent =
	| {
			kind: 'agent';
			id: string;
			username: string;
			status: string;
			schemeType: string;
			chipBalance: number;
			creditReference: number;
	  }
	| { kind: 'whitelabel'; tenant: string; name: string; available: number };

/** The child as read under its lock. A player with no wallet row has cash and exposure 0. */
export type LockedChipChild =
	| {
			accountType: 'AGENT';
			id: string;
			username: string;
			status: string;
			schemeType: string;
			parentAgentId: string | null;
			chipBalance: number;
			creditReference: number;
	  }
	| {
			accountType: 'PLAYER';
			id: string;
			username: string;
			status: string;
			playerType: string;
			agentId: string | null;
			creditReference: number;
			cash: number;
			exposure: number;
	  };

function sameId(a: string | null | undefined, b: string | null | undefined): boolean {
	return a != null && b != null && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function isActiveStatus(status: string | null | undefined): boolean {
	return String(status ?? '').trim().toUpperCase() === 'ACTIVE';
}

function childLabel(child: LockedChipChild): string {
	return `${child.accountType === 'AGENT' ? 'agent' : 'player'} ${child.username}`;
}

/**
 * The direct-parent rule (spec §4.1 step 2). Returns the refusal, or null when `parent` is the child's direct
 * parent: an agent for its direct CREDIT sub-agents and its own AGENT_CREDIT players; the whitelabel for root
 * CREDIT agents and WHITELABEL_CREDIT players.
 */
export function directParentError(parent: ChipParentRef, child: LockedChipChild): ChipError | null {
	if (child.accountType === 'AGENT') {
		if (child.schemeType !== 'CREDIT') return new ChipError('NOT_CREDIT', CHIP_MESSAGES.notCreditAccount);
		const direct = parent.kind === 'agent' ? sameId(child.parentAgentId, parent.agentId) : child.parentAgentId == null;
		return direct ? null : new ChipError('NOT_DIRECT_PARENT', CHIP_MESSAGES.onlyDirectUpline);
	}
	if (!isCreditPlayer(child.playerType)) return new ChipError('NOT_CREDIT', CHIP_MESSAGES.notCreditAccount);
	const direct =
		parent.kind === 'agent'
			? child.playerType === 'AGENT_CREDIT' && sameId(child.agentId, parent.agentId)
			: child.playerType === 'WHITELABEL_CREDIT';
	return direct ? null : new ChipError('NOT_DIRECT_PARENT', CHIP_MESSAGES.onlyDirectUpline);
}

export interface ChipTransferPlan {
	amount: number;
	/** The parent's chips: agent chip_balance, or the pool's available credit. */
	parentBefore: number;
	parentAfter: number;
	parentDelta: number;
	/** The child's chips: agent chip_balance, or the player's wallets.cash. */
	childBefore: number;
	childAfter: number;
	childDelta: number;
}

/**
 * Decides a deposit or withdrawal from the locked snapshots (spec §4.1, §4.2). Throws ChipError for every
 * refusal: not CREDIT, not the direct parent, a deposit to or by an account that is not ACTIVE, and the free-chip
 * guards (deposit: the parent's chips; withdraw: the child's free chips, a player's being cash - exposure).
 */
export function planChipTransfer(
	direction: ChipDirection,
	parent: LockedChipParent,
	child: LockedChipChild,
	amount: number
): ChipTransferPlan {
	if (parent.kind === 'agent' && parent.schemeType !== 'CREDIT') {
		throw new ChipError('NOT_CREDIT', CHIP_MESSAGES.parentNotCredit);
	}
	const ref: ChipParentRef = parent.kind === 'agent' ? { kind: 'agent', agentId: parent.id } : { kind: 'whitelabel' };
	const notDirect = directParentError(ref, child);
	if (notDirect) throw notDirect;

	const parentBefore = parent.kind === 'agent' ? parent.chipBalance : parent.available;
	const childBefore = child.accountType === 'AGENT' ? child.chipBalance : child.cash;

	if (direction === 'DEPOSIT') {
		if (parent.kind === 'agent' && !isActiveStatus(parent.status)) {
			throw new ChipError(
				'NOT_ACTIVE',
				`Chips cannot be deposited while agent ${parent.username} is ${parent.status.toLowerCase()}`
			);
		}
		if (!isActiveStatus(child.status)) {
			throw new ChipError(
				'NOT_ACTIVE',
				`Chips cannot be deposited while ${childLabel(child)} is ${child.status.toLowerCase()}`
			);
		}
		if (chipCents(parentBefore) < chipCents(amount)) {
			const available = formatChips(Math.max(0, parentBefore));
			throw new ChipError(
				'INSUFFICIENT',
				parent.kind === 'agent'
					? `Not enough chips: available ${available}`
					: `Not enough chips in the whitelabel pool: available ${available}`
			);
		}
	} else {
		const free = child.accountType === 'AGENT' ? child.chipBalance : child.cash - child.exposure;
		if (chipCents(free) < chipCents(amount)) {
			throw new ChipError('INSUFFICIENT', `Not enough chips: available ${formatChips(Math.max(0, free))}`);
		}
	}

	const parentDelta = direction === 'DEPOSIT' ? -amount : amount;
	const childDelta = -parentDelta;
	return {
		amount,
		parentBefore: roundChips(parentBefore),
		parentAfter: roundChips(parentBefore + parentDelta),
		parentDelta,
		childBefore: roundChips(childBefore),
		childAfter: roundChips(childBefore + childDelta),
		childDelta,
	};
}

/**
 * The two credit_chip_ledger rows of one transfer, sharing `transferId`: the parent's (-amount on a deposit) and
 * the child's (+amount on a deposit), each with its own before/after. The whitelabel's row has
 * account_type 'whitelabel', account_id = tenant and the pool's available credit as its balance.
 */
export function buildChipTransferLedger(p: {
	tenant: string;
	transferId: string;
	direction: ChipDirection;
	parent: LockedChipParent;
	child: LockedChipChild;
	amount: number;
	parentBefore: number;
	parentAfter: number;
	childBefore: number;
	childAfter: number;
	remark: string | null;
	actor: ChipActor;
}): ChipLedgerInsert[] {
	const kind: ChipMovementKind = p.direction;
	const deposit = p.direction === 'DEPOSIT';
	const parentType: ChipLedgerAccountType = p.parent.kind === 'agent' ? 'agent' : 'whitelabel';
	const parentId = p.parent.kind === 'agent' ? p.parent.id : p.tenant;
	const parentReference = p.parent.kind === 'agent' ? roundChips(p.parent.creditReference) : null;
	const childType: ChipLedgerAccountType = p.child.accountType === 'AGENT' ? 'agent' : 'player';
	const childReference = roundChips(p.child.creditReference);
	const common = {
		tenantId: p.tenant,
		transferId: p.transferId,
		kind,
		remark: p.remark,
		createdBy: p.actor.createdBy,
		createdByType: p.actor.createdByType,
	};
	return [
		{
			...common,
			accountType: parentType,
			accountId: parentId,
			counterpartyType: childType,
			counterpartyId: p.child.id,
			amount: deposit ? -p.amount : p.amount,
			balanceBefore: roundChips(p.parentBefore),
			balanceAfter: roundChips(p.parentAfter),
			creditReferenceBefore: parentReference,
			creditReferenceAfter: parentReference,
		},
		{
			...common,
			accountType: childType,
			accountId: p.child.id,
			counterpartyType: parentType,
			counterpartyId: parentId,
			amount: deposit ? p.amount : -p.amount,
			balanceBefore: roundChips(p.childBefore),
			balanceAfter: roundChips(p.childAfter),
			creditReferenceBefore: childReference,
			creditReferenceAfter: childReference,
		},
	];
}

/**
 * The reason WhitelabelCreditService records on the pool's own ledger row. It must not contain "deposit": that
 * word turns the pool row into a DEPOSIT (cash deposit) row. A username that contains it falls back to the id.
 */
export function poolReason(direction: ChipDirection, child: { accountType: ChipAccountType; id: string; username: string }): string {
	const who = child.accountType === 'AGENT' ? 'agent' : 'player';
	const way = direction === 'DEPOSIT' ? 'to' : 'from';
	const reason = `Chips ${way} ${who} ${child.username}`;
	return /deposit/i.test(reason) ? `Chips ${way} ${who} #${child.id}` : reason;
}

/**
 * WhitelabelCreditService re-checks a pool debit under its own lock with its own formula (credit_limit -
 * credit_used + the per-domain settlement balances), which can be lower than the stored credit_available that
 * planChipTransfer checked. Its refusal is a plain Error ("Insufficient whitelabel credit. Available: x, ...");
 * this returns the same INSUFFICIENT refusal the pool guard gives. Any other error gives null: the caller
 * rethrows it unchanged.
 */
export function poolRefusalFrom(err: unknown): ChipError | null {
	if (!(err instanceof Error) || !/^Insufficient whitelabel credit\b/.test(err.message)) return null;
	const match = /Available:\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(err.message);
	const available = match ? Number(match[1]) : Number.NaN;
	return new ChipError(
		'INSUFFICIENT',
		Number.isFinite(available)
			? `Not enough chips in the whitelabel pool: available ${formatChips(Math.max(0, available))}`
			: 'Not enough chips in the whitelabel pool'
	);
}

/** The principal of a GraphQL context, in ChipService's shape. Throws when nobody is signed in. */
export function chipCallerFromCtx(ctx: any): ChipCaller {
	if (!ctx?.user) throw new ChipError('FORBIDDEN', 'Unauthorized: authentication required');
	const tenant = requireCallerTenant(ctx).trim();
	if (ctx.user.type === 'agent') {
		const agentId = String(ctx.user.agentId ?? '').trim();
		if (!agentId) throw new ChipError('FORBIDDEN', 'Unauthorized: the agent session has no agent id');
		return { kind: 'agent', tenant, agentId, readOnly: Boolean(ctx.user.isReadOnly) };
	}
	return { kind: 'admin', tenant, userId: ctx.user.sub != null ? String(ctx.user.sub) : null };
}

export function chipActorOf(caller: ChipCaller): ChipActor {
	return caller.kind === 'agent'
		? { createdBy: caller.agentId, createdByType: 'agent' }
		: { createdBy: caller.userId, createdByType: 'admin' };
}

// ---------------------------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------------------------

type ChipTarget = { accountType: 'AGENT'; id: string } | { accountType: 'PLAYER'; id: string; playerId: number };

interface TransferParams {
	tenant: string;
	direction: ChipDirection;
	parent: ChipParentRef;
	target: ChipTarget;
	amount: number;
	remark: string | null;
	actor: ChipActor;
	/** For an agent caller: the target must sit in this agent's subtree, otherwise it is "not found". */
	scopeAgentId: string | null;
}

interface TransferOutcome {
	transferId: string;
	parentAfter: number;
	childAfter: number;
}

const DEFAULT_PAGE = 50;
const MAX_PAGE = 500;

function parseTarget(accountType: unknown, accountId: unknown): ChipTarget {
	const type = String(accountType ?? '').trim().toUpperCase();
	if (type === 'AGENT') {
		const id = String(accountId ?? '').trim();
		if (!isUuid(id)) throw new ChipError('NOT_FOUND', CHIP_MESSAGES.agentNotFound);
		return { accountType: 'AGENT', id: id.toLowerCase() };
	}
	if (type === 'PLAYER') {
		const playerId = parsePlayerId(accountId);
		if (playerId == null) throw new ChipError('NOT_FOUND', CHIP_MESSAGES.playerNotFound);
		return { accountType: 'PLAYER', id: String(playerId), playerId };
	}
	throw new ChipError('INVALID_INPUT', 'Account type must be AGENT or PLAYER');
}

function notFound(target: ChipTarget): ChipError {
	return new ChipError('NOT_FOUND', target.accountType === 'AGENT' ? CHIP_MESSAGES.agentNotFound : CHIP_MESSAGES.playerNotFound);
}

function pageOf(offset: unknown, limit: unknown): { offset: number; limit: number } {
	const o = Math.trunc(Number(offset ?? 0));
	const l = Math.trunc(Number(limit ?? DEFAULT_PAGE));
	return {
		offset: Number.isFinite(o) && o > 0 ? o : 0,
		limit: Number.isFinite(l) && l > 0 ? Math.min(l, MAX_PAGE) : DEFAULT_PAGE,
	};
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseRange(from: unknown, to: unknown): { from: Date | null; toBefore: Date | null } {
	const parse = (raw: unknown, label: string): Date | null => {
		if (raw == null || String(raw).trim() === '') return null;
		const value = String(raw).trim();
		const date = new Date(DATE_ONLY.test(value) ? `${value}T00:00:00.000Z` : value);
		if (Number.isNaN(date.getTime())) throw new ChipError('INVALID_INPUT', `Invalid ${label} date: ${value}`);
		return date;
	};
	const start = parse(from, 'from');
	const end = parse(to, 'to');
	let toBefore: Date | null = null;
	if (end) {
		// A bare date covers that whole day; a timestamp is inclusive.
		toBefore = DATE_ONLY.test(String(to).trim())
			? new Date(end.getTime() + 24 * 60 * 60 * 1000)
			: new Date(end.getTime() + 1);
	}
	return { from: start, toBefore };
}

function memberTypeFilter(raw: unknown): ChipAccountType | null {
	if (raw == null || raw === '') return null;
	const type = String(raw).trim().toUpperCase();
	if (type === 'AGENT' || type === 'PLAYER') return type;
	throw new ChipError('INVALID_INPUT', 'Account type must be AGENT or PLAYER');
}

function cleanQuery(raw: unknown): string | null {
	if (raw == null) return null;
	const q = String(raw).trim();
	return q ? q.slice(0, 120) : null;
}

/** The production pool: WhitelabelCreditService, inside the caller's transaction. Exported so tests can wrap it. */
export const whitelabelPoolPort: ChipPoolPort = {
	async debit(tenant, amount, reason, tx, player) {
		try {
			await new WhitelabelCreditService(new WhitelabelCreditRepo()).deductCredit(tenant, amount, reason, tx, player);
		} catch (err) {
			throw poolRefusalFrom(err) ?? err;
		}
	},
	async credit(tenant, amount, reason, tx, player) {
		await new WhitelabelCreditService(new WhitelabelCreditRepo()).addCredit(tenant, amount, reason, tx, player);
	},
	async read(tenant) {
		try {
			const pool = await new WhitelabelCreditService(new WhitelabelCreditRepo()).getCreditAllocation(tenant);
			return { creditLimit: pool.creditLimit, creditUsed: pool.creditUsed, creditAvailable: pool.creditAvailable };
		} catch (err) {
			if (err instanceof Error && err.message === 'Whitelabel not found') return null;
			throw err;
		}
	},
};

export class ChipService {
	constructor(
		private readonly repo: ChipRepo = new ChipRepo(),
		private readonly pool: ChipPoolPort = whitelabelPoolPort,
		private readonly currencyOf: (tenant: string) => Promise<string> = getWhitelabelCurrency
	) {}

	// ---- Operations ------------------------------------------------------------------------------------------

	/** Spec §4.1: the caller (the direct parent) gives chips to its direct downline account. */
	depositChips(caller: ChipCaller, input: ChipTransferInput): Promise<ChipTransferResult> {
		return this.transfer(caller, 'DEPOSIT', input);
	}

	/** Spec §4.2: the caller (the direct parent) takes free chips back from its direct downline account. */
	withdrawChips(caller: ChipCaller, input: ChipTransferInput): Promise<ChipTransferResult> {
		return this.transfer(caller, 'WITHDRAW', input);
	}

	/**
	 * Spec §4.3: sets the account's credit reference (credit_limit); moves no chips. Writes one CREDIT_REFERENCE
	 * ledger row (amount 0, balance unchanged). Setting the value it already has writes nothing.
	 */
	async setCreditReference(caller: ChipCaller, input: CreditReferenceInput): Promise<ChipAccount> {
		ensureMayMove(caller);
		const value = toCreditReference(input.creditReference);
		const remark = cleanRemark(input.remark);
		const target = parseTarget(input.accountType, input.accountId);
		const parentRef = parentOfCaller(caller);
		const actor = chipActorOf(caller);
		const tenant = caller.tenant;

		await db.transaction(async (tx) => {
			if (caller.kind === 'agent') await this.assertInScope(tx, caller.agentId, tenant, target);
			// Parent first. The pool is not locked: a credit reference moves nothing out of it.
			if (parentRef.kind === 'agent') {
				const parentAgent = await this.repo.lockAgent(tx, parentRef.agentId);
				if (!parentAgent || parentAgent.tenantId !== tenant) throw new ChipError('NOT_FOUND', CHIP_MESSAGES.agentNotFound);
				if (parentAgent.schemeType !== 'CREDIT') throw new ChipError('NOT_CREDIT', CHIP_MESSAGES.parentNotCredit);
			}
			const { child } = await this.lockChild(tx, tenant, target);
			const refusal = directParentError(parentRef, child);
			if (refusal) throw refusal;

			const before = roundChips(child.creditReference);
			if (chipCents(before) === chipCents(value)) return;
			if (child.accountType === 'AGENT') {
				await this.repo.setAgentCreditReference(tx, child.id, value);
			} else {
				await this.repo.setPlayerCreditReference(tx, Number(child.id), tenant, value);
			}
			const balance = child.accountType === 'AGENT' ? child.chipBalance : child.cash;
			await this.repo.insertLedgerRows(tx, [
				{
					tenantId: tenant,
					transferId: randomUUID(),
					accountType: child.accountType === 'AGENT' ? 'agent' : 'player',
					accountId: child.id,
					counterpartyType: parentRef.kind === 'agent' ? 'agent' : 'whitelabel',
					counterpartyId: parentRef.kind === 'agent' ? parentRef.agentId : tenant,
					kind: 'CREDIT_REFERENCE',
					amount: 0,
					balanceBefore: roundChips(balance),
					balanceAfter: roundChips(balance),
					creditReferenceBefore: before,
					creditReferenceAfter: value,
					remark,
					createdBy: actor.createdBy,
					createdByType: actor.createdByType,
				},
			]);
		});

		const account = await this.accountFor(tenant, target);
		if (!account) throw notFound(target);
		return account;
	}

	/**
	 * Opening chips for a newly created CREDIT agent or credit player (spec §4.4): a DEPOSIT from the account's own
	 * parent (its parent agent, or the whitelabel pool for a root agent / WHITELABEL_CREDIT player), with every rule
	 * of depositChips. Pass the creation transaction so the new row is visible and the deposit commits or rolls
	 * back with it; without `tx` it runs in its own transaction (the account must already be committed).
	 * Call it only when openingChips > 0: a zero amount is refused like any other deposit. Ledger rows carry
	 * kind DEPOSIT and the remark "Opening chips" unless one is given.
	 */
	async depositOpeningChips(input: OpeningChipsInput, tx?: ChipTx): Promise<{ transferId: string }> {
		const amount = toChipAmount(input.amount);
		const remark = cleanRemark(input.remark) ?? 'Opening chips';
		const tenant = String(input.tenant ?? '').trim();
		if (!tenant) throw new ChipError('INVALID_INPUT', 'Tenant is required');
		const target = parseTarget(input.accountType, input.accountId);
		if (tx && typeof (tx as { rollback?: unknown }).rollback !== 'function') {
			throw new Error('depositOpeningChips needs a transaction (tx), not the database handle');
		}
		const run = async (executor: ChipExecutor) => {
			const parent = await this.parentOfAccount(executor, tenant, target);
			const outcome = await this.transferInTx(executor, {
				tenant,
				direction: 'DEPOSIT',
				parent,
				target,
				amount,
				remark,
				actor: input.actor,
				scopeAgentId: null,
			});
			return { transferId: outcome.transferId };
		};
		return tx ? run(tx) : db.transaction((t) => run(t));
	}

	// ---- Reads -----------------------------------------------------------------------------------------------

	/** One account within the caller's read scope (agent: itself and its subtree; admin: its tenant); else null. */
	async getAccount(caller: ChipCaller, accountType: unknown, accountId: unknown): Promise<ChipAccount | null> {
		let target: ChipTarget;
		try {
			target = parseTarget(accountType, accountId);
		} catch (err) {
			if (err instanceof ChipError && err.code === 'NOT_FOUND') return null;
			throw err;
		}
		const account = await this.accountFor(caller.tenant, target);
		if (!account) return null;
		if (caller.kind === 'agent' && !(await this.agentMaySee(caller.agentId, caller.tenant, target))) return null;
		return account;
	}

	/** The signed-in CREDIT agent's own account; null for admins and for agents of other schemes. */
	async getMyAccount(caller: ChipCaller): Promise<ChipAccount | null> {
		if (caller.kind !== 'agent') return null;
		return (await this.chipAccountsForAgents(caller.tenant, [caller.agentId])).get(caller.agentId.toLowerCase()) ?? null;
	}

	/**
	 * A direct downline with figures. Without parentAgentId: an agent's own (direct CREDIT sub-agents + its own
	 * AGENT_CREDIT players), or an admin's (root CREDIT agents + WHITELABEL_CREDIT players, with the pool). With
	 * parentAgentId: that agent's, which must be in the caller's read scope.
	 */
	async getDownline(caller: ChipCaller, args: ChipDownlineArgs = {}): Promise<ChipDownline> {
		const tenant = caller.tenant;
		const { offset, limit } = pageOf(args.offset, args.limit);
		const accountType = memberTypeFilter(args.accountType);
		const query = cleanQuery(args.query);
		const empty: ChipDownline = { parent: null, pool: null, items: [], total: 0, totals: sumChipTotals([]) };

		let parentAgentId: string | null = null;
		const requested = args.parentAgentId == null ? '' : String(args.parentAgentId).trim();
		if (requested) {
			if (!isUuid(requested)) throw new ChipError('NOT_FOUND', CHIP_MESSAGES.agentNotFound);
			if (caller.kind === 'agent' && !(await this.repo.isAgentInSubtree(db, caller.agentId, requested))) {
				throw new ChipError('NOT_FOUND', CHIP_MESSAGES.agentNotFound);
			}
			parentAgentId = requested.toLowerCase();
		} else if (caller.kind === 'agent') {
			parentAgentId = caller.agentId.toLowerCase();
		}

		let parent: ChipAccount | null = null;
		if (parentAgentId) {
			parent = (await this.chipAccountsForAgents(tenant, [parentAgentId])).get(parentAgentId) ?? null;
			if (!parent) {
				if (requested) throw new ChipError('NOT_FOUND', CHIP_MESSAGES.agentNotFound);
				return empty; // an agent of another scheme has no chips downline
			}
		}

		const members = await this.repo.downlineMembers(db, { tenant, parentAgentId, query, accountType });
		const agentIds = members.filter((m) => m.accountType === 'AGENT').map((m) => m.id);
		const playerIds = members.filter((m) => m.accountType === 'PLAYER').map((m) => m.id);
		const [agentAccounts, playerAccounts, pool] = await Promise.all([
			this.chipAccountsForAgents(tenant, agentIds),
			this.chipAccountsForPlayers(tenant, playerIds),
			parentAgentId ? Promise.resolve(null) : this.poolFigures(tenant),
		]);
		const accounts: ChipAccount[] = [];
		for (const m of members) {
			const account = m.accountType === 'AGENT' ? agentAccounts.get(m.id) : playerAccounts.get(m.id);
			if (account) accounts.push(account);
		}
		return {
			parent,
			pool,
			items: accounts.slice(offset, offset + limit),
			total: accounts.length,
			totals: sumChipTotals(accounts),
		};
	}

	/** One account's chip statement (credit_chip_ledger), newest first. The account must be in the read scope. */
	async getStatement(caller: ChipCaller, args: ChipStatementArgs): Promise<ChipStatementPage> {
		const target = parseTarget(args.accountType, args.accountId);
		const account = await this.getAccount(caller, target.accountType, target.id);
		if (!account) throw notFound(target);
		return this.statement(caller.tenant, target.accountType === 'AGENT' ? 'agent' : 'player', account.id, args);
	}

	/** Admin only: the pool side of chip transfers (account_type 'whitelabel', account_id = tenant). */
	async getPoolStatement(caller: ChipCaller, args: Omit<ChipStatementArgs, 'accountType' | 'accountId'> = {}): Promise<ChipStatementPage> {
		if (caller.kind !== 'admin') throw new ChipError('FORBIDDEN', 'Forbidden: the whitelabel pool is an admin view');
		return this.statement(caller.tenant, 'whitelabel', caller.tenant, args);
	}

	/** Admin only: the whitelabel pool's figures; null for agents or when the tenant has no pool row. */
	async getPool(caller: ChipCaller): Promise<ChipPool | null> {
		if (caller.kind !== 'admin') return null;
		return this.poolFigures(caller.tenant);
	}

	/**
	 * Batch figures for CREDIT agents (for AgentAccount.chips on list queries). Ids the caller has already scoped;
	 * agents of other schemes or tenants are left out. Keys are lower-case agent ids.
	 */
	async chipAccountsForAgents(tenant: string, ids: readonly string[]): Promise<Map<string, ChipAccount>> {
		const out = new Map<string, ChipAccount>();
		const agentIds = [...new Set(ids.map((id) => String(id ?? '').trim().toLowerCase()).filter((id) => isUuid(id)))];
		if (agentIds.length === 0) return out;
		const [bases, descendantChips, subtreeWallets, counts, currency] = await Promise.all([
			this.repo.agentBases(db, tenant, agentIds),
			this.repo.descendantAgentChips(db, tenant, agentIds),
			this.repo.subtreePlayerWallets(db, tenant, agentIds),
			this.repo.directDownlineCounts(db, tenant, agentIds),
			this.currencyOf(tenant),
		]);
		for (const b of bases) {
			const wallets = subtreeWallets.get(b.id) ?? { cash: 0, exposure: 0 };
			const figures = agentChipFigures({
				creditReference: b.creditLimit,
				balance: b.chipBalance,
				downlineBalance: (descendantChips.get(b.id) ?? 0) + wallets.cash,
				exposure: wallets.exposure,
			});
			out.set(b.id, {
				accountType: 'AGENT',
				id: b.id,
				username: b.username || b.id,
				name: null,
				status: b.status,
				parentAgentId: b.parentAgentId,
				playerType: null,
				currency,
				...figures,
				downlineCount: counts.get(b.id) ?? 0,
			});
		}
		return out;
	}

	/**
	 * Batch figures for credit players (for Player.chips on list queries). Ids the caller has already scoped;
	 * players of other types or tenants are left out. Keys are the player ids as strings.
	 */
	async chipAccountsForPlayers(tenant: string, ids: readonly (string | number)[]): Promise<Map<string, ChipAccount>> {
		const out = new Map<string, ChipAccount>();
		const playerIds = [...new Set(ids.map((id) => parsePlayerId(id)).filter((id): id is number => id != null))];
		if (playerIds.length === 0) return out;
		const [bases, currency] = await Promise.all([this.repo.playerBases(db, tenant, playerIds), this.currencyOf(tenant)]);
		for (const b of bases) {
			const id = String(b.id);
			out.set(id, {
				accountType: 'PLAYER',
				id,
				username: b.username || b.name || id,
				name: b.name,
				status: b.status,
				parentAgentId: b.playerType === 'AGENT_CREDIT' ? b.agentId : null,
				playerType: b.playerType,
				currency,
				...playerChipFigures({ creditReference: b.creditLimit, cash: b.cash, exposure: b.exposure }),
				downlineCount: 0,
			});
		}
		return out;
	}

	// ---- Internals -------------------------------------------------------------------------------------------

	private async transfer(caller: ChipCaller, direction: ChipDirection, input: ChipTransferInput): Promise<ChipTransferResult> {
		ensureMayMove(caller);
		const amount = toChipAmount(input.amount);
		const remark = cleanRemark(input.remark);
		const target = parseTarget(input.accountType, input.accountId);
		const parent = parentOfCaller(caller);
		const outcome = await db.transaction((tx) =>
			this.transferInTx(tx, {
				tenant: caller.tenant,
				direction,
				parent,
				target,
				amount,
				remark,
				actor: chipActorOf(caller),
				scopeAgentId: caller.kind === 'agent' ? caller.agentId : null,
			})
		);
		const [account, parentAccount, pool] = await Promise.all([
			this.accountFor(caller.tenant, target),
			parent.kind === 'agent'
				? this.accountFor(caller.tenant, { accountType: 'AGENT', id: parent.agentId.toLowerCase() })
				: Promise.resolve(null),
			parent.kind === 'whitelabel' ? this.poolFigures(caller.tenant) : Promise.resolve(null),
		]);
		if (!account) throw notFound(target);
		return { account, parent: parentAccount, pool, transferId: outcome.transferId };
	}

	/** The whole money movement, inside `tx`. Lock order: parent, then child (users before wallets). */
	private async transferInTx(tx: ChipExecutor, p: TransferParams): Promise<TransferOutcome> {
		const transferId = randomUUID();
		// Scope first, without locks: a target outside an agent caller's subtree is "not found", and refusing it
		// before locking means a caller can never lock a row above itself (which would invert the lock order).
		if (p.scopeAgentId) await this.assertInScope(tx, p.scopeAgentId, p.tenant, p.target);

		const parent = await this.lockParent(tx, p.tenant, p.parent);
		const { child, wallet } = await this.lockChild(tx, p.tenant, p.target);
		const plan = planChipTransfer(p.direction, parent, child, p.amount);
		if (p.direction === 'DEPOSIT' && child.accountType === 'PLAYER') {
			await this.assertPlayerCanReceiveChips(tx, p.tenant, child);
		}
		const refused = () =>
			new ChipError('INSUFFICIENT', 'Not enough chips: the balance changed, please try again');

		// The parent's side.
		let parentAfter: number;
		if (parent.kind === 'agent') {
			const after = await this.repo.moveAgentChips(tx, parent.id, plan.parentDelta);
			if (after == null) throw refused(); // the row is locked and was checked; the SQL guard is a backstop
			parentAfter = after;
		} else {
			const reason = poolReason(p.direction, child);
			const player: PoolPlayerInfo | undefined =
				child.accountType === 'PLAYER' ? { userId: Number(child.id), playerUsername: child.username } : undefined;
			if (p.direction === 'DEPOSIT') {
				await this.pool.debit(p.tenant, plan.amount, reason, tx, player);
			} else {
				await this.pool.credit(p.tenant, plan.amount, reason, tx, player);
			}
			const pool = await this.repo.readPool(tx, p.tenant);
			if (!pool) throw new ChipError('NOT_FOUND', CHIP_MESSAGES.noPool);
			parentAfter = pool.creditAvailable;
		}

		// The child's side.
		let childAfter: number;
		if (child.accountType === 'AGENT') {
			const after = await this.repo.moveAgentChips(tx, child.id, plan.childDelta);
			if (after == null) throw refused();
			childAfter = after;
		} else {
			let target: ChipWalletRow | null = wallet;
			if (!target) {
				// Only a deposit gets here: a withdrawal from a player with no wallet was refused (no chips).
				target = await this.repo.createPlayerWallet(tx, Number(child.id), p.tenant, await this.currencyOf(p.tenant));
			}
			const moved = await this.repo.moveWalletCash(tx, target.id, plan.childDelta);
			if (!moved) throw refused();
			childAfter = moved.cash;
			const counterpartyName =
				parent.kind === 'agent' ? parent.username : parent.name || p.tenant;
			await this.repo.insertPlayerStatement(tx, {
				tenant: p.tenant,
				walletId: target.id,
				userId: Number(child.id),
				direction: p.direction,
				amount: plan.amount,
				cashBefore: plan.childBefore,
				cashAfter: childAfter,
				exposure: moved.exposure,
				currency: target.currency,
				transferId,
				counterpartyType: parent.kind === 'agent' ? 'agent' : 'whitelabel',
				counterpartyId: parent.kind === 'agent' ? parent.id : p.tenant,
				counterpartyName,
				remark: p.remark,
			});
		}

		await this.repo.insertLedgerRows(
			tx,
			buildChipTransferLedger({
				tenant: p.tenant,
				transferId,
				direction: p.direction,
				parent,
				child,
				amount: plan.amount,
				parentBefore: plan.parentBefore,
				parentAfter,
				childBefore: plan.childBefore,
				childAfter,
				remark: p.remark,
				actor: p.actor,
			})
		);
		return { transferId, parentAfter, childAfter };
	}

	private async lockParent(tx: ChipExecutor, tenant: string, ref: ChipParentRef): Promise<LockedChipParent> {
		if (ref.kind === 'agent') {
			const row = await this.repo.lockAgent(tx, ref.agentId);
			if (!row || row.tenantId !== tenant) throw new ChipError('NOT_FOUND', CHIP_MESSAGES.agentNotFound);
			return {
				kind: 'agent',
				id: row.id,
				username: row.username || row.id,
				status: row.status,
				schemeType: row.schemeType,
				chipBalance: row.chipBalance,
				creditReference: row.creditLimit,
			};
		}
		const pool = await this.repo.lockPool(tx, tenant);
		if (!pool) throw new ChipError('NOT_FOUND', CHIP_MESSAGES.noPool);
		return { kind: 'whitelabel', tenant, name: pool.name || tenant, available: pool.creditAvailable };
	}

	/**
	 * Lock the child: an agent's row, or a player's users row and then its wallet row. A player whose agent changed
	 * between an agent caller's scope check and this lock is caught by the direct-parent rule, which accepts only
	 * the caller's own players.
	 */
	private async lockChild(
		tx: ChipExecutor,
		tenant: string,
		target: ChipTarget
	): Promise<{ child: LockedChipChild; wallet: ChipWalletRow | null }> {
		if (target.accountType === 'AGENT') {
			const row = await this.repo.lockAgent(tx, target.id);
			if (!row || row.tenantId !== tenant) throw notFound(target);
			return {
				child: {
					accountType: 'AGENT',
					id: row.id,
					username: row.username || row.id,
					status: row.status,
					schemeType: row.schemeType,
					parentAgentId: row.parentAgentId,
					chipBalance: row.chipBalance,
					creditReference: row.creditLimit,
				},
				wallet: null,
			};
		}
		const player = await this.repo.lockPlayer(tx, target.playerId, tenant);
		if (!player) throw notFound(target);
		const wallet = await this.repo.lockPlayerWallet(tx, player.id, tenant);
		return {
			child: {
				accountType: 'PLAYER',
				id: String(player.id),
				username: player.username || player.name || String(player.id),
				status: player.status,
				playerType: player.playerType,
				agentId: player.agentId,
				creditReference: player.creditLimit,
				cash: wallet?.cash ?? 0,
				exposure: wallet?.exposure ?? 0,
			},
			wallet,
		};
	}

	/**
	 * Responsible gambling (shared/src/services/rgEnforcement.ts, rule 1): chips arriving in a blocked player's
	 * wallet are money in, so a deposit is refused. Called with the player's users row already locked. Withdrawals
	 * never call this: money out is never gated.
	 */
	private async assertPlayerCanReceiveChips(tx: ChipExecutor, tenant: string, child: LockedChipChild): Promise<void> {
		try {
			await assertPlayerCanFund(tenant, Number(child.id), tx);
		} catch (err) {
			if (err instanceof RgBlockedError) {
				throw new ChipError('RG_BLOCKED', `Chips cannot be deposited while ${childLabel(child)} has a responsible gambling block`);
			}
			throw err;
		}
	}

	/** An agent caller reaches only itself and its subtree; anything else is reported as not found. */
	private async assertInScope(executor: ChipExecutor, agentId: string, tenant: string, target: ChipTarget): Promise<void> {
		if (target.accountType === 'AGENT') {
			if (!(await this.repo.isAgentInSubtree(executor, agentId, target.id))) throw notFound(target);
			return;
		}
		const player = await this.repo.readPlayer(executor, target.playerId, tenant);
		if (!player || !player.agentId || !(await this.repo.isAgentInSubtree(executor, agentId, player.agentId))) {
			throw notFound(target);
		}
	}

	/** Whose chips fund a new account: its parent agent, or the whitelabel pool. */
	private async parentOfAccount(executor: ChipExecutor, tenant: string, target: ChipTarget): Promise<ChipParentRef> {
		if (target.accountType === 'AGENT') {
			const agent = await this.repo.readAgent(executor, target.id);
			if (!agent || agent.tenantId !== tenant) throw notFound(target);
			if (agent.schemeType !== 'CREDIT') throw new ChipError('NOT_CREDIT', CHIP_MESSAGES.notCreditAccount);
			return agent.parentAgentId ? { kind: 'agent', agentId: agent.parentAgentId } : { kind: 'whitelabel' };
		}
		const player = await this.repo.readPlayer(executor, target.playerId, tenant);
		if (!player) throw notFound(target);
		if (player.playerType === 'AGENT_CREDIT') {
			if (!player.agentId) throw new ChipError('NOT_DIRECT_PARENT', 'This credit player has no agent');
			return { kind: 'agent', agentId: player.agentId };
		}
		if (player.playerType === 'WHITELABEL_CREDIT') return { kind: 'whitelabel' };
		throw new ChipError('NOT_CREDIT', CHIP_MESSAGES.notCreditAccount);
	}

	/** Read scope of an agent caller: itself, its descendants, and the players of any of them (users.agent_id). */
	private async agentMaySee(agentId: string, tenant: string, target: ChipTarget): Promise<boolean> {
		try {
			await this.assertInScope(db, agentId, tenant, target);
			return true;
		} catch (err) {
			if (err instanceof ChipError && err.code === 'NOT_FOUND') return false;
			throw err;
		}
	}

	private async accountFor(tenant: string, target: ChipTarget): Promise<ChipAccount | null> {
		if (target.accountType === 'AGENT') {
			return (await this.chipAccountsForAgents(tenant, [target.id])).get(target.id) ?? null;
		}
		return (await this.chipAccountsForPlayers(tenant, [target.playerId])).get(target.id) ?? null;
	}

	private async poolFigures(tenant: string): Promise<ChipPool | null> {
		const [pool, currency] = await Promise.all([this.pool.read(tenant), this.currencyOf(tenant)]);
		if (!pool) return null;
		return {
			currency,
			creditLimit: roundChips(pool.creditLimit),
			used: roundChips(pool.creditUsed),
			available: roundChips(pool.creditAvailable),
		};
	}

	private async statement(
		tenant: string,
		accountType: ChipLedgerAccountType,
		accountId: string,
		args: { from?: string | null; to?: string | null; offset?: number | null; limit?: number | null }
	): Promise<ChipStatementPage> {
		const { offset, limit } = pageOf(args.offset, args.limit);
		const { from, toBefore } = parseRange(args.from, args.to);
		const page = await this.repo.statementPage(db, { tenant, accountType, accountId, from, toBefore, offset, limit });
		return { total: page.total, rows: page.rows.map(toStatementRow) };
	}
}

function toStatementRow(r: ChipStatementDbRow): ChipStatementRow {
	return {
		id: r.id,
		createdAt: r.createdAt,
		kind: r.kind,
		amount: r.amount,
		balanceBefore: r.balanceBefore,
		balanceAfter: r.balanceAfter,
		creditReferenceBefore: r.creditReferenceBefore,
		creditReferenceAfter: r.creditReferenceAfter,
		counterpartyType: r.counterpartyType ? r.counterpartyType.toUpperCase() : null,
		counterpartyId: r.counterpartyId,
		counterpartyName: r.counterpartyName,
		remark: r.remark,
		createdBy: r.createdByName ?? (r.createdByType === 'system' ? 'System' : r.createdBy),
	};
}

function ensureMayMove(caller: ChipCaller): void {
	if (caller.kind === 'agent' && caller.readOnly) throw new ChipError('FORBIDDEN', CHIP_MESSAGES.readOnly);
}

function parentOfCaller(caller: ChipCaller): ChipParentRef {
	return caller.kind === 'agent' ? { kind: 'agent', agentId: caller.agentId } : { kind: 'whitelabel' };
}

/** Shared instance for resolvers. */
export const chipService = new ChipService();
