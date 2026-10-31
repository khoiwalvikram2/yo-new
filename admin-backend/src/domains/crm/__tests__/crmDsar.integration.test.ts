/**
 * Data subject requests.
 *
 * The assertions that matter are about the boundary, in both directions:
 *
 *   - the export must contain what the CRM holds — and must NOT contain a note
 *     the admin panel marked admin_only, because a DSAR run from the CRM must
 *     not become the way around that visibility wall;
 *   - the erasure must remove the prose and must NOT touch the rows the law
 *     requires kept: RG episodes, consent records, the exclusion register.
 *     An erasure that reached the register would let a self-excluded player
 *     re-register — the exact harm the register exists to prevent;
 *   - both must refuse a player of another whitelabel with the same "not
 *     found" a missing id gets.
 *
 * Requires DATABASE_URL. Uses its own tenants and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const TENANT = `crm-dsar-${randomUUID().slice(0, 8)}`
const OTHER = `crm-dsar-other-${randomUUID().slice(0, 8)}`

let admin = ''
let bookId = ''
let subject = 0
let bystander = 0
let foreignPlayer = 0

const DSAR = [{ domain: 'crm.dsar', actions: ['export', 'erase'] }]

function ctx(userId: string, permissions = DSAR, tenant = TENANT, status = 'ACTIVE') {
  return {
    crmUser: { id: userId, name: 'Admin', tenant, status, requirePasswordReset: false },
    permissions,
  } as any
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')

  for (const t of [TENANT, OTHER]) {
    await db.execute(sql`
      INSERT INTO crm_whitelabel_settings (tenant, enabled, seat_limit) VALUES (${t}, true, 10)`)
  }
  const u = await db.execute(sql`
    INSERT INTO crm_users (tenant, name, status) VALUES (${TENANT}, 'Admin', 'ACTIVE') RETURNING id`)
  admin = String((u.rows[0] as { id: string }).id)

  const b = await db.execute(sql`
    INSERT INTO crm_books (tenant, name) VALUES (${TENANT}, 'Book') RETURNING id`)
  bookId = String((b.rows[0] as { id: string }).id)

  const mkPlayer = async (tenant: string) => {
    const p = await db.execute(sql`
      INSERT INTO users (tenant, name, username, status, password_hash)
      VALUES (${tenant}, 'Subject', ${`p-${randomUUID().slice(0, 10)}`}, 'active', 'x') RETURNING id`)
    return Number((p.rows[0] as { id: number }).id)
  }
  subject = await mkPlayer(TENANT)
  bystander = await mkPlayer(TENANT)
  foreignPlayer = await mkPlayer(OTHER)

  // The subject's record, one of everything.
  await db.execute(sql`
    INSERT INTO crm_player_notes (tenant, player_id, body, visibility, author_crm_user_id, author_name)
    VALUES (${TENANT}, ${subject}, 'Prefers evening calls', 'all', ${admin}::uuid, 'Admin'),
           (${TENANT}, ${subject}, 'ADMIN SECRET: under investigation', 'admin_only', ${admin}::uuid, 'Admin')`)
  await db.execute(sql`
    INSERT INTO crm_contact_attempts (tenant, player_id, channel, direction, outcome, notes, by_crm_user_id, by_name)
    VALUES (${TENANT}, ${subject}, 'call', 'out', 'connected', 'Asked about the bonus', ${admin}::uuid, 'Admin')`)
  // Source values come from the table's own check constraint.
  await db.execute(sql`
    INSERT INTO crm_player_consents (tenant, player_id, channel, purpose, state, source)
    VALUES (${TENANT}, ${subject}, 'SMS', 'MARKETING', 'WITHDRAWN', 'PLAYER_PORTAL')`)
  await db.execute(sql`
    INSERT INTO crm_consent_events (tenant, player_id, channel, purpose, to_state, source, actor_kind)
    VALUES (${TENANT}, ${subject}, 'SMS', 'MARKETING', 'WITHDRAWN', 'PLAYER_PORTAL', 'player')`)
  const flag = await db.execute(sql`
    INSERT INTO crm_player_rg_flags (tenant, player_id, flag_type, status, initiated_by, blocks_play,
                                     starts_at, min_term_ends_at, raised_by, reason)
    VALUES (${TENANT}, ${subject}, 'SELF_EXCLUSION', 'ACTIVE', 'player', true,
            now(), now() + interval '180 days', 'crm:test', 'asked to be excluded')
    RETURNING id`)
  // The register row points at its source episode, as the real raise path writes it.
  await db.execute(sql`
    INSERT INTO crm_exclusion_register (tenant, identifier_kind, identifier_hash, source_flag_id)
    VALUES (${TENANT}, 'phone', 'deadbeef', ${String((flag.rows[0] as { id: string }).id)}::uuid)`)
  const tag = await db.execute(sql`
    INSERT INTO crm_tags (tenant, name, colour) VALUES (${TENANT}, 'VIP', '#ff0000') RETURNING id`)
  await db.execute(sql`
    INSERT INTO crm_player_tags (tenant, player_id, tag_id, tagged_by)
    VALUES (${TENANT}, ${subject}, ${String((tag.rows[0] as { id: string }).id)}::uuid, 'crm:test')`)
  await db.execute(sql`
    INSERT INTO crm_tasks (tenant, book_id, player_id, created_by, title, body, status, sla_minutes,
                           due_at, breach_at, next_escalation_at)
    VALUES (${TENANT}, ${bookId}::uuid, ${subject}, 'crm:test', 'Call Subject about deposit', 'He mentioned a problem',
            'OPEN', 60, now() + interval '1 hour', now() + interval '2 hours', now() + interval '2 hours')`)

  // A bystander's note, to prove erasure stays on its subject.
  await db.execute(sql`
    INSERT INTO crm_player_notes (tenant, player_id, body, visibility, author_crm_user_id, author_name)
    VALUES (${TENANT}, ${bystander}, 'Bystander note', 'all', ${admin}::uuid, 'Admin')`)
})

after(async () => {
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  for (const t of [TENANT, OTHER]) {
    for (const table of [
      'crm_pii_access_log', 'crm_contact_attempts', 'crm_player_notes', 'crm_player_tags',
      'crm_tags', 'crm_consent_events', 'crm_player_consents',
      // The register references its source flag with ON DELETE RESTRICT, so it
      // must go first.
      'crm_exclusion_register', 'crm_player_rg_flags',
      'crm_task_events', 'crm_tasks', 'crm_books',
      'users', 'crm_users', 'crm_whitelabel_settings', 'audit_logs',
    ]) {
      await db.execute(sql.raw(`DELETE FROM ${table} WHERE tenant = '${t}'`))
    }
  }
})

describe('the export', () => {
  it('refuses without crm.dsar:export', async () => {
    const { crmDsarQueries } = await import('@src/domains/crm/resolvers/dsar.js')
    await assert.rejects(
      () =>
        crmDsarQueries.crmDsarExport(
          null,
          { playerId: String(subject) },
          ctx(admin, [{ domain: 'crm.players', actions: ['view', 'view_all'] }])
        ),
      /Forbidden/
    )
  })

  it('contains what the CRM holds, and never the admin-only note', async () => {
    const { crmDsarQueries } = await import('@src/domains/crm/resolvers/dsar.js')
    const out = await crmDsarQueries.crmDsarExport(null, { playerId: String(subject) }, ctx(admin))

    assert.match(out.filename, /^dsar-player-\d+-\d{4}-\d{2}-\d{2}\.json$/)
    const doc = JSON.parse(out.json)

    assert.equal(doc.player.id, subject)
    assert.ok(
      doc.notes.some((n: { body: string }) => n.body === 'Prefers evening calls'),
      'the CRM note is missing'
    )
    assert.equal(
      JSON.stringify(doc).includes('ADMIN SECRET'),
      false,
      'an admin_only note leaked through the DSAR export'
    )
    assert.ok(doc.contactAttempts.some((c: { notes: string }) => c.notes === 'Asked about the bonus'))
    assert.ok(doc.consents.some((c: { state: string }) => c.state === 'WITHDRAWN'))
    assert.ok(doc.consentHistory.length >= 1, 'consent history missing')
    assert.ok(doc.rgFlags.some((f: { flag_type: string }) => f.flag_type === 'SELF_EXCLUSION'))
    assert.ok(doc.tags.some((t: { name: string }) => t.name === 'VIP'))
    assert.ok(doc.tasks.some((t: { title: string }) => t.title.includes('Call Subject')))
  })

  it('records itself in the personal-data access log', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    await new Promise((r) => setTimeout(r, 200))
    const rows = await db.execute(sql`
      SELECT action FROM crm_pii_access_log
      WHERE tenant = ${TENANT} AND resource_type = 'player_dsar' AND resource_id = ${String(subject)}
        AND action = 'export'`)
    assert.ok(rows.rows.length >= 1, 'the export left no trace of itself')
  })

  it("reports another whitelabel's player as not found", async () => {
    const { crmDsarQueries } = await import('@src/domains/crm/resolvers/dsar.js')
    await assert.rejects(
      () => crmDsarQueries.crmDsarExport(null, { playerId: String(foreignPlayer) }, ctx(admin)),
      /not found/i
    )
  })
})

describe('the erasure', () => {
  it('demands a request reference', async () => {
    const { crmDsarMutations } = await import('@src/domains/crm/resolvers/dsar.js')
    const res = await crmDsarMutations.crmDsarErase(
      null,
      { playerId: String(subject), reason: '  ' },
      ctx(admin)
    )
    assert.equal(res.ok, false)
    assert.match(String(res.error), /reference|reason/i)
  })

  it('redacts the prose, keeps the rows, and stays on its subject', async () => {
    const { crmDsarMutations } = await import('@src/domains/crm/resolvers/dsar.js')
    const res = await crmDsarMutations.crmDsarErase(
      null,
      { playerId: String(subject), reason: 'DSAR-2026-014' },
      ctx(admin)
    )
    assert.equal(res.ok, true, res.error)
    // Both notes (visibility does not shelter prose from the subject's own right).
    assert.equal(res.notesRedacted, 2)
    assert.equal(res.contactNotesCleared, 1)
    assert.equal(res.tasksRedacted, 1)

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')

    const notes = await db.execute(sql`
      SELECT body FROM crm_player_notes WHERE tenant = ${TENANT} AND player_id = ${subject}`)
    assert.equal(notes.rows.length, 2, 'a note row was deleted rather than redacted')
    for (const r of notes.rows as Array<{ body: string }>) {
      assert.match(r.body, /removed under data subject request/)
    }

    const task = await db.execute(sql`
      SELECT title, body, status FROM crm_tasks WHERE tenant = ${TENANT} AND player_id = ${subject}`)
    assert.match((task.rows[0] as { title: string }).title, /removed under/)
    assert.equal((task.rows[0] as { body: string | null }).body, null)
    assert.equal((task.rows[0] as { status: string }).status, 'OPEN', 'the erasure changed workflow state')

    // The bystander's prose is untouched.
    const other = await db.execute(sql`
      SELECT body FROM crm_player_notes WHERE tenant = ${TENANT} AND player_id = ${bystander}`)
    assert.equal((other.rows[0] as { body: string }).body, 'Bystander note')
  })

  it('takes the copies of a task title that assignment left in the desk inboxes', async () => {
    // Assigning or escalating a task copies its title into the assignee's
    // notification row. Redacting only `crm_tasks` left that copy verbatim and
    // still rendering in the bell — the prose the request exists to remove,
    // sitting on screen.
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const { crmDsarMutations } = await import('@src/domains/crm/resolvers/dsar.js')

    const t = await db.execute(sql`
      INSERT INTO crm_tasks (tenant, book_id, player_id, created_by, title, status, sla_minutes,
                             due_at, breach_at, next_escalation_at)
      VALUES (${TENANT}, ${bookId}::uuid, ${subject}, 'crm:test', 'Chase his gambling debt',
              'OPEN', 60, now() + interval '1 hour', now() + interval '2 hours', now() + interval '2 hours')
      RETURNING id`)
    const taskId = String((t.rows[0] as { id: string }).id)
    await db.execute(sql`
      INSERT INTO crm_notifications (tenant, crm_user_id, kind, title, body, resource_type, resource_id)
      VALUES (${TENANT}, ${admin}::uuid, 'task_assigned', 'Chase his gambling debt',
              'he mentioned a problem', 'task', ${taskId})`)
    // A notification about a different subject, to prove the erasure is targeted.
    await db.execute(sql`
      INSERT INTO crm_notifications (tenant, crm_user_id, kind, title, body, resource_type, resource_id)
      VALUES (${TENANT}, ${admin}::uuid, 'system', 'Unrelated notice', 'keep me', 'system', 'x')`)

    const res = await crmDsarMutations.crmDsarErase(
      null,
      { playerId: String(subject), reason: 'DSAR-2026-014 inbox sweep' },
      ctx(admin)
    )
    assert.equal(res.ok, true, res.error)
    assert.equal(res.notificationsRedacted, 1, 'the inbox copy was not redacted')

    const rows = await db.execute(sql`
      SELECT title, body, resource_type FROM crm_notifications WHERE tenant = ${TENANT} ORDER BY resource_type`)
    const all = rows.rows as Array<{ title: string; body: string | null; resource_type: string }>
    assert.equal(
      all.some((r) => r.title.includes('gambling') || String(r.body ?? '').includes('problem')),
      false,
      'the prose survived in the notification inbox'
    )
    const unrelated = all.find((r) => r.resource_type === 'system')
    assert.equal(unrelated?.title, 'Unrelated notice', 'an unrelated notification was redacted too')
    assert.equal(unrelated?.body, 'keep me')

    // And re-running removes nothing further.
    const again = await crmDsarMutations.crmDsarErase(
      null,
      { playerId: String(subject), reason: 'DSAR-2026-014 rerun' },
      ctx(admin)
    )
    assert.equal(again.notificationsRedacted, 0)
  })

  it('leaves the records the law requires: RG, consents, the register', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')

    const rg = await db.execute(sql`
      SELECT reason FROM crm_player_rg_flags WHERE tenant = ${TENANT} AND player_id = ${subject}`)
    assert.equal((rg.rows[0] as { reason: string }).reason, 'asked to be excluded', 'an RG episode was touched')

    const consent = await db.execute(sql`
      SELECT count(*)::int n FROM crm_player_consents WHERE tenant = ${TENANT} AND player_id = ${subject}`)
    assert.equal((consent.rows[0] as { n: number }).n, 1)

    const register = await db.execute(sql`
      SELECT count(*)::int n FROM crm_exclusion_register WHERE tenant = ${TENANT}`)
    assert.equal(
      (register.rows[0] as { n: number }).n, 1,
      'the exclusion register was touched — this is the one table an erasure must never reach'
    )
  })

  it('is idempotent: a second run removes nothing further and still succeeds', async () => {
    const { crmDsarMutations } = await import('@src/domains/crm/resolvers/dsar.js')
    const res = await crmDsarMutations.crmDsarErase(
      null,
      { playerId: String(subject), reason: 'DSAR-2026-014 rerun' },
      ctx(admin)
    )
    assert.equal(res.ok, true)
    assert.equal(res.notesRedacted, 0)
    assert.equal(res.contactNotesCleared, 0)
    assert.equal(res.tasksRedacted, 0)
  })

  it('is audited with its reference', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    await new Promise((r) => setTimeout(r, 300))
    const rows = await db.execute(sql`
      SELECT before FROM audit_logs
      WHERE tenant = ${TENANT} AND action = 'dsar_erase' AND resource_id = ${String(subject)}`)
    assert.ok(rows.rows.length >= 1, 'the erasure was not audited')
    const detail = (rows.rows[0] as { before: { reason?: string } }).before
    assert.match(String(detail?.reason ?? ''), /DSAR-2026-014/)
  })

  it('refuses an INACTIVE user and a foreign player', async () => {
    const { crmDsarMutations } = await import('@src/domains/crm/resolvers/dsar.js')
    await assert.rejects(
      () =>
        crmDsarMutations.crmDsarErase(
          null,
          { playerId: String(subject), reason: 'DSAR-X' },
          ctx(admin, DSAR, TENANT, 'INACTIVE')
        ),
      /inactive/i
    )
    const res = await crmDsarMutations.crmDsarErase(
      null,
      { playerId: String(foreignPlayer), reason: 'DSAR-X' },
      ctx(admin)
    )
    assert.equal(res.ok, false)
    assert.match(String(res.error), /not found/i)
  })
})
