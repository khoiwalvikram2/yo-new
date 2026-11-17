import { db } from '@/db/client.js'
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm'
import { withdrawalRequests, userPayoutAccounts, users, wallets, ledgerEntries, welivepayPayouts } from '@shared/db/schema.js'
import { createWalletLedgerEntry } from '@shared/services/walletLedgerService.js'

type Filter = {
  /** One request by id (task links). An id that cannot exist matches nothing. */
  id?: number
  status?: string
  userId?: number
  accountId?: number
  /** The search box: see withdrawalSearchCondition. */
  query?: string
  fromDate?: Date
  toDate?: Date
}

/** withdrawal_requests.id is a serial (int4); a larger number would make Postgres throw, so it matches nothing. */
const MAX_REQUEST_ID = 2_147_483_647

export function isRequestId(n: number): boolean {
  return Number.isSafeInteger(n) && n > 0 && n <= MAX_REQUEST_ID
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`)
}

/**
 * The page's search box: the player's name, username, phone or email (their users row in the same tenant),
 * or the request id when the term is a number. Under two characters it searches nothing, like the page.
 * The field was sent by the page but never declared, so every search failed validation and listed nothing.
 */
export function withdrawalSearchCondition(query: string, tenant: string): SQL | undefined {
  const term = query.trim()
  if (term.length < 2) return undefined
  const like = `%${escapeLike(term)}%`
  const players = db.select({ id: users.id }).from(users).where(and(
    eq(users.tenant, tenant),
    or(ilike(users.name, like), ilike(users.username, like), ilike(users.phone, like), ilike(users.email, like)),
  ))
  const asId = /^\d+$/.test(term) ? Number(term) : NaN
  return or(
    inArray(withdrawalRequests.userId, players),
    ...(isRequestId(asId) ? [eq(withdrawalRequests.id, asId)] : []),
  )
}

export async function listWithdrawalRequests(filter: Filter, tenant: string, pagination: { offset: number; limit: number }) {
  const where: SQL[] = []
  where.push(eq(withdrawalRequests.tenant, tenant))
  if (filter.id !== undefined) where.push(isRequestId(filter.id) ? eq(withdrawalRequests.id, filter.id) : sql`false`)
  if (filter.status) where.push(eq(withdrawalRequests.status, filter.status as any))
  if (filter.userId) where.push(eq(withdrawalRequests.userId, filter.userId))
  if (filter.accountId) where.push(eq(withdrawalRequests.payoutAccountId, filter.accountId))
  if (filter.fromDate) where.push(gte(withdrawalRequests.createdAt, filter.fromDate))
  if (filter.toDate) where.push(lte(withdrawalRequests.createdAt, filter.toDate))
  const search = filter.query ? withdrawalSearchCondition(filter.query, tenant) : undefined
  if (search) where.push(search)

  const items = await db
    .select({
      id: withdrawalRequests.id,
      userId: withdrawalRequests.userId,
      walletId: withdrawalRequests.walletId,
      payoutAccountId: withdrawalRequests.payoutAccountId,
      amount: withdrawalRequests.amount,
      currency: withdrawalRequests.currency,
      status: withdrawalRequests.status,
      reviewerId: withdrawalRequests.reviewerId,
      reviewedAt: withdrawalRequests.reviewedAt,
      note: withdrawalRequests.note,
      balanceBefore: withdrawalRequests.balanceBefore,
      balanceAfter: withdrawalRequests.balanceAfter,
      createdAt: withdrawalRequests.createdAt,
      updatedAt: withdrawalRequests.updatedAt,
    })
    .from(withdrawalRequests)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(withdrawalRequests.createdAt), desc(withdrawalRequests.id))
    .offset(pagination.offset)
    .limit(pagination.limit)

  const total = Number(
    (
      await db
        .select({ count: sql<number>`count(*)::int` })
        .from(withdrawalRequests)
        .where(where.length ? and(...where) : undefined)
    )[0]?.count ?? 0
  )

  return { items, total }
}

export async function getWithdrawalRequestById(id: number, tenant: string) {
  const rows = await db
    .select()
    .from(withdrawalRequests)
    .where(and(eq(withdrawalRequests.id, id), eq(withdrawalRequests.tenant, tenant)))
    .limit(1)
  return rows[0] || null
}

export async function getWithdrawalHistory(id: number, tenant: string) {
  const row = await getWithdrawalRequestById(id, tenant)
  if (!row) return []
  // With current schema we only have last status/reviewer; emulate history with single entry
  return [
    {
      status: row.status,
      reviewerId: row.reviewerId,
      reviewedAt: row.reviewedAt,
      note: row.note,
    },
  ]
}

type WithdrawalRequestRow = typeof withdrawalRequests.$inferSelect

/** The request's own columns as read under its FOR UPDATE lock. */
type LockedWithdrawal = { status?: string; user_id?: number | string | null; payout_account_id?: number | string | null }
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** The statuses that pay a withdrawal out: PROCESSING (the payment is under way) and COMPLETED (it was paid). */
const PAYOUT_STATUSES = new Set(['PROCESSING', 'COMPLETED'])

/**
 * FIN-05, checked again at payout time. The player's request checked its payout account when it was stored, but an
 * admin can reject that account afterwards, so a live request is paid out (moved to PROCESSING or COMPLETED) only
 * while the account it names still exists for that player, is not deleted and is APPROVED, as the WeLivePay send
 * already requires.
 * Read FOR SHARE under the request's lock: an approval change made now waits for this payment, and one committed
 * just before is seen. The refusal throws, so the transaction writes nothing. FAILED and CANCELLED, which refund
 * the player, are never refused here.
 */
async function assertPayoutAccountApproved(tx: Tx, request: LockedWithdrawal, tenant: string): Promise<void> {
  const accountId = request.payout_account_id != null ? Number(request.payout_account_id) : null
  const [account] = accountId != null
    ? await tx
        .select({ approvalStatus: userPayoutAccounts.approvalStatus, deletedAt: userPayoutAccounts.deletedAt })
        .from(userPayoutAccounts)
        .where(and(
          eq(userPayoutAccounts.id, accountId),
          eq(userPayoutAccounts.tenant, tenant),
          eq(userPayoutAccounts.userId, Number(request.user_id)),
        ))
        .for('share')
        .limit(1)
    : []
  if (!account) {
    throw new Error("This withdrawal's payout account no longer exists, so it cannot be paid. Cancel the request to refund the player.")
  }
  // The player cannot delete an account while a withdrawal to it is live; a deleted one is never paid all the same.
  if (account.deletedAt) {
    throw new Error("This withdrawal's payout account was deleted by the player, so it cannot be paid. Cancel the request to refund the player.")
  }
  if (account.approvalStatus !== 'APPROVED') {
    const state = account.approvalStatus === 'REJECTED' ? 'rejected' : 'waiting for approval'
    throw new Error(`This withdrawal's payout account is ${state}, so it cannot be paid. Approve the account under Payout Account Approvals first, or cancel the request to refund the player.`)
  }
}

