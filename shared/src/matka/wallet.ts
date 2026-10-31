import { and, eq, sql } from 'drizzle-orm'
import { ledgerEntries, users, wallets, walletLedger } from '../db/schema.js'
import type { SharedDb } from '../db/registry.js'
import { moneyDecimal, moneyMinor } from './rules.js'

export type MatkaWallet = 'cash' | 'bonus' | 'referralBonus' | 'credit'
export const creditPlayer = (type: string) => type === 'AGENT_CREDIT' || type === 'WHITELABEL_CREDIT'
const first = (result: any) => result?.rows?.[0] ?? result?.[0]

/** Called under the player row lock. Unlike the legacy best-effort writer,
 * ledger writes must succeed in the same transaction as the Matka movement. */
export async function recordMatkaMovement(tx: SharedDb, args: {
  tenant: string; userId: number; walletId: number; walletType: MatkaWallet; delta: bigint
  before: bigint; after: bigint; referenceId: string; category: string; description: string
}) {
  const { tenant, userId, walletId, walletType, delta, before, after, referenceId, category, description } = args
  if (after !== before + delta) throw new Error('Matka ledger arithmetic mismatch')
  const meta = { type: category, domain: 'matka', betId: referenceId, walletType, originalAmount: moneyDecimal(delta), description }
  await tx.insert(ledgerEntries).values({ tenant, walletId, type: delta < 0n ? 'debit' : 'credit', amount: moneyDecimal(delta), balanceBefore: moneyDecimal(before), balanceAfter: moneyDecimal(after), meta })
  await tx.insert(walletLedger).values({ tenant, userId, walletId, walletType: walletType === 'credit' ? 'cash' : walletType,
    category, direction: delta < 0n ? 'debit' : 'credit', amount: moneyDecimal(delta < 0n ? -delta : delta),
    balanceBefore: moneyDecimal(before), balanceAfter: moneyDecimal(after), description, referenceType: 'matka_bet', referenceId, meta })
}

export async function changeMatkaWallet(tx: SharedDb, args: {
  tenant: string; userId: number; walletType: Exclude<MatkaWallet, 'credit'>; delta: bigint
  referenceId: string; category: string; description: string
}) {
  if (!['cash', 'bonus', 'referralBonus'].includes(args.walletType)) throw new Error('Invalid Matka funding wallet')
  const [wallet] = await tx.select().from(wallets).where(and(eq(wallets.tenant, args.tenant), eq(wallets.userId, args.userId))).for('update').limit(1)
  if (!wallet) throw new Error('Wallet not found')
  const rawBefore = moneyMinor(wallet[args.walletType] || '0'), exposure = args.walletType === 'cash' ? moneyMinor(wallet.exposure || '0') : 0n
  const before = rawBefore - exposure, after = before + args.delta
  if (after < 0n) throw new Error(args.category === 'matka_result_reversal' ? 'Result cannot be rolled back: the paid funds are no longer available' : 'Insufficient available balance')
  await tx.update(wallets).set({ [args.walletType]: moneyDecimal(rawBefore + args.delta) }).where(and(eq(wallets.id, wallet.id), eq(wallets.tenant, args.tenant)))
  await recordMatkaMovement(tx, { ...args, walletId: wallet.id, before, after })
  return { balance: Number(moneyDecimal(after)), currency: wallet.currency }
}

/** Credit placement/settlement and rollback use the same existing domain invariant:
 * used = sports book + open casino + open Matka; settlement = sum(domain P/L).
 * Agent handed-down limits never increase when a player places a bet. */
