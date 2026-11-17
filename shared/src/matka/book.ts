import { normalizeBid, normalizeSelection, pannaType, resultDigit, type MatkaBid, type MatkaKind, type MatkaSession } from './rules.js'

/** One selection of a session's open book: its stakes and what it pays if it wins, in minor units. */
export type MatkaBookEntry = { bidType: string; selection: string; stakeMinor: bigint; payoutMinor: bigint }
export type MatkaWorstOutcome = { key: string | null; plMinor: bigint }

const PANNAS = Array.from({ length: 1000 }, (_, n) => String(n).padStart(3, '0')).filter(value => pannaType(value))
const DIGIT = new Map(PANNAS.map(panna => [panna, resultDigit(panna)]))
const TYPE = new Map(PANNAS.map(panna => [panna, pannaType(panna)]))
const TWO_DIGITS = Array.from({ length: 100 }, (_, n) => String(n).padStart(2, '0'))
const DIGIT_LEVEL = new Set<MatkaBid>(['SINGLE', 'JODI', 'AB', 'A', 'B'])
const COMBINATIONS = new Set<MatkaBid>(['JODI', 'HALF_SANGAM', 'FULL_SANGAM'])

/**
 * The result that costs the house most on a session's open book, and the house P/L if it comes: every stake
 * is kept and every winning selection is paid. Every possible result is tried (220 Panas, or 00-99), so
 * Single, Pana, Jodi and Sangam bets that win together on one result are counted together. A Worli Close
 * session whose Open result is not declared yet tries every Open/Close pair when it holds Jodi or Sangam
 * bets, since those depend on both. The key is the result as an operator reads it: the digit (or Jodi) when
 * only digit bets win on it, otherwise the Pana (or "open-close" Panas). Null when the book is empty.
 */
export function worstMatkaOutcome(entries: readonly MatkaBookEntry[], kind: MatkaKind, side: MatkaSession, openResult?: string | null): MatkaWorstOutcome | null {
  if (!entries.length) return null
  const paid = new Map<string, bigint>(), bids = new Set<MatkaBid>()
  let stake = 0n
  for (const entry of entries) {
    stake += entry.stakeMinor
    try {
      const bid = normalizeBid(entry.bidType, entry.selection), key = `${bid}:${normalizeSelection(bid, entry.selection)}`
      paid.set(key, (paid.get(key) ?? 0n) + entry.payoutMinor); bids.add(bid)
    } catch { /* An unsupported legacy selection can never win; its stake still counts. */ }
  }
  let worst: MatkaWorstOutcome = { key: null, plMinor: stake }
  const consider = (winners: Array<[MatkaBid | null, string]>, digitKey: string, pannaKey: string) => {
    let payout = 0n, pannaLevel = false
    for (const [bid, selection] of winners) {
      const amount = bid ? paid.get(`${bid}:${selection}`) : undefined
      if (!amount) continue
      payout += amount
      if (!DIGIT_LEVEL.has(bid!)) pannaLevel = true
    }
    if (payout > 0n && stake - payout < worst.plMinor) worst = { key: pannaLevel ? pannaKey : digitKey, plMinor: stake - payout }
  }
  if (kind === 'jackpot') for (const result of TWO_DIGITS) consider([['JODI', result]], result, result)
  else if (kind === 'sattaMatka') for (const result of TWO_DIGITS) consider([['AB', result], ['A', result[0]], ['B', result[1]]], result, result)
  else {
    const digit = (panna: string) => DIGIT.get(panna)!
    const single = (panna: string): Array<[MatkaBid | null, string]> => [['SINGLE', digit(panna)], [TYPE.get(panna)!, panna]]
    const both = (open: string, close: string): Array<[MatkaBid | null, string]> => [...single(close), ['JODI', digit(open) + digit(close)],
      ['HALF_SANGAM', `${digit(open)}-${close}`], ['HALF_SANGAM', `${open}-${digit(close)}`], ['FULL_SANGAM', `${open}-${close}`]]
    const combinations = side === 'close' && kind === 'worli' && [...bids].some(bid => COMBINATIONS.has(bid))
    if (!combinations) for (const panna of PANNAS) consider(single(panna), digit(panna), panna)
    else if (openResult && DIGIT.has(openResult)) for (const close of PANNAS) consider(both(openResult, close), digit(close), close)
    else for (const open of PANNAS) for (const close of PANNAS) consider(both(open, close), digit(open) + digit(close), `${open}-${close}`)
  }
  return worst
}
