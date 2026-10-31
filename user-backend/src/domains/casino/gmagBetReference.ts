/**
 * GMAG bet-reference resolution — pure, dependency-free.
 *
 * WHY THIS EXISTS
 * ---------------
 * GMAG/Evolution derive every id in a round from one shared reference uuid and put a
 * single-letter TYPE prefix in front of it:
 *
 *   bet   ->  transId = "D" + uuid      referenceId = uuid
 *   win   ->  transId = "C" + uuid      referenceId = uuid
 *
 * `createCasinoBet` persists `casino_bets.transaction_id = item.transId`, i.e. the
 * **D-prefixed** value. The win handler then looked the bet up by the raw `referenceId`
 * (the *bare* uuid) and, finding nothing, returned `R_02 Invalid round when win` without
 * ever trying the round-level resolver that sits below it. The provider had already
 * accepted the debit, so the stake was gone, the win was refused, and the round stayed
 * `active` forever — the provider retried for hours and no self-healing was possible.
 *
 * Real incident (CS-22135, player 131, 2026-07-27): 4 rounds, 10,000 INR debited,
 * 8,500 INR of winnings declined.
 *
 *   bet stored as  D0f30b773-2e4d-4f26-bafc-1004ca154b50
 *   win arrives    transId C0f30b773-…   referenceId 0f30b773-…   -> lookup missed
 *
 * FIXED AT READ TIME, DELIBERATELY
 * --------------------------------
 * We do NOT normalise what `createCasinoBet` writes. There is a partial unique index on
 * (user_id, transaction_id); rewriting placement would orphan every existing row and could
 * collide a bet with a cancel that share a uuid. Instead the reader asks for every id the
 * bet may legitimately be stored under, **exact match first**.
 *
 * Ordering is load-bearing: because the unique index is on the raw string, a user really can
 * hold both a bet `123` and a bet `D123`. Trying the stripped form first could settle the
 * wrong bet with the wrong stake, so the value the provider actually sent always wins.
 */

/**
 * Type markers GMAG puts in front of the shared round reference. D = debit/bet, C = credit/win.
 *
 * CASE MATTERS, and both cases are real. Measured on live data:
 *   Evolution Gaming — 20,255 of 20,269 settled bets are `D<body>` -> `C<body>` (UPPER)
 *   Ezugi           — 23,951 of 23,951 settled bets are `d<body>` -> `c<body>` (lower)
 * A third vendor (Onetouch) uses plain unprefixed uuids.
 *
 * So the prefix scheme is per-vendor and cannot be assumed. We generate candidates for every
 * shape rather than hard-coding one, which is why this list is data and not an `if`.
 */
const GMAG_TYPE_PREFIXES = ['D', 'C', 'd', 'c'] as const

/** Prefixes a BET row's `transaction_id` may be stored under, both cases. */
const GMAG_BET_PREFIXES = ['D', 'd'] as const

/**
 * Strip a known GMAG type marker, returning the bare reference.
 * Returns '' when `id` carries no known marker (or stripping would leave nothing).
 */
export function stripGmagTypePrefix(id: string): string {
  if (id.length < 2) return ''
  const head = id.charAt(0)
  if (!(GMAG_TYPE_PREFIXES as readonly string[]).includes(head)) return ''
  return id.slice(1)
}

export interface GmagBetCandidate {
  id: string
  /**
   * true ONLY for the value the provider itself sent. An exact match is the provider asserting
   * which bet this is, and is trusted unconditionally. Everything else is OUR inference and is
   * held to a stricter test — see isAcceptableCandidateMatch.
   */
  exact: boolean
}

/**
 * Every `casino_bets.transaction_id` value the original bet may be stored under for a given
 * provider reference, ordered most-authoritative first and deduped.
 *
 *   '0f30b773…'  -> 0f30b773… (exact), D0f30b773…, d0f30b773…      [Evolution win -> D bet]
 *   'c27b38fc…'  -> c27b38fc… (exact), 27b38fc…, D27b38fc…, d27b38fc…   [Ezugi win -> d bet]
 *   'D0f30b773…' -> D0f30b773… (exact), 0f30b773…, d0f30b773…
 *   '' | null    -> []
 *
 * The caller tries each in order and stops at the first acceptable hit, so the exact value the
 * provider sent always wins over anything derived from it.
 */
