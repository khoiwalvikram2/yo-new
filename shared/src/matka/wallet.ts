import { and, eq } from 'drizzle-orm'
import { ledgerEntries, wallets, walletLedger } from '../db/schema.js'
import type { SharedDb } from '../db/registry.js'
import { moneyDecimal, moneyMinor } from './rules.js'

/** The wallets a Matka stake is taken from. Credit players (AGENT_CREDIT, WHITELABEL_CREDIT) hold
 * their Deposit/Withdraw chips in wallets.cash and stake from 'cash' like every other player. */
export type MatkaWallet = 'cash' | 'bonus' | 'referralBonus'

/** The wallet a stored bet settles, refunds and reverses against. Bets placed before credit players
 * moved to chips carry the retired value 'credit'; they settle on cash, because migration 0019 took
 * every open credit stake off the player's opening chips, just as the cash path does at bet time. */
export function matkaFundingWallet(stored: string): MatkaWallet {
  if (stored === 'cash' || stored === 'credit') return 'cash'
  if (stored === 'bonus' || stored === 'referralBonus') return stored
  throw new Error('Invalid Matka funding wallet')
}

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
  await tx.insert(walletLedger).values({ tenant, userId, walletId, walletType,
    category, direction: delta < 0n ? 'debit' : 'credit', amount: moneyDecimal(delta < 0n ? -delta : delta),
    balanceBefore: moneyDecimal(before), balanceAfter: moneyDecimal(after), description, referenceType: 'matka_bet', referenceId, meta })
}

export async function changeMatkaWallet(tx: SharedDb, args: {
  tenant: string; userId: number; walletType: MatkaWallet; delta: bigint
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
