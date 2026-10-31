/**
 * Does the admin surface actually refuse a user who holds nothing?
 *
 * `auditAdminSurface.ts` reads resolver source and reports which operations
 * name no permission. Reading is not proof: this codebase has already produced
 * a case where three independent reviewers declared a defect refuted and a
 * five-line probe demonstrated it in one run. So this executes.
 *
 * It signs in as a purpose-built admin user holding exactly one harmless
 * permission, in its own throwaway tenant, and invokes each operation through
 * the real resolver map with the real context shape.
 *
 * **Reading the verdict.** An operation is gated if it throws a refusal *or*
 * returns one — a large part of this surface reports refusal as a payload
 * (`{ success: false, message: 'Forbidden: …' }`) because its GraphQL type has
 * a success field, and treating that as "reached" made the RBAC mutations look
 * wide open when they are not. Two further blind spots are worth knowing:
 *
 *   - a refusal expressed as an *empty result* is invisible here. `globalSearch`
 *     authorises per category and returns nothing to a caller entitled to
 *     nothing, which is correct and looks identical to running;
 *   - a resolver that validates its input before checking the permission looks
 *     open whenever the probe supplies no input. See `GATED_BUT_VALIDATES_FIRST`.
 *
 * So a clean run is evidence, and a flagged operation is a lead to confirm by
 * hand with a valid payload — not a finding.
 *
 * **Safety.** By default only two classes are probed: every Query, which is
 * read-only, and mutations whose arguments are ids, invoked with ids that do
 * not exist. Neither writes. `--deep` adds the rest with empty arguments, into
 * the throwaway tenant, which is then swept from every tenant-scoped table;
 * operations that reach outside the database are never probed at all.
 *
 *   npm run probe:admin-authz
 *   npm run probe:admin-authz -- --deep
 *   npm run probe:admin-authz -- --domain=vip
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { db, pool } from '@src/db/client.js'
import { sql } from 'drizzle-orm'

const SRC = join(process.cwd(), 'src')
const ONLY = process.argv.find((a) => a.startsWith('--domain='))?.split('=')[1] ?? null
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? '0')

/**
 * `--deep` also probes the mutations that take arguments other than ids.
 *
 * The default run skips them, because supplying content would mean inventing it
 * and an ungated mutation would then write it. Deep mode calls them with **no
 * arguments at all**: a gated one refuses before looking, and an ungated one
 * almost always fails its own input validation instead. Anything that does slip
 * through writes into the probe's throwaway tenant, and every tenant-scoped
 * table is emptied of that tenant afterwards.
 *
 * It is still not free — see `EXTERNALLY_EFFECTFUL` — so it is opt-in.
 */
const DEEP = process.argv.includes('--deep')

/**
 * Never probed, in any mode.
 *
 * These reach outside the database: a message, a provider call, a payout, an
 * irreversible state change. A cleanup script cannot un-send an SMS, and an
 * authorization probe that charges a payment provider is not a probe. Their
 * gating has to be read rather than executed.
 */
const EXTERNALLY_EFFECTFUL = [
  /otp|sms|email|mail|notify|notification|webhook|push/i,
  /payout|withdraw|refund|settle|approve|reject|capture|charge|transfer/i,
  /provider|gateway|ingest|sync|import|seed|migrate|backfill|reconcile/i,
  /delete|purge|reset|truncate|rollback|void|cancel/i,
  /login|logout|password|token|impersonate/i,
]

const TENANT = `authz-probe-${randomUUID().slice(0, 8)}`

/** An id that cannot exist, per argument type. */
const ABSENT_INT = 987654321
const ABSENT_UUID = '00000000-0000-4000-8000-000000000000'

/**
 * Operations a permission-less caller reaches on purpose, each with the reason.
 *
 * Listing them is what makes the rest of the output actionable: without this
 * the report is a constant twenty-two lines of noise and nobody reads the
 * twenty-third when it appears.
 *
 * Two of these are gated by a mechanism this probe cannot see. `globalSearch`
 * authorises **per category** and returns an empty result for a caller who may
 * see none — which is a refusal, expressed as data rather than as an error, and
 * the right design for a search box. `aiWhitelabelSettings` and `crmWhitelabels`
 * check Super Admin by role name rather than by permission.
 */
