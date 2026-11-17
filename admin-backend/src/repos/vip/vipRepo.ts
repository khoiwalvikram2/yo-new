import { vipEligiblePlayer } from '@shared/vip/depositPolicy.js'
import { changePlayerVipTier } from '@shared/vip/membership.js'
import { lockVipPlayer, monthlyQualifyingDeposits } from '@shared/vip/depositAccess.js'
import { db } from '@src/db/client.js'
import { vipTiersTable, vipTierBenefitsTable, vipTierPerksTable, vipAuditTable, vipMembersTable, vipMemberHistoryTable, vipTransactionsTable, users, agents, whitelabelPaymentMethods } from '@src/db/schema.js'
import { eq, asc, desc, inArray, and, gt, ne } from 'drizzle-orm'
import { listTiers } from '@src/stores/index.js'
import { accountAllowsTier, defaultVipDepositPolicy, type VipDepositPolicy } from '@shared/vip/depositPolicy.js'

/** Sets, from the tier form, which receiving accounts a tier may use. Accounts keep
 * their other tiers; an account open to every tier (null) that loses this one is
 * narrowed to all the other tiers, so nobody else loses it. */
async function applyTierAccountAccess(tx: any, tenant: string, tierId: string, accountIds: string[]) {
  const [payments] = await tx.select().from(whitelabelPaymentMethods)
    .where(eq(whitelabelPaymentMethods.tenant, tenant)).for('update').limit(1)
  const banks: any[] = Array.isArray(payments?.bankDetails) ? payments.bankDetails : []
  const upis: any[] = Array.isArray(payments?.upiDetails) ? payments.upiDetails : []
  const cryptos: any[] = Array.isArray(payments?.cryptoDetails) ? payments.cryptoDetails : []
  const known = new Set([...banks, ...upis, ...cryptos].map(account => account?.id).filter(Boolean))
  if (accountIds.some(id => !known.has(id))) throw new Error('A selected receiving account no longer exists. Reload the page and try again.')
  if (!payments) return
  const others: string[] = (await tx.select({ id: vipTiersTable.id }).from(vipTiersTable)
    .where(and(eq(vipTiersTable.tenant, tenant), ne(vipTiersTable.id, tierId)))).map((row: { id: string }) => row.id)
  const wanted = new Set(accountIds)
  const apply = (list: any[]) => list.map(account => {
    const allowed = accountAllowsTier(account.vipTierIds, tierId)
    if (wanted.has(account.id) === allowed) return account
    if (wanted.has(account.id)) return { ...account, vipTierIds: [...(account.vipTierIds || []), tierId] }
    return { ...account, vipTierIds: account.vipTierIds == null ? others : account.vipTierIds.filter((id: string) => id !== tierId) }
  })
  await tx.update(whitelabelPaymentMethods).set({
    bankDetails: Array.isArray(payments.bankDetails) ? apply(banks) : payments.bankDetails,
    upiDetails: Array.isArray(payments.upiDetails) ? apply(upis) : payments.upiDetails,
    cryptoDetails: Array.isArray(payments.cryptoDetails) ? apply(cryptos) : payments.cryptoDetails,
  }).where(eq(whitelabelPaymentMethods.id, payments.id))
}

export async function createVipTierDb(input: {
  tenant?: string
  name: string
  level: number
  minMonthlyDeposit: number
  color: string
  status: string
  depositPolicy?: VipDepositPolicy
  benefits: string[]
  perks: Array<{ name: string; description: string; icon?: string }>
  /** Receiving accounts the tier may use; null or absent leaves accounts as they are. */
  receivingAccountIds?: string[] | null
}) {
  return db.transaction(async tx => {
  const tenant = input.tenant || 'default'
  const [tier] = await tx.insert(vipTiersTable).values({
    tenant,
    name: input.name,
    level: input.level,
    minMonthlyDeposit: input.minMonthlyDeposit,
    color: input.color,
    status: input.status,
    depositPolicy: input.depositPolicy ?? defaultVipDepositPolicy(),
    createdAt: new Date(), updatedAt: new Date(),
  }).returning()

  if (!tier) return null
  if (input.benefits?.length) {
    await tx.insert(vipTierBenefitsTable).values(input.benefits.map((b) => ({ tierId: tier.id, benefit: b })))
  }
  if (input.perks?.length) {
    await tx.insert(vipTierPerksTable).values(input.perks.map((p) => ({ tierId: tier.id, name: p.name, description: p.description, icon: p.icon })))
  }
  if (input.receivingAccountIds) await applyTierAccountAccess(tx, tenant, tier.id, input.receivingAccountIds)
  return tier
  })
}

