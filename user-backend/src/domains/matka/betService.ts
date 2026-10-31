import { assertPlayerDomainBetting } from '@shared/access/playerDomains.js'
import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { appConfigs, matkaBetBatches, matkaBets, matkaBidRules, matkaResults, matkaWorliInstances, playerLimits, users, wallets } from '@shared/db/schema.js'
import { db } from '../../db/client.js'
import { assertPlayerCanStake } from '@shared/services/rgEnforcement.js'
import { assertPlayerAgentAllowsBetting } from '../userApp/services/agentBettingGate.js'
import { activeMatkaBonus } from '@shared/matka/bonus.js'
import { effectiveMatkaRates, ensureMatkaInstance, matkaRateFingerprint } from '@shared/matka/catalogue.js'
import { lockMatkaMarket, refreshMatkaCounters } from '@shared/matka/settlement.js'
import { cutoffSession, matkaKind, moneyDecimal, moneyMinor, normalizeBid, normalizeSelection, payoutMinor, settlementSession, type MatkaBid, type MatkaSession } from '@shared/matka/rules.js'
import { matkaSchedule } from '@shared/matka/schedule.js'
import { changeMatkaCredit, changeMatkaWallet, creditPlayer, type MatkaWallet } from '@shared/matka/wallet.js'

export type MatkaEntryInput = { bidType: string; selection: string; session: 'OPEN' | 'CLOSE'; amount: number }
export type PlaceMatkaInput = { marketId: string; runDate: string; requestKey: string; quoteVersion?: string; accountId?: string; walletType: 'CASH' | 'BONUS' | 'REFERRAL_BONUS'; entries: MatkaEntryInput[] }
const rows = (value: any): any[] => value?.rows ?? value ?? []

