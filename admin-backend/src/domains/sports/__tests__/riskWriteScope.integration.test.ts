/**
 * The sports risk writes reach the caller's own whitelabel only.
 *
 * flagPlayer, unflagPlayer, deleteAutomationRule and dismissPattern matched
 * their row by id alone, while the reads beside them (sportsPlayerProfile,
 * automationRules, bettingPatterns) were already scoped. An admin of one
 * whitelabel could flag or unflag any player of another (player ids are
 * sequential), delete another brand's live automation rule and dismiss its
 * detections. An id from another whitelabel now answers "not found" and leaves
 * the row as it was; the caller's own rows still work.
 *
 * flagPlayer and unflagPlayer also recorded the actor as 'system': the admin id
 * is `ctx.user.sub`, and `ctx.user.id` is never set.
 *
 * Requires DATABASE_URL. Creates its own rows (tenants vfyfix-g7-*) and removes
 * them; the audit rows the successful writes leave are kept, as audit rows are.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const OWN = 'vfyfix-g7-risk-own'
const OTHER = 'vfyfix-g7-risk-other'

let db: (typeof import('@src/db/client.js'))['db']
let mutations: (typeof import('@src/domains/sports/resolvers/mutations.js'))['sportsMutationResolvers']
let playerId = 0
let ruleId = ''
let patternId = ''

const adminOf = (tenant: string, sub: string) => ({
  tenant,
  whitelabel: { id: tenant },
  user: { sub, type: 'admin', roles: ['Whitelabel Admin'] },
  permissions: [{ domain: 'sports', actions: ['read', 'write'] }],
})

async function rows(query: ReturnType<typeof sql>): Promise<any[]> {
  const result: any = await db.execute(query)
  return Array.isArray(result) ? result : result?.rows ?? []
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  ;({ sportsMutationResolvers: mutations } = await import('@src/domains/sports/resolvers/mutations.js'))

  ;[{ id: playerId }] = await rows(sql`
    INSERT INTO users (tenant, name, username, status, password_hash)
    VALUES (${OWN}, 'vfyfix g7 player', ${'vfyfix-g7-p-' + Date.now()}, 'active', 'x')
    RETURNING id`)
  ;[{ id: ruleId }] = await rows(sql`
    INSERT INTO automation_rules (tenant, whitelabel_id, rule_type, config, enabled, priority)
    VALUES (${OWN}, ${OWN}, 'AUTO_VOID', '{}'::jsonb, false, 0)
    RETURNING id`)
  ;[{ id: patternId }] = await rows(sql`
    INSERT INTO betting_patterns (tenant, whitelabel_id, user_id, pattern_type, severity)
    VALUES (${OWN}, ${OWN}, ${playerId}, 'RAPID_BETTING', 'LOW')
    RETURNING id`)
})

after(async () => {
  if (db) {
    await db.execute(sql`DELETE FROM betting_patterns WHERE tenant IN (${OWN}, ${OTHER})`)
    await db.execute(sql`DELETE FROM automation_rules WHERE tenant IN (${OWN}, ${OTHER})`)
    await db.execute(sql`DELETE FROM users WHERE tenant IN (${OWN}, ${OTHER})`)
  }
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
})

describe('an admin of another whitelabel', () => {
  const other = () => adminOf(OTHER, '9002')

  it('cannot flag or unflag the player, and the flags stay as they were', async () => {
    const flagged = await mutations.flagPlayer(null, { userId: String(playerId), flag: 'vfyfix_xtenant', reason: 'x' }, other())
    assert.deepEqual(flagged, { success: false, message: 'Player not found' })
    const [{ flags }] = await rows(sql`SELECT flags FROM users WHERE id = ${playerId}`)
    assert.deepEqual(flags ?? [], [])

    await db.execute(sql`UPDATE users SET flags = ${JSON.stringify([{ flag: 'kept', reason: '', setBy: '1', setAt: '2026-01-01T00:00:00.000Z' }])}::jsonb WHERE id = ${playerId}`)
    const unflagged = await mutations.unflagPlayer(null, { userId: String(playerId), flag: 'kept' }, other())
    assert.deepEqual(unflagged, { success: false, message: 'Player not found' })
    const [{ flags: after }] = await rows(sql`SELECT flags FROM users WHERE id = ${playerId}`)
    assert.deepEqual(after.map((f: any) => f.flag), ['kept'])
    await db.execute(sql`UPDATE users SET flags = '[]'::jsonb WHERE id = ${playerId}`)
  })

  it('cannot delete the automation rule', async () => {
    const result = await mutations.deleteAutomationRule(null, { id: ruleId }, other())
    assert.deepEqual(result, { success: false, message: 'Rule not found' })
    assert.equal((await rows(sql`SELECT 1 FROM automation_rules WHERE id = ${ruleId}`)).length, 1)
  })

  it('cannot dismiss the betting pattern', async () => {
    const result = await mutations.dismissPattern(null, { patternId, reason: 'x' }, other())
    assert.deepEqual(result, { success: false, message: 'Pattern not found' })
    const [{ status }] = await rows(sql`SELECT status FROM betting_patterns WHERE id = ${patternId}`)
    assert.equal(status, 'DETECTED')
  })
})

describe('ids that match nothing', () => {
  const own = () => adminOf(OWN, '9001')

  it('answer not found instead of success or a TypeError', async () => {
    assert.deepEqual(await mutations.flagPlayer(null, { userId: '2147483000', flag: 'f' }, own()), { success: false, message: 'Player not found' })
    assert.deepEqual(await mutations.flagPlayer(null, { userId: 'abc', flag: 'f' }, own()), { success: false, message: 'Invalid user ID' })
    assert.deepEqual(await mutations.dismissPattern(null, { patternId: '00000000-0000-4000-8000-000000000000' }, own()), { success: false, message: 'Pattern not found' })
    assert.deepEqual(await mutations.dismissPattern(null, { patternId: 'not-a-uuid' }, own()), { success: false, message: 'Pattern not found' })
    assert.deepEqual(await mutations.deleteAutomationRule(null, { id: 'not-a-uuid' }, own()), { success: false, message: 'Rule not found' })
  })
})

describe('agents', () => {
  it('are refused the player flag and pattern writes, like every other risk write', async () => {
    const agent = { ...adminOf(OWN, '9003'), user: { sub: '9003', type: 'agent', agentId: 'a' } }
    await assert.rejects(() => mutations.flagPlayer(null, { userId: String(playerId), flag: 'f' }, agent), /Agents are not allowed/)
    await assert.rejects(() => mutations.unflagPlayer(null, { userId: String(playerId), flag: 'f' }, agent), /Agents are not allowed/)
    await assert.rejects(() => mutations.dismissPattern(null, { patternId }, agent), /Agents are not allowed/)
  })
})

describe("the player's own whitelabel", () => {
  const own = () => adminOf(OWN, '9001')

  it('flags and unflags its player, recorded as set by the acting admin', async () => {
    const flagged = await mutations.flagPlayer(null, { userId: String(playerId), flag: 'vfyfix_own', reason: 'r' }, own())
    assert.equal(flagged.success, true)
    const [{ flags }] = await rows(sql`SELECT flags FROM users WHERE id = ${playerId}`)
    assert.equal(flags.length, 1)
    assert.equal(flags[0].flag, 'vfyfix_own')
    assert.equal(flags[0].setBy, '9001')

    const unflagged = await mutations.unflagPlayer(null, { userId: String(playerId), flag: 'vfyfix_own' }, own())
    assert.equal(unflagged.success, true)
    const [{ flags: after }] = await rows(sql`SELECT flags FROM users WHERE id = ${playerId}`)
    assert.deepEqual(after, [])

    // Both audit rows land in the player's tenant with the admin as actor.
    const audit = await rows(sql`
      SELECT action, actor_id FROM audit_logs
      WHERE tenant = ${OWN} AND resource_id = ${String(playerId)} AND action IN ('flag_player', 'unflag_player')`)
    assert.deepEqual(audit.map((r) => r.actor_id).sort(), ['9001', '9001'])
  })

  it('dismisses its pattern and deletes its rule', async () => {
    assert.deepEqual(await mutations.dismissPattern(null, { patternId, reason: 'reviewed' }, own()), { success: true, message: 'Pattern dismissed' })
    const [{ status }] = await rows(sql`SELECT status FROM betting_patterns WHERE id = ${patternId}`)
    assert.equal(status, 'DISMISSED')

    assert.deepEqual(await mutations.deleteAutomationRule(null, { id: ruleId }, own()), { success: true, message: 'Automation rule deleted successfully' })
    assert.equal((await rows(sql`SELECT 1 FROM automation_rules WHERE id = ${ruleId}`)).length, 0)
  })
})
