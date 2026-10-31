/**
 * Query.playerCreditStatement: who may read a credit player's statement
 * (spec 2026-10-22 §1, Access), argument rules, and what the resolver hands
 * the maths.
 *
 * No test here reaches PostgreSQL. The pg pool is a tripwire; the agent's
 * player scope (PlayerAuthService.getAgentPlayerIds) and every
 * CreditStatementRepo method are stubbed on their prototypes.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/players/__tests__/playerCreditStatementAccess.test.ts
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '@src/db/client.js'
import { PlayerAuthService } from '@src/domains/players/services/PlayerAuthService.js'
import { deriveAgentPermissions } from '@src/domains/agents/services/AgentPermissionsService.js'
import { CreditStatementRepo, type CreditAccountRow } from '@src/repos/players/creditStatementRepo.js'
import { resolvePlayerCreditStatement } from '@src/domains/players/services/playerCreditStatementQuery.js'

const T = 'stmt-tenant'
const OTHER_T = 'stmt-other-tenant'
const AGENT_ID = '11111111-1111-4111-8111-111111111111'
const OWN = 101
const REFERRED = 102
const COMMISSION_PLAYER = 103
const OUTSIDE = 999

function account(playerId: number, playerType: string, settlementBalance: number): CreditAccountRow {
  return {
    playerId, playerType, creditLimit: 1000, creditUsed: 100, creditAvailable: 900 + settlementBalance,
    settlementBalance, settlementBalanceSports: settlementBalance, settlementBalanceCasino: 0, settlementBalanceMatka: 0,
  }
}

const ACCOUNTS = new Map<string, CreditAccountRow>([
  [`${T}:${OWN}`, account(OWN, 'AGENT_CREDIT', 250)],
  [`${T}:${REFERRED}`, account(REFERRED, 'AGENT_CREDIT', -40)],
  [`${T}:${COMMISSION_PLAYER}`, account(COMMISSION_PLAYER, 'COMMISSION_AGENT_PLAYER', 0)],
  [`${OTHER_T}:${OUTSIDE}`, account(OUTSIDE, 'WHITELABEL_CREDIT', 10)],
])

const CREDIT_VIEW = [{ domain: 'players.credit', actions: ['view'] }]
const args = (playerId: number | string, extra: Record<string, unknown> = {}) => ({ playerId: String(playerId), dateFrom: '2026-10-01', dateTo: '2026-10-21', ...extra })
const agentCtx = (user: Record<string, unknown> = {}) => ({
  tenant: T, whitelabel: { id: T },
  user: { type: 'agent', agentId: AGENT_ID, sub: AGENT_ID, roles: [], isReadOnly: false, ...user },
  permissions: deriveAgentPermissions(['sports']),
})
const adminCtx = (permissions: { domain: string; actions: string[] }[]) => ({
  tenant: T, whitelabel: { id: T }, user: { sub: '7', type: 'admin', roles: ['Whitelabel Admin'] }, permissions,
})

let accountReads: Array<{ playerId: number; tenant: string }>
let timezoneReads: number
let dbTouches: number
let settledBets: unknown[]
let ledgerRows: unknown[]
let betNetAfter: number
let settlementsAfter: unknown[]

beforeEach(() => {
  accountReads = []
  timezoneReads = 0
  dbTouches = 0
  settledBets = [{ id: 'sports:b1', type: 'BET_SETTLED', occurredAt: new Date('2026-10-10T10:00:00.000Z'), domain: 'sports', reference: 'India v Australia', details: 'Match Odds', amount: 300, valueBefore: null, valueAfter: null }]
  ledgerRows = []
  betNetAfter = 50
  settlementsAfter = []
  mock.method(pool as any, 'query', async () => { dbTouches++; throw new Error('DB_TOUCHED') })
  mock.method(pool as any, 'connect', async () => { dbTouches++; throw new Error('DB_TOUCHED') })
  // The agent's scope as getAgentPlayerIds returns it: its subtree's players plus a CONFIRMED referral (102).
  mock.method(PlayerAuthService.prototype as any, 'getAgentPlayerIds', async () => [OWN, REFERRED, COMMISSION_PLAYER])
  const repo = CreditStatementRepo.prototype as any
  mock.method(repo, 'getTimezone', async () => { timezoneReads++; return 'Asia/Kolkata' })
  mock.method(repo, 'readSnapshot', async function (this: CreditStatementRepo, fn: (r: CreditStatementRepo) => Promise<unknown>) { return fn(this) })
  mock.method(repo, 'findCreditAccount', async (playerId: number, tenant: string) => {
    accountReads.push({ playerId, tenant })
    return ACCOUNTS.get(`${tenant}:${playerId}`) ?? null
  })
  mock.method(repo, 'listSettledBets', async () => settledBets)
  mock.method(repo, 'listLedgerRows', async () => ledgerRows)
  mock.method(repo, 'sumSettledBetsAfter', async () => betNetAfter)
  mock.method(repo, 'listSettlementRowsAfter', async () => settlementsAfter)
})

afterEach(() => {
  mock.restoreAll()
})

describe('playerCreditStatement: who may read', () => {
  it('an anonymous caller is refused before anything is read', async () => {
    await assert.rejects(() => resolvePlayerCreditStatement(args(OWN), { tenant: T }), /Unauthorized: authentication required/)
    assert.deepEqual(accountReads, [])
  })

  it('an admin without players.credit:view is refused', async () => {
    await assert.rejects(
      () => resolvePlayerCreditStatement(args(OWN), adminCtx([{ domain: 'players.profile', actions: ['view'] }])),
      /Forbidden: insufficient permissions for players.credit:view/,
    )
    assert.deepEqual(accountReads, [])
  })

  it('an admin with players.credit:view reads a credit player of their own tenant', async () => {
    const s = await resolvePlayerCreditStatement(args(OWN), adminCtx(CREDIT_VIEW))
    assert.equal(s.playerId, '101')
    assert.deepEqual(accountReads, [{ playerId: OWN, tenant: T }])
    assert.equal(dbTouches, 0)
  })

  it("an admin cannot read another tenant's player: the account read is tenant-scoped and finds nothing", async () => {
    await assert.rejects(() => resolvePlayerCreditStatement(args(OUTSIDE), adminCtx(CREDIT_VIEW)), /Player not found/)
    assert.deepEqual(accountReads, [{ playerId: OUTSIDE, tenant: T }])
  })

  it('a Super Admin in whitelabel mode reads the chosen whitelabel', async () => {
    const ctx = { tenant: T, whitelabel: { id: T }, user: { sub: '1', type: 'admin', roles: ['Super Admin'] }, directorMode: 'whitelabel', directorWhitelabelId: OTHER_T, permissions: [{ domain: 'all', actions: ['*'] }] }
    const s = await resolvePlayerCreditStatement(args(OUTSIDE), ctx)
    assert.equal(s.playerType, 'WHITELABEL_CREDIT')
    assert.deepEqual(accountReads, [{ playerId: OUTSIDE, tenant: OTHER_T }])
  })

  it('an agent reads its own player', async () => {
    const s = await resolvePlayerCreditStatement(args(OWN), agentCtx())
    assert.equal(s.playerId, '101')
  })

  it("an agent reads a referral-linked player that its scope includes", async () => {
    const s = await resolvePlayerCreditStatement(args(REFERRED), agentCtx())
    assert.equal(s.playerId, '102')
  })

  it('an agent is refused a player outside its subtree, before the account is read', async () => {
    await assert.rejects(
      () => resolvePlayerCreditStatement(args(OUTSIDE), agentCtx()),
      /Unauthorized: You do not have permission to view the credit statement of this player/,
    )
    assert.deepEqual(accountReads, [])
  })

  it('a read-only (INACTIVE) agent may still read its own player', async () => {
    const s = await resolvePlayerCreditStatement(args(OWN), agentCtx({ isReadOnly: true }))
    assert.equal(s.playerId, '101')
  })

  it('a player who is not a credit player gets a clear error', async () => {
    await assert.rejects(
      () => resolvePlayerCreditStatement(args(COMMISSION_PLAYER), adminCtx(CREDIT_VIEW)),
      /The credit statement is for credit players only \(AGENT_CREDIT or WHITELABEL_CREDIT\)\. This player is COMMISSION_AGENT_PLAYER\./,
    )
  })
})

describe('playerCreditStatement: arguments', () => {
  it('a non-numeric player id is refused', async () => {
    await assert.rejects(() => resolvePlayerCreditStatement(args('abc'), adminCtx(CREDIT_VIEW)), /Invalid player ID/)
  })

  it('a malformed date is refused', async () => {
    await assert.rejects(() => resolvePlayerCreditStatement(args(OWN, { dateFrom: 'yesterday' }), adminCtx(CREDIT_VIEW)), /dateFrom must be a date \(yyyy-MM-dd\)/)
    await assert.rejects(() => resolvePlayerCreditStatement(args(OWN, { dateTo: '' }), adminCtx(CREDIT_VIEW)), /dateTo must be a date \(yyyy-MM-dd\)/)
  })

  it('an impossible calendar day is refused clearly, before anything is read', async () => {
    await assert.rejects(() => resolvePlayerCreditStatement(args(OWN, { dateFrom: '2026-02-30' }), adminCtx(CREDIT_VIEW)), /dateFrom is not a valid date/)
    await assert.rejects(() => resolvePlayerCreditStatement(args(OWN, { dateTo: '2026-04-31' }), agentCtx()), /dateTo is not a valid date/)
    assert.deepEqual(accountReads, [])
    assert.equal(timezoneReads, 0)
    assert.equal(dbTouches, 0)
  })

  it('dateFrom after dateTo is refused', async () => {
    await assert.rejects(
      () => resolvePlayerCreditStatement(args(OWN, { dateFrom: '2026-10-22', dateTo: '2026-10-01' }), adminCtx(CREDIT_VIEW)),
      /dateFrom must not be after dateTo/,
    )
  })

  it('paging: 200 from the top by default, limit clamped to 1000, limit 0 refused', async () => {
    const byDefault = await resolvePlayerCreditStatement(args(OWN), adminCtx(CREDIT_VIEW))
    assert.deepEqual([byDefault.limit, byDefault.offset], [200, 0])
    const clamped = await resolvePlayerCreditStatement(args(OWN, { limit: 5000 }), adminCtx(CREDIT_VIEW))
    assert.equal(clamped.limit, 1000)
    await assert.rejects(() => resolvePlayerCreditStatement(args(OWN, { limit: 0 }), adminCtx(CREDIT_VIEW)), /limit must be a positive integer/)
  })
})

describe('playerCreditStatement: result', () => {
  it('returns the users summary and the statement maths, with rows as ISO strings', async () => {
    const s = await resolvePlayerCreditStatement(args(OWN), adminCtx(CREDIT_VIEW))
    assert.equal(s.playerType, 'AGENT_CREDIT')
    assert.deepEqual(s.summary, { creditLimit: 1000, creditUsed: 100, creditAvailable: 1150, settlementBalance: 250, settlementBalanceSports: 250, settlementBalanceCasino: 0, settlementBalanceMatka: 0 })
    // current 250, +50 settled after the range → closing 200; the +300 win inside → opening −100
    assert.equal(s.closingBalance, 200)
    assert.equal(s.openingBalance, -100)
    assert.deepEqual(s.rows.map((r) => [r.id, r.occurredAt, r.balanceAfter]), [['sports:b1', '2026-10-10T10:00:00.000Z', 200]])
    assert.equal(s.dateFrom, '2026-09-30T18:30:00.000Z')
    assert.equal(s.dateTo, '2026-10-21T18:29:59.999Z')
    assert.equal(s.totalRows, 1)
    assert.equal(dbTouches, 0)
  })

  it('a settlement after the range moves the closing balance by minus the settled balance', async () => {
    settlementsAfter = [{
      id: 'l9', transactionType: 'ADJUSTMENT', fromEntityType: 'agent', fromEntityId: AGENT_ID, toEntityType: 'player', toEntityId: String(OWN),
      amount: 120, balanceBefore: 0, balanceAfter: 0, reason: 'Player credit settlement: 120 → 0', metadata: { settlementBalanceBefore: 120 }, createdAt: new Date('2026-10-25T10:00:00.000Z'),
    }]
    const s = await resolvePlayerCreditStatement(args(OWN), adminCtx(CREDIT_VIEW))
    // after the range: bets +50, settlement −120 → −70; closing = 250 − (−70) = 320; opening = 320 − 300 = 20
    assert.equal(s.closingBalance, 320)
    assert.equal(s.openingBalance, 20)
  })

  it('maps the ledger rows of the range: a limit change is informational', async () => {
    ledgerRows = [{
      id: 'l1', transactionType: 'CREDIT_LIMIT_ADJUSTMENT', fromEntityType: 'agent', fromEntityId: AGENT_ID, toEntityType: 'player', toEntityId: String(OWN),
      amount: 500, balanceBefore: 1000, balanceAfter: 1500, reason: 'Credit limit adjustment: 1000 → 1500', metadata: null, createdAt: new Date('2026-10-12T10:00:00.000Z'),
    }]
    const s = await resolvePlayerCreditStatement(args(OWN), adminCtx(CREDIT_VIEW))
    assert.deepEqual(s.rows.map((r) => [r.id, r.type, r.affectsBalance, r.balanceAfter]), [
      ['ledger:l1', 'LIMIT_CHANGE', false, null],
      ['sports:b1', 'BET_SETTLED', true, 200],
    ])
  })
})