export async function updateVipTierDb(
  id: string,
  input: Partial<{ name: string; level: number; minMonthlyDeposit: number; color: string; status: string; benefits: string[]; perks: Array<{ name: string; description: string; icon?: string }>; depositPolicy: VipDepositPolicy; receivingAccountIds: string[] | null }>,
  tenant: string
) {
  if (input.status !== undefined && !VIP_TIER_STATUSES.includes(input.status)) throw new Error(`Unknown VIP tier status "${input.status}"`)
  return db.transaction(async tx => {
  if (input.status !== undefined && input.status !== 'active') await assertActiveTierRemains(tx, tenant, id)
  const [updated] = await tx
    .update(vipTiersTable)
    .set({
      name: input.name,
      level: input.level,
      minMonthlyDeposit: input.minMonthlyDeposit,
      color: input.color,
      status: input.status,
      depositPolicy: input.depositPolicy,
      updatedAt: new Date(),
    })
    .where(and(eq(vipTiersTable.id, id), eq(vipTiersTable.tenant, tenant)))
    .returning()

  if (!updated) return null
  if (input.benefits) {
    await tx.delete(vipTierBenefitsTable).where(eq(vipTierBenefitsTable.tierId, id))
    if (input.benefits.length) await tx.insert(vipTierBenefitsTable).values(input.benefits.map((b) => ({ tierId: id, benefit: b })))
  }
  if (input.perks) {
    await tx.delete(vipTierPerksTable).where(eq(vipTierPerksTable.tierId, id))
    if (input.perks.length) await tx.insert(vipTierPerksTable).values(input.perks.map((p) => ({ tierId: id, name: p.name, description: p.description, icon: p.icon })))
  }
  if (input.receivingAccountIds) await applyTierAccountAccess(tx, tenant, id, input.receivingAccountIds)
  return updated
  })
}

const VIP_TIER_STATUSES = ['active', 'inactive', 'draft']

/** Every deposit resolves a tier, so a whitelabel must keep one active tier.
 * Locks the whitelabel's tiers so two concurrent changes cannot both pass. */
async function assertActiveTierRemains(tx: any, tenant: string, id: string) {
  const rows: Array<{ id: string; status: string }> = await tx.select({ id: vipTiersTable.id, status: vipTiersTable.status })
    .from(vipTiersTable).where(eq(vipTiersTable.tenant, tenant)).for('update')
  const target = rows.find(row => row.id === id)
  if (target?.status === 'active' && !rows.some(row => row.id !== id && row.status === 'active'))
    throw new Error('At least one VIP tier must stay active, because deposits use it. Activate another tier first.')
}

export async function deleteVipTierDb(id: string, tenant: string) {
  return db.transaction(async tx => {
  const [exists] = await tx
    .select({ id: vipTiersTable.id })
    .from(vipTiersTable)
    .where(and(eq(vipTiersTable.id, id), eq(vipTiersTable.tenant, tenant)))
    .limit(1)
  if (!exists) return false
  await assertActiveTierRemains(tx, tenant, id)
  // Memberships and their history reference the tier, and that history must not be rewritten.
  const [member] = await tx.select({ id: vipMembersTable.id }).from(vipMembersTable).where(eq(vipMembersTable.tierId, id)).limit(1)
  const [history] = await tx.select({ id: vipMemberHistoryTable.id }).from(vipMemberHistoryTable).where(eq(vipMemberHistoryTable.toTierId, id)).limit(1)
  if (member || history) throw new Error('Players have been on this tier, so it cannot be deleted. Deactivate it instead; its players then use their automatic tier.')
  // Receiving accounts may name this tier. Drop the id so later account saves
  // still validate; an account that named only this tier stays restricted ([] = none).
  const [payments] = await tx.select().from(whitelabelPaymentMethods)
    .where(eq(whitelabelPaymentMethods.tenant, tenant)).for('update').limit(1)
  if (payments) {
    const strip = (list: unknown) => Array.isArray(list) ? list.map((account: any) =>
      Array.isArray(account?.vipTierIds) ? { ...account, vipTierIds: account.vipTierIds.filter((tierId: string) => tierId !== id) } : account) : list
    await tx.update(whitelabelPaymentMethods).set({ bankDetails: strip(payments.bankDetails), upiDetails: strip(payments.upiDetails), cryptoDetails: strip(payments.cryptoDetails) })
      .where(eq(whitelabelPaymentMethods.id, payments.id))
  }
  await tx.delete(vipTierBenefitsTable).where(eq(vipTierBenefitsTable.tierId, id))
  await tx.delete(vipTierPerksTable).where(eq(vipTierPerksTable.tierId, id))
  const res = await tx
    .delete(vipTiersTable)
    .where(and(eq(vipTiersTable.id, id), eq(vipTiersTable.tenant, tenant)))
    .returning({ id: vipTiersTable.id })
  return res.length > 0
  })
}