export async function changeMatkaCredit(tx: SharedDb, args: {
  tenant: string; userId: number; exposureDelta: bigint; profitDelta: bigint
  referenceId: string; category: string; description: string; checkHeadroom?: boolean
}) {
  const { tenant, userId, exposureDelta, profitDelta } = args
  const [player] = await tx.select().from(users).where(and(eq(users.id, userId), eq(users.tenant, tenant))).for('update').limit(1)
  if (!player || !creditPlayer(player.playerType)) throw new Error('Credit player not found')
  if (player.playerType === 'AGENT_CREDIT' && !player.agentId) throw new Error('Credit agent is not configured for this account')
  const oldUsed = moneyMinor(player.creditUsed || '0'), used = oldUsed + exposureDelta
  if (used < 0n) throw new Error('Credit exposure does not reconcile with this Matka bet')
  const limit = moneyMinor(player.creditLimit || '0'), oldSettlement = moneyMinor(player.settlementBalance || '0')
  const beforeRaw = limit - oldUsed + oldSettlement, before = beforeRaw > 0n ? beforeRaw : 0n
  if (args.checkHeadroom && exposureDelta > beforeRaw) throw new Error('Insufficient available credit')
  const matkaProfit = moneyMinor(player.settlementBalanceMatka || '0') + profitDelta
  const settlement = moneyMinor(player.settlementBalanceSports || '0') + moneyMinor(player.settlementBalanceCasino || '0') + matkaProfit
  const rawAfter = limit - used + settlement, after = rawAfter > 0n ? rawAfter : 0n
  await tx.update(users).set({ creditUsed: moneyDecimal(used), creditAvailable: moneyDecimal(after), settlementBalanceMatka: moneyDecimal(matkaProfit), settlementBalance: moneyDecimal(settlement) }).where(and(eq(users.id, userId), eq(users.tenant, tenant)))
  const delta = moneyDecimal(profitDelta)
  if (player.agentId) {
    // The player's own agent is already tenant validated by the betting gate.
    await tx.execute(sql`UPDATE agents SET settlement_balance_matka=COALESCE(settlement_balance_matka,0)+${delta},
      settlement_balance=COALESCE(settlement_balance_sports,0)+COALESCE(settlement_balance_casino,0)+COALESCE(settlement_balance_matka,0)+${delta},
      credit_available=GREATEST(0,COALESCE(credit_limit,0)-COALESCE(credit_used,0)+COALESCE(settlement_balance_sports,0)+COALESCE(settlement_balance_casino,0)+COALESCE(settlement_balance_matka,0)+${delta})
      WHERE id=${player.agentId} AND tenant_id=${tenant}`)
    await tx.execute(sql`UPDATE agent_player_credits SET current_balance=COALESCE(current_balance,0)+${delta},
      credit_used=${moneyDecimal(used)},open_exposure=${moneyDecimal(used)},
      credit_available=GREATEST(0,COALESCE(credit_limit,0)-${moneyDecimal(used)}+COALESCE(current_balance,0)+${delta}),updated_at=now()
      WHERE agent_id=${player.agentId} AND player_id=${userId}`)
  } else if (player.playerType === 'WHITELABEL_CREDIT') {
    await tx.execute(sql`UPDATE whitelabels SET settlement_balance_matka=COALESCE(settlement_balance_matka,0)+${delta},
      settlement_balance=COALESCE(settlement_balance_sports,0)+COALESCE(settlement_balance_casino,0)+COALESCE(settlement_balance_matka,0)+${delta},
      credit_available=GREATEST(0,COALESCE(credit_limit,0)-COALESCE(credit_used,0)+COALESCE(settlement_balance_sports,0)+COALESCE(settlement_balance_casino,0)+COALESCE(settlement_balance_matka,0)+${delta}),updated_at=now()
      WHERE id=${tenant}`)
  }
  const [wallet] = await tx.select({ id: wallets.id, currency: wallets.currency }).from(wallets).where(and(eq(wallets.userId, userId), eq(wallets.tenant, tenant))).for('update').limit(1)
  if (!wallet) throw new Error('Wallet not found')
  await recordMatkaMovement(tx, { ...args, walletId: wallet.id, walletType: 'credit', delta: after - before, before, after })
  return { balance: Number(moneyDecimal(after)), currency: wallet.currency }
}

/** Include Matka whenever sports recomputes the player's total open credit. */
export async function getOpenMatkaCreditStake(tx: SharedDb, userId: number, tenant: string): Promise<number> {
  const result = await tx.execute(sql`SELECT COALESCE(SUM(bet_amount),0) amount FROM matka_bets
    WHERE user_id=${userId} AND tenant=${tenant} AND status IN ('pending','active') AND wallet_type='credit'`)
  return Number(first(result)?.amount || 0)
}
