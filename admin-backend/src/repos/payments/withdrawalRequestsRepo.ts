import { db } from '@/db/client.js'
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { withdrawalRequests, userPayoutAccounts, users, wallets, ledgerEntries } from '@shared/db/schema.js'
import { createWalletLedgerEntry } from '@shared/services/walletLedgerService.js'

type Filter = {
  status?: string
  userId?: number
  accountId?: number
  fromDate?: Date
  toDate?: Date
}

export async function listWithdrawalRequests(filter: Filter, tenant: string, pagination: { offset: number; limit: number }) {
  const where = []
  where.push(eq(withdrawalRequests.tenant, tenant))
  if (filter.status) where.push(eq(withdrawalRequests.status, filter.status as any))
  if (filter.userId) where.push(eq(withdrawalRequests.userId, filter.userId))
  if (filter.accountId) where.push(eq(withdrawalRequests.payoutAccountId, filter.accountId))
  if (filter.fromDate) where.push(gte(withdrawalRequests.createdAt, filter.fromDate))
  if (filter.toDate) where.push(lte(withdrawalRequests.createdAt, filter.toDate))

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

export async function updateWithdrawalStatusAdmin(id: number, tenant: string, status: string, reviewerId?: number, note?: string) {
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

  const rows = await db
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
  const row = rows[0]
  if (!row) {
    // Either the request does not exist, or it is already terminal. Both return
    // the row as it actually stands so the caller sees the real status rather
    // than a transition that did not happen; a missing row still yields null.
    return getWithdrawalRequestById(id, tenant)
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

  return row
}

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

export async function getPayoutAccountsByIds(ids: number[], tenant: string) {
  if (!ids.length) return []
  return db.select().from(userPayoutAccounts)
    .where(and(inArray(userPayoutAccounts.id, ids), eq(userPayoutAccounts.tenant, tenant)))
}