export async function addVipAuditDb(tenant: string, actor: string | undefined, action: string, tierId: string | undefined, message: string) {
  await db.insert(vipAuditTable).values({ tenant: tenant?.trim() || 'default', actor, action, tierId, message })
}

/**
 * Rows written before vip_audit had a tenant column are left null by the backfill
 * when their tier is gone, and an exact-match filter therefore omits them. That is
 * the intended trade: an unattributable audit row shown to nobody is better than one
 * shown to every whitelabel, which is what this query did before.
 */
export async function listVipAuditDb(tenant: string, limit?: number) {
  const tscope = tenant?.trim() || 'default'
  const rows = await db
    .select()
    .from(vipAuditTable)
    .where(eq(vipAuditTable.tenant, tscope))
    .orderBy(desc(vipAuditTable.at))
  const normalized = rows.map((r: any) => ({
    ...r,
    // Ensure ISO string for cross-browser reliability (Safari needs ISO 8601)
    at: r?.at instanceof Date ? r.at.toISOString() : String(r?.at ?? '')
  }))
  return limit ? normalized.slice(0, limit) : normalized
}

export async function listVipTiersDb(tenant: string) {
  const tiers = await db
    .select()
    .from(vipTiersTable)
    .where(eq(vipTiersTable.tenant, tenant))
    .orderBy(asc(vipTiersTable.level))
  if (!tiers.length) return []
  const ids = tiers.map(t => t.id)
  const benefits = await db.select().from(vipTierBenefitsTable).where(inArray(vipTierBenefitsTable.tierId, ids))
  const perks = await db.select().from(vipTierPerksTable).where(inArray(vipTierPerksTable.tierId, ids))
  const benefitsByTier = new Map<string, string[]>()
  for (const b of benefits) {
    const arr = benefitsByTier.get(b.tierId) || []
    arr.push(b.benefit)
    benefitsByTier.set(b.tierId, arr)
  }
  const perksByTier = new Map<string, Array<{ name: string; description: string; icon?: string }>>()
  for (const p of perks) {
    const arr = perksByTier.get(p.tierId) || []
    arr.push({ name: p.name, description: p.description, icon: p.icon || undefined })
    perksByTier.set(p.tierId, arr)
  }
  return tiers.map(t => ({ ...t, benefits: benefitsByTier.get(t.id) || [], perks: perksByTier.get(t.id) || [] }))
}

export async function getVipTierDb(id: string, tenant: string) {
  const rows = await db
    .select()
    .from(vipTiersTable)
    .where(and(eq(vipTiersTable.id, id), eq(vipTiersTable.tenant, tenant)))
  if (!rows.length) return null
  const tier = rows[0]
  const benefits = await db.select().from(vipTierBenefitsTable).where(eq(vipTierBenefitsTable.tierId, id))
  const perks = await db.select().from(vipTierPerksTable).where(eq(vipTierPerksTable.tierId, id))
  return {
    ...tier,
    benefits: benefits.map(b => b.benefit),
    perks: perks.map(p => ({ name: p.name, description: p.description, icon: p.icon || undefined }))
  }
}

