import { getMatkaDb } from '@src/repos/matka/matkaRepo.js'
import { matkaKind, resultDigit, validateMatkaResult, type MatkaKind, type MatkaSession } from '@shared/matka/rules.js'

export type MatkaResultType = MatkaSession
export type MatkaMarketType = MatkaKind
export interface ResultValidationResult {
  valid: boolean
  error?: string
  derivedValues?: { avDigit?: string; jodi?: string; panna?: string }
}
export async function validateResultForMarket(matkaId: string, type: MatkaResultType, value: string, tenant = 'default'): Promise<ResultValidationResult> {
  try {
    const market = await getMatkaDb(matkaId, tenant)
    if (!market) return { valid: false, error: 'Matka market not found' }
    const kind = matkaKind(market.settings), result = validateMatkaResult(kind, type, value)
    return { valid: true, derivedValues: result.length === 3 ? { avDigit: resultDigit(result), panna: result } : { jodi: result } }
  } catch (error) { return { valid: false, error: error instanceof Error ? error.message : 'Invalid result' } }
}
export async function getExpectedFormat(matkaId: string, _type: MatkaResultType, tenant = 'default'): Promise<string> {
  const market = await getMatkaDb(matkaId, tenant)
  if (!market) throw new Error('Matka market not found')
  return ['jackpot', 'sattaMatka'].includes(matkaKind(market.settings)) ? 'Two digits (00-99)' : 'Three-digit Pana in 1-9,0 order; digit = sum modulo 10'
}
export const validateResultStrict = validateResultForMarket
