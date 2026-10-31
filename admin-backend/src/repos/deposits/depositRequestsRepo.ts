import { lockVipPlayer, assertVipDepositAllowed } from '@shared/vip/depositAccess.js'
import { assertPlayerCanFund } from '@shared/services/rgEnforcement.js'
import { db } from '@/db/client.js'
import { depositRequests, ledgerEntries } from '@/db/schema.js'
import { and, eq, desc, gte, lte, inArray, or, ilike, sql } from 'drizzle-orm'
import { adjustWalletDb } from '@src/repos/players/walletsRepo.js'

export type DepositRequestRow = {
  id: number
  tenant: string
  userId: number
  amount: string
  currency: string
  method: 'BANK_TRANSFER' | 'UPI'
  utr: string | null
  referenceId: string | null
  proofKey: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  reviewerId: number | null
  reviewedAt: Date | null
  note: string | null
  walletTxnId: number | null
  balanceBefore: string | null
  balanceAfter: string | null
  createdAt: Date
  updatedAt: Date
}

export type CreateDepositRequestInput = {
  accountId?: string | null
  tenant: string
  userId: number
  amount: number
  currency: string
  method: 'BANK_TRANSFER' | 'UPI'
  utr?: string | null
  referenceId?: string | null
  proofKey: string
}

export type ListDepositRequestsFilter = {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  userId?: number
  method?: 'BANK_TRANSFER' | 'UPI'
  fromDate?: Date
  toDate?: Date
  query?: string
}

export async function createDepositRequest(input: CreateDepositRequestInput): Promise<DepositRequestRow> {
  return db.transaction(async tx => {
  await lockVipPlayer(tx, input.tenant, input.userId)
  await assertPlayerCanFund(input.tenant, input.userId, tx)
  const snapshot = await assertVipDepositAllowed(tx, input.tenant, input.userId, { method: input.method, amount: input.amount, accountId: input.accountId })
  const [row] = await tx.insert(depositRequests).values({
    tenant: input.tenant,
    userId: input.userId,
    amount: String(input.amount),
    currency: input.currency,
    method: input.method,
    receivingAccountId: input.accountId, vipPolicySnapshot: snapshot,
    utr: input.utr ?? null,
    referenceId: input.referenceId ?? null,
    proofKey: input.proofKey,
    status: 'PENDING',
  }).returning()
  
  return row as DepositRequestRow
  })
}

export async function getDepositRequestById(id: number, tenant: string): Promise<DepositRequestRow | null> {
  const [row] = await db.select()
    .from(depositRequests)
    .where(and(eq(depositRequests.id, id), eq(depositRequests.tenant, tenant)))
    .limit(1)
  
  return (row as DepositRequestRow) || null
}

export async function listDepositRequests(
  filter: ListDepositRequestsFilter,
  tenant: string,
  options?: { offset?: number; limit?: number }
): Promise<{ items: DepositRequestRow[]; total: number }> {
  const whereClauses: any[] = [eq(depositRequests.tenant, tenant)]
  
  if (filter.status) {
    whereClauses.push(eq(depositRequests.status, filter.status))
  }
  
  if (filter.userId) {
    whereClauses.push(eq(depositRequests.userId, filter.userId))
  }
  
  if (filter.method) {
    whereClauses.push(eq(depositRequests.method, filter.method))
  }
  
  if (filter.fromDate) {
    whereClauses.push(gte(depositRequests.createdAt, filter.fromDate))
  }
  
  if (filter.toDate) {
    whereClauses.push(lte(depositRequests.createdAt, filter.toDate))
  }
  
  if (filter.query) {
    whereClauses.push(
      or(
        ilike(depositRequests.utr, `%${filter.query}%`),
        ilike(depositRequests.referenceId, `%${filter.query}%`)
      )
    )
  }
  
  const whereClause = and(...whereClauses)
  
  // Get total count
  const allRows = await db.select()
    .from(depositRequests)
    .where(whereClause)
  
  const total = allRows.length
  
  // Get paginated results
  const offset = options?.offset ?? 0
  const limit = options?.limit ?? 100
  
  const items = await db.select()
    .from(depositRequests)
    .where(whereClause)
    .orderBy(desc(depositRequests.createdAt), desc(depositRequests.id))
    .limit(limit)
    .offset(offset)
  
  return {
    items: items as DepositRequestRow[],
    total,
  }
}