/** Batch fetch VIP tier names by IDs. Returns Map<tierId, name>. Use for list pages to avoid N queries. */
export async function getVipTierNamesByIdsDb(ids: string[], tenant: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (!ids.length) return map
  const uniqueIds = [...new Set(ids)].filter(Boolean)
  if (!uniqueIds.length) return map
  const rows = await db
    .select({ id: vipTiersTable.id, name: vipTiersTable.name })
    .from(vipTiersTable)
    .where(and(inArray(vipTiersTable.id, uniqueIds), eq(vipTiersTable.tenant, tenant)))
  for (const r of rows) {
    if (r.name) map.set(r.id, r.name)
  }
  return map
}

export async function seedVipTiersFromStoreIfEmpty() {
  const existing = await db.select({ id: vipTiersTable.id }).from(vipTiersTable).limit(1)
  if (existing.length > 0) return false
  const tiers = listTiers()
  if (!tiers.length) return false
  for (const t of tiers) {
    const [inserted] = await db.insert(vipTiersTable).values({
      tenant: t.tenant || 'default',
      name: t.name,
      level: t.level,
      minMonthlyDeposit: t.minMonthlyDeposit,
      color: t.color,
      status: t.status || 'active',
    }).returning()
    if (inserted) {
      if (t.benefits?.length) {
        await db.insert(vipTierBenefitsTable).values(t.benefits.map(b => ({ tierId: inserted.id, benefit: b })))
      }
      if (t.perks?.length) {
        await db.insert(vipTierPerksTable).values(t.perks.map(p => ({ tierId: inserted.id, name: p.name, description: p.description, icon: p.icon })))
      }
    }
  }
  return true
}

// Members
export type VipMemberRow = typeof vipMembersTable.$inferSelect

export async function listVipMembersDb(filters?: { tierId?: string; status?: string; query?: string }, tenant?: string) {
  const tscope = tenant?.trim() || 'default'
  let rows = await db.select().from(vipMembersTable).where(eq(vipMembersTable.tenant, tscope))
  if (filters?.tierId) rows = rows.filter((m) => m.tierId === filters.tierId)
  if (filters?.status) rows = rows.filter((m) => m.status === filters.status)
  if (filters?.query) {
    const q = filters.query.toLowerCase()
    rows = rows.filter((m) => (m.userName?.toLowerCase().includes(q) || m.userEmail?.toLowerCase().includes(q) || m.userId?.toLowerCase().includes(q)))
  }
  const ordered = rows.sort((a, b) => b.currentPoints - a.currentPoints)
  return describeMembers(tscope, ordered)
}

/** The admin view of memberships. Tiers follow this month's approved deposits, not the
 * points balance, so the next tier and the gap to it come from those deposits; a
 * manually assigned player does not move with deposits and has no next tier. */
async function describeMembers(tenant: string, members: VipMemberRow[]) {
  if (!members.length) return []
  const tiers = await listVipTiersDb(tenant)
  const active = tiers.filter(t => t.status === 'active')
  const deposits = await monthlyQualifyingDeposits(db, tenant)
  const userIds = members.map(m => Number(m.userId)).filter(Number.isSafeInteger)
  const modes = new Map(userIds.length ? (await db.select({ id: users.id, mode: users.vipTierMode }).from(users)
    .where(and(eq(users.tenant, tenant), inArray(users.id, userIds)))).map(row => [row.id, row.mode]) : [])
  return members.map((m) => {
    const tier = tiers.find((t) => t.id === m.tierId)
    const monthlyDeposits = deposits.get(Number(m.userId)) ?? 0
    const nextTier = tier && modes.get(Number(m.userId)) !== 'MANUAL' ? active.find((t) => t.level > tier.level) : undefined
    return {
      id: m.id,
      tenant: m.tenant,
      userId: m.userId,
      userName: m.userName,
      userEmail: m.userEmail || undefined,
      tierId: m.tierId,
      tierName: tier?.name || '',
      tierLevel: tier?.level || 0,
      currentPoints: m.currentPoints,
      lifetimePoints: m.lifetimePoints,
      monthlyDeposits,
      nextTierId: nextTier?.id,
      nextTierName: nextTier?.name,
      // Approved deposits still needed this month (whole units, the schema field is an Int).
      pointsToNextTier: nextTier ? Math.max(0, Math.ceil(nextTier.minMonthlyDeposit - monthlyDeposits)) : undefined,
      joinedAt: m.joinedAt,
      lastActivityAt: m.lastActivityAt || undefined,
      status: m.status,
    }
  })
}

