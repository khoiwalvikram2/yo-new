import { lockVipPlayer, assertVipDepositAllowed } from '@shared/vip/depositAccess.js'
import { assertPlayerCanFund } from '@shared/services/rgEnforcement.js'
import { db } from '@/db/client.js'
import { depositRequests, ledgerEntries, welivepayOrders } from '@/db/schema.js'
import { and, eq, ne, desc, gte, lte, lt, inArray, isNull, not, or, ilike, sql, count, getTableColumns, type AnyColumn, type SQL } from 'drizzle-orm'
import { PAYIN_LINK_TTL_MS } from '@shared/services/welivepay/welivepayClient.js'
import { adjustWalletDb } from '@src/repos/players/walletsRepo.js'

export type DepositRequestRow = {
  id: number
  tenant: string
  userId: number
  amount: string
  currency: string
  method: 'BANK_TRANSFER' | 'UPI' | 'CRYPTO'
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
  cryptoAmount: string | null
  cryptoRate: string | null
  cryptoNetwork: string | null
  cryptoBonusPercent: string | null
  cryptoBonusAmount: string | null
  bonusWalletTxnId: number | null
  createdAt: Date
  updatedAt: Date
  /** A screenshot or a link to show (DEPOSIT_REQUEST_FIELDS); the screenshot itself is read by getDepositRequestProof. */
  hasProof: boolean
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
  /** The screenshot as a data URI, written by the same insert (proof_key 'inline'); null or omitted for a sentinel. */
  proofData?: string | null
}

export type ListDepositRequestsFilter = {
  /** One request by its id (task links). An id that cannot be a request id matches nothing. */
  id?: number
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  userId?: number
  method?: 'BANK_TRANSFER' | 'UPI' | 'CRYPTO'
  /** GATEWAY: payment-gateway deposits only; MANUAL: player-submitted requests only. */
  source?: 'MANUAL' | 'GATEWAY'
  fromDate?: Date
  toDate?: Date
  query?: string
}

/** proof_key of the APPROVED deposit row the user backend creates when a WeLivePay pay-in is credited. */
export const GATEWAY_PROOF_KEY = 'welivepay'

export type WelivepayOrderRow = typeof welivepayOrders.$inferSelect

/**
 * Whether a stored proof value is one a page can show: an image (a data URI) or a link, never an S3 key or a sentinel.
 * The SQL twin of shared displayableAsset, which depositProofUrl applies. It compares only a value's first bytes, and
 * substr reads just that slice of a stored screenshot rather than the whole of it.
 */
function showableProofSql(column: AnyColumn): SQL<boolean> {
  return sql<boolean>`(CASE WHEN substr(${column}, 1, 5) = 'data:' THEN true
    WHEN substr(${column}, 1, 7) = 'http://' OR substr(${column}, 1, 8) = 'https://' THEN strpos(${column}, '.amazonaws.com/') = 0
    ELSE false END)`
}

const { proofData: _screenshot, ...depositRequestColumns } = getTableColumns(depositRequests)

/**
 * What a deposit request is read as: every column but proof_data, the screenshot itself (a base64 data URI of up to
 * 2 MB since S3 went, 2026-11-04), and whether the request has a proof to show. Every read and RETURNING here uses it,
 * so a list, an export or an approval never carries screenshots; getDepositRequestProof reads one when it is opened.
 */
export const DEPOSIT_REQUEST_FIELDS = {
  ...depositRequestColumns,
  hasProof: sql<boolean>`(${showableProofSql(depositRequests.proofData)} OR ${showableProofSql(depositRequests.proofKey)})`,
}

/** deposit_requests.id is an int4: anything else (NaN, 0, a fraction, past 2^31-1) would be a driver error, so it names no request. */
function isDepositRequestId(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647
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
    // In the same insert: a request is never left marked 'inline' without its screenshot.
    proofData: input.proofData ?? null,
    status: 'PENDING',
  }).returning(DEPOSIT_REQUEST_FIELDS)

  return row as DepositRequestRow
  })
}

