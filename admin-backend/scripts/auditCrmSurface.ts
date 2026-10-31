/**
 * The CRM's own surface, audited in the directions nothing else looks.
 *
 * The GraphQL verifier proves schema, resolvers and front ends agree about what
 * *exists*. It says nothing about whether an operation is guarded, whether a
 * guard can be reached, or whether a permission an administrator can grant does
 * anything at all. Those are the failures that look like working software.
 *
 * Four passes:
 *
 *   1. **Ungated operations.** Every CRM resolver should name the permission it
 *      needs. One that names none is reachable by any signed-in CRM user — which
 *      is how `crmRecordContactAttempt` came to write to a player's record
 *      behind a read permission.
 *
 *   2. **Dead permissions.** Every action in the catalogue should gate
 *      something. One that gates nothing is worse than missing: an administrator
 *      grants it, withholds it, and neither has any effect.
 *
 *   3. **Unscoped by-id paths.** A resolver taking an id must decide whether the
 *      caller may reach *that* row. Tenant alone is not scope — a task id
 *      outlives the player moving to another book, which is exactly the shape of
 *      five defects this codebase shipped with.
 *
 *   4. **Unreachable API.** Fields the backend serves that no front end asks
 *      for: either something is missing from the UI or the field is dead weight.
 */
import 'dotenv/config'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, basename } from 'node:path'

const ROOT = join(process.cwd(), '..')
const RESOLVER_DIR = join(process.cwd(), 'src', 'domains', 'crm', 'resolvers')

/** Operations that legitimately have no permission, with the reason. */
const UNGATED_BY_DESIGN: Record<string, string> = {
  crmLogin: 'the sign-in itself; there is no session yet',
  crmMe: 'the caller reading their own session',
  crmPermissionCatalog: 'the list of grantable permissions, needed to render the role editor',
  crmChangeOwnPassword: 'your own password, verified against the old one',
  crmSetMyAvailability: 'your own availability; it takes no user argument',
  crmMarkNotificationsRead: 'your own inbox; it takes no user argument',
  crmMyNotifications: 'your own inbox; reading someone else’s is not expressible',
  crmCreateFirstAdmin: 'an admin-panel operation, gated by admin permissions instead',
  crmWhitelabels: 'an admin-panel operation, Super Admin only',
  setCrmWhitelabelSettings: 'an admin-panel operation, Super Admin only',
}

/** Scope helpers that count as "this resolver decided whether the caller may reach that row". */
const SCOPE_CALLS = [
  'crmPlayerScope',
  'canCrmUserSeePlayer',
  'assertPlayerReachable',
  'taskReachable',
  'bookReachable',
  'reachable(',
  'canReach',
  'assertCrmAdminSurface',
  'getBookIdsForCrmUser',
]

type Op = { name: string; file: string; body: string }

/** Splits a resolver map file into one entry per operation. */
function readOperations(file: string): Op[] {
  const src = readFileSync(file, 'utf8')
  const out: Op[] = []
  const re = /^ {2}(crm[A-Za-z0-9]*|whitelabelCrm[A-Za-z0-9]*|setCrmWhitelabelSettings):\s*async/gm
  const starts: Array<{ name: string; at: number }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) starts.push({ name: m[1], at: m.index })
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].at : src.length
    out.push({ name: starts[i].name, file: basename(file), body: src.slice(starts[i].at, end) })
  }
  return out
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
      walk(p, out)
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