/** The request after the attempt, or null when it does not exist; see applyWithdrawalStatusAdmin. */
export async function updateWithdrawalStatusAdmin(id: number, tenant: string, status: string, reviewerId?: number, note?: string) {
  return (await applyWithdrawalStatusAdmin(id, tenant, status, reviewerId, note))?.row ?? null
}

/**
 * Moves a live (PENDING or PROCESSING) request to `status`, with the refund, completion marker and pool
 * credit that go with it. `changed` is false when the request was already settled (by another reviewer,
 * typically while this one had it open): nothing was written and `row` is the request as it stands, so the
 * caller must not report, audit or announce a change. `previousStatus` is the status this call moved it from.
 * Paying a live request out (PROCESSING or COMPLETED) throws, writing nothing, when its payout account is gone or
 * not APPROVED; see assertPayoutAccountApproved.
 */
export async function applyWithdrawalStatusAdmin(
  id: number,
  tenant: string,
  status: string,
  reviewerId?: number,
  note?: string,
): Promise<{ row: WithdrawalRequestRow; changed: boolean; previousStatus: string } | null> {
  // First get the existing withdrawal request to check for ledger entry
  const [existing] = await db
    .select()
    .from(withdrawalRequests)
    .where(and(eq(withdrawalRequests.id, id), eq(withdrawalRequests.tenant, tenant)))
    .limit(1)
  
  if (!existing) return null
  
  // Get balance from ledger entry if it exists (prefer ledger entry, fallback to existing values)
  let balanceBefore: string | null = existing.balanceBefore
  let balanceAfter: string | null = existing.balanceAfter
  
  if (existing.walletId && existing.ledgerTxnId) {
    const [ledgerEntry] = await db
      .select()
      .from(ledgerEntries)
      .where(and(
        eq(ledgerEntries.id, existing.ledgerTxnId),
        eq(ledgerEntries.tenant, tenant)
      ))
      .limit(1)
    
    if (ledgerEntry) {
      // Use ledger entry balance if available, otherwise keep existing values
      if (ledgerEntry.balanceBefore) {
        balanceBefore = ledgerEntry.balanceBefore
      }
      if (ledgerEntry.balanceAfter) {
        balanceAfter = ledgerEntry.balanceAfter
      }
    }
  }

  // Conditional update so only one caller wins (no double refund, no double COMPLETED/whitelabel under concurrency)
  const isRefundStatus = status === 'FAILED' || status === 'CANCELLED'
  const isCompletedStatus = status === 'COMPLETED'

  // The guard used to apply only to FAILED/CANCELLED/COMPLETED, which left the
  // transitions *back* to PENDING or PROCESSING unguarded. A settled withdrawal
  // could therefore be reopened, and the next FAILED or CANCELLED then passed
  // this very check and refunded the player again — repeatable without bound.
  //
  // Of the five statuses, COMPLETED, FAILED and CANCELLED are terminal. Every
  // transition, in either direction, may only move a request that is still
  // live, so the condition is the same for all of them.
  const updateWhere = and(
    eq(withdrawalRequests.id, id),
    eq(withdrawalRequests.tenant, tenant),
    inArray(withdrawalRequests.status, ['PENDING', 'PROCESSING'])
  )

  // A withdrawal sent to WeLivePay settles only through the gateway (refresh or reject payout).
  // Checked under the row lock the payout service takes when it sends one, so a manual
  // COMPLETED/FAILED can never race a submission into a second payout or refund.
  let lockedStatus: string | null = null
  const rows = await db.transaction(async (tx) => {
    const locked = await tx.execute(sql`SELECT status, user_id, payout_account_id FROM withdrawal_requests WHERE id = ${id} AND tenant = ${tenant} FOR UPDATE`)
    const lockedRow = locked.rows[0] as LockedWithdrawal | undefined
    lockedStatus = lockedRow?.status ?? null
    const [gatewayPayout] = await tx.select({ id: welivepayPayouts.id }).from(welivepayPayouts)
      .where(eq(welivepayPayouts.withdrawalRequestId, id)).limit(1)
    if (gatewayPayout) throw new Error('This withdrawal is managed by WeLivePay. Refresh gateway status instead of changing it manually.')
    if (lockedRow && PAYOUT_STATUSES.has(status) && (lockedStatus === 'PENDING' || lockedStatus === 'PROCESSING')) {
      await assertPayoutAccountApproved(tx, lockedRow, tenant)
    }
    return tx
      .update(withdrawalRequests)
      .set({
        status: status as any,
        reviewerId: reviewerId ?? null,
        reviewedAt: new Date(),
        note: note ?? null,
        balanceBefore: balanceBefore,
        balanceAfter: balanceAfter,
        updatedAt: new Date(),
      })
      .where(updateWhere)
      .returning()
  })
  const row = rows[0]
  if (!row) {
    // Either the request does not exist, or it is already terminal. Both return
    // the row as it actually stands so the caller sees the real status rather
    // than a transition that did not happen; a missing row still yields null.
    const current = await getWithdrawalRequestById(id, tenant)
    return current ? { row: current, changed: false, previousStatus: current.status } : null
  }

  const previousStatus = existing.status

  // Withdrawal completed: audit marker (0 credit/debit) for ledger timeline
  if (status === 'COMPLETED' && row.walletId) {
    try {
      const [wallet] = await db
        .select({ cash: wallets.cash, exposure: wallets.exposure })
        .from(wallets)
        .where(and(eq(wallets.id, row.walletId), eq(wallets.tenant, tenant)))
        .limit(1)
      const available = wallet
        ? Math.max(0, Number(wallet.cash ?? 0) - Number(wallet.exposure ?? 0))
        : 0
      await createWalletLedgerEntry(db, {
        tenant,
        walletId: row.walletId,
        userId: row.userId,
        walletType: 'cash',
        category: 'withdrawal_completed',
        direction: 'credit',
        amount: 0,
        balanceBefore: available,
        balanceAfter: available,
        description: 'Withdrawal completed',
        referenceType: 'withdrawal_request',
        referenceId: String(row.id),
        meta: { withdrawalId: row.id, status },
      })
    } catch (e) {
    }
  }

  // Add whitelabel credit when withdrawal is completed (only for whitelabels, not 'default' tenant)
  // This applies to ALL players, not just WHITELABEL_CREDIT players
  const isWhitelabel = tenant && tenant !== 'default'
  if (status === 'COMPLETED' && row.amount && isWhitelabel) {
    const { WhitelabelCreditService } = await import('@src/domains/common/services/WhitelabelCreditService.js')
    const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js')
    const whitelabelCreditService = new WhitelabelCreditService(new WhitelabelCreditRepo())
    
    // Get player info for transaction meta
    const { getUserDb } = await import('@src/repos/users/usersRepo.js')
    const player = row.userId ? await getUserDb(row.userId, tenant) : null
    
    const amount = Number(row.amount)
    await whitelabelCreditService.addCredit(
      tenant,
      amount,
      `Player withdrawal completed - Withdrawal Request #${id}`,
      undefined, // No transaction needed here
      player ? {
        userId: player.id,
        playerName: player.name || undefined,
        playerEmail: player.email || undefined,
        playerUsername: player.username || undefined,
      } : undefined
    )
  }

  // Refund on failure/cancel only when transitioning from a non-final status (idempotent: no double refund)
  const wasRefundable = previousStatus === 'PENDING' || previousStatus === 'PROCESSING'
  const refundAmount = Number(row.amount ?? 0)
  if (row.walletId && isRefundStatus && wasRefundable && refundAmount > 0) {
    const [wallet] = await db
      .select({ cash: wallets.cash, exposure: wallets.exposure })
      .from(wallets)
      .where(and(eq(wallets.id, row.walletId), eq(wallets.tenant, tenant)))
      .limit(1)
    const balanceBefore = wallet ? Number(wallet.cash ?? 0) : 0
    const exposure = wallet ? Number(wallet.exposure ?? 0) : 0
    const balanceAfter = balanceBefore + refundAmount
    const ledgerBefore = Math.max(0, balanceBefore - exposure)
    const ledgerAfter = Math.max(0, balanceAfter - exposure)

    await db
      .update(wallets)
      .set({ cash: sql`${wallets.cash} + ${row.amount}` })
      .where(and(eq(wallets.id, row.walletId), eq(wallets.tenant, tenant)))

    await db.insert(ledgerEntries).values({
      walletId: row.walletId,
      tenant,
      amount: String(refundAmount),
      type: 'withdrawal_refund',
      meta: { withdrawalId: row.id, status },
      balanceBefore: String(balanceBefore),
      balanceAfter: String(balanceAfter),
    })
    await createWalletLedgerEntry(db, {
      tenant,
      walletId: row.walletId,
      userId: row.userId,
      walletType: 'cash',
      category: 'withdrawal_refund',
      direction: 'credit',
      amount: refundAmount,
      balanceBefore: ledgerBefore,
      balanceAfter: ledgerAfter,
      description: 'Withdrawal refund (admin)',
      referenceType: 'withdrawal_request',
      referenceId: String(row.id),
      meta: { withdrawalId: row.id, status },
    })
  }

  return { row, changed: true, previousStatus: lockedStatus ?? previousStatus }
}

/**
 * A withdrawal's own payout account, deleted or not: the admin still sees where the request was to be paid, and the
 * view marks a deleted one (deletedAt). Lists of accounts for review read payoutAccountsRepo, which leaves them out.
 */
export async function getPayoutAccount(id: number, tenant: string) {
  const rows = await db
    .select()
    .from(userPayoutAccounts)
    .where(and(eq(userPayoutAccounts.id, id), eq(userPayoutAccounts.tenant, tenant)))
    .limit(1)
  return rows[0] || null
}

export async function getUserBasic(id: number, tenant: string) {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.tenant, tenant)))
    .limit(1)
  return rows[0] || null
}

/** The payout accounts of a page of withdrawals, deleted ones included (see getPayoutAccount). */
export async function getPayoutAccountsByIds(ids: number[], tenant: string) {
  if (!ids.length) return []
  return db.select().from(userPayoutAccounts)
    .where(and(inArray(userPayoutAccounts.id, ids), eq(userPayoutAccounts.tenant, tenant)))
}