export async function getDepositRequestById(id: number, tenant: string): Promise<DepositRequestRow | null> {
  const [row] = await db.select(DEPOSIT_REQUEST_FIELDS)
    .from(depositRequests)
    .where(and(eq(depositRequests.id, id), eq(depositRequests.tenant, tenant)))
    .limit(1)

  return (row as DepositRequestRow) || null
}

/**
 * One request's proof as stored (proof_key and proof_data), in its own tenant; null when the tenant has no such
 * request. The only read of proof_data: lists and exports carry DEPOSIT_REQUEST_FIELDS' hasProof instead.
 */
export async function getDepositRequestProof(id: number, tenant: string): Promise<{ proofKey: string; proofData: string | null } | null> {
  if (!isDepositRequestId(id)) return null
  const [row] = await db.select({ proofKey: depositRequests.proofKey, proofData: depositRequests.proofData })
    .from(depositRequests)
    .where(and(eq(depositRequests.id, id), eq(depositRequests.tenant, tenant)))
    .limit(1)
  return row ?? null
}

/** Whether a request of this tenant has a proof to show, without reading it; false when there is no such request. */
export async function depositRequestHasProof(id: number, tenant: string): Promise<boolean> {
  if (!isDepositRequestId(id)) return false
  const [row] = await db.select({ hasProof: DEPOSIT_REQUEST_FIELDS.hasProof })
    .from(depositRequests)
    .where(and(eq(depositRequests.id, id), eq(depositRequests.tenant, tenant)))
    .limit(1)
  return row?.hasProof === true
}

export async function listDepositRequests(
  filter: ListDepositRequestsFilter,
  tenant: string,
  options?: { offset?: number; limit?: number }
): Promise<{ items: DepositRequestRow[]; total: number }> {
  const whereClauses: any[] = [eq(depositRequests.tenant, tenant)]

  if (filter.id !== undefined) {
    // An id that cannot be a request id matches nothing, rather than reaching the driver.
    whereClauses.push(isDepositRequestId(filter.id) ? eq(depositRequests.id, filter.id) : sql`false`)
  }

  if (filter.status) {
    whereClauses.push(eq(depositRequests.status, filter.status))
  }
  
  if (filter.userId) {
    whereClauses.push(eq(depositRequests.userId, filter.userId))
  }
  
  if (filter.method) {
    whereClauses.push(eq(depositRequests.method, filter.method))
  }

  if (filter.source === 'GATEWAY') whereClauses.push(eq(depositRequests.proofKey, GATEWAY_PROOF_KEY))
  if (filter.source === 'MANUAL') whereClauses.push(ne(depositRequests.proofKey, GATEWAY_PROOF_KEY))

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
  const offset = options?.offset ?? 0
  const limit = options?.limit ?? 100

  // The total is counted in SQL, and the page carries no screenshots (DEPOSIT_REQUEST_FIELDS). Counting by loading
  // every matching row read every request's proof_data, on each 15 s poll of the deposit page.
  const [[counted], items] = await Promise.all([
    db.select({ value: count() }).from(depositRequests).where(whereClause),
    db.select(DEPOSIT_REQUEST_FIELDS)
      .from(depositRequests)
      .where(whereClause)
      .orderBy(desc(depositRequests.createdAt), desc(depositRequests.id))
      .limit(limit)
      .offset(offset),
  ])

  return {
    items: items as DepositRequestRow[],
    total: Number(counted?.value ?? 0),
  }
}

/** Status the admin and the player both see for a WeLivePay order: unpaid past the checkout link's life reads as expired. */
export function gatewayOrderStatus(order: WelivepayOrderRow): 'pending' | 'success' | 'expired' | 'invalid' {
  if (order.depositRequestId != null || order.status === 'success') return 'success'
  if (order.status === 'invalid') return 'invalid'
  if (order.status === 'pending' && order.createdAt.getTime() > Date.now() - PAYIN_LINK_TTL_MS) return 'pending'
  return 'expired'
}