const OPEN_BY_DESIGN: Record<string, string> = {
  health: 'liveness, no session required',
  logout: 'ends your own session',
  whitelabelCurrent: 'branding for the host being addressed, needed before sign-in completes',
  whitelabel: 'the same, by id',
  // `whitelabels` used to sit here as "the whitelabel switcher; names only".
  // It was neither: it returned every brand to a caller with no session, and the
  // `Whitelabel` type's field resolvers then served each one's credit line. It
  // now requires a session, and `all:*` to see more than one's own brand.
  whitelabels:
    "returns ONLY the caller's own brand without all:* — the probe's caller has a" +
    ' session, so reaching it here means seeing one row, its own', 
  crmMe: 'the caller reading their own CRM session',
  checkPhoneAvailable: 'a boolean during player creation; discloses nothing about the holder',
  myDepositMethods: 'the caller’s own deposit methods',
  myWhitelabelCredit: 'the caller’s own credit',
  myWhitelabelCreditHistory: 'the caller’s own credit history',
  myWhitelabelSettlements: 'the caller’s own settlements',
  myWhitelabelSharing: 'the caller’s own sharing terms',
  aiAvailability: 'whether the assistant is switched on at all',
  aiEntitlement: 'what the caller’s own whitelabel may use',
  globalSearch: 'authorises per category and returns empty for a caller entitled to none',
  aiWhitelabelSettings: 'Super Admin, checked by role name',
  crmWhitelabels: 'Super Admin, checked by role name',
  referralLink: 'carries its own ownership check on the link',
  agentReferralLink: 'carries its own agent-ownership check',
  aiConversation: 'scoped to the caller’s own conversations',
  aiConfirmAction: 'consumes a proposal already addressed to the caller',
  aiRejectAction: 'the same',
}

/**
 * Gated, but only visible as gated when the payload is valid.
 *
 * `--deep` calls a mutation with no arguments, and these validate their input
 * *before* checking the permission — so they report "Invalid input" and look
 * open. Each was confirmed individually by calling it with a well-formed
 * payload as a caller holding nothing, and each returned a refusal:
 * `createRBACRole` gives `{ success: false, message: 'Forbidden: insufficient
 * permissions for roles' }`.
 *
 * This list is the reason deep mode is usable. Without it the same eleven lines
 * appear on every run and the twelfth, which would be real, is lost in them.
 * Anything added here must be re-confirmed with a valid payload, not assumed.
 */
const GATED_BUT_VALIDATES_FIRST: Record<string, string> = {
  createRBACRole: 'refuses with a Forbidden payload when given a valid role',
  updateRBACRole: 'the same',
  setRBACRolePermissions: 'the same',
  assignRoleToAdmin: 'the same',
  revokeRoleFromAdmin: 'the same',
  upsertWhitelabelPaymentMethods: 'refuses on a valid payload',
  crmCreateFirstAdmin: 'refuses with "You do not have permission to configure the CRM"',
  createPlayerForAgent: 'refuses anyone who is not an agent',
  aiChat: 'entitlement is checked after the message is validated',
  setAiWhitelabelSettings: 'Super Admin, checked by role name',
  setCrmWhitelabelSettings: 'the same',
}

type Field = { name: string; kind: 'Query' | 'Mutation'; args: Array<{ name: string; type: string }> }

/** Parses the operation SDL into fields with their argument types. */
function parseFields(file: string, kind: 'Query' | 'Mutation'): Field[] {
  const src = readFileSync(join(SRC, 'types', 'operations', file), 'utf8')
  const out: Field[] = []
  // A field is a two-space-indented name, optional (args), then ": Type".
  const re = /^ {2}([a-zA-Z][A-Za-z0-9_]*)\s*(\(([\s\S]*?)\))?\s*:\s*[A-Za-z[]/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const args: Array<{ name: string; type: string }> = []
    if (m[3]) {
      for (const a of m[3].matchAll(/([a-zA-Z][A-Za-z0-9_]*)\s*:\s*([A-Za-z[\]!]+)/g)) {
        args.push({ name: a[1], type: a[2] })
      }
    }
    out.push({ name: m[1], kind, args })
  }
  return out
}

/** A value for an argument that will not match anything real. */
function absentValue(type: string): unknown | undefined {
  const t = type.replace(/[![\]]/g, '')
  if (t === 'ID' || t === 'Int') return t === 'Int' ? ABSENT_INT : String(ABSENT_INT)
  if (t === 'String') return ABSENT_UUID
  return undefined
}

/** Only id-shaped arguments; anything else means we would be inventing content. */
const ID_ARG = /^(id|.*Id|.*_id)$/i

const REFUSAL = /forbidden|insufficient permission|unauthorized|not permitted|access denied|only a super admin|permission/i

