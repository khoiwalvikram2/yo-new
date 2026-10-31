import test from 'node:test'
import assert from 'node:assert/strict'
import {
  stripGmagTypePrefix,
  gmagBetReferenceCandidates,
  resolveGmagWinTarget,
  pickSoleRoundBet,
  isAcceptableCandidateMatch,
} from './gmagBetReference.js'

/** Candidate ids only, for terser assertions. */
const ids = (ref: string | null | undefined) => gmagBetReferenceCandidates(ref).map((c) => c.id)

/**
 * Real ids from incident CS-22135 (player 131, 2026-07-27, Casino Malta Roulette).
 * The bet was accepted and stored D-prefixed; the win 21s later carried the bare uuid as
 * referenceId and was rejected with R_02, stranding a 5,400 INR payout.
 */
const UUID = '0f30b773-2e4d-4f26-bafc-1004ca154b50'
const BET_TRANS_ID = `D${UUID}` // what casino_bets.transaction_id actually holds
const WIN_TRANS_ID = `C${UUID}` // the win callback's own transId
const WIN_REFERENCE_ID = UUID // the win callback's referenceId — bare, no prefix

const bet = (over: Partial<Parameters<typeof resolveGmagWinTarget>[0]['betsAnyStatus'][number]> = {}) => ({
  id: 'bet-uuid',
  transactionId: BET_TRANS_ID,
  status: 'active',
  resultTransactionId: null,
  ...over,
})

// ---------------------------------------------------------------- prefix stripping

test('stripGmagTypePrefix removes only known D/C type prefixes', () => {
  assert.equal(stripGmagTypePrefix(BET_TRANS_ID), UUID)
  assert.equal(stripGmagTypePrefix(WIN_TRANS_ID), UUID)
  // no known prefix -> nothing stripped
  assert.equal(stripGmagTypePrefix(UUID), '')
  assert.equal(stripGmagTypePrefix('X123'), '')
  // degenerate input must never produce a bogus empty-ish candidate
  assert.equal(stripGmagTypePrefix('D'), '')
  assert.equal(stripGmagTypePrefix(''), '')
})

// ---------------------------------------------------------------- candidate generation

test('REGRESSION CS-22135: a bare referenceId yields the D-prefixed id the bet is stored under', () => {
  const candidates = ids(WIN_REFERENCE_ID)

  // This is the assertion that would have caught the incident: the stored bet id must be reachable.
  assert.ok(
    candidates.includes(BET_TRANS_ID),
    `candidates ${JSON.stringify(candidates)} must include the stored bet transaction_id ${BET_TRANS_ID}`
  )
  assert.deepEqual(candidates, [UUID, BET_TRANS_ID, `d${UUID}`])
})

test('naive exact-string matching — the pre-fix behaviour — provably misses the bet', () => {
  // Documents the root cause: equality between the win's referenceId and the stored
  // transaction_id is false, which is why the old code fell straight through to R_02.
  assert.notEqual(WIN_REFERENCE_ID, BET_TRANS_ID)
  const naiveMatch = [bet()].filter((b) => b.transactionId === WIN_REFERENCE_ID)
  assert.equal(naiveMatch.length, 0)

  // The candidate list is what closes the gap.
  const viaCandidates = ids(WIN_REFERENCE_ID).flatMap((c) => [bet()].filter((b) => b.transactionId === c))
  assert.equal(viaCandidates.length, 1)
})

test('candidate ordering is exact-first so the wrong bet can never be settled', () => {
  // A user can legitimately hold BOTH `123` and `D123` — the unique index is on the raw
  // string. The value the provider actually sent must always be tried first.
  assert.deepEqual(ids('123'), ['123', 'D123', 'd123'])
  assert.equal(ids('123')[0], '123')

  assert.deepEqual(ids('D123'), ['D123', '123', 'd123'])
  assert.equal(ids('D123')[0], 'D123')
})

test('a C-prefixed reference resolves to the bare and the bet form', () => {
  assert.deepEqual(ids(WIN_TRANS_ID), [WIN_TRANS_ID, UUID, BET_TRANS_ID, `d${UUID}`])
})

test('candidates are deduped and empty input yields no candidates', () => {
  assert.deepEqual(ids(''), [])
  assert.deepEqual(ids(null), [])
  assert.deepEqual(ids(undefined), [])
  assert.deepEqual(ids('   '), [])

  const c = ids('D123')
  assert.equal(new Set(c).size, c.length, 'candidate list must not repeat an id')
})

