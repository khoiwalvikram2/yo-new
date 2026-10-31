import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/db/client.js'
import { matkaBets, matkaResults } from '@shared/db/schema.js'
import { getMatkaDb } from '@/repos/matka/matkaRepo.js'
import { evaluateMatkaSelection, moneyDecimal, moneyMinor, payoutMinor } from '@shared/matka/rules.js'
import { matkaBetDateScope, type MatkaImpact } from '@shared/matka/settlement.js'
export type MatkaResultImpact = MatkaImpact

export async function calculateSettlementImpact(matkaId: string, date: string, type: 'open' | 'close', result: string, tenant = 'default'): Promise<MatkaResultImpact> {
  const market = await getMatkaDb(matkaId, tenant)
  if (!market) throw new Error('Matka market not found')
  const [open] = await db.select().from(matkaResults).where(and(eq(matkaResults.tenant, tenant), eq(matkaResults.matkaId, matkaId), eq(matkaResults.date, date), eq(matkaResults.type, 'open'), isNull(matkaResults.rolledBackAt))).limit(1)
  const bets = await db.select().from(matkaBets).where(and(eq(matkaBets.tenant, tenant), eq(matkaBets.matkaId, matkaId), matkaBetDateScope(market, date), inArray(matkaBets.status, ['active', 'pending'])))
  let betsSettled = 0, winners = 0, payout = 0n
  for (const bet of bets) {
    const won = evaluateMatkaSelection(bet, type, result, open?.result)
    if (won === null) continue
    betsSettled++
    if (won) { winners++; payout += payoutMinor(moneyMinor(bet.betAmount), bet.payoutMultiplier) }
  }
  return { betsSettled, winners, totalPayout: Number(moneyDecimal(payout)) }
}
export async function calculateRollbackImpact(resultId: string, tenant = 'default'): Promise<MatkaResultImpact> {
  const bets = await db.select().from(matkaBets).where(and(eq(matkaBets.tenant, tenant), eq(matkaBets.settlementResultId, resultId), inArray(matkaBets.status, ['won', 'lost'])))
  return { betsSettled: bets.length, winners: bets.filter(bet => bet.status === 'won').length, totalPayout: Number(moneyDecimal(bets.reduce((sum, bet) => sum + moneyMinor(bet.actualWin || '0'), 0n))) }
}