export function canonicalMatkaEntries(input: PlaceMatkaInput) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.marketId) || !/^[a-zA-Z0-9_-]{8,128}$/.test(input.requestKey)) throw new Error('Invalid market or request key')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.runDate) || !DateTime.fromISO(input.runDate).isValid) throw new Error('Invalid market date')
  if (!['CASH', 'BONUS', 'REFERRAL_BONUS'].includes(input.walletType)) throw new Error('Invalid wallet')
  if (!Array.isArray(input.entries) || input.entries.length < 1 || input.entries.length > 500) throw new Error('Submit between 1 and 500 entries')
  const combined = new Map<string, { bid: MatkaBid; selection: string; session: MatkaSession; stake: bigint }>()
  for (const entry of input.entries) {
    if (entry.session !== 'OPEN' && entry.session !== 'CLOSE') throw new Error('Invalid Matka session')
    const bid = normalizeBid(entry.bidType, entry.selection), selection = normalizeSelection(bid, entry.selection), stake = moneyMinor(entry.amount)
    if (stake <= 0n) throw new Error('Stake must be positive')
    const session = entry.session.toLowerCase() as MatkaSession, key = `${bid}:${session}:${selection}`, prior = combined.get(key)
    combined.set(key, { bid, selection, session, stake: stake + (prior?.stake || 0n) })
  }
  return [...combined.values()].sort((a, b) => `${a.bid}:${a.session}:${a.selection}`.localeCompare(`${b.bid}:${b.session}:${b.selection}`))
}
function fingerprint(input: PlaceMatkaInput, entries: ReturnType<typeof canonicalMatkaEntries>) {
  return createHash('sha256').update(JSON.stringify({ marketId: input.marketId, date: input.runDate, wallet: input.walletType, quoteVersion: input.quoteVersion || null, entries: entries.map(entry => ({ ...entry, stake: entry.stake.toString() })) })).digest('hex')
}
export async function placeMatkaEntries(userId: number, tenant: string, input: PlaceMatkaInput, executor: any = db) {
  if (input.accountId && input.accountId !== String(userId)) throw new Error('Account changed. Review your entries in the current account.')
  const entries = canonicalMatkaEntries(input), hash = fingerprint(input, entries), totalStake = entries.reduce((sum, entry) => sum + entry.stake, 0n)
  return executor.transaction(async (tx: any) => {
    // Replay an accepted request before checking gates which may have changed.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`matka-request:${tenant}:${userId}:${input.requestKey}`},0))`)
    const [prior] = await tx.select().from(matkaBetBatches).where(and(eq(matkaBetBatches.tenant, tenant), eq(matkaBetBatches.userId, userId), eq(matkaBetBatches.requestKey, input.requestKey))).limit(1)
    if (prior) {
      if (prior.fingerprint !== hash) throw new Error('This request key belongs to different entries')
      const bets = await tx.select().from(matkaBets).where(and(eq(matkaBets.batchId, prior.id), eq(matkaBets.tenant, tenant), eq(matkaBets.userId, userId)))
      return { batchId: prior.id, totalStake: Number(prior.totalStake), bets, replayed: true }
    }
    const market = await lockMatkaMarket(tx, tenant, input.marketId), now = new Date(), kind = matkaKind(market.settings)
    const [player] = await tx.select().from(users).where(and(eq(users.id, userId), eq(users.tenant, tenant))).for('update').limit(1)
    if (!player || player.status !== 'active') throw new Error('This account cannot place bets')
    if (player.requirePasswordReset) throw new Error('Change your password before placing a bet')
    if (!player.matkaVisible || !player.matkaBetAllowed) throw new Error('Matka betting is disabled for this account')
    await assertPlayerCanStake(tenant, userId, tx)
    await assertPlayerAgentAllowsBetting(tx, { userId, tenant }, 'matka')
    await assertPlayerDomainBetting(tx, tenant, userId, 'matka')
    const [config] = await tx.select().from(appConfigs).where(eq(appConfigs.whitelabelId, tenant)).limit(1)
    if (config?.matkaEnabled === false || config?.maintenance) throw new Error('Matka betting is unavailable')
    const [wallet] = await tx.select().from(wallets).where(and(eq(wallets.userId, userId), eq(wallets.tenant, tenant))).for('update').limit(1)
    if (!wallet) throw new Error('Wallet not found')
    const currency = wallet.currency
    if (config?.baseCurrency && currency !== config.baseCurrency) throw new Error('Wallet currency does not match this site')
    const walletType: MatkaWallet = creditPlayer(player.playerType) ? 'credit' : input.walletType === 'BONUS' ? 'bonus' : input.walletType === 'REFERRAL_BONUS' ? 'referralBonus' : 'cash'
    if (walletType === 'credit' && input.walletType !== 'CASH') throw new Error('Credit players use the main wallet')
    const base = matkaSchedule(market, now)
    if (base.runDate !== input.runDate) throw new Error('The market date changed. Refresh before placing entries.')
    const instances = await tx.select().from(matkaWorliInstances).where(and(eq(matkaWorliInstances.marketId, market.id), eq(matkaWorliInstances.runDate, base.runDate))).for('update')
    const results = await tx.select().from(matkaResults).where(and(eq(matkaResults.tenant, tenant), eq(matkaResults.matkaId, market.id), eq(matkaResults.date, base.runDate), isNull(matkaResults.rolledBackAt)))
    const published: Partial<Record<MatkaSession, string>> = {}
    for (const result of results) published[result.type as MatkaSession] = result.result
    const schedule = matkaSchedule(market, now, instances, published)
    if ((market.visibility as any)?.hidden) throw new Error('This Matka market is unavailable')
    const rates = await effectiveMatkaRates(tx, tenant, market.id, kind, now)
    if (input.quoteVersion && input.quoteVersion !== matkaRateFingerprint(rates)) throw new Error('Payout rates changed. Review the updated rates before confirming.')
    const [limits] = await tx.select().from(playerLimits).where(and(eq(playerLimits.userId, userId), eq(playerLimits.tenant, tenant))).limit(1)
    const settings = market.settings as any
    const tierLimits = player.vipTierId ? settings?.tierOverrides?.[player.vipTierId]?.limits : null
    const marketLimits = { ...(market.limits as any), ...(tierLimits || {}) }
    const minimum = moneyMinor(String(marketLimits?.minBet ?? '10')), maximum = moneyMinor(String(marketLimits?.maxBet ?? '10000'))
    const playerMaximum = limits?.maxBetMatka != null ? moneyMinor(limits.maxBetMatka) : null
    const ruleRows = await tx.select().from(matkaBidRules).where(and(eq(matkaBidRules.tenant, tenant), eq(matkaBidRules.matkaId, market.id), eq(matkaBidRules.status, 'active'),
      or(isNull(matkaBidRules.versionId), eq(matkaBidRules.isActive, true)), or(isNull(matkaBidRules.validFrom), lte(matkaBidRules.validFrom, now)),
      or(isNull(matkaBidRules.validTo), sql`${matkaBidRules.validTo}>${now}`))).orderBy(desc(matkaBidRules.priority), desc(matkaBidRules.percentage))
    const priorSelections = await tx.select().from(matkaBets).where(and(eq(matkaBets.tenant, tenant), eq(matkaBets.userId, userId), eq(matkaBets.matkaId, market.id), eq(matkaBets.runDate, schedule.runDate), inArray(matkaBets.status, ['pending', 'active', 'won', 'lost'])))
    const bonus = walletType === 'bonus' ? await activeMatkaBonus(tx, tenant, userId, market.id) : null
    const prepared = []
    for (const entry of entries) {
      const cutoff = cutoffSession(entry.bid, kind, entry.session), session = settlementSession(entry.bid, kind, entry.session)
      if (session !== entry.session) throw new Error('Invalid session for this game type')
      if (!schedule[cutoff].accepting || published[session]) throw new Error(`${cutoff === 'open' ? 'Open' : 'Close'} betting is closed for these entries`)
      const rate = rates.find(rate => rate.bidType === entry.bid)
      if (!rate) throw new Error(`Payout rate is not configured for ${entry.bid}`)
      const rule = ruleRows.find((rule: any) => {
        let type: MatkaBid; try { type = normalizeBid(rule.bidType) } catch { return false }
        const included = rule.includedPlayers?.playerIds || []
        return type === entry.bid && (!rule.marketSession || rule.marketSession.toLowerCase() === session) && (rule.includeAll || included.map(String).includes(String(userId)))
      })
      const min = rule?.minStake != null && moneyMinor(rule.minStake) > minimum ? moneyMinor(rule.minStake) : minimum
      let max = rule?.maxStake != null && moneyMinor(rule.maxStake) < maximum ? moneyMinor(rule.maxStake) : maximum
      if (playerMaximum != null && playerMaximum < max) max = playerMaximum
      const existing = priorSelections.filter((bet: any) => bet.bidType === entry.bid && bet.marketSession === session && bet.betNumbers === entry.selection).reduce((sum: bigint, bet: any) => sum + moneyMinor(bet.betAmount), 0n)
      if (entry.stake < min || entry.stake + existing > max) throw new Error(`Entry amount must be ${moneyDecimal(min)}–${moneyDecimal(max)} per number, including existing entries`)
      const group = entries.filter(item => item.bid === entry.bid && settlementSession(item.bid, kind, item.session) === session)
      if (rule) {
        const familySize = ({ SINGLE: 10, JODI: 100, SINGLE_PANNA: 120, DOUBLE_PANNA: 90, TRIPLE_PANNA: 10, HALF_SANGAM: 4400, FULL_SANGAM: 48400, AB: 100, A: 10, B: 10 } as const)[entry.bid]
        const selected = new Set([...priorSelections.filter((bet: any) => bet.bidType === entry.bid && bet.marketSession === session).map((bet: any) => bet.betNumbers), ...group.map(item => item.selection)])
        if (selected.size > Math.floor(familySize * Number(rule.percentage) / 100)) throw new Error('The selected numbers exceed the configured bid-percentage limit')
      }
      prepared.push({ ...entry, session, payout: payoutMinor(entry.stake, rate.payoutMultiplier), rate, rule })
    }
    const accountZone = config?.timeZone || market.timezone, local = DateTime.fromJSDate(now, { zone: accountZone })
    if (limits?.dailyStakeLimit != null || limits?.weeklyStakeLimit != null || Number(limits?.cooldownSeconds || 0) > 0) {
      const totals = rows(await tx.execute(sql`WITH all_stakes AS (
        SELECT stake AS amount,created_at FROM sports_bets WHERE tenant=${tenant} AND user_id=${userId} AND status::text NOT IN ('void','cancelled')
        UNION ALL SELECT stake,created_at FROM casino_bets WHERE tenant=${tenant} AND user_id=${userId} AND status::text NOT IN ('void','cancelled')
        UNION ALL SELECT bet_amount,created_at FROM matka_bets WHERE tenant=${tenant} AND user_id=${userId} AND status::text NOT IN ('void','cancelled')
      ) SELECT COALESCE(SUM(amount) FILTER(WHERE created_at>=${local.startOf('day').toJSDate()}),0) daily,
        COALESCE(SUM(amount) FILTER(WHERE created_at>=${local.startOf('week').toJSDate()}),0) weekly,MAX(created_at) latest FROM all_stakes`))[0]
      if (limits.dailyStakeLimit != null && moneyMinor(totals.daily) + totalStake > moneyMinor(limits.dailyStakeLimit)) throw new Error('Daily stake limit exceeded')
      if (limits.weeklyStakeLimit != null && moneyMinor(totals.weekly) + totalStake > moneyMinor(limits.weeklyStakeLimit)) throw new Error('Weekly stake limit exceeded')
      if (totals.latest && now.getTime() - new Date(totals.latest).getTime() < Number(limits.cooldownSeconds || 0) * 1000) throw new Error('Please wait before placing another entry')
    }
    const [exposure] = rows(await tx.execute(sql`SELECT COALESCE(SUM(potential_win),0) amount FROM matka_bets WHERE tenant=${tenant} AND matka_id=${market.id} AND run_date=${schedule.runDate}::date AND status IN ('pending','active')`))
    const projected = moneyMinor(exposure?.amount || '0') + prepared.reduce((sum, entry) => sum + entry.payout, 0n)
    const caps = [marketLimits?.exposureCap, marketLimits?.exposureLimit, settings?.autoPauseOnLiabilityThreshold, ...prepared.map(entry => entry.rule?.exposureCap)].filter(value => value != null && Number(value) > 0)
    if (caps.some(cap => projected > moneyMinor(String(cap)))) throw new Error('Market liability limit reached')
    if (marketLimits.exposureDaily || marketLimits.exposureWeekly) {
      const [periods] = rows(await tx.execute(sql`SELECT
        COALESCE(SUM(potential_win) FILTER(WHERE created_at>=${local.startOf('day').toJSDate()}),0) daily,
        COALESCE(SUM(potential_win) FILTER(WHERE created_at>=${local.startOf('week').toJSDate()}),0) weekly
        FROM matka_bets WHERE tenant=${tenant} AND matka_id=${market.id} AND status IN ('pending','active')`))
      const added = prepared.reduce((sum, entry) => sum + entry.payout, 0n)
      if (Number(marketLimits.exposureDaily) > 0 && moneyMinor(periods.daily) + added > moneyMinor(marketLimits.exposureDaily)) throw new Error('Daily market exposure limit reached')
      if (Number(marketLimits.exposureWeekly) > 0 && moneyMinor(periods.weekly) + added > moneyMinor(marketLimits.exposureWeekly)) throw new Error('Weekly market exposure limit reached')
    }
    const finalSchedule = matkaSchedule(market, new Date(), instances, published)
    if (finalSchedule.runDate !== schedule.runDate || prepared.some(entry => !finalSchedule[cutoffSession(entry.bid, kind, entry.session)].accepting)) throw new Error('Betting closed while your entries were being checked. Refresh the market.')
    const batchId = randomUUID()
    await tx.insert(matkaBetBatches).values({ id: batchId, tenant, userId, matkaId: market.id, requestKey: input.requestKey, fingerprint: hash, walletType, totalStake: moneyDecimal(totalStake), runDate: schedule.runDate })
    let balance = 0
    const accepted = []
    for (const entry of prepared) {
      const instance = await ensureMatkaInstance(tx, market, schedule, entry.session, entry.rule?.versionId), id = randomUUID()
      const movement = { tenant, userId, referenceId: id, category: 'matka_bet', description: `Matka ${market.name}: ${entry.bid} ${entry.selection}` }
      const changed = walletType === 'credit' ? await changeMatkaCredit(tx, { ...movement, exposureDelta: entry.stake, profitDelta: 0n, checkHeadroom: true }) : await changeMatkaWallet(tx, { ...movement, walletType, delta: -entry.stake })
      balance = changed.balance
      const [bet] = await tx.insert(matkaBets).values({ id, tenant, whitelabelId: tenant, userId, matkaId: market.id, matkaType: kind, marketName: market.name, marketSession: entry.session,
        bidType: entry.bid, betNumbers: entry.selection, betAmount: moneyDecimal(entry.stake), payoutMultiplier: entry.rate.payoutMultiplier, potentialWin: moneyDecimal(entry.payout),
        status: 'active', currency, instanceId: instance.id, side: entry.session === 'open' ? 'OPEN' : 'CLOSE', selectionKey: entry.selection,
        selectionJson: { selection: entry.selection, bidType: entry.bid, cutoffSide: cutoffSession(entry.bid, kind, entry.session), rateVersionId: entry.rate.versionId }, rulesVersionId: entry.rule?.versionId || null,
        batchId, walletType, runDate: schedule.runDate, bonusAwardId: bonus?.award.id || null,
      }).returning()
      accepted.push(bet)
    }
    await refreshMatkaCounters(tx, market.id, schedule.runDate)
    return { batchId, totalStake: Number(moneyDecimal(totalStake)), balance, bets: accepted, replayed: false }
  })
}
