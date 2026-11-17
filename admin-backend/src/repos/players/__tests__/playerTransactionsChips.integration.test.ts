/**
 * The admin player transactions page lists a credit player's chip movements (CREDIT on Deposit/Withdraw chips, spec
 * docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md §4.1/§4.2): the CHIP_DEPOSIT / CHIP_WITHDRAW rows
 * ChipRepo.insertPlayerStatement writes on the player's cash wallet, as chip_deposit / chip_withdrawal labelled
 * "Chip deposit" / "Chip withdrawal", with the amount, the balance before and after, and the remark (or who moved
 * the chips) as the reference.
 *
 * SQL projection test, like playerTransactionsPagination.integration.test.ts: temporary CTEs shadow the source
 * tables for this one SELECT, on read-only connections. No fixture inserts and no writes. Needs DATABASE_URL.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/repos/players/__tests__/playerTransactionsChips.integration.test.ts
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { pool } from '@src/db/client.js'
import { getPlayerTransactionsPage } from '../playerTransactionsPageRepo.js'

const hasDb = Boolean(process.env.DATABASE_URL)
const TENANT = 'chip-tx-fixture'

// Player 7 owns wallet 1; player 8 owns wallet 2. The rows are shaped like ChipRepo.insertPlayerStatement's.
const LEDGER = [
	{
		id: 1, wallet_id: 1, type: 'CHIP_DEPOSIT', amount: 1000, balance_before: 0, balance_after: 1000, created_at: '2026-10-01T10:00:00Z',
		meta: { type: 'chip_deposit', transferId: 't-1', originalAmount: 1000, originalCurrency: 'INR', counterpartyType: 'agent', counterpartyName: 'agent_a', remark: 'first chips', description: 'Chips deposited by agent_a', status: 'completed' },
	},
	{
		id: 2, wallet_id: 1, type: 'CHIP_WITHDRAW', amount: 250, balance_before: 1000, balance_after: 750, created_at: '2026-10-01T11:00:00Z',
		meta: { type: 'chip_withdraw', transferId: 't-2', originalAmount: -250, originalCurrency: 'INR', counterpartyType: 'agent', counterpartyName: 'agent_a', remark: null, description: 'Chips withdrawn by agent_a', status: 'completed' },
	},
	// A casino stake is a bet, not a transaction: never listed.
	{ id: 3, wallet_id: 1, type: 'debit', amount: 100, balance_before: 750, balance_after: 650, created_at: '2026-10-01T12:00:00Z', meta: { type: 'casino_bet' } },
	// Another player's chips.
	{ id: 4, wallet_id: 2, type: 'CHIP_DEPOSIT', amount: 500, balance_before: 0, balance_after: 500, created_at: '2026-10-01T10:30:00Z', meta: { type: 'chip_deposit', originalAmount: 500, status: 'completed' } },
	// A cash deposit, for the "all deposits" filter.
	{ id: 5, wallet_id: 1, type: 'credit', amount: 40, balance_before: 0, balance_after: 40, created_at: '2026-10-01T09:00:00Z', meta: { type: 'deposit', method: 'UPI', reference: 'utr-5', originalAmount: '40' } },
]

const fixtures = `
	wallets AS (SELECT (jsonb_populate_record(null::public.wallets,
		jsonb_build_object('id',n,'tenant',$1::text,'user_id',CASE WHEN n=1 THEN 7 ELSE 8 END,'currency','INR'))).* FROM generate_series(1,2)n),
	ledger_entries AS (SELECT (jsonb_populate_record(null::public.ledger_entries, e || jsonb_build_object('tenant',$1::text))).*
		FROM jsonb_array_elements('${JSON.stringify(LEDGER).replace(/'/g, "''")}'::jsonb) e),
	deposit_requests AS (SELECT * FROM public.deposit_requests WHERE false),
	withdrawal_requests AS (SELECT * FROM public.withdrawal_requests WHERE false),
	agent_credit_ledger AS (SELECT * FROM public.agent_credit_ledger WHERE false),
`

describe("a credit player's chip movements on the admin transactions page", { skip: !hasDb }, () => {
	const original = pool.query.bind(pool)
	before(() => {
		;(pool as any).options.options += ' -c default_transaction_read_only=on'
		;(pool as any).query = (query: any, ...rest: any[]) => {
			const text = typeof query === 'string' ? query : query.text
			if (/WITH ledger_base AS/.test(text)) {
				const replacement = text.replace('WITH ledger_base AS', `WITH ${fixtures} ledger_base AS`)
				return (original as any)(typeof query === 'string' ? replacement : { ...query, text: replacement }, ...rest)
			}
			return (original as any)(query, ...rest)
		}
	})
	after(async () => {
		;(pool as any).query = original
		await pool.end()
	})

	it('lists the chip deposit and withdrawal with their label, amount and balances, and nothing else of the wallet', async () => {
		const page = await getPlayerTransactionsPage(TENANT, 7, { limit: 20 }, true)
		assert.equal(page.total, 3)
		assert.deepEqual(page.items.map((r: any) => r.id), ['ledger_2', 'ledger_1', 'ledger_5'], 'newest first; no bet, no other player')

		const [withdrawal, deposit] = page.items as any[]
		assert.deepEqual(
			{ type: deposit.type, method: deposit.method, amount: deposit.amount, fees: deposit.fees, netAmount: deposit.netAmount, status: deposit.status, currency: deposit.currency, reference: deposit.reference, balanceBefore: deposit.balanceBefore, balanceAfter: deposit.balanceAfter },
			{ type: 'chip_deposit', method: 'Chip deposit', amount: 1000, fees: 0, netAmount: 1000, status: 'completed', currency: 'INR', reference: 'first chips', balanceBefore: 0, balanceAfter: 1000 }
		)
		assert.deepEqual(
			{ type: withdrawal.type, method: withdrawal.method, amount: withdrawal.amount, status: withdrawal.status, reference: withdrawal.reference, balanceBefore: withdrawal.balanceBefore, balanceAfter: withdrawal.balanceAfter },
			{ type: 'chip_withdrawal', method: 'Chip withdrawal', amount: 250, status: 'completed', reference: 'Chips withdrawn by agent_a', balanceBefore: 1000, balanceAfter: 750 },
			'a positive amount; with no remark, the reference says who took the chips back'
		)
		assert.equal(JSON.parse(deposit.metadata).transferId, 't-1')
	})

	it('filters: by chip type, in "all deposits" / "all withdrawals", by search and by method', async () => {
		const total = async (filter: Record<string, unknown>) => (await getPlayerTransactionsPage(TENANT, 7, { limit: 20, ...filter }, true)).total
		assert.equal(await total({ type: 'chip_deposit' }), 1)
		assert.equal(await total({ type: 'chip_withdrawal' }), 1)
		assert.equal(await total({ type: 'all_deposit' }), 2, 'the chip deposit and the cash deposit')
		assert.equal(await total({ type: 'all_withdrawal' }), 1)
		assert.equal(await total({ type: 'deposit' }), 1, 'a plain deposit filter still means cash deposits')
		assert.equal(await total({ search: 'first chips' }), 1)
		assert.equal(await total({ method: 'Chip withdrawal' }), 1)
	})

	it('are listed without the players.credit permission: they are the wallet\'s own rows, like deposits', async () => {
		assert.equal((await getPlayerTransactionsPage(TENANT, 7, { limit: 20 }, false)).total, 3)
	})
})