/**
 * WeLivePay pay-ins not yet credited, filtered the way gatewayOrderStatus maps them (pending → PENDING,
 * expired/invalid → REJECTED). A credited pay-in is not here: its APPROVED deposit_requests row is.
 */
function uncreditedGatewayOrdersWhere(filter: ListDepositRequestsFilter, tenant: string): SQL | null {
  // An id names a deposit request; an uncredited pay-in is not one.
  if (filter.id !== undefined) return null
  if (filter.source === 'MANUAL' || (filter.method && filter.method !== 'UPI')) return null
  const linkExpired = lt(welivepayOrders.createdAt, new Date(Date.now() - PAYIN_LINK_TTL_MS))
  const clauses: (SQL | undefined)[] = [eq(welivepayOrders.tenant, tenant), isNull(welivepayOrders.depositRequestId)]
  if (!filter.status) clauses.push(inArray(welivepayOrders.status, ['pending', 'expired', 'invalid']))
  else if (filter.status === 'PENDING') clauses.push(eq(welivepayOrders.status, 'pending'), not(linkExpired))
  else if (filter.status === 'REJECTED') clauses.push(or(inArray(welivepayOrders.status, ['expired', 'invalid']), and(eq(welivepayOrders.status, 'pending'), linkExpired)))
  else return null
  if (filter.userId) clauses.push(eq(welivepayOrders.userId, filter.userId))
  if (filter.fromDate) clauses.push(gte(welivepayOrders.createdAt, filter.fromDate))
  if (filter.toDate) clauses.push(lte(welivepayOrders.createdAt, filter.toDate))
  if (filter.query) clauses.push(or(ilike(welivepayOrders.orderid, `%${filter.query}%`), ilike(welivepayOrders.txnRef, `%${filter.query}%`)))
  return and(...clauses) ?? null
}

export type DepositListEntry = { kind: 'request'; row: DepositRequestRow } | { kind: 'gatewayOrder'; row: WelivepayOrderRow }

/** Deposit requests plus uncredited gateway pay-ins, newest first, paged across both tables. */
export async function listDepositRequestsWithGatewayOrders(
  filter: ListDepositRequestsFilter,
  tenant: string,
  options?: { offset?: number; limit?: number }
): Promise<{ items: DepositListEntry[]; total: number }> {
  const offset = options?.offset ?? 0
  const limit = options?.limit ?? 100
  const ordersWhere = uncreditedGatewayOrdersWhere(filter, tenant)
  if (!ordersWhere) {
    const { items, total } = await listDepositRequests(filter, tenant, { offset, limit })
    return { items: items.map((row) => ({ kind: 'request', row })), total }
  }
  // A page of the merged list lies within the newest offset + limit rows of each table.
  const window = offset + limit
  const [requests, orders, [orderCount]] = await Promise.all([
    listDepositRequests(filter, tenant, { offset: 0, limit: window }),
    db.select().from(welivepayOrders).where(ordersWhere).orderBy(desc(welivepayOrders.createdAt)).limit(window),
    db.select({ value: count() }).from(welivepayOrders).where(ordersWhere),
  ])
  const merged: DepositListEntry[] = [
    ...requests.items.map((row) => ({ kind: 'request' as const, row })),
    ...orders.map((row) => ({ kind: 'gatewayOrder' as const, row })),
  ].sort((a, b) => b.row.createdAt.getTime() - a.row.createdAt.getTime())
  return { items: merged.slice(offset, window), total: requests.total + Number(orderCount?.value ?? 0) }
}

