import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm'
import { DateTime } from 'luxon'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { agents, appConfigs, depositRequests, users, vipMembersTable, vipTiersTable, welivepayOrders, whitelabelPaymentMethods, whitelabelPgSettings, whitelabels } from '../db/schema.js'
import { accountAllowsTier, defaultVipDepositPolicy, intersectDepositLimits, vipEligiblePlayer, type VipDepositMethod } from './depositPolicy.js'

export type VipDatabase = NodePgDatabase<any>

// The rule each backend's whitelabelConfig uses: the configured zone, else the
// base currency's zone, else UTC. VIP days and months must roll over with the rest.
const CURRENCY_TIME_ZONES: Record<string, string> = {
  INR: 'Asia/Kolkata', USD: 'America/New_York', EUR: 'Europe/Berlin', GBP: 'Europe/London', JPY: 'Asia/Tokyo',
  AUD: 'Australia/Sydney', CAD: 'America/Toronto', CHF: 'Europe/Zurich', CNY: 'Asia/Shanghai', AED: 'Asia/Dubai', BTC: 'UTC',
}
export const whitelabelTimeZone = (config?: { timeZone?: string | null; baseCurrency?: string | null } | null) =>
  config?.timeZone || CURRENCY_TIME_ZONES[config?.baseCurrency || 'INR'] || 'UTC'

