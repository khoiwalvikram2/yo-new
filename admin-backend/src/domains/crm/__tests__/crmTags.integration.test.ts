/**
 * The tag vocabulary, and the two things about it that are easy to get wrong.
 *
 * First, filtering: a tag filter has to narrow the book scope, never widen it.
 * The obvious implementation joins `crm_player_tags` and forgets that the join
 * itself can reintroduce players the caller was never allowed to see.
 *
 * Second, merging: six months of a desk creating labels produces near
 * duplicates, and folding one into another must move every player without
 * losing the ones who already carried both.
 *
 * Requires DATABASE_URL. Uses its own tenant and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildSchema, graphql } from 'graphql'
import { randomUUID } from 'node:crypto'

const TENANT = `crm-tags-${randomUUID().slice(0, 8)}`

let schema: ReturnType<typeof buildSchema>
let rootValue: Record<string, unknown>
let inBook = 0
let outOfBook = 0
let agentCtx: Record<string, unknown>
let headCtx: Record<string, unknown>

const superAdminCtx = {
  user: { sub: '1', name: 'Root', roles: ['Super Admin'] },
  tenant: 'default',
  permissions: [{ domain: 'all', actions: ['*'] }],
}
const anonCtx = { tenant: TENANT, whitelabel: { id: TENANT }, request: { headers: {} } }

async function run(source: string, ctx: unknown, variableValues?: Record<string, unknown>) {
  const res = await graphql({ schema, source, rootValue, contextValue: ctx, variableValues })
  if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '))
  return res.data as Record<string, any>
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const { typeDefs } = await import('@src/types/graphql.js')
  const { domainResolvers } = await import('@src/domains/index.js')
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const { buildCrmAuthContext } = await import('@src/domains/crm/services/CrmAuthService.js')

  schema = buildSchema(typeDefs)
  rootValue = Object.fromEntries(
    Object.entries({ ...domainResolvers.Query, ...(domainResolvers as any).Mutation }).map(
      ([n, fn]: [string, any]) => [n, (a: any, c: any, i: any) => fn(undefined, a, c, i)]
    )
  )

  for (const name of ['Tag In Book', 'Tag Out Of Book']) {
    const r = await db.execute(sql`
      INSERT INTO users (tenant, name, username, phone, password_hash)
      VALUES (${TENANT}, ${name}, ${name.replace(/\s/g, '').toLowerCase() + randomUUID().slice(0, 5)},
              ${'9' + Math.floor(Math.random() * 1e9)}, 'x')
      RETURNING id`)
    const id = Number((r.rows[0] as { id: number }).id)
    if (!inBook) inBook = id
    else outOfBook = id
  }

  await run(
    `mutation($t:String!){ setCrmWhitelabelSettings(tenant:$t, enabled:true, seatLimit:5){ enabled } }`,
    superAdminCtx,
    { t: TENANT }
  )
  await run(
    `mutation($t:String!){ crmCreateFirstAdmin(tenant:$t, name:"Head", username:"tagshead", password:"FirstPass2026"){ ok error } }`,
    superAdminCtx,
    { t: TENANT }
  )
  const mkCtx = async (token: string) => ({
    ...(await buildCrmAuthContext({ headers: { authorization: `Bearer ${token}` } }, TENANT)),
    tenant: TENANT,
    whitelabel: { id: TENANT },
    request: { headers: {} },
  })
  const login = await run(`mutation{ crmLogin(username:"tagshead", password:"FirstPass2026"){ ok token } }`, anonCtx)
  headCtx = await mkCtx(login.crmLogin.token)

  await run(`mutation{ crmCreateBook(name:"Tag Desk"){ ok } }`, headCtx)
  const bookId = (await run(`{ crmBooks{ id } }`, headCtx)).crmBooks[0].id
  const roles = await run(`{ crmRoles{ id name } }`, headCtx)
  const agentRole = roles.crmRoles.find((r: any) => r.name === 'Agent')
  await run(
    `mutation($r:[ID!]){ crmCreateUser(input:{name:"Tag Agent", username:"tagagent", password:"AgentPass2026", roleIds:$r}){ ok error } }`,
    headCtx,
    { r: [agentRole.id] }
  )
  const users = await run(`{ crmUsers{ id username } }`, headCtx)
  const agent = users.crmUsers.find((u: any) => u.username === 'tagagent')
  await run(`mutation($b:ID!,$u:[ID!]!){ crmSetBookMembers(bookId:$b, crmUserIds:$u){ ok } }`, headCtx, {
    b: bookId,
    u: [agent.id],
  })
  await run(`mutation($p:[ID!]!,$b:ID!){ crmAssignPlayers(playerIds:$p, bookId:$b){ ok error } }`, headCtx, {
    p: [String(inBook)],
    b: bookId,
  })

  const agentLogin = await run(`mutation{ crmLogin(username:"tagagent", password:"AgentPass2026"){ ok token } }`, anonCtx)
  agentCtx = await mkCtx(agentLogin.crmLogin.token)
})

after(async () => {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  for (const stmt of [
    sql`DELETE FROM crm_player_tags WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_tags WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_pii_access_log WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_login_attempts WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_player_assignments WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_books WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_users WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_roles WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_whitelabel_settings WHERE tenant = ${TENANT}`,
    sql`DELETE FROM audit_logs WHERE tenant = ${TENANT}`,
    sql`DELETE FROM users WHERE tenant = ${TENANT}`,
  ]) {
    await db.execute(stmt)
  }
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()
  const { closeRedisClient } = await import('@src/config/redisClient.js')
  await closeRedisClient()
})

async function tagId(name: string): Promise<string> {
  const res = await run(`{ crmTags(includeArchived:true){ id name } }`, headCtx)
  const t = res.crmTags.find((x: any) => x.name === name)
  assert.ok(t, `expected a tag named ${name}`)
  return t.id
}

describe('the vocabulary is owned, not free text', () => {
  it('creates a tag', async () => {
    const res = await run(
      `mutation{ crmCreateTag(name:"High value", colour:"#2563eb", description:"Top decile by stake"){ ok error } }`,
      headCtx
    )
    assert.equal(res.crmCreateTag.ok, true, res.crmCreateTag.error ?? '')
  })

  it('refuses a duplicate name whatever its case', async () => {
    const res = await run(`mutation{ crmCreateTag(name:"high VALUE"){ ok error } }`, headCtx)
    assert.equal(res.crmCreateTag.ok, false)
    assert.match(res.crmCreateTag.error, /already exists/)
  })

  it('refuses a colour that is not a hex value', async () => {
    const res = await run(`mutation{ crmCreateTag(name:"Bad Colour", colour:"blue"){ ok error } }`, headCtx)
    assert.equal(res.crmCreateTag.ok, false)
    assert.match(res.crmCreateTag.error, /hex/)
  })

  it('does not let an agent change the vocabulary', async () => {
    await assert.rejects(
      async () => run(`mutation{ crmCreateTag(name:"Agent Made"){ ok } }`, agentCtx),
      /Forbidden/,
      'renaming a label a report is built on is a supervisor decision'
    )
  })

  it('does let an agent apply one', async () => {
    const id = await tagId('High value')
    const res = await run(`mutation($p:[ID!]!,$t:[ID!]!){ crmApplyTags(playerIds:$p, tagIds:$t){ ok error } }`, agentCtx, {
      p: [String(inBook)],
      t: [id],
    })
    assert.equal(res.crmApplyTags.ok, true, res.crmApplyTags.error ?? '')
  })
})

describe('tagging cannot reach outside the caller\'s books', () => {
  it('refuses a player the agent cannot see', async () => {
    const id = await tagId('High value')
    const res = await run(`mutation($p:[ID!]!,$t:[ID!]!){ crmApplyTags(playerIds:$p, tagIds:$t){ ok error } }`, agentCtx, {
      p: [String(outOfBook)],
      t: [id],
    })
    assert.equal(res.crmApplyTags.ok, false)

    // And nothing landed.
    const { getTagsForPlayers } = await import('@src/repos/crm/CrmTagsRepo.js')
    const map = await getTagsForPlayers(TENANT, [outOfBook])
    assert.equal(map.get(outOfBook), undefined)
  })

  it('filters within the book scope, never around it', async () => {
    const id = await tagId('High value')
    // Give the out-of-book player the tag through the administrator, who can
    // reach them — the agent must still not see them in a tag-filtered list.
    await run(`mutation($p:[ID!]!,$t:[ID!]!){ crmApplyTags(playerIds:$p, tagIds:$t){ ok error } }`, headCtx, {
      p: [String(outOfBook)],
      t: [id],
    })

    const asAgent = await run(
      `query($t:[ID!]){ crmPlayers(filter:{tagIds:$t}, limit:50){ total items{ id } } }`,
      agentCtx,
      { t: [id] }
    )
    assert.deepEqual(
      asAgent.crmPlayers.items.map((p: any) => p.id),
      [String(inBook)],
      'a tag filter must narrow the book scope, not widen it'
    )

    const asHead = await run(
      `query($t:[ID!]){ crmPlayers(filter:{tagIds:$t}, limit:50){ total } }`,
      headCtx,
      { t: [id] }
    )
    assert.equal(asHead.crmPlayers.total, 2, 'the administrator sees both')
  })

  it('reveals nothing about another tenant\'s tag id', async () => {
    const res = await run(
      `query($t:[ID!]){ crmPlayers(filter:{tagIds:$t}, limit:50){ total } }`,
      headCtx,
      { t: [randomUUID()] }
    )
    assert.equal(res.crmPlayers.total, 0)
  })
})

describe('archiving and merging', () => {
  it('archives without losing who carried it', async () => {
    await run(`mutation{ crmCreateTag(name:"Churn risk"){ ok } }`, headCtx)
    const id = await tagId('Churn risk')
    await run(`mutation($p:[ID!]!,$t:[ID!]!){ crmApplyTags(playerIds:$p, tagIds:$t){ ok } }`, headCtx, {
      p: [String(inBook)],
      t: [id],
    })
    const res = await run(`mutation($id:ID!){ crmArchiveTag(id:$id, archived:true){ ok error } }`, headCtx, { id })
    assert.equal(res.crmArchiveTag.ok, true, res.crmArchiveTag.error ?? '')

    const live = await run(`{ crmTags{ name } }`, headCtx)
    assert.equal(live.crmTags.some((t: any) => t.name === 'Churn risk'), false, 'archived tags are not offered')

    const all = await run(`{ crmTags(includeArchived:true){ name isArchived playerCount } }`, headCtx)
    const archived = all.crmTags.find((t: any) => t.name === 'Churn risk')
    assert.equal(archived.isArchived, true)
    assert.equal(archived.playerCount, 1, 'the player still carries it')
  })

  it('refuses to apply an archived tag', async () => {
    const id = await tagId('Churn risk')
    const res = await run(`mutation($p:[ID!]!,$t:[ID!]!){ crmApplyTags(playerIds:$p, tagIds:$t){ ok error } }`, headCtx, {
      p: [String(outOfBook)],
      t: [id],
    })
    // The call succeeds but applies nothing — an archived label is not offered.
    const { getTagsForPlayers } = await import('@src/repos/crm/CrmTagsRepo.js')
    const map = await getTagsForPlayers(TENANT, [outOfBook])
    assert.equal(
      (map.get(outOfBook) ?? []).some((t) => t.name === 'Churn risk'),
      false,
      'an archived tag must not be applicable'
    )
    assert.equal(res.crmApplyTags.ok, true)
  })

  it('merges one tag into another, keeping players who had both', async () => {
    await run(`mutation{ crmCreateTag(name:"HighValue"){ ok } }`, headCtx)
    const dupe = await tagId('HighValue')
    const canonical = await tagId('High value')

    // The in-book player already has the canonical tag; give them the duplicate
    // too, so the merge has to survive a collision on the primary key.
    await run(`mutation($p:[ID!]!,$t:[ID!]!){ crmApplyTags(playerIds:$p, tagIds:$t){ ok } }`, headCtx, {
      p: [String(inBook), String(outOfBook)],
      t: [dupe],
    })

    const res = await run(`mutation($f:ID!,$i:ID!){ crmMergeTags(fromId:$f, intoId:$i){ ok error } }`, headCtx, {
      f: dupe,
      i: canonical,
    })
    assert.equal(res.crmMergeTags.ok, true, res.crmMergeTags.error ?? '')

    const all = await run(`{ crmTags(includeArchived:true){ id name isArchived mergedIntoId playerCount } }`, headCtx)
    const merged = all.crmTags.find((t: any) => t.id === dupe)
    assert.equal(merged.isArchived, true, 'the folded tag is archived, not deleted')
    assert.equal(merged.mergedIntoId, canonical, 'and still points at where it went')
    assert.equal(merged.playerCount, 0, 'its players moved across')

    const target = all.crmTags.find((t: any) => t.id === canonical)
    assert.equal(target.playerCount, 2, 'both players carry the canonical tag exactly once')
  })

  it('refuses to merge a tag into itself', async () => {
    const id = await tagId('High value')
    const res = await run(`mutation($f:ID!,$i:ID!){ crmMergeTags(fromId:$f, intoId:$i){ ok error } }`, headCtx, {
      f: id,
      i: id,
    })
    assert.equal(res.crmMergeTags.ok, false)
    assert.match(res.crmMergeTags.error, /itself/)
  })
})

describe('merging moves players in one statement, not two', () => {
  // Finding #17: the copy (INSERT...SELECT) and the delete (DELETE WHERE
  // tag_id = fromId) used to be two separate round-trips, each against its own
  // READ COMMITTED snapshot. A tag applied to a player by a *different*
  // request, landing in the gap between them, was removed by the delete
  // without ever having been seen by the copy — the player fell out of both
  // the old tag and the new one, silently.
  //
  // The fix folds both into one statement (a DELETE...RETURNING feeding an
  // INSERT through a CTE), so there is no gap for another transaction's commit
  // to land in — not "a smaller window", genuinely none, because a single SQL
  // statement's DELETE and INSERT execute against the same snapshot. That
  // makes this provable by construction rather than by racing a timing window,
  // so what follows is a correctness proof plus a concurrency stress pass —
  // not an attempt to catch a gap that no longer exists.
  let fromId = ''
  let intoId = ''
  let seeded: number[] = []

  async function makePlayer(name: string): Promise<number> {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const r = await db.execute(sql`
      INSERT INTO users (tenant, name, username, phone, password_hash)
      VALUES (${TENANT}, ${name}, ${name.replace(/\s/g, '').toLowerCase() + randomUUID().slice(0, 6)},
              ${'9' + Math.floor(Math.random() * 1e9)}, 'x')
      RETURNING id`)
    return Number((r.rows[0] as { id: number }).id)
  }

  it('seeds two fresh tags and ten players already carrying the source tag', async () => {
    const { createCrmTag } = await import('@src/repos/crm/CrmTagsRepo.js')
    const from = await createCrmTag({ tenant: TENANT, name: 'Race Source ' + randomUUID().slice(0, 6), colour: '#111111' })
    const into = await createCrmTag({ tenant: TENANT, name: 'Race Target ' + randomUUID().slice(0, 6), colour: '#222222' })
    fromId = from.id
    intoId = into.id

    seeded = await Promise.all(Array.from({ length: 10 }, (_, i) => makePlayer(`Racer ${i}`)))
    const { applyTagsToPlayers } = await import('@src/repos/crm/CrmTagsRepo.js')
    const n = await applyTagsToPlayers({ tenant: TENANT, playerIds: seeded, tagIds: [fromId], taggedBy: 'crm:setup' })
    assert.equal(n, 10)
  })

  it('every pre-existing row survives the merge under concurrent write pressure on the same table', async () => {
    const { mergeCrmTags, applyTagsToPlayers } = await import('@src/repos/crm/CrmTagsRepo.js')
    const { pool } = await import('@src/db/client.js')

    // Warm the pool: cold connections stagger the transactions and the merge
    // would run in effective isolation, proving nothing about interference.
    await Promise.all(Array.from({ length: 6 }, () => pool.query('SELECT pg_sleep(0.05)')))

    // A second, unrelated tag applied to the SAME ten rows concurrently — real
    // write contention on the exact table region the merge statement touches.
    const { createCrmTag } = await import('@src/repos/crm/CrmTagsRepo.js')
    const bystander = await createCrmTag({ tenant: TENANT, name: 'Race Bystander ' + randomUUID().slice(0, 6), colour: '#333333' })

    const [mergeResult] = await Promise.all([
      mergeCrmTags(TENANT, fromId, intoId),
      ...seeded.map((p) => applyTagsToPlayers({ tenant: TENANT, playerIds: [p], tagIds: [bystander.id], taggedBy: 'crm:racer' })),
    ])
    assert.equal(mergeResult.ok, true, mergeResult.reason ?? '')
    assert.equal(mergeResult.moved, 10, 'all ten pre-existing rows were captured by the one atomic statement')

    const { getTagsForPlayers } = await import('@src/repos/crm/CrmTagsRepo.js')
    const tagsByPlayer = await getTagsForPlayers(TENANT, seeded)
    for (const p of seeded) {
      const names = (tagsByPlayer.get(p) ?? []).map((t) => t.id)
      assert.ok(names.includes(intoId), `player ${p} must carry the destination tag`)
      assert.ok(!names.includes(fromId), `player ${p} must not carry the archived source tag`)
      assert.ok(names.includes(bystander.id), `the concurrent bystander tag must still have landed`)
    }
  })
})
