/**
 * The allowance is what stands between a whitelabel and an unbounded provider
 * bill, so the cases that matter are the ones where it must refuse:
 *
 *   - no settings row at all;
 *   - a row that exists but is switched off;
 *   - switched on with an allowance of zero, which is the default;
 *   - the allowance spent.
 *
 * Usage is derived from the transcript rather than stored in a counter, so it
 * cannot drift from what was actually sent.
 *
 * Requires DATABASE_URL. Uses its own tenants and cleans up.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const SUFFIX = randomUUID().slice(0, 8)
const T = {
  unset: `ai-ent-unset-${SUFFIX}`,
  disabled: `ai-ent-off-${SUFFIX}`,
  zero: `ai-ent-zero-${SUFFIX}`,
  allowed: `ai-ent-ok-${SUFFIX}`,
  spent: `ai-ent-spent-${SUFFIX}`,
  daily: `ai-ent-daily-${SUFFIX}`,
  claim: `ai-ent-claim-${SUFFIX}`,
}
const ALL = [...Object.values(T), `${T.spent}-nosettings`]

/** Records a message the way a real turn would, so usage is counted from it. */
async function recordMessages(tenant: string, count: number, when?: Date) {
  const { db } = await import('@src/db/client.js')
  const { aiConversations, aiMessages } = await import('@shared/db/schema.js')
  const [conversation] = await db
    .insert(aiConversations)
    .values({ tenant, adminUserId: 1 })
    .returning({ id: aiConversations.id })
  for (let i = 0; i < count; i++) {
    await db.insert(aiMessages).values({
      tenant,
      conversationId: conversation.id,
      role: 'user',
      content: `message ${i}`,
      ...(when ? { createdAt: when } : {}),
    })
    // An assistant reply must not count towards the allowance.
    await db.insert(aiMessages).values({
      tenant,
      conversationId: conversation.id,
      role: 'assistant',
      content: 'reply',
      ...(when ? { createdAt: when } : {}),
    })
  }
}

async function cleanup() {
  const { db } = await import('@src/db/client.js')
  const { aiConversations, aiMessages, aiActionProposals, aiWhitelabelSettings } = await import('@shared/db/schema.js')
  const { inArray } = await import('drizzle-orm')
  await db.delete(aiActionProposals).where(inArray(aiActionProposals.tenant, ALL))
  await db.delete(aiMessages).where(inArray(aiMessages.tenant, ALL))
  await db.delete(aiConversations).where(inArray(aiConversations.tenant, ALL))
  await db.delete(aiWhitelabelSettings).where(inArray(aiWhitelabelSettings.tenant, ALL))
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  await cleanup()
  const { upsertSettings } = await import('../entitlement.js')

  await upsertSettings({ tenant: T.disabled, enabled: false, chatLimit: 100, limitPeriod: 'monthly', updatedBy: 'test' })
  await upsertSettings({ tenant: T.zero, enabled: true, chatLimit: 0, limitPeriod: 'monthly', updatedBy: 'test' })
  await upsertSettings({ tenant: T.allowed, enabled: true, chatLimit: 5, limitPeriod: 'monthly', updatedBy: 'test' })
  await upsertSettings({ tenant: T.spent, enabled: true, chatLimit: 5, limitPeriod: 'monthly', updatedBy: 'test' })
  await upsertSettings({ tenant: T.daily, enabled: true, chatLimit: 3, limitPeriod: 'daily', updatedBy: 'test' })
  await upsertSettings({ tenant: T.claim, enabled: true, chatLimit: 5, limitPeriod: 'monthly', updatedBy: 'test' })

  await recordMessages(T.allowed, 2)
  await recordMessages(T.spent, 5)
})

after(cleanup)