export async function lockVipPlayer(tx: VipDatabase, tenant: string, userId: number) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`vip-player:${tenant}:${userId}`},0))`)
}

/** Authoritative, read-only effective tier. Qualification counts only approved
 * deposits requested after program activation, in the current tenant month.
 * Manual assignments remain fixed until an admin selects Automatic again. */
export async function getVipDepositContext(database: VipDatabase, tenant: string, userId: number, now = new Date(),
  options: { strictManual?: boolean } = {}) {
  const [row] = await database.select({ user: users, scheme: agents.schemeType }).from(users)
    .leftJoin(agents, and(eq(agents.id, users.agentId), eq(agents.tenantId, users.tenant)))
    .where(and(eq(users.id, userId), eq(users.tenant, tenant))).limit(1)
  if (!row) throw new Error('Player not found')
  if (row.user.agentId && !row.scheme) throw new Error('Player agent configuration is unavailable')
  if (!vipEligiblePlayer(row.user.playerType, row.scheme)) throw new Error('VIP tiers and deposits are unavailable for credit-agent players')
  const [brand] = await database.select().from(whitelabels).where(eq(whitelabels.id, tenant)).limit(1)
  if (!brand) throw new Error('Whitelabel not found')
  const [config] = await database.select().from(appConfigs).where(eq(appConfigs.whitelabelId, tenant)).limit(1)
  const zone = whitelabelTimeZone(config)
  const local = DateTime.fromJSDate(now).setZone(zone)
  if (!local.isValid) throw new Error('Invalid whitelabel timezone')
  const monthStart = local.startOf('month').toJSDate()
  const dayStart = local.startOf('day').toJSDate()
  const startsAt = brand.vipStartedAt
  const [sum] = await database.select({ value: sql<string>`COALESCE(SUM(${depositRequests.amount}),0)` }).from(depositRequests).where(and(
    eq(depositRequests.tenant, tenant), eq(depositRequests.userId, userId), eq(depositRequests.status, 'APPROVED'),
    gte(depositRequests.createdAt, startsAt),
    gte(sql`COALESCE(${depositRequests.reviewedAt},${depositRequests.createdAt})`, monthStart),
  ))
  const monthlyDeposits = Number(sum?.value || 0)
  const tiers = await database.select().from(vipTiersTable).where(and(eq(vipTiersTable.tenant, tenant), eq(vipTiersTable.status, 'active'))).orderBy(asc(vipTiersTable.level))
  const automatic = tiers.filter(tier => monthlyDeposits >= tier.minMonthlyDeposit).slice().reverse()[0] || tiers[0]
  const manual = row.user.vipTierMode === 'MANUAL' ? tiers.find(tier => tier.id === row.user.vipTierId) : undefined
  // A manual tier that was later deactivated or deleted must not block the
  // player's deposits: the automatic tier applies until an admin picks again.
  // Assignment is strict, so an inactive tier can never be chosen.
  const manualTierUnavailable = row.user.vipTierMode === 'MANUAL' && !manual
  if (manualTierUnavailable && options.strictManual) throw new Error('The selected VIP tier is not an active VIP tier of this whitelabel')
  const tier = manual || automatic
  if (!tier) throw new Error('No active VIP tier is available. Please contact support.')
  const policy = tier.depositPolicy || defaultVipDepositPolicy()

  // Count outstanding reservations as well as successful deposits. Successful
  // gateway orders already have a deposit_request and are not counted twice.
  const usage = await database.execute(sql`
    SELECT COALESCE(SUM(amount) FILTER(WHERE created_at>=${dayStart}),0)::text AS daily,
           COALESCE(SUM(amount) FILTER(WHERE created_at>=${monthStart}),0)::text AS monthly
    FROM (
      SELECT amount,created_at FROM deposit_requests WHERE tenant=${tenant} AND user_id=${userId}
        AND status IN ('PENDING','APPROVED') AND created_at>=${startsAt} AND created_at>=${monthStart}
      UNION ALL
      SELECT amount,created_at FROM welivepay_orders WHERE tenant=${tenant} AND user_id=${userId}
        AND status='pending' AND created_at>=${startsAt} AND created_at>=${monthStart}
    ) used`)
  const used = usage.rows[0] as { daily: string; monthly: string }
  const remainingDaily = policy.daily === null ? null : Math.max(0, Number((policy.daily - Number(used.daily)).toFixed(2)))
  const remainingMonthly = policy.monthly === null ? null : Math.max(0, Number((policy.monthly - Number(used.monthly)).toFixed(2)))
  const [payments] = await database.select().from(whitelabelPaymentMethods).where(eq(whitelabelPaymentMethods.tenant, tenant)).limit(1)
  const global = payments?.limits as { min?: number; max?: number } | undefined
  const baseLimits = intersectDepositLimits([
    { min: config?.depositMin == null ? null : Number(config.depositMin), max: config?.depositMax == null ? null : Number(config.depositMax) },
    global || {}, { min: policy.min, max: policy.max }, { max: remainingDaily }, { max: remainingMonthly },
  ])
  return { user: row.user, tier, tiers, policy, monthlyDeposits, startsAt, zone, dayStart, monthStart,
    remainingDaily, remainingMonthly, payments, baseLimits, manualTierUnavailable }
}

export type VipDepositContext = Awaited<ReturnType<typeof getVipDepositContext>>

/** Each player's approved deposits that count towards this whitelabel month's tier,
 * by the same rule as getVipDepositContext, in one query for a whole list. */
export async function monthlyQualifyingDeposits(database: VipDatabase, tenant: string, now = new Date()) {
  const totals = new Map<number, number>()
  const [brand] = await database.select({ startsAt: whitelabels.vipStartedAt }).from(whitelabels).where(eq(whitelabels.id, tenant)).limit(1)
  if (!brand) return totals
  const [config] = await database.select().from(appConfigs).where(eq(appConfigs.whitelabelId, tenant)).limit(1)
  const local = DateTime.fromJSDate(now).setZone(whitelabelTimeZone(config))
  if (!local.isValid) return totals
  const rows = await database.select({ userId: depositRequests.userId, total: sql<string>`SUM(${depositRequests.amount})` })
    .from(depositRequests).where(and(eq(depositRequests.tenant, tenant), eq(depositRequests.status, 'APPROVED'),
      gte(depositRequests.createdAt, brand.startsAt),
      gte(sql`COALESCE(${depositRequests.reviewedAt},${depositRequests.createdAt})`, local.startOf('month').toJSDate())))
    .groupBy(depositRequests.userId)
  for (const row of rows) totals.set(Number(row.userId), Number(row.total))
  return totals
}
export function normalizedReceivingAccounts(payments: VipDepositContext['payments']) {
  if (!payments) return []
  const banks: any[] = Array.isArray(payments.bankDetails) ? payments.bankDetails : payments.bankDetails ? [{ ...payments.bankDetails as object, id: `bank-legacy-${payments.id}` }] : []
  const upis: any[] = Array.isArray(payments.upiDetails) ? payments.upiDetails : payments.upiDetails ? [{ ...payments.upiDetails as object, id: `upi-legacy-${payments.id}` }] : []
  return [...banks.map(account => ({ ...account, type: 'bank' as const, method: 'BANK_TRANSFER' as const })),
    ...upis.map(account => ({ ...account, type: 'upi' as const, method: 'UPI' as const }))]
}

export function allowedReceivingAccounts(context: VipDepositContext) {
  if (!context.policy.enabled || context.user.status !== 'active') return []
  return normalizedReceivingAccounts(context.payments).filter(account => account.enabled !== false &&
    (!Array.isArray(context.payments?.enabledMethods) || !context.payments.enabledMethods.length || context.payments.enabledMethods.includes(account.method)) &&
    context.policy.methods.includes(account.method) && accountAllowsTier(account.vipTierIds, context.tier.id))
    .map(account => ({ ...account, limits: intersectDepositLimits([context.baseLimits, { min: account.minAmount, max: account.maxAmount }]) }))
    .filter(account => account.limits.available)
}

/** Caller must hold lockVipPlayer until its deposit/order insert commits. */
export async function assertVipDepositAllowed(database: VipDatabase, tenant: string, userId: number,
  input: { method: VipDepositMethod; amount: number; accountId?: string | null }) {
  if (!Number.isFinite(input.amount) || input.amount <= 0 || Math.abs(Math.round(input.amount * 100) / 100 - input.amount) > 0.000001)
    throw new Error('Enter a valid deposit amount with at most two decimal places')
  const context = await getVipDepositContext(database, tenant, userId)
  if (context.user.status !== 'active') throw new Error('Deposits are unavailable for this account')
  if (!context.policy.enabled || !context.policy.methods.includes(input.method)) throw new Error('This deposit method is unavailable for your VIP tier')
  let limits = context.baseLimits
  if (input.method !== 'GATEWAY') {
    if (!input.accountId) throw new Error('Choose a receiving account')
    const account = allowedReceivingAccounts(context).find(account => account.id === input.accountId && account.method === input.method)
    if (!account) throw new Error('This receiving account is unavailable for your VIP tier. Refresh deposit options.')
    limits = account.limits
  } else {
    const [gateway] = await database.select().from(whitelabelPgSettings).where(eq(whitelabelPgSettings.tenant, tenant)).limit(1)
    if (!gateway?.enabled || !gateway.secretSiteKeyEncrypted) throw new Error('Online payment is unavailable')
    limits = intersectDepositLimits([limits, { min: gateway.minDeposit == null ? 10 : Number(gateway.minDeposit), max: gateway.maxDeposit == null ? null : Number(gateway.maxDeposit) }])
  }
  if (!limits.available || input.amount < limits.min || input.amount > limits.max)
    throw new Error(`Allowed deposit amount is ${limits.min.toFixed(2)} to ${Math.max(0, limits.max).toFixed(2)}. Your tier and remaining daily/monthly limits apply.`)
  return { tierId: context.tier.id, tierName: context.tier.name, tierMode: context.user.vipTierMode,
    accountId: input.accountId ?? null, method: input.method, min: limits.min, max: limits.max,
    policy: context.policy, programStartedAt: context.startsAt.toISOString(), acceptedAt: new Date().toISOString() }
}

export async function validatePaymentAccountTiers(database: VipDatabase, tenant: string,
  accounts: Array<{ id?: string; minAmount?: number | null; maxAmount?: number | null; vipTierIds?: string[] | null }>) {
  const ids = accounts.map(account => account.id).filter(Boolean)
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate receiving account ID')
  const tierIds = [...new Set(accounts.flatMap(account => account.vipTierIds || []))]
  if (tierIds.length) {
    const existing = await database.select({ id: vipTiersTable.id }).from(vipTiersTable).where(and(eq(vipTiersTable.tenant, tenant), inArray(vipTiersTable.id, tierIds)))
    if (existing.length !== tierIds.length) throw new Error('A selected VIP tier does not belong to this whitelabel')
  }
  for (const account of accounts) {
    for (const value of [account.minAmount, account.maxAmount]) if (value != null && (!Number.isFinite(value) || value < 0)) throw new Error('Account limits cannot be negative')
    if (account.minAmount != null && account.maxAmount != null && account.minAmount > account.maxAmount) throw new Error('Account maximum must be at least its minimum')
  }
}