export async function getVipMemberDb(id: string, tenant: string) {
  const tscope = tenant?.trim() || 'default'
  const [m] = await db
    .select()
    .from(vipMembersTable)
    .where(and(eq(vipMembersTable.id, id), eq(vipMembersTable.tenant, tscope)))
    .limit(1)
  if (!m) return null
  return (await describeMembers(tscope, [m]))[0]
}

export async function getVipMemberByUserIdDb(userId: string, tenant?: string) {
  // Query directly from database for better performance
  const conditions = [eq(vipMembersTable.userId, userId)]
  if (tenant) {
    conditions.push(eq(vipMembersTable.tenant, tenant))
  }
  
  const [member] = await db
    .select()
    .from(vipMembersTable)
    .where(and(...conditions))
    .limit(1)
  
  if (!member) return null
  return (await describeMembers(member.tenant?.trim() || 'default', [member]))[0]
}

export async function ensureVipMember(userId: number, tenant: string, userName?: string, userEmail?: string | null): Promise<VipMemberRow> {
  const [owner] = await db.select({ type: users.playerType, scheme: agents.schemeType }).from(users)
    .leftJoin(agents, and(eq(agents.id, users.agentId), eq(agents.tenantId, users.tenant)))
    .where(and(eq(users.id, userId), eq(users.tenant, tenant))).limit(1)
  if (!owner) throw new Error('Player not found')
  if (!vipEligiblePlayer(owner.type, owner.scheme)) throw new Error('VIP tiers are unavailable for credit-agent players')
  const userIdStr = String(userId)
  
  // Check if member exists - query directly from database
  const [existing] = await db
    .select()
    .from(vipMembersTable)
    .where(and(eq(vipMembersTable.userId, userIdStr), eq(vipMembersTable.tenant, tenant)))
    .limit(1)
  
  if (existing) {
    return existing
  }

  // Get lowest tier (level 1)
  const tiers = await listVipTiersDb(tenant)
  const lowestTier = tiers.find((t) => t.level === 1) || tiers[0]

  if (!lowestTier) {
    throw new Error('No VIP tiers configured')
  }

  const [member] = await db
    .insert(vipMembersTable)
    .values({
      tenant,
      userId: userIdStr,
      userName: userName || 'User',
      userEmail: userEmail || null,
      tierId: lowestTier.id,
      currentPoints: 0,
      lifetimePoints: 0,
      status: 'active',
    })
    .returning()

  return member
}

export async function addVipPointsDb(tenant: string, memberId: string, points: number, description: string, relatedEntityType?: string, relatedEntityId?: string) {
  const tscope = tenant?.trim() || 'default'
  // Scoped on the way in rather than after the fact: this function moves a balance,
  // so a member id from another whitelabel must find nothing, not be corrected later.
  return withLockedMember(tscope, memberId, async (tx, m) => {
    const before = m.currentPoints
    const after = before + points
    // Returned rather than reconstructed: the caller needs the real id and createdAt,
    // and a hand-built object would be a second, drifting description of the same row.
    const [transaction] = await tx
      .insert(vipTransactionsTable)
      .values({ memberId, type: 'credit', points, description, balanceBefore: before, balanceAfter: after })
      .returning()
    await tx.update(vipMembersTable).set({ currentPoints: after, lifetimePoints: Math.max(m.lifetimePoints, after), lastActivityAt: new Date() }).where(and(eq(vipMembersTable.id, memberId), eq(vipMembersTable.tenant, tscope)))
    // Reward-point adjustments never override a manual tier or the program's
    // monthly-deposit qualification. Deposit approval uses the shared VIP hook.
    const [updated] = await tx.select().from(vipMembersTable).where(and(eq(vipMembersTable.id, memberId), eq(vipMembersTable.tenant, tscope)))
    return { member: updated, transaction }
  })
}