export async function approveDepositRequest(
  id: number,
  tenant: string,
  reviewerId: number,
  note?: string | null
): Promise<DepositRequestRow> {
  const approved = await db.transaction(async (tx) => {
    // Lock the request row first. Reading it with a plain SELECT let two
    // concurrent approvals both see PENDING, and both then ran the whole body:
    // the whitelabel credit was deducted twice and the player's wallet credited
    // twice for one deposit. With the lock the second transaction waits, re-reads
    // an APPROVED row, matches nothing and raises 'already processed'.
    await tx.execute(sql`
      SELECT id FROM deposit_requests
      WHERE id = ${id} AND tenant = ${tenant}
      FOR UPDATE`)

    // Get the deposit request and ensure it's PENDING
    const [request] = await tx.select()
      .from(depositRequests)
      .where(and(
        eq(depositRequests.id, id),
        eq(depositRequests.tenant, tenant),
        eq(depositRequests.status, 'PENDING')
      ))
      .limit(1)
    
    if (!request) {
      throw new Error('Deposit request not found or already processed')
    }

    // CR-8 defense-in-depth: never approve a deposit into raw cash for a credit
    // player, even if a stale PENDING row pre-dates the create-path guard.
    const { getUserDb } = await import('@src/repos/users/usersRepo.js')
    const { isCreditPlayer } = await import('@shared/services/credit/isCreditPlayer.js')
    const depositingUser = await getUserDb(request.userId, tenant)
    if (isCreditPlayer((depositingUser as { playerType?: string | null } | null)?.playerType)) {
      throw new Error('Cannot approve deposit for a credit player')
    }
    // Nor for a player owned by a CREDIT agent, whatever its own type says; the
    // create path refuses both, but a PENDING row can pre-date that rule.
    const owner = await tx.execute(sql`SELECT a.scheme_type FROM users u JOIN agents a ON a.id = u.agent_id AND a.tenant_id = u.tenant
      WHERE u.id = ${request.userId} AND u.tenant = ${tenant} LIMIT 1`)
    if ((owner.rows[0] as { scheme_type?: string } | undefined)?.scheme_type === 'CREDIT') {
      throw new Error('Cannot approve deposit for a credit player')
    }

    const amount = Number(request.amount)
    
    // ENFORCE WHITELABEL CREDIT: Only enforce for whitelabels (not 'default' tenant)
    const isWhitelabel = tenant && tenant !== 'default'
    if (isWhitelabel) {
      const { WhitelabelCreditService } = await import('@src/domains/common/services/WhitelabelCreditService.js')
      const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js')
      const whitelabelCreditService = new WhitelabelCreditService(new WhitelabelCreditRepo())
      
      // Validate whitelabel has enough credit available
      const hasCredit = await whitelabelCreditService.validateCreditAvailable(tenant, amount)
      if (!hasCredit) {
        const creditData = await whitelabelCreditService.getCreditAllocation(tenant)
        throw new Error(
          `Insufficient whitelabel credit. Available: ${creditData.creditAvailable.toFixed(2)}, Requested: ${amount.toFixed(2)}`
        )
      }
      
      // Reuse the player loaded above for the credit-player guard.
      const player = depositingUser

      // ENFORCE WHITELABEL CREDIT: Deduct from whitelabel credit INSIDE transaction
      await whitelabelCreditService.deductCredit(
        tenant,
        amount,
        `Player deposit approved - Deposit Request #${id}`,
        tx, // Pass transaction to ensure atomicity
        player ? {
          userId: player.id,
          playerName: player.name || undefined,
          playerEmail: player.email || undefined,
          playerUsername: player.username || undefined,
        } : undefined
      )
    }
    
    // Credit the wallet (use same transaction for atomicity)
    const wallet = await adjustWalletDb(
      request.userId,
      amount,
      {
        type: 'deposit',
        depositRequestId: id,
        method: request.method,
        currency: request.currency,
      },
      tenant,
      tx // Pass transaction to ensure atomicity with whitelabel credit deduction
    )
    
    if (!wallet) {
      throw new Error('Wallet not found')
    }
    
    // Get the ledger entry ID that was just created
    const [ledgerEntry] = await tx.select()
      .from(ledgerEntries)
      .where(and(
        eq(ledgerEntries.tenant, tenant),
        eq(ledgerEntries.walletId, wallet.id),
        eq(ledgerEntries.type, 'credit')
      ))
      .orderBy(desc(ledgerEntries.createdAt))
      .limit(1)
    
    if (!ledgerEntry) {
      throw new Error('Failed to create ledger entry')
    }
    
    // Update the deposit request with balance information from ledger entry
    const [updated] = await tx.update(depositRequests)
      .set({
        status: 'APPROVED',
        reviewerId,
        reviewedAt: new Date(),
        note: note ?? null,
        walletTxnId: ledgerEntry.id,
        balanceBefore: ledgerEntry.balanceBefore,
        balanceAfter: ledgerEntry.balanceAfter,
        updatedAt: new Date(),
      })
      // Second line of defence, independent of the lock: the transition is only
      // valid from PENDING, and it is scoped to the tenant like every other
      // statement here. The bare `id` predicate would have re-approved an
      // already-approved row without complaint.
      .where(and(
        eq(depositRequests.id, id),
        eq(depositRequests.tenant, tenant),
        eq(depositRequests.status, 'PENDING')
      ))
      .returning()

    if (!updated) {
      throw new Error('Deposit request not found or already processed')
    }
    
    // Process post-approval bonus logic (non-blocking, async after transaction)
    // Bonus wallet credit only when user manually activates the bonus card (not on deposit approval).
    setImmediate(async () => {
      try {
        // Create deposit bonus awards only; user must activate on bonus page to get credit
        const { findEligibleCampaignsForDepositTriggers, awardBonus } = await import('@shared/services/bonusService.js')
        const campaigns = await findEligibleCampaignsForDepositTriggers(tenant)
        
        for (const campaign of campaigns) {
          const result = await awardBonus({
            userId: request.userId,
            tenant,
            campaignId: campaign.id,
            depositAmount: amount,
          })
          
          if (result.success) {
          }
        }
      } catch (error: any) {
      }
    })
    
    return updated as DepositRequestRow
  })
  const { vipIntegrationService } = await import('@src/services/vipIntegrationService.js')
  await vipIntegrationService.awardPointsFromDeposit(approved.userId, tenant, Number(approved.amount), approved.id)
  return approved
}

export async function rejectDepositRequest(
  id: number,
  tenant: string,
  reviewerId: number,
  note?: string | null
): Promise<DepositRequestRow> {
  const [updated] = await db.update(depositRequests)
    .set({
      status: 'REJECTED',
      reviewerId,
      reviewedAt: new Date(),
      note: note ?? null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(depositRequests.id, id),
      eq(depositRequests.tenant, tenant),
      eq(depositRequests.status, 'PENDING')
    ))
    .returning()
  
  if (!updated) {
    throw new Error('Deposit request not found or already processed')
  }
  
  return updated as DepositRequestRow
}

export async function cancelDepositRequest(
  id: number,
  tenant: string,
  userId: number
): Promise<DepositRequestRow> {
  const [updated] = await db.update(depositRequests)
    .set({
      status: 'CANCELLED',
      updatedAt: new Date(),
    })
    .where(and(
      eq(depositRequests.id, id),
      eq(depositRequests.tenant, tenant),
      eq(depositRequests.userId, userId),
      eq(depositRequests.status, 'PENDING')
    ))
    .returning()
  
  if (!updated) {
    throw new Error('Deposit request not found or already processed')
  }
  
  return updated as DepositRequestRow
}