describe('assistant entitlement', () => {
  it('refuses a whitelabel that has never been granted anything', async () => {
    const { getEntitlement } = await import('../entitlement.js')
    const e = await getEntitlement(T.unset)
    assert.equal(e.enabled, false)
    assert.equal(e.chatLimit, 0, 'the default allowance is none')
    assert.ok(e.blockedReason, 'a whitelabel with no row must not be able to spend')
  })

  it('refuses a whitelabel that is switched off, however large its allowance', async () => {
    const { getEntitlement } = await import('../entitlement.js')
    const e = await getEntitlement(T.disabled)
    assert.equal(e.enabled, false)
    assert.equal(e.chatLimit, 100)
    assert.ok(e.blockedReason, 'the switch must override the allowance')
  })

  it('refuses an enabled whitelabel whose allowance is zero', async () => {
    const { getEntitlement } = await import('../entitlement.js')
    const e = await getEntitlement(T.zero)
    assert.equal(e.enabled, true)
    assert.equal(e.remaining, 0)
    assert.match(e.blockedReason ?? '', /allowance/i)
  })

  it('allows a whitelabel with allowance left, and reports what is left', async () => {
    const { getEntitlement } = await import('../entitlement.js')
    const e = await getEntitlement(T.allowed)
    assert.equal(e.blockedReason, null)
    assert.equal(e.chatLimit, 5)
    assert.equal(e.used, 2, 'only the operator messages count')
    assert.equal(e.remaining, 3)
  })

  it('refuses once the allowance is spent', async () => {
    const { getEntitlement } = await import('../entitlement.js')
    const e = await getEntitlement(T.spent)
    assert.equal(e.used, 5)
    assert.equal(e.remaining, 0)
    assert.match(e.blockedReason ?? '', /used up/i)
  })

  it('reserveChatSlot refuses a blocked whitelabel and admits an allowed one', async () => {
    // The reservation is the only gate. A separate read-only "can this chat?"
    // helper used to exist and was removed: it looked like the gate but did not
    // claim anything, so anyone reaching for it would reintroduce the race.
    const { reserveChatSlot, AiNotEntitledError, getEntitlement } = await import('../entitlement.js')
    const { db } = await import('@src/db/client.js')
    const { aiConversations } = await import('@shared/db/schema.js')

    const conversationFor = async (tenant: string) => {
      const [c] = await db.insert(aiConversations).values({ tenant, adminUserId: 1 }).returning({ id: aiConversations.id })
      return c.id
    }

    await assert.rejects(
      async () => reserveChatSlot({ tenant: T.zero, conversationId: await conversationFor(T.zero), content: 'x' }),
      (e: Error) => e instanceof AiNotEntitledError
    )
    await assert.rejects(
      async () => reserveChatSlot({ tenant: T.disabled, conversationId: await conversationFor(T.disabled), content: 'x' }),
      (e: Error) => e instanceof AiNotEntitledError
    )

    // Its own tenant: claiming against a shared one would spend allowance the
    // other tests assert on, and the order they run in is not guaranteed.
    const before = await getEntitlement(T.claim)
    await reserveChatSlot({ tenant: T.claim, conversationId: await conversationFor(T.claim), content: 'x' })
    const afterClaim = await getEntitlement(T.claim)
    assert.equal(afterClaim.used, before.used + 1, 'a successful claim consumes exactly one')
  })

  it('counts a daily allowance only against today', async () => {
    const { getEntitlement } = await import('../entitlement.js')
    // Spend yesterday's allowance; today's must be untouched.
    const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000)
    await recordMessages(T.daily, 3, yesterday)

    const e = await getEntitlement(T.daily)
    assert.equal(e.limitPeriod, 'daily')
    assert.equal(e.used, 0, 'yesterday must not consume today')
    assert.equal(e.blockedReason, null)
  })

  it('never resets a total allowance', async () => {
    const { upsertSettings, getEntitlement } = await import('../entitlement.js')
    await upsertSettings({ tenant: T.daily, enabled: true, chatLimit: 3, limitPeriod: 'total', updatedBy: 'test' })
    const e = await getEntitlement(T.daily)
    assert.equal(e.limitPeriod, 'total')
    assert.equal(e.used, 3, 'a total allowance counts every message ever sent')
    assert.equal(e.remaining, 0)
    assert.ok(e.blockedReason)
  })

  it('treats a negative or fractional allowance as a whole number floor of zero', async () => {
    const { upsertSettings, getEntitlement } = await import('../entitlement.js')
    await upsertSettings({ tenant: T.unset, enabled: true, chatLimit: -5, limitPeriod: 'monthly', updatedBy: 'test' })
    const negative = await getEntitlement(T.unset)
    assert.equal(negative.chatLimit, 0, 'a negative allowance must not become unlimited')

    await upsertSettings({ tenant: T.unset, enabled: true, chatLimit: 7.9, limitPeriod: 'monthly', updatedBy: 'test' })
    const fractional = await getEntitlement(T.unset)
    assert.equal(fractional.chatLimit, 7)
  })

  it('turning the switch off blocks a whitelabel that still has allowance', async () => {
    const { upsertSettings, getEntitlement } = await import('../entitlement.js')
    await upsertSettings({ tenant: T.allowed, enabled: false, chatLimit: 5, limitPeriod: 'monthly', updatedBy: 'test' })
    const e = await getEntitlement(T.allowed)
    assert.equal(e.remaining, 3, 'the allowance is untouched')
    assert.ok(e.blockedReason, 'but access is refused')
  })

  it('admits exactly the allowance when claims arrive together', async () => {
    // Two steps — check, then write — let concurrent requests all read the same
    // "used" figure and every one proceed. With an allowance of three, five
    // simultaneous messages were all admitted before the claim became atomic.
    const { upsertSettings, reserveChatSlot, getEntitlement } = await import('../entitlement.js')
    const { db } = await import('@src/db/client.js')
    const { aiConversations } = await import('@shared/db/schema.js')

    const tenant = T.unset
    await upsertSettings({ tenant, enabled: true, chatLimit: 3, limitPeriod: 'total', updatedBy: 'test' })
    const [conversation] = await db
      .insert(aiConversations)
      .values({ tenant, adminUserId: 1 })
      .returning({ id: aiConversations.id })

    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        reserveChatSlot({ tenant, conversationId: conversation.id, content: `concurrent ${i}` })
      )
    )

    const admitted = attempts.filter((a) => a.status === 'fulfilled').length
    assert.equal(admitted, 3, 'exactly the allowance may be claimed, however many arrive at once')

    const after = await getEntitlement(tenant)
    assert.equal(after.used, 3, 'and exactly that many messages are recorded')
    assert.equal(after.remaining, 0)
  })

  it('records the message as part of claiming the slot', async () => {
    // The message is the reservation: if it were written separately a crash in
    // between would consume allowance with nothing to show, or record a message
    // that was never paid for.
    const { upsertSettings, reserveChatSlot, getEntitlement } = await import('../entitlement.js')
    const { db } = await import('@src/db/client.js')
    const { aiConversations, aiMessages } = await import('@shared/db/schema.js')
    const { eq } = await import('drizzle-orm')

    const tenant = T.zero
    await upsertSettings({ tenant, enabled: true, chatLimit: 2, limitPeriod: 'total', updatedBy: 'test' })
    const [conversation] = await db
      .insert(aiConversations)
      .values({ tenant, adminUserId: 1 })
      .returning({ id: aiConversations.id })

    const id = await reserveChatSlot({ tenant, conversationId: conversation.id, content: 'hello' })
    assert.ok(id, 'returns the id of the recorded message')

    const rows = await db.select().from(aiMessages).where(eq(aiMessages.id, id))
    assert.equal(rows.length, 1)
    assert.equal(rows[0].content, 'hello')
    assert.equal(rows[0].role, 'user')
    assert.equal((await getEntitlement(tenant)).used, 1)
  })

  it('refuses to claim for a whitelabel with no settings row', async () => {
    const { reserveChatSlot, AiNotEntitledError } = await import('../entitlement.js')
    const { db } = await import('@src/db/client.js')
    const { aiConversations } = await import('@shared/db/schema.js')

    const tenant = `${T.spent}-nosettings`
    const [conversation] = await db
      .insert(aiConversations)
      .values({ tenant, adminUserId: 1 })
      .returning({ id: aiConversations.id })

    await assert.rejects(
      () => reserveChatSlot({ tenant, conversationId: conversation.id, content: 'x' }),
      (e: Error) => e instanceof AiNotEntitledError
    )
  })
})