export async function removeVipPointsDb(tenant: string, memberId: string, points: number, description: string) {
  const tscope = tenant?.trim() || 'default'
  return withLockedMember(tscope, memberId, async (tx, m) => {
    const before = m.currentPoints
    const after = Math.max(0, before - points)
    const [transaction] = await tx
      .insert(vipTransactionsTable)
      .values({ memberId, type: 'debit', points, description, balanceBefore: before, balanceAfter: after })
      .returning()
    await tx.update(vipMembersTable).set({ currentPoints: after, lastActivityAt: new Date() }).where(and(eq(vipMembersTable.id, memberId), eq(vipMembersTable.tenant, tscope)))
    const [updated] = await tx.select().from(vipMembersTable).where(and(eq(vipMembersTable.id, memberId), eq(vipMembersTable.tenant, tscope)))
    return { member: updated, transaction }
  })
}

/** Runs a points change under the same player lock as the deposit award, so
 * neither one writes its balance over the other's. Null when the member is not
 * in this whitelabel. */
async function withLockedMember<T>(tenant: string, memberId: string,
  work: (tx: any, member: typeof vipMembersTable.$inferSelect) => Promise<T>): Promise<T | null> {
  const [found] = await db.select({ userId: vipMembersTable.userId }).from(vipMembersTable)
    .where(and(eq(vipMembersTable.id, memberId), eq(vipMembersTable.tenant, tenant)))
  if (!found) return null
  return db.transaction(async (tx) => {
    await lockVipPlayer(tx, tenant, Number(found.userId))
    const [m] = await tx.select().from(vipMembersTable)
      .where(and(eq(vipMembersTable.id, memberId), eq(vipMembersTable.tenant, tenant))).for('update')
    return m ? work(tx, m) : null
  })
}

/**
 * Manual edit of a membership.
 *
 * The resolver behind this used to call the in-memory store, so an operator's change
 * lived in one process and vanished on restart. A tier change writes a history row for
 * the same reason the automatic upgrade path does: the tier a player was on at a point
 * in time is a fact somebody will ask about later.
 */
export async function updateVipMemberDb(
  tenant: string,
  memberId: string,
  patch: { tierId?: string; currentPoints?: number; status?: string; reason?: string },
  actor = 'admin'
) {
  const tscope = tenant?.trim() || 'default'
  const [found] = await db
    .select({ userId: vipMembersTable.userId, tierId: vipMembersTable.tierId })
    .from(vipMembersTable)
    .where(and(eq(vipMembersTable.id, memberId), eq(vipMembersTable.tenant, tscope)))
  if (!found) return null

  if (patch.tierId && patch.tierId !== found.tierId) {
    // The tier has to belong to this whitelabel, checked before it is written.
    const target = await getVipTierDb(patch.tierId, tscope)
    if (!target) return null
  }

  // One transaction under the player lock: the tier, points and status land
  // together or not at all, and a deposit award cannot interleave with them.
  const saved = await db.transaction(async (tx) => {
    await lockVipPlayer(tx, tscope, Number(found.userId))
    const [m] = await tx.select().from(vipMembersTable)
      .where(and(eq(vipMembersTable.id, memberId), eq(vipMembersTable.tenant, tscope))).for('update')
    if (!m) return false
    const [owner] = await tx.select({ type: users.playerType, scheme: agents.schemeType }).from(users)
      .leftJoin(agents, and(eq(agents.id, users.agentId), eq(agents.tenantId, users.tenant)))
      .where(and(eq(users.id, Number(m.userId)), eq(users.tenant, tscope))).limit(1)
    if (!owner || !vipEligiblePlayer(owner.type, owner.scheme)) throw new Error('VIP tiers are unavailable for credit-agent players')
    if (patch.tierId) await changePlayerVipTier(tx, tscope, Number(m.userId), patch.tierId, actor, patch.reason)
    const values: Record<string, unknown> = { lastActivityAt: new Date() }
    if (patch.tierId !== undefined) values.tierId = patch.tierId
    if (patch.status !== undefined) values.status = patch.status
    if (patch.currentPoints !== undefined) {
      values.currentPoints = patch.currentPoints
      values.lifetimePoints = Math.max(m.lifetimePoints, patch.currentPoints)
    }
    await tx
      .update(vipMembersTable)
      .set(values)
      .where(and(eq(vipMembersTable.id, memberId), eq(vipMembersTable.tenant, tscope)))
    return true
  })

  return saved ? getVipMemberDb(memberId, tscope) : null
}