async function main(): Promise<void> {
  const problems: string[] = []
  const note = (s: string) => problems.push(s)

  const ops: Op[] = []
  for (const f of readdirSync(RESOLVER_DIR)) {
    if (!f.endsWith('.ts') || f === 'index.ts') continue
    ops.push(...readOperations(join(RESOLVER_DIR, f)))
  }
  console.log(`CRM operations found: ${ops.length}`)

  // ---- 1. ungated ---------------------------------------------------------
  const declared = new Map<string, Set<string>>()
  for (const op of ops) {
    const perms = [...op.body.matchAll(/requireCrmPermission\(\s*ctx,\s*'([^']+)',\s*'([^']+)'/g)].map(
      (m) => `${m[1]}:${m[2]}`
    )
    for (const p of perms) {
      if (!declared.has(p)) declared.set(p, new Set())
      declared.get(p)!.add(op.name)
    }
    const guardedElsewhere = /assertCrmAdminSurface|hasPermission\(/.test(op.body)
    if (perms.length === 0 && !guardedElsewhere && !(op.name in UNGATED_BY_DESIGN)) {
      note(`ungated: ${op.file} ${op.name} names no permission`)
    }
  }

  // ---- 2. dead permissions ------------------------------------------------
  const { CRM_PERMISSIONS } = await import('@src/domains/crm/permissions.js')
  const catalogue = CRM_PERMISSIONS.flatMap((g: any) =>
    g.actions.map((a: any) => `${a.domain}:${a.action}`)
  )
  // Some are scope modifiers rather than gates: they widen what a resolver
  // returns instead of deciding whether it runs.
  const SCOPE_MODIFIERS = new Set(['crm.players:view_all'])
  const allResolverSource = ops.map((o) => o.body).join('\n')
  for (const key of catalogue) {
    if (SCOPE_MODIFIERS.has(key)) continue
    const [domain, action] = key.split(':')
    const used =
      declared.has(key) ||
      allResolverSource.includes(`'${domain}', '${action}'`) ||
      // The escalation ladder checks this one in SQL rather than in a resolver.
      (domain === 'crm.tasks' && action === 'escalate')
    if (!used) note(`dead permission: ${key} is grantable but gates nothing`)
  }

  // ---- 3. unscoped by-id --------------------------------------------------
  for (const op of ops) {
    const takesId = /args:\s*\{[^}]*\b(id|playerId|taskId|bookId|crmUserId|flagId)\b/.test(op.body)
    if (!takesId) continue
    const scoped = SCOPE_CALLS.some((c) => op.body.includes(c))
    // Operations on objects that belong to the whitelabel rather than to a
    // book — a tag, a role, a CRM user — are tenant-scoped by nature; there is
    // no narrower scope for them to respect.
    // `crm.books:manage` confers whitelabel-wide player visibility by design —
    // its holder can add themselves to any book via crmSetBookMembers — so a
    // book predicate on the assign path would close nothing. See the comment on
    // the resolver.
    // `crmDsar*` are tenant-scoped on purpose: a data subject request is the
    // whitelabel's legal duty and must reach any of its players, including one
    // no book holds. Both check the player belongs to the tenant via
    // findDsarSubject, and the narrowness comes from the crm.dsar permissions,
    // seeded to the CRM Administrator role alone.
    const TENANT_SCOPED_BY_NATURE = /^(crmAssignPlayers|crmUnassignPlayers|crmUpdateTag|crmArchiveTag|crmMergeTags|crmDeleteRole|crmUpdateRole|crmSetUserRoles|crmSetUserStatus|crmResetUserPassword|crmDeleteUser|crmUpdateUser|crmUpdateBook|crmDeleteBook|crmSetBookMembers|crmRemoveIpAllowlistEntry|crmAddIpAllowlistEntry|crmIpAllowlist|crmBookMembers|crmLoginAttempts|crmPiiAccessLog|crmAcknowledgeTask|crmDsarExport|crmDsarErase)$/

    // Scoped harder than anything above, just not where this check can see it.
    // A segment belongs to the person who wrote it, so `updateCrmSegment` and
    // `deleteCrmSegment` carry `owner_id = <caller>` alongside the tenant in
    // their own WHERE clause — a shared segment is readable by the whole
    // whitelabel and writable only by its author. Putting the predicate in the
    // statement rather than in a preceding lookup is what makes it impossible
    // to reach the write without it; the resolver has no id check to find.
    // Proven by "refuses everyone but its author" and "does not reach another
    // whitelabel's segment" in crmSegmentsAndBulkTasks.integration.test.ts.
    const OWNER_SCOPED_IN_REPOSITORY = /^(crmUpdateSegment|crmDeleteSegment)$/

    if (!scoped && !TENANT_SCOPED_BY_NATURE.test(op.name) && !OWNER_SCOPED_IN_REPOSITORY.test(op.name)) {
      note(`unscoped: ${op.file} ${op.name} takes an id but calls no scope check`)
    }
  }

  // ---- 4. API the UI never asks for ---------------------------------------
  const { typeDefs } = await import('@src/types/graphql.js')
  const crmFields = [...String(typeDefs).matchAll(/^\s{2}(crm[A-Za-z0-9]*)\s*[(:]/gm)].map((m) => m[1])
  const uiSource = walk(join(ROOT, 'crm', 'src'))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')
  const unused = [...new Set(crmFields)].filter((f) => !uiSource.includes(f))
  // Fields the admin panel consumes instead of the CRM app.
  const ADMIN_PANEL_FIELDS = new Set(['crmSettings', 'crmWhitelabels', 'crmCreateFirstAdmin'])
  for (const f of unused) {
    if (ADMIN_PANEL_FIELDS.has(f)) continue
    note(`unreachable: ${f} is served but no CRM screen asks for it`)
  }

  console.log(`permissions in catalogue: ${catalogue.length}`)
  console.log(`crm* schema fields: ${new Set(crmFields).size}`)

  if (problems.length) {
    console.error(`\n${problems.length} finding(s):`)
    for (const p of problems) console.error('  ✖ ' + p)
    process.exitCode = 1
  } else {
    console.log('\n✅ every operation is gated, every permission bites, every id is scoped, every field is used')
  }
}

main().catch((err) => {
  console.error('failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
