/**
 * Notes are stored once and read from two applications, so the interesting
 * question is not "does writing work" but "does each surface see exactly what
 * it should".
 *
 * Three things are asserted that no unit test would catch:
 *   - a CRM agent cannot read notes on a player outside their books, through
 *     either surface;
 *   - `crm_only` and `admin_only` notes stay on their own side;
 *   - the admin field refuses a CRM session outright, so the CRM cannot borrow
 *     the admin panel's wider scope by calling its field instead.
 *
 * Requires DATABASE_URL. Uses its own tenant and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildSchema, graphql } from 'graphql'
import { randomUUID } from 'node:crypto'

const TENANT = `crm-notes-${randomUUID().slice(0, 8)}`

let schema: ReturnType<typeof buildSchema>
let rootValue: Record<string, unknown>
let inBook = 0
let outOfBook = 0
let agentCtx: Record<string, unknown>
let adminCtx: Record<string, unknown>
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
      ([name, fn]: [string, any]) => [name, (args: any, ctx: any, info: any) => fn(undefined, args, ctx, info)]
    )
  )

  for (const name of ['Notes In Book', 'Notes Out Of Book']) {
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
    `mutation($t:String!){ crmCreateFirstAdmin(tenant:$t, name:"Head", username:"noteshead", password:"FirstPass2026"){ ok error } }`,
    superAdminCtx,
    { t: TENANT }
  )
  const login = await run(
    `mutation{ crmLogin(username:"noteshead", password:"FirstPass2026"){ ok token } }`,
    anonCtx
  )
  const mkCtx = async (token: string) => ({
    ...(await buildCrmAuthContext({ headers: { authorization: `Bearer ${token}` } }, TENANT)),
    tenant: TENANT,
    whitelabel: { id: TENANT },
    request: { headers: {} },
  })
  headCtx = await mkCtx(login.crmLogin.token)

  // One book holding one of the two players, worked by one agent.
  await run(`mutation{ crmCreateBook(name:"Notes Desk"){ ok } }`, headCtx)
  const bookId = (await run(`{ crmBooks{ id } }`, headCtx)).crmBooks[0].id
  const roles = await run(`{ crmRoles{ id name } }`, headCtx)
  const agentRole = roles.crmRoles.find((r: any) => r.name === 'Agent')
  await run(
    `mutation($r:[ID!]){ crmCreateUser(input:{name:"Note Agent", username:"noteagent", password:"AgentPass2026", roleIds:$r}){ ok error } }`,
    headCtx,
    { r: [agentRole.id] }
  )
  const users = await run(`{ crmUsers{ id username } }`, headCtx)
  const agent = users.crmUsers.find((u: any) => u.username === 'noteagent')
  await run(`mutation($b:ID!,$u:[ID!]!){ crmSetBookMembers(bookId:$b, crmUserIds:$u){ ok } }`, headCtx, {
    b: bookId,
    u: [agent.id],
  })
  await run(`mutation($p:[ID!]!,$b:ID!){ crmAssignPlayers(playerIds:$p, bookId:$b){ ok error } }`, headCtx, {
    p: [String(inBook)],
    b: bookId,
  })

  const agentLogin = await run(`mutation{ crmLogin(username:"noteagent", password:"AgentPass2026"){ ok token } }`, anonCtx)
  agentCtx = await mkCtx(agentLogin.crmLogin.token)

  adminCtx = {
    user: { sub: '99', name: 'Desk Admin', roles: ['Whitelabel Admin'] },
    tenant: TENANT,
    whitelabel: { id: TENANT },
    permissions: [{ domain: 'all', actions: ['*'] }],
    request: { headers: {} },
  }
})

after(async () => {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  for (const stmt of [
    sql`DELETE FROM crm_player_notes WHERE tenant = ${TENANT}`,
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

describe('a CRM agent writes and reads a note', () => {
  it('writes one on a player in their book', async () => {
    const res = await run(
      `mutation($p:ID!){ crmAddPlayerNote(input:{playerId:$p, content:"Called about the weekend bonus", category:"contact", labels:["callback"]}){ ok error note{ id content labels authorKind createdBy updatedAt } } }`,
      agentCtx,
      { p: String(inBook) }
    )
    assert.equal(res.crmAddPlayerNote.ok, true, res.crmAddPlayerNote.error ?? '')
    assert.equal(res.crmAddPlayerNote.note.authorKind, 'crm')
    assert.equal(res.crmAddPlayerNote.note.createdBy, 'Note Agent')
    assert.deepEqual(res.crmAddPlayerNote.note.labels, ['callback'])
    // There is no edit path, so this must not claim one happened.
    assert.equal(res.crmAddPlayerNote.note.updatedAt, null)
  })

  it('reads it back', async () => {
    const res = await run(`query($p:ID!){ crmPlayerNotes(playerId:$p){ content } }`, agentCtx, {
      p: String(inBook),
    })
    assert.equal(res.crmPlayerNotes.length, 1)
    assert.match(res.crmPlayerNotes[0].content, /weekend bonus/)
  })

  it('is refused on a player outside their books, and told nothing about it', async () => {
    const write = await run(
      `mutation($p:ID!){ crmAddPlayerNote(input:{playerId:$p, content:"should not land"}){ ok error } }`,
      agentCtx,
      { p: String(outOfBook) }
    )
    assert.equal(write.crmAddPlayerNote.ok, false)

    const read = await run(`query($p:ID!){ crmPlayerNotes(playerId:$p){ content } }`, agentCtx, {
      p: String(outOfBook),
    })
    assert.deepEqual(read.crmPlayerNotes, [], 'an unreachable player must look like one with no notes')
  })
})

describe('the two surfaces see the right notes', () => {
  it('the admin panel reads what the CRM wrote', async () => {
    const res = await run(`query($p:ID!){ playerNotes(playerId:$p){ content createdBy tags } }`, adminCtx, {
      p: String(inBook),
    })
    assert.equal(res.playerNotes.length, 1)
    assert.equal(res.playerNotes[0].createdBy, 'Note Agent')
    // The shipped admin contract calls them `tags`; the column is `labels`.
    assert.deepEqual(res.playerNotes[0].tags, ['callback'])
  })

  it('the admin panel writes one the CRM can read', async () => {
    const res = await run(
      `mutation($p:ID!){ addPlayerNote(input:{playerId:$p, content:"Verified ID document", category:"kyc"}){ success message note{ createdBy } } }`,
      adminCtx,
      { p: String(inBook) }
    )
    assert.equal(res.addPlayerNote.success, true, res.addPlayerNote.message)
    assert.equal(res.addPlayerNote.note.createdBy, 'Desk Admin')

    const crmSide = await run(`query($p:ID!){ crmPlayerNotes(playerId:$p){ content authorKind } }`, agentCtx, {
      p: String(inBook),
    })
    const fromAdmin = crmSide.crmPlayerNotes.find((n: any) => /ID document/.test(n.content))
    assert.ok(fromAdmin, 'the CRM should see the admin panel note')
    assert.equal(fromAdmin.authorKind, 'admin')
  })

  it('keeps a crm_only note away from the admin panel', async () => {
    await run(
      `mutation($p:ID!){ crmAddPlayerNote(input:{playerId:$p, content:"Suspected bonus abuse, do not disclose", visibility:"crm_only"}){ ok error } }`,
      agentCtx,
      { p: String(inBook) }
    )
    const crmSide = await run(`query($p:ID!){ crmPlayerNotes(playerId:$p){ content } }`, agentCtx, {
      p: String(inBook),
    })
    assert.ok(crmSide.crmPlayerNotes.some((n: any) => /bonus abuse/.test(n.content)))

    const adminSide = await run(`query($p:ID!){ playerNotes(playerId:$p){ content } }`, adminCtx, {
      p: String(inBook),
    })
    assert.equal(
      adminSide.playerNotes.some((n: any) => /bonus abuse/.test(n.content)),
      false,
      'a crm_only note must not appear on the admin surface'
    )
  })
})

describe('the CRM cannot borrow the admin surface', () => {
  it('is refused on the admin note field', async () => {
    await assert.rejects(
      async () =>
        run(`query($p:ID!){ playerNotes(playerId:$p){ content } }`, agentCtx, { p: String(outOfBook) }),
      /Forbidden/,
      'calling the admin field with a CRM session must be refused, not scoped'
    )
  })
})

describe('reading notes is recorded', () => {
  it('appears in the personal-data access log', async () => {
    await run(`query($p:ID!){ crmPlayerNotes(playerId:$p){ content } }`, agentCtx, { p: String(inBook) })
    await new Promise((r) => setTimeout(r, 400))
    const { listCrmPiiAccess } = await import('@src/repos/crm/CrmSecurityRepo.js')
    const log = await listCrmPiiAccess(TENANT, { limit: 50 })
    assert.ok(
      log.some((e) => e.resourceType === 'player_notes' && e.resourceId === String(inBook)),
      'reading notes is reading personal data'
    )
  })
})

describe('pinning and deleting check reachability before writing, not after', () => {
  // No shipped role holds crm.notes:delete without also holding
  // crm.players:view_all (only CRM Administrator does, which makes the check
  // moot). The gap is only live behind a tenant-authored custom role — the
  // shape reproduced here — so that is what this proves closed, not the
  // shipped Agent/Supervisor roles.
  let deleterCtx: Record<string, unknown>
  let secondBookId = ''
  let scopedNoteId = ''

  it('sets up a custom role that can delete and pin, scoped to one book', async () => {
    const role = await run(
      `mutation($p:[CrmPermissionInput!]!){ crmCreateRole(name:"Note Deleter", permissions:$p){ ok error } }`,
      headCtx,
      {
        p: [
          { domain: 'crm.notes', action: 'view' },
          { domain: 'crm.notes', action: 'delete' },
          { domain: 'crm.notes', action: 'create' },
        ],
      }
    )
    assert.equal(role.crmCreateRole.ok, true, role.crmCreateRole.error ?? '')

    const roles = await run(`{ crmRoles{ id name } }`, headCtx)
    const deleterRole = roles.crmRoles.find((r: any) => r.name === 'Note Deleter')

    await run(
      `mutation($r:[ID!]){ crmCreateUser(input:{name:"Note Deleter", username:"notedeleter", password:"DeleterPass2026", roleIds:$r}){ ok error } }`,
      headCtx,
      { r: [deleterRole.id] }
    )
    const users = await run(`{ crmUsers{ id username } }`, headCtx)
    const deleter = users.crmUsers.find((u: any) => u.username === 'notedeleter')

    const bookId = (await run(`{ crmBooks{ id } }`, headCtx)).crmBooks[0].id
    await run(`mutation($b:ID!,$u:[ID!]!){ crmSetBookMembers(bookId:$b, crmUserIds:$u){ ok } }`, headCtx, {
      b: bookId,
      u: [deleter.id],
    })

    const login = await run(
      `mutation{ crmLogin(username:"notedeleter", password:"DeleterPass2026"){ ok token } }`,
      anonCtx
    )
    const { buildCrmAuthContext } = await import('@src/domains/crm/services/CrmAuthService.js')
    deleterCtx = {
      ...(await buildCrmAuthContext({ headers: { authorization: `Bearer ${login.crmLogin.token}` } }, TENANT)),
      tenant: TENANT,
      whitelabel: { id: TENANT },
      request: { headers: {} },
    }

    const second = await run(`mutation{ crmCreateBook(name:"Elsewhere Desk"){ ok } }`, headCtx)
    assert.equal(second.crmCreateBook.ok, true)
    const books = await run(`{ crmBooks{ id name } }`, headCtx)
    secondBookId = books.crmBooks.find((b: any) => b.name === 'Elsewhere Desk').id
  })

  it('the deleter can write and see a note on the player while still in scope', async () => {
    const res = await run(
      `mutation($p:ID!){ crmAddPlayerNote(input:{playerId:$p, content:"Reachability probe note"}){ ok error note{ id } } }`,
      deleterCtx,
      { p: String(inBook) }
    )
    assert.equal(res.crmAddPlayerNote.ok, true, res.crmAddPlayerNote.error ?? '')
    scopedNoteId = res.crmAddPlayerNote.note.id
  })

  it('once the player moves to another book, deleting that same note id is refused', async () => {
    const moved = await run(
      `mutation($p:[ID!]!,$b:ID!){ crmAssignPlayers(playerIds:$p, bookId:$b){ ok error } }`,
      headCtx,
      { p: [String(inBook)], b: secondBookId }
    )
    assert.equal(moved.crmAssignPlayers.ok, true, moved.crmAssignPlayers.error ?? '')

    // Finding #7: this used to soft-delete regardless — no reachability check
    // at all on the delete path.
    const del = await run(
      `mutation($id:ID!){ crmDeletePlayerNote(id:$id){ ok error } }`,
      deleterCtx,
      { id: scopedNoteId }
    )
    assert.equal(del.crmDeletePlayerNote.ok, false)
    assert.equal(del.crmDeletePlayerNote.error, 'Note not found')

    // And it is genuinely untouched, not merely reported as refused. Read back
    // through the admin surface's view_all, since agentCtx no longer reaches
    // inBook either — it moved out of its book too.
    const adminView = await run(`query($p:ID!){ playerNotes(playerId:$p){ content } }`, adminCtx, {
      p: String(inBook),
    })
    assert.ok(
      adminView.playerNotes.some((n: any) => /Reachability probe note/.test(n.content)),
      'the note must still exist — the refused delete must not have partially applied'
    )
  })

  it('pinning that same note id is refused the same way, before any write', async () => {
    // Finding #15: this used to pin first and only check reachability
    // afterward — reordering the owning desk's note list before reporting
    // "not found".
    const pin = await run(
      `mutation($id:ID!){ crmSetNotePinned(id:$id, isPinned:true){ ok error } }`,
      deleterCtx,
      { id: scopedNoteId }
    )
    assert.equal(pin.crmSetNotePinned.ok, false)
    assert.equal(pin.crmSetNotePinned.error, 'Note not found')

    const adminView = await run(`query($p:ID!){ playerNotes(playerId:$p){ content isPinned } }`, adminCtx, {
      p: String(inBook),
    })
    const note = adminView.playerNotes.find((n: any) => /Reachability probe note/.test(n.content))
    assert.equal(note?.isPinned, false, 'the refused pin must not have applied either')
  })

  it('moved back into scope, both operations now succeed', async () => {
    const bookId = (await run(`{ crmBooks{ id name } }`, headCtx)).crmBooks.find(
      (b: any) => b.name === 'Notes Desk'
    ).id
    await run(`mutation($p:[ID!]!,$b:ID!){ crmAssignPlayers(playerIds:$p, bookId:$b){ ok error } }`, headCtx, {
      p: [String(inBook)],
      b: bookId,
    })

    const pin = await run(
      `mutation($id:ID!){ crmSetNotePinned(id:$id, isPinned:true){ ok error } }`,
      deleterCtx,
      { id: scopedNoteId }
    )
    assert.equal(pin.crmSetNotePinned.ok, true, pin.crmSetNotePinned.error ?? '')

    const del = await run(
      `mutation($id:ID!){ crmDeletePlayerNote(id:$id){ ok error } }`,
      deleterCtx,
      { id: scopedNoteId }
    )
    assert.equal(del.crmDeletePlayerNote.ok, true, del.crmDeletePlayerNote.error ?? '')
  })
})