// ------------------------------------------------- per-vendor prefix conventions (live data)

/**
 * Ezugi uses the SAME scheme in lowercase. Verified across 23,951 settled Ezugi bets:
 * every one is d<body> -> c<body>. Evolution is D<body> -> C<body> across 20,255 of 20,269.
 * A win must resolve regardless of which case the vendor uses.
 */
test('REGRESSION: Ezugi lowercase d/c convention resolves to the stored bet', () => {
  const body = '27b38fc-74ce-496d-8dec-b0c1ed7afeab'
  const ezugiBet = `d${body}` // what casino_bets.transaction_id holds for Ezugi
  const ezugiWin = `c${body}` // the settlement id

  assert.ok(
    ids(ezugiWin).includes(ezugiBet),
    `lowercase win id ${ezugiWin} must reach the lowercase bet id ${ezugiBet}`
  )
  assert.equal(stripGmagTypePrefix(ezugiWin), body)
})

test('Onetouch-style unprefixed uuids still match themselves first', () => {
  const plain = '1a2b3c4d-0000-0000-0000-000000000000'
  assert.equal(ids(plain)[0], plain)
})

// ------------------------------------------------- derived-match guard

test('an EXACT match is trusted even if the round id disagrees', () => {
  // The provider named this bet explicitly; that assertion outranks our round bookkeeping.
  assert.equal(
    isAcceptableCandidateMatch({ exact: true, betRoundId: 'round-A', callbackRoundId: 'round-B' }),
    true
  )
})

test('a DERIVED match is only accepted when the round agrees', () => {
  // Derived ids are OUR inference. Requiring the round to match is what stops a look-alike
  // uuid from booking a settlement against the wrong bet.
  assert.equal(
    isAcceptableCandidateMatch({ exact: false, betRoundId: 'round-A', callbackRoundId: 'round-A' }),
    true
  )
  assert.equal(
    isAcceptableCandidateMatch({ exact: false, betRoundId: 'round-A', callbackRoundId: 'round-B' }),
    false
  )
  // Missing round information can never justify a derived match.
  assert.equal(isAcceptableCandidateMatch({ exact: false, betRoundId: null, callbackRoundId: 'r' }), false)
  assert.equal(isAcceptableCandidateMatch({ exact: false, betRoundId: 'r', callbackRoundId: null }), false)
})

// ---------------------------------------------------------------- win decision tree

test('an active bet settles on its own — never split across the round', () => {
  const target = resolveGmagWinTarget({
    activeBet: bet(),
    betsAnyStatus: [],
    winTransId: WIN_TRANS_ID,
  })
  assert.equal(target.kind, 'settle')
  assert.equal(target.kind === 'settle' && target.bet.id, 'bet-uuid')
})

test('replaying the same win transId is a duplicate — no double credit', () => {
  const target = resolveGmagWinTarget({
    activeBet: null,
    betsAnyStatus: [bet({ status: 'won', resultTransactionId: WIN_TRANS_ID })],
    winTransId: WIN_TRANS_ID,
  })
  assert.equal(target.kind, 'duplicate')
})

test('a NEW win transId on an already-settled bet is an additional win, not a duplicate', () => {
  const target = resolveGmagWinTarget({
    activeBet: null,
    betsAnyStatus: [bet({ status: 'won', resultTransactionId: 'Cearlier-txn' })],
    winTransId: WIN_TRANS_ID,
  })
  assert.equal(target.kind, 'additional_win')
})

test('a genuinely unknown reference stays unresolved so the caller can still reject', () => {
  const target = resolveGmagWinTarget({
    activeBet: null,
    betsAnyStatus: [],
    winTransId: WIN_TRANS_ID,
  })
  assert.equal(target.kind, 'unknown_reference')
})

// ---------------------------------------------------------------- round-level safety net

test('the round fallback recovers a single-bet round', () => {
  assert.equal(pickSoleRoundBet([bet()])?.id, 'bet-uuid')
})

test('the round fallback refuses to guess when the round holds several bets', () => {
  // Splitting P&L across bets here is the dual-bet bug; rejecting loudly is correct.
  assert.equal(pickSoleRoundBet([bet({ id: 'a' }), bet({ id: 'b' })]), null)
  assert.equal(pickSoleRoundBet([]), null)
})
