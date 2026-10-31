/** Rules shared by player entry, operator results, settlement and charts. */
export type MatkaKind = 'worli' | 'starline' | 'jackpot' | 'sattaMatka'
export type MatkaSession = 'open' | 'close'
export type MatkaBid = 'SINGLE' | 'JODI' | 'SINGLE_PANNA' | 'DOUBLE_PANNA' | 'TRIPLE_PANNA' | 'HALF_SANGAM' | 'FULL_SANGAM' | 'AB' | 'A' | 'B'
export const BID_LABELS: Record<MatkaBid, string> = {
  SINGLE: 'Single Digit', JODI: 'Jodi', SINGLE_PANNA: 'Single Pana', DOUBLE_PANNA: 'Double Pana',
  TRIPLE_PANNA: 'Triple Pana', HALF_SANGAM: 'Half Sangam', FULL_SANGAM: 'Full Sangam', AB: 'AB', A: 'A', B: 'B',
}
const order = '1234567890'

export function moneyMinor(value: string | number): bigint {
  const raw = String(value).trim()
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error('Amount must have at most two decimal places')
  const negative = raw.startsWith('-'), [whole, fraction = ''] = raw.replace(/^-/, '').split('.')
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount is too large')
  return negative ? -amount : amount
}
export function moneyDecimal(minor: bigint): string {
  const positive = minor < 0n ? -minor : minor
  return `${minor < 0n ? '-' : ''}${positive / 100n}.${String(positive % 100n).padStart(2, '0')}`
}
export function payoutMinor(stake: bigint, multiplier: string | number): bigint {
  const raw = String(multiplier)
  if (!/^\d+(?:\.\d{1,4})?$/.test(raw)) throw new Error('Invalid payout multiplier')
  const [whole, fraction = ''] = raw.split('.')
  const rate = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'))
  if (rate <= 0n) throw new Error('Payout multiplier must be positive')
  const payout = (stake * rate + 5000n) / 10000n
  if (payout > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Payout is too large')
  return payout
}
export function matkaKind(settings: unknown): MatkaKind {
  const value = String((settings as Record<string, unknown> | null)?.matkaType || 'worli').toLowerCase()
  if (value === 'sattamatka' || value === 'satta_matka') return 'sattaMatka'
  if (value === 'worli' || value === 'starline' || value === 'jackpot') return value
  throw new Error('Unknown Matka market type')
}
export function pannaType(value: string): MatkaBid | null {
  if (!/^\d{3}$/.test(value) || [...value].some((digit, i) => i > 0 && order.indexOf(digit) < order.indexOf(value[i - 1]))) return null
  return ({ 1: 'TRIPLE_PANNA', 2: 'DOUBLE_PANNA', 3: 'SINGLE_PANNA' } as const)[new Set(value).size as 1 | 2 | 3]
}
export function normalizeBid(value: string, selection?: string): MatkaBid {
  const key = value.trim().toUpperCase().replace(/[\s,/-]+/g, '_').replace(/_BULK$/, '')
  const aliases: Record<string, MatkaBid> = {
    SINGLE: 'SINGLE', SINGLE_DIGIT: 'SINGLE', JODI: 'JODI', JODI_DIGITS: 'JODI',
    SP: 'SINGLE_PANNA', SP_MOTOR: 'SINGLE_PANNA', SINGLE_PATTI: 'SINGLE_PANNA', SINGLE_PANA: 'SINGLE_PANNA', SINGLE_PANNA: 'SINGLE_PANNA',
    DP: 'DOUBLE_PANNA', DP_MOTOR: 'DOUBLE_PANNA', DOUBLE_PATTI: 'DOUBLE_PANNA', DOUBLE_PANA: 'DOUBLE_PANNA', DOUBLE_PANNA: 'DOUBLE_PANNA',
    TP: 'TRIPLE_PANNA', TRIPLE_PATTI: 'TRIPLE_PANNA', TRIPLE_PANA: 'TRIPLE_PANNA', TRIPLE_PANNA: 'TRIPLE_PANNA',
    HS: 'HALF_SANGAM', FS: 'FULL_SANGAM', HALF_SANGAM: 'HALF_SANGAM', HALF_SANGAM_DIGITS: 'HALF_SANGAM', FULL_SANGAM: 'FULL_SANGAM', FULL_SANGAM_DIGITS: 'FULL_SANGAM',
    AB: 'AB', A: 'A', B: 'B',
  }
  if (key === 'SP_DP_TP' && selection) {
    const type = pannaType(selection)
    if (type) return type
  }
  if (!aliases[key]) throw new Error('Unsupported Matka game type')
  return aliases[key]
}
export function normalizeSelection(bid: MatkaBid, input: string): string {
  const value = String(input).trim().replace(/\s*[/\-]\s*/g, '-')
  const valid = bid === 'SINGLE' || bid === 'A' || bid === 'B' ? /^\d$/.test(value)
    : bid === 'JODI' || bid === 'AB' ? /^\d{2}$/.test(value)
      : bid === 'FULL_SANGAM' ? value.split('-').length === 2 && value.split('-').every(v => !!pannaType(v))
        : bid === 'HALF_SANGAM' ? /^(\d-\d{3}|\d{3}-\d)$/.test(value) && value.split('-').filter(v => v.length === 3).every(v => !!pannaType(v))
          : pannaType(value) === bid
  if (!valid) throw new Error(`Invalid ${BID_LABELS[bid]} selection`)
  return value
}
export function allowedBids(kind: MatkaKind): MatkaBid[] {
  if (kind === 'jackpot') return ['JODI']
  if (kind === 'sattaMatka') return ['AB', 'A', 'B']
  const standard: MatkaBid[] = ['SINGLE', 'SINGLE_PANNA', 'DOUBLE_PANNA', 'TRIPLE_PANNA']
  return kind === 'starline' ? standard : ['SINGLE', 'JODI', 'SINGLE_PANNA', 'DOUBLE_PANNA', 'TRIPLE_PANNA', 'HALF_SANGAM', 'FULL_SANGAM']
}
export function requiresBothResults(bid: MatkaBid, kind: MatkaKind): boolean {
  return kind === 'worli' && ['JODI', 'HALF_SANGAM', 'FULL_SANGAM'].includes(bid)
}
export function settlementSession(bid: MatkaBid, kind: MatkaKind, requested: MatkaSession): MatkaSession {
  if (!allowedBids(kind).includes(bid)) throw new Error('This game is not available for this market type')
  if (kind === 'starline') return 'open'
  return kind === 'jackpot' || kind === 'sattaMatka' || requiresBothResults(bid, kind) ? 'close' : requested
}
export function cutoffSession(bid: MatkaBid, kind: MatkaKind, requested: MatkaSession): MatkaSession {
  // Combined results are unknown only before the first draw. Their settlement
  // session is Close, but their entry deadline is the Open deadline.
  return requiresBothResults(bid, kind) ? 'open' : settlementSession(bid, kind, requested)
}
export function validateMatkaResult(kind: MatkaKind, side: MatkaSession, raw: string): string {
  const result = String(raw).trim()
  if ((kind === 'jackpot' || kind === 'sattaMatka') && side !== 'close') throw new Error('This market declares a Close result only')
  if (kind === 'starline' && side !== 'open') throw new Error('Starline declares an Open result only')
  if (kind === 'jackpot' || kind === 'sattaMatka') {
    if (!/^\d{2}$/.test(result)) throw new Error('Result must contain exactly two digits (00–99)')
  } else if (!pannaType(result)) throw new Error('Result must be a valid three-digit Pana in 1–9,0 order')
  return result
}
export function resultDigit(value: string): string {
  if (!/^\d{3}$/.test(value)) throw new Error('A three-digit Pana is required')
  return String([...value].reduce((sum, digit) => sum + Number(digit), 0) % 10)
}
export type MatkaSelection = { bidType: string; betNumbers: string; marketSession?: string | null; matkaType?: string | null }
export function evaluateMatkaSelection(bet: MatkaSelection, side: MatkaSession, result: string, openResult?: string | null): boolean | null {
  const kind = matkaKind({ matkaType: bet.matkaType || 'worli' }), bid = normalizeBid(bet.bidType, bet.betNumbers)
  const session = settlementSession(bid, kind, bet.marketSession === 'close' ? 'close' : 'open')
  if (session !== side) return null
  const selection = normalizeSelection(bid, bet.betNumbers)
  if (kind === 'jackpot') return selection === result
  if (kind === 'sattaMatka') return selection === (bid === 'A' ? result[0] : bid === 'B' ? result[1] : result)
  if (requiresBothResults(bid, kind)) {
    if (!openResult) throw new Error('Open result is required before settling combination bets')
    if (bid === 'JODI') return selection === resultDigit(openResult) + resultDigit(result)
    if (bid === 'FULL_SANGAM') return selection === `${openResult}-${result}`
    return selection === (selection.split('-')[0].length === 1 ? `${resultDigit(openResult)}-${result}` : `${openResult}-${resultDigit(result)}`)
  }
  return selection === (bid === 'SINGLE' ? resultDigit(result) : result)
}