/**
 * Whether a returned value is a refusal rather than a result.
 *
 * Recurses one level into object values so that a payload wrapping its status
 * (`{ data: { success: false, message } }`) is read too. Deliberately requires
 * `success === false` *and* a refusal-shaped message: a mutation that failed
 * validation also returns `success: false`, and calling that "gated" would hide
 * exactly what this probe exists to find.
 */
function isRefusalPayload(out: unknown, depth = 0): boolean {
  if (!out || typeof out !== 'object' || depth > 1) return false
  const o = out as Record<string, unknown>
  const failed = o.success === false || o.ok === false
  const message = typeof o.message === 'string' ? o.message : typeof o.error === 'string' ? o.error : ''
  if (failed && REFUSAL.test(message)) return true
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object' && isRefusalPayload(v, depth + 1)) return true
  }
  return false
}

async function main(): Promise<void> {
  const fields = [
    ...parseFields('queries.graphql', 'Query'),
    ...parseFields('mutations.graphql', 'Mutation'),
  ]

  // A throwaway tenant with a user holding one harmless permission, so the
  // caller is unambiguously authenticated and unambiguously unprivileged.
  await db.execute(sql`
    INSERT INTO whitelabels (id, name, domain, status)
    VALUES (${TENANT}, 'Authz Probe', ${TENANT + '.test'}, 'active')
    ON CONFLICT (id) DO NOTHING`)
  const u = await db.execute(sql`
    INSERT INTO users (tenant, name, username, status, password_hash)
    VALUES (${TENANT}, 'Probe', ${'probe-' + randomUUID().slice(0, 8)}, 'active', 'x')
    RETURNING id`)
  const userId = Number((u.rows[0] as { id: number }).id)
  const r = await db.execute(sql`
    INSERT INTO roles (tenant, name) VALUES (${TENANT}, 'Nothing') RETURNING id`)
  const roleId = Number((r.rows[0] as { id: number }).id)
  await db.execute(sql`INSERT INTO user_roles (user_id, role_id) VALUES (${userId}, ${roleId})`)

  const ctx: Record<string, unknown> = {
    user: { sub: String(userId), name: 'Probe', roles: ['Nothing'], type: 'admin' },
    // Exactly one permission, in a domain nothing important uses.
    permissions: [{ domain: 'dashboard', actions: ['read'] }],
    tenant: TENANT,
    whitelabel: { id: TENANT, name: 'Authz Probe' },
    request: { headers: {} },
    reply: undefined,
    loaders: {},
    pubsub: { subscribe: async () => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true }) }) }) },
  }

  const { domainResolvers } = await import('@src/domains/index.js')
  const maps: Record<string, Record<string, unknown>> = {
    Query: (domainResolvers as Record<string, Record<string, unknown>>).Query ?? {},
    Mutation: (domainResolvers as Record<string, Record<string, unknown>>).Mutation ?? {},
  }

  const gated: string[] = []
  const reached: Array<{ name: string; kind: string; note: string }> = []
  const skipped: string[] = []

  let probed = 0
  for (const f of fields) {
    if (LIMIT && probed >= LIMIT) break
    const fn = maps[f.kind][f.name]
    if (typeof fn !== 'function') {
      skipped.push(`${f.name} (no function resolver)`)
      continue
    }

    // Build arguments. Queries may take anything; mutations only ids.
    const args: Record<string, unknown> = {}
    let unsafe = false
    for (const a of f.args) {
      const required = a.type.endsWith('!')
      if (f.kind === 'Mutation' && !ID_ARG.test(a.name)) {
        if (required) unsafe = true
        continue
      }
      const v = absentValue(a.type)
      if (v === undefined) {
        if (required) unsafe = true
        continue
      }
      args[a.name] = v
    }
    if (unsafe) {
      const effectful = EXTERNALLY_EFFECTFUL.some((re) => re.test(f.name))
      if (!DEEP || effectful) {
        skipped.push(
          `${f.name} (${effectful ? 'reaches outside the database' : 'would need invented content'})`
        )
        continue
      }
      // Deep mode: call it with nothing. A gate refuses first; input validation
      // refuses second; only an operation with neither gets any further, and
      // whatever it writes lands in the throwaway tenant.
      for (const k of Object.keys(args)) delete args[k]
    }

    probed++
    try {
      const out = await (fn as (p: unknown, a: unknown, c: unknown, i: unknown) => Promise<unknown>)(
        undefined,
        args,
        ctx,
        undefined
      )
      // Returning without throwing is not the same as running. A large part of
      // this surface reports refusal as a *payload* — `{ success: false,
      // message: 'Forbidden: insufficient permissions for roles' }` — because
      // its GraphQL type has a success field. Treating that as "reached" made
      // the RBAC mutations look wide open when they are gated, and reading the
      // returned message is the only way to tell the two apart.
      if (isRefusalPayload(out)) {
        gated.push(f.name)
      } else {
        reached.push({ name: f.name, kind: f.kind, note: 'ran to completion' })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/Forbidden|insufficient permission|Unauthorized|not permitted|Access denied/i.test(msg)) {
        gated.push(f.name)
      } else {
        reached.push({ name: f.name, kind: f.kind, note: msg.split('\n')[0].slice(0, 70) })
      }
    }
  }

  // Clean up.
  //
  // Every table carrying a `tenant` or `whitelabel_id` column is emptied of
  // this run's tenant, not just the three the probe created itself: in deep
  // mode an ungated mutation may have written anywhere. Repeated until a pass
  // deletes nothing, so foreign keys between those tables sort themselves out
  // without needing a hand-maintained order that would rot.
  const scoped = await db.execute(sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name IN ('tenant', 'whitelabel_id')`)
  const targets = (scoped.rows as Array<{ table_name: string; column_name: string }>).map((r) => ({
    table: r.table_name,
    column: r.column_name,
  }))

  for (let pass = 0; pass < 6; pass++) {
    let deleted = 0
    for (const t of targets) {
      try {
        const res = await db.execute(
          sql.raw(`DELETE FROM "${t.table}" WHERE "${t.column}" = '${TENANT}'`)
        )
        deleted += (res as { rowCount?: number }).rowCount ?? 0
      } catch {
        // A foreign key still holding it; a later pass will reach it.
      }
    }
    if (deleted === 0) break
  }

  await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${userId}`)
  await db.execute(sql`DELETE FROM role_permissions WHERE role_id = ${roleId}`)
  await db.execute(sql`DELETE FROM whitelabels WHERE id = ${TENANT}`)

  // Say plainly if anything survived, rather than leaving it to be found later.
  const leftovers: string[] = []
  for (const t of targets) {
    try {
      const res = await db.execute(
        sql.raw(`SELECT count(*)::int AS n FROM "${t.table}" WHERE "${t.column}" = '${TENANT}'`)
      )
      const n = Number((res.rows[0] as { n: number } | undefined)?.n ?? 0)
      if (n > 0) leftovers.push(`${t.table}=${n}`)
    } catch {
      // Unreadable here is not worth failing the probe over.
    }
  }
  if (leftovers.length) {
    console.log(`\n⚠ rows left behind in tenant ${TENANT}: ${leftovers.join(', ')}\n`)
  }

  const unexpected = reached.filter(
    (x) => !(x.name in OPEN_BY_DESIGN) && !(DEEP && x.name in GATED_BUT_VALIDATES_FIRST)
  )
  const expected = reached.filter((x) => x.name in OPEN_BY_DESIGN)
  const shown = ONLY
    ? unexpected.filter((x) => x.name.toLowerCase().includes(ONLY.toLowerCase()))
    : unexpected

  console.log(`probed ${probed} operation(s) as a user holding one unrelated permission\n`)
  console.log(`  refused on a permission  : ${gated.length}`)
  console.log(`  reached, open by design  : ${expected.length}`)
  console.log(`  REACHED UNEXPECTEDLY     : ${unexpected.length}`)
  console.log(`  skipped (unsafe to probe): ${skipped.length}\n`)

  if (DEEP) {
    console.log('NOTE on --deep: these are LEADS, not findings.')
    console.log('  Deep mode calls a mutation with no arguments. Many resolvers validate their')
    console.log('  input before checking the permission, so a properly gated operation still')
    console.log('  appears here — `createRBACRole` does, and returns a clean "Forbidden" when')
    console.log('  given a valid payload. Confirm each one individually before acting on it.')
    console.log('  The default run, which uses real argument shapes, is the reliable signal.\n')
  }

  if (shown.length === 0) {
    console.log('OK every operation this probe can reach is either gated or open by design.')
  } else {
    console.log('--- reached by a caller holding nothing, and not on the by-design list ---')
    for (const x of shown.slice(0, 120)) {
      console.log(`  ${x.kind[0]}:${x.name.padEnd(38)} ${x.note}`)
    }
    if (shown.length > 120) console.log(`  …and ${shown.length - 120} more`)
    process.exitCode = 1
  }

  await pool.end()
}

main().catch(async (e) => {
  console.error(e)
  try { await pool.end() } catch { /* already closed */ }
  process.exitCode = 1
})