/** WeLivePay orders behind credited gateway deposit rows, keyed by deposit request id. */
export async function getGatewayOrdersByDepositId(depositIds: number[], tenant: string): Promise<Map<number, WelivepayOrderRow>> {
  if (!depositIds.length) return new Map()
  const rows = await db.select().from(welivepayOrders)
    .where(and(eq(welivepayOrders.tenant, tenant), inArray(welivepayOrders.depositRequestId, depositIds)))
  return new Map(rows.map((row) => [row.depositRequestId!, row]))
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

    // Get the deposit request and ensure it's PENDING (without its screenshot, which approving never reads)
    const [request] = await tx.select(DEPOSIT_REQUEST_FIELDS)
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
    // A crypto deposit's bonus, promised when the player made the request: paid into the cash wallet on top
    // of the deposit, as its own ledger entry, so deposit totals, VIP qualification and caps count the deposit alone.
    const bonus = request.method === 'CRYPTO' ? Math.max(0, Number(request.cryptoBonusAmount ?? 0) || 0) : 0

    // ENFORCE WHITELABEL CREDIT: Only enforce for whitelabels (not 'default' tenant)
    const isWhitelabel = tenant && tenant !== 'default'
    if (isWhitelabel) {
      const { WhitelabelCreditService } = await import('@src/domains/common/services/WhitelabelCreditService.js')
      const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js')
      const whitelabelCreditService = new WhitelabelCreditService(new WhitelabelCreditRepo())

      // Validate whitelabel has enough credit available (the bonus is chips in the wallet too)
      const hasCredit = await whitelabelCreditService.validateCreditAvailable(tenant, amount + bonus)
      if (!hasCredit) {
        const creditData = await whitelabelCreditService.getCreditAllocation(tenant)
        throw new Error(
          `Insufficient whitelabel credit. Available: ${creditData.creditAvailable.toFixed(2)}, Requested: ${(amount + bonus).toFixed(2)}`
        )
      }

      // Reuse the player loaded above for the credit-player guard.
      const player = depositingUser
      const playerInfo = player ? {
        userId: player.id,
        playerName: player.name || undefined,
        playerEmail: player.email || undefined,
        playerUsername: player.username || undefined,
      } : undefined

      // ENFORCE WHITELABEL CREDIT: Deduct from whitelabel credit INSIDE transaction
      await whitelabelCreditService.deductCredit(
        tenant,
        amount,
        `Player deposit approved - Deposit Request #${id}`,
        tx, // Pass transaction to ensure atomicity
        playerInfo
      )
      if (bonus > 0) {
        await whitelabelCreditService.deductCredit(
          tenant,
          bonus,
          `Crypto deposit bonus (${Number(request.cryptoBonusPercent ?? 0)}%) - Deposit Request #${id}`,
          tx,
          playerInfo
        )
      }
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

    let bonusWalletTxnId: number | null = null
    if (bonus > 0) {
      const bonusWallet = await adjustWalletDb(
        request.userId,
        bonus,
        {
          type: 'crypto_deposit_bonus',
          depositRequestId: id,
          method: request.method,
          currency: request.currency,
          bonusPercent: Number(request.cryptoBonusPercent ?? 0),
        },
        tenant,
        tx
      )
      if (!bonusWallet) {
        throw new Error('Wallet not found')
      }
      const [bonusEntry] = await tx.select({ id: ledgerEntries.id })
        .from(ledgerEntries)
        .where(and(
          eq(ledgerEntries.tenant, tenant),
          eq(ledgerEntries.walletId, bonusWallet.id),
          sql`${ledgerEntries.meta}->>'type' = 'crypto_deposit_bonus'`,
          sql`${ledgerEntries.meta}->>'depositRequestId' = ${String(id)}`
        ))
        .orderBy(desc(ledgerEntries.id))
        .limit(1)
      if (!bonusEntry) {
        throw new Error('Failed to create the bonus ledger entry')
      }
      bonusWalletTxnId = bonusEntry.id
    }

    // Update the deposit request with balance information from ledger entry
    const [updated] = await tx.update(depositRequests)
      .set({
        status: 'APPROVED',
        reviewerId,
        reviewedAt: new Date(),
        note: note ?? null,
        walletTxnId: ledgerEntry.id,
        bonusWalletTxnId,
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
      .returning(DEPOSIT_REQUEST_FIELDS)

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
    .returning(DEPOSIT_REQUEST_FIELDS)

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
    .returning(DEPOSIT_REQUEST_FIELDS)
  
  if (!updated) {
    throw new Error('Deposit request not found or already processed')
  }
  
  return updated as DepositRequestRow
}