/**
 * vip_transactions and vip_member_history carry no tenant column of their own; they
 * are reachable only through vip_members, which does. Scoping therefore joins rather
 * than filtering, and the join is not optional: a member id is a bare uuid, so
 * without it any admin could read any whitelabel's points ledger by passing one.
 */
export async function listVipTransactionsDb(tenant: string, memberId: string, limit?: number) {
  const tscope = tenant?.trim() || 'default'
  const rows = await db
    .select({
      id: vipTransactionsTable.id,
      memberId: vipTransactionsTable.memberId,
      type: vipTransactionsTable.type,
      points: vipTransactionsTable.points,
      description: vipTransactionsTable.description,
      balanceBefore: vipTransactionsTable.balanceBefore,
      balanceAfter: vipTransactionsTable.balanceAfter,
      createdAt: vipTransactionsTable.createdAt,
    })
    .from(vipTransactionsTable)
    .innerJoin(vipMembersTable, eq(vipMembersTable.id, vipTransactionsTable.memberId))
    .where(and(eq(vipTransactionsTable.memberId, memberId), eq(vipMembersTable.tenant, tscope)))
    .orderBy(desc(vipTransactionsTable.createdAt))
  return limit ? rows.slice(0, limit) : rows
}

export async function listVipHistoryDb(tenant: string, memberId: string) {
  const tscope = tenant?.trim() || 'default'
  const rows = await db
    .select({
      id: vipMemberHistoryTable.id,
      memberId: vipMemberHistoryTable.memberId,
      fromTierId: vipMemberHistoryTable.fromTierId,
      toTierId: vipMemberHistoryTable.toTierId,
      reason: vipMemberHistoryTable.reason,
      pointsAtChange: vipMemberHistoryTable.pointsAtChange,
      createdAt: vipMemberHistoryTable.createdAt,
    })
    .from(vipMemberHistoryTable)
    .innerJoin(vipMembersTable, eq(vipMembersTable.id, vipMemberHistoryTable.memberId))
    .where(and(eq(vipMemberHistoryTable.memberId, memberId), eq(vipMembersTable.tenant, tscope)))
    .orderBy(desc(vipMemberHistoryTable.createdAt))
  // toTierName is non-null in both schemas that expose history. Inactive tiers keep
  // their names, and history pins its tiers, so none of them can be deleted.
  const names = new Map((await db.select({ id: vipTiersTable.id, name: vipTiersTable.name }).from(vipTiersTable)
    .where(eq(vipTiersTable.tenant, tscope))).map(tier => [tier.id, tier.name]))
  return rows.map(row => ({ ...row, tenant: tscope,
    fromTierName: row.fromTierId ? names.get(row.fromTierId) ?? null : null, toTierName: names.get(row.toTierId) ?? row.toTierId }))
}

const DEFAULT_TZ = 'Asia/Kolkata'
export async function getVipStatsDb(tenant: string) {
  const tscope = tenant?.trim() || 'default'
  const { getStartOfDay } = await import('@src/shared/dateUtils.js')
  const todayStart = getStartOfDay(DEFAULT_TZ)
  const members = await db.select().from(vipMembersTable).where(eq(vipMembersTable.tenant, tscope))
  const tiers = await listVipTiersDb(tscope)
  const total = members.length
  const active = members.filter((m) => m.status === 'active').length
  const newToday = members.filter((m) => (m.joinedAt as any) >= todayStart).length
  const totalPoints = members.reduce((sum, m) => sum + (m.lifetimePoints || 0), 0)
  const dist = tiers.map((t) => ({ tierId: t.id, tierName: t.name, tierLevel: t.level, memberCount: members.filter((m) => m.tierId === t.id).length }))
  const tierDistribution = dist.map((d) => ({ ...d, percentage: total ? (d.memberCount / total) * 100 : 0 })).sort((a, b) => b.tierLevel - a.tierLevel)
  // The full VIPMember shape: tierId is non-null in the schema and was missing here.
  const topMembers = await describeMembers(tscope, members.filter((m) => m.status === 'active').sort((a, b) => b.currentPoints - a.currentPoints).slice(0, 10))
  return { totalMembers: total, activeMembers: active, newMembersToday: newToday, totalPointsAwarded: totalPoints, tierDistribution, topMembers }
}