export function gmagBetReferenceCandidates(referenceId: string | null | undefined): GmagBetCandidate[] {
  const ref = typeof referenceId === 'string' ? referenceId.trim() : ''
  if (!ref) return []

  const out: GmagBetCandidate[] = [{ id: ref, exact: true }]
  const push = (id: string) => {
    if (id && !out.some((c) => c.id === id)) out.push({ id, exact: false })
  }

  const bare = stripGmagTypePrefix(ref)
  if (bare && bare !== ref) push(bare)

  const base = bare || ref
  for (const prefix of GMAG_BET_PREFIXES) push(prefix + base)

  return out
}

/**
 * Guard on a DERIVED candidate match.
 *
 * An exact match is the provider naming the bet, so we take it. A derived match came from us
 * re-casing or re-prefixing their id, and a uuid that merely looks similar could belong to a
 * different round — so a derived match must additionally agree on the round. This is the line
 * between "recover a settlement we would otherwise strand" and "book money against the wrong
 * bet", and it is the only place the two can be confused.
 */
export function isAcceptableCandidateMatch(args: {
  exact: boolean
  betRoundId: string | null | undefined
  callbackRoundId: string | null | undefined
}): boolean {
  if (args.exact) return true
  if (!args.betRoundId || !args.callbackRoundId) return false
  return args.betRoundId === args.callbackRoundId
}

/** Minimal shape the resolver needs from a `casino_bets` row. */
export interface GmagResolvableBet {
  id: string
  transactionId: string | null
  status: string
  resultTransactionId: string | null
}

export type GmagWinTarget<B extends GmagResolvableBet> =
  /** An active bet matched this reference — settle it on its own, never split across the round. */
  | { kind: 'settle'; bet: B }
  /** The bet is already settled and this is a NEW win transId (e.g. jackpot top-up) — credit only. */
  | { kind: 'additional_win'; bet: B }
  /** This exact win transId was already applied to the bet — idempotent replay, credit nothing. */
  | { kind: 'duplicate' }
  /** Nothing matched. Caller may still try a round-level fallback before rejecting. */
  | { kind: 'unknown_reference' }

/**
 * Decide what a win callback should do, given the rows a candidate lookup produced.
 * A faithful lift of the decision tree that used to be inline in `processOneTrans`,
 * extracted so the whole retry/idempotency matrix is assertable without a database.
 *
 * @param activeBet      first active row found across the candidate ids, else null
 * @param betsAnyStatus  rows found across the candidate ids regardless of status
 * @param winTransId     the win callback's own transId (`item.transId`)
 */
export function resolveGmagWinTarget<B extends GmagResolvableBet>(args: {
  activeBet: B | null
  betsAnyStatus: B[]
  winTransId: string
}): GmagWinTarget<B> {
  const { activeBet, betsAnyStatus, winTransId } = args

  if (activeBet) return { kind: 'settle', bet: activeBet }

  if (!betsAnyStatus.length) return { kind: 'unknown_reference' }

  // Same win already recorded on one of these rows -> replay, must not credit twice.
  if (betsAnyStatus.some((b) => b.resultTransactionId === winTransId)) {
    return { kind: 'duplicate' }
  }

  return { kind: 'additional_win', bet: betsAnyStatus[0] }
}

/**
 * Round-level safety net for a reference we could not match.
 *
 * Returns the bet ONLY when the round holds exactly one candidate. That restriction is the
 * whole point: the round-level settlement path divides P&L by bet count
 * (`netPerBet = pl / n`), which is precisely the dual-bet split bug the per-reference path
 * was introduced to avoid. With a single bet there is nothing to split and nothing to guess,
 * so recovering the round is unambiguous. With two or more we genuinely cannot tell which
 * bet the win belongs to, and inventing an answer would mis-book real money — the caller
 * rejects instead, loudly.
 */
export function pickSoleRoundBet<B extends GmagResolvableBet>(roundBets: B[]): B | null {
  return roundBets.length === 1 ? roundBets[0] : null
}
