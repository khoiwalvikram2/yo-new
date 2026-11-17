import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { matkaActivityLogs, matkaBets, matkaResults, matkas, matkaWorliInstances, users } from '../db/schema.js'
import type { SharedDb } from '../db/registry.js'
import { evaluateMatkaSelection, matkaKind, moneyDecimal, moneyMinor, payoutMinor, validateMatkaResult, type MatkaSession } from './rules.js'
import { changeMatkaWallet, matkaFundingWallet } from './wallet.js'
import { updateMatkaBonusWagering } from './bonus.js'

export type MatkaImpact = { betsSettled: number; winners: number; totalPayout: number }
const emptyImpact = (): MatkaImpact => ({ betsSettled: 0, winners: 0, totalPayout: 0 })
export type MatkaOperator = { tenant: string; actorId: string; ip?: string; userAgent?: string }
export async function lockMatkaMarket(tx: SharedDb, tenant: string, marketId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`matka:${tenant}:${marketId}`},0))`)
  const [market] = await tx.select().from(matkas).where(and(eq(matkas.id, marketId), eq(matkas.tenant, tenant))).for('update').limit(1)
  if (!market) throw new Error('Matka market not found')
  return market as typeof matkas.$inferSelect
}
export function matkaBetDateScope(market: typeof matkas.$inferSelect, date: string) {
  return or(eq(matkaBets.runDate, date), and(isNull(matkaBets.runDate), sql`(${matkaBets.createdAt} AT TIME ZONE ${market.timezone})::date=${date}::date`))!
}
export async function refreshMatkaCounters(tx: SharedDb, marketId: string, date: string) {
  await tx.execute(sql`UPDATE matka_worli_instances i SET
    total_stake_minor=(SELECT COALESCE(SUM(b.bet_amount*100),0)::bigint FROM matka_bets b WHERE b.instance_id=i.id AND b.status NOT IN ('void','cancelled')),
    bet_count=(SELECT COUNT(*)::int FROM matka_bets b WHERE b.instance_id=i.id AND b.status NOT IN ('void','cancelled')),
    exposure_total_minor=(SELECT COALESCE(SUM(b.potential_win*100),0)::bigint FROM matka_bets b WHERE b.instance_id=i.id AND b.status IN ('pending','active')),updated_at=now()
    WHERE i.market_id=${marketId} AND i.run_date=${date}::date`)
}
async function invalidateMatkaSnapshots(tx: SharedDb, tenant: string, date: string) {
  // Include adjacent calendar days for overnight markets and reporting timezones.
  // A missing snapshot falls back to the live bet records until regeneration.
  await tx.execute(sql`DELETE FROM reporting_daily_snapshots WHERE tenant=${tenant} AND domain IN ('matka','global')
    AND snapshot_date>=${date}::date-interval '1 day' AND snapshot_date<${date}::date+interval '2 days'`)
}
function strictDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !DateTime.fromISO(date).isValid) throw new Error('Invalid result date')
}
function impactOf(bets: Array<typeof matkaBets.$inferSelect>): MatkaImpact {
  return { betsSettled: bets.length, winners: bets.filter(b => b.status === 'won').length, totalPayout: Number(moneyDecimal(bets.reduce((sum, bet) => sum + moneyMinor(bet.actualWin || '0'), 0n))) }
}

export async function declareAndSettleMatka(db: SharedDb, input: { matkaId: string; date: string; type: MatkaSession; result: string; idempotencyKey?: string }, operator: MatkaOperator) {
  strictDate(input.date)
  return db.transaction(async (tx: SharedDb) => {
    const market = await lockMatkaMarket(tx, operator.tenant, input.matkaId), kind = matkaKind(market.settings)
    if (input.date > DateTime.now().setZone(market.timezone).toISODate()!) throw new Error('Cannot declare a future result')
    const value = validateMatkaResult(kind, input.type, input.result)
    const [existing] = await tx.select().from(matkaResults).where(and(eq(matkaResults.tenant, operator.tenant), eq(matkaResults.matkaId, market.id), eq(matkaResults.date, input.date), eq(matkaResults.type, input.type))).for('update').limit(1)
    if (input.idempotencyKey) {
      const [sameKey] = await tx.select().from(matkaResults).where(and(eq(matkaResults.tenant, operator.tenant), eq(matkaResults.idempotencyKey, input.idempotencyKey))).limit(1)
      if (sameKey && (sameKey.matkaId !== input.matkaId || sameKey.date !== input.date || sameKey.type !== input.type || sameKey.result !== value || sameKey.rolledBackAt)) throw new Error('This result request key was already used. Refresh before declaring a new result.')
    }
    if (existing && !existing.rolledBackAt) {
      if (input.idempotencyKey && existing.idempotencyKey === input.idempotencyKey && existing.result === value) {
        const settled = await tx.select().from(matkaBets).where(and(eq(matkaBets.tenant, operator.tenant), eq(matkaBets.settlementResultId, existing.id), inArray(matkaBets.status, ['won', 'lost'])))
        return { ...existing, impact: impactOf(settled), settledBets: [], replayed: true }
      }
      throw new Error('A result is already declared for this session')
    }
    const [open] = input.type === 'close' && kind === 'worli' ? await tx.select().from(matkaResults).where(and(eq(matkaResults.tenant, operator.tenant), eq(matkaResults.matkaId, market.id), eq(matkaResults.date, input.date), eq(matkaResults.type, 'open'), isNull(matkaResults.rolledBackAt))).limit(1) : []
    if (input.type === 'close' && kind === 'worli' && !open) throw new Error('Declare the Open result before the Close result')
    const now = new Date(), values = { tenant: operator.tenant, matkaId: market.id, date: input.date, type: input.type, result: value, declaredBy: operator.actorId, declaredAt: now,
      idempotencyKey: input.idempotencyKey || null, declaredFromIp: operator.ip || null, declaredUserAgent: operator.userAgent || null, rolledBackAt: null, rolledBackBy: null, rollbackReason: null, rollbackTag: null }
    const [result] = existing ? await tx.update(matkaResults).set(values).where(eq(matkaResults.id, existing.id)).returning() : await tx.insert(matkaResults).values(values).returning()
    const bets: Array<typeof matkaBets.$inferSelect> = await tx.select().from(matkaBets).where(and(eq(matkaBets.tenant, operator.tenant), eq(matkaBets.matkaId, market.id), matkaBetDateScope(market, input.date), inArray(matkaBets.status, ['pending', 'active']))).orderBy(asc(matkaBets.userId), asc(matkaBets.id)).for('update')
    const impact = emptyImpact(), settled: Array<typeof matkaBets.$inferSelect> = []
    for (const bet of bets) {
      const won = evaluateMatkaSelection(bet, input.type, value, open?.result)
      if (won === null) continue
      await tx.select({ id: users.id }).from(users).where(and(eq(users.id, bet.userId), eq(users.tenant, operator.tenant))).for('update')
      const stake = moneyMinor(bet.betAmount), payout = won ? payoutMinor(stake, bet.payoutMultiplier) : 0n
      const movement = { tenant: operator.tenant, userId: bet.userId, referenceId: bet.id, category: 'matka_win', description: `Matka ${market.name}: ${won ? 'win' : 'loss'}` }
      // Every player, credit players included, settles on the wallet it staked from; a win pays the
      // gross return there. Nothing moves on the agent's or the whitelabel's balances.
      await changeMatkaWallet(tx, { ...movement, walletType: matkaFundingWallet(bet.walletType), delta: payout })
      const [updated] = await tx.update(matkaBets).set({ status: won ? 'won' : 'lost', actualWin: moneyDecimal(payout), result: value, settledAt: now, settlementResultId: result.id, updatedAt: now }).where(and(eq(matkaBets.id, bet.id), eq(matkaBets.tenant, operator.tenant))).returning()
      settled.push(updated); impact.betsSettled++; if (won) impact.winners++
    }
    // Update wagering only after every payout is posted, so a rollover release
    // cannot strand later winnings from the same settlement in the bonus wallet.
    for (const bet of settled) if (bet.walletType === 'bonus' && bet.bonusAwardId) await updateMatkaBonusWagering(tx, { tenant: operator.tenant, userId: bet.userId, awardId: bet.bonusAwardId, stake: moneyMinor(bet.betAmount) })
    impact.totalPayout = impactOf(settled).totalPayout
    await tx.update(matkaWorliInstances).set({ status: 'SETTLED', resultValue: value, resultPublishedAtUtc: now, resultActorId: operator.actorId, updatedAt: now }).where(and(eq(matkaWorliInstances.marketId, market.id), eq(matkaWorliInstances.runDate, input.date), eq(matkaWorliInstances.side, input.type === 'open' ? 'OPEN' : 'CLOSE')))
    await refreshMatkaCounters(tx, market.id, input.date)
    await invalidateMatkaSnapshots(tx, operator.tenant, input.date)
    return { ...result, impact, settledBets: settled, replayed: false }
  })
}

export async function reverseMatkaResult(db: SharedDb, input: { id: string; reason: string; tag?: string }, operator: MatkaOperator, windowMinutes = 60) {
  if (!input.reason.trim()) throw new Error('A rollback reason is required')
  return db.transaction(async (tx: SharedDb) => {
    const [lookup] = await tx.select().from(matkaResults).where(and(eq(matkaResults.id, input.id), eq(matkaResults.tenant, operator.tenant))).limit(1)
    if (!lookup) throw new Error('Result not found')
    const market = await lockMatkaMarket(tx, operator.tenant, lookup.matkaId)
    const [result] = await tx.select().from(matkaResults).where(eq(matkaResults.id, lookup.id)).for('update').limit(1)
    if (result.rolledBackAt) throw new Error('Result is already rolled back')
    const now = new Date()
    if (now.getTime() - result.declaredAt.getTime() > windowMinutes * 60000) throw new Error('Result rollback window expired')
    if (result.type === 'open') {
      const [close] = await tx.select({ id: matkaResults.id }).from(matkaResults).where(and(eq(matkaResults.tenant, operator.tenant), eq(matkaResults.matkaId, market.id), eq(matkaResults.date, result.date), eq(matkaResults.type, 'close'), isNull(matkaResults.rolledBackAt))).limit(1)
      if (close) throw new Error('Rollback the Close result before rolling back Open')
    }
    const bets: Array<typeof matkaBets.$inferSelect> = await tx.select().from(matkaBets).where(and(eq(matkaBets.tenant, operator.tenant), eq(matkaBets.settlementResultId, result.id), inArray(matkaBets.status, ['won', 'lost']))).orderBy(asc(matkaBets.userId), asc(matkaBets.id)).for('update')
    const impact = impactOf(bets)
    for (const bet of bets) {
      await tx.select({ id: users.id }).from(users).where(and(eq(users.id, bet.userId), eq(users.tenant, operator.tenant))).for('update')
      if (bet.walletType === 'bonus' && bet.bonusAwardId) await updateMatkaBonusWagering(tx, { tenant: operator.tenant, userId: bet.userId, awardId: bet.bonusAwardId, stake: moneyMinor(bet.betAmount), reverse: true })
      const stake = moneyMinor(bet.betAmount), payout = moneyMinor(bet.actualWin || '0'), movement = { tenant: operator.tenant, userId: bet.userId, referenceId: bet.id, category: 'matka_result_reversal', description: `Matka ${market.name}: result rollback` }
      await changeMatkaWallet(tx, { ...movement, walletType: matkaFundingWallet(bet.walletType), delta: -payout })
      await tx.update(matkaBets).set({ status: 'active', actualWin: null, result: null, settledAt: null, settlementResultId: null, updatedAt: now }).where(and(eq(matkaBets.id, bet.id), eq(matkaBets.tenant, operator.tenant)))
    }
    const [updated] = await tx.update(matkaResults).set({ rolledBackAt: now, rolledBackBy: operator.actorId, rollbackReason: input.reason, rollbackTag: input.tag || null }).where(eq(matkaResults.id, result.id)).returning()
    await tx.update(matkaWorliInstances).set({ status: 'LOCKED', resultValue: null, resultPublishedAtUtc: null, resultActorId: null, updatedAt: now }).where(and(eq(matkaWorliInstances.marketId, market.id), eq(matkaWorliInstances.runDate, result.date), eq(matkaWorliInstances.side, result.type === 'open' ? 'OPEN' : 'CLOSE')))
    await refreshMatkaCounters(tx, market.id, result.date)
    await invalidateMatkaSnapshots(tx, operator.tenant, result.date)
    return { ...updated, impact, revertedBets: bets, previousDeclaredAt: result.declaredAt }
  })
}

export async function voidAndRefundMatkaBet(db: SharedDb, id: string, reason: string, operator: MatkaOperator) {
  if (!reason.trim()) throw new Error('A void reason is required')
  return db.transaction(async (tx: SharedDb) => {
    const [lookup] = await tx.select().from(matkaBets).where(and(eq(matkaBets.id, id), eq(matkaBets.tenant, operator.tenant))).limit(1)
    if (!lookup) throw new Error('Bet not found')
    const market = await lockMatkaMarket(tx, operator.tenant, lookup.matkaId)
    const [bet] = await tx.select().from(matkaBets).where(eq(matkaBets.id, id)).for('update').limit(1)
    if (bet.status === 'void' || bet.status === 'cancelled') return bet
    if (!['pending', 'active'].includes(bet.status)) throw new Error('Rollback the settled result before voiding this bet')
    await tx.select({ id: users.id }).from(users).where(and(eq(users.id, bet.userId), eq(users.tenant, operator.tenant))).for('update')
    const stake = moneyMinor(bet.betAmount), movement = { tenant: operator.tenant, userId: bet.userId, referenceId: bet.id, category: 'matka_refund', description: `Matka ${market.name}: void refund` }
    await changeMatkaWallet(tx, { ...movement, walletType: matkaFundingWallet(bet.walletType), delta: stake })
    const [updated] = await tx.update(matkaBets).set({ status: 'void', actualWin: moneyDecimal(stake), result: 'VOID', settledAt: new Date(), updatedAt: new Date() }).where(eq(matkaBets.id, bet.id)).returning()
    if (bet.instanceId) await tx.insert(matkaActivityLogs).values({ instanceId: bet.instanceId, actorId: operator.actorId, action: 'VOID_BET', reason, metaJson: JSON.stringify({ betId: id }) })
    if (bet.runDate) await refreshMatkaCounters(tx, market.id, bet.runDate)
    return updated
  })
}
