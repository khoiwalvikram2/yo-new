/**
 * Every permission the admin panel guards on must exist in a catalogue.
 *
 * This is a whole class of silent bug. `hasPermissionWithNested` returns false
 * for a domain it has never heard of, so a typo in a guard does not raise — it
 * quietly removes a button, a nav item or a search category for everyone except
 * an `all:*` holder. Super Admin sees it working, everybody else does not, and
 * nothing anywhere says why.
 *
 * Three instances of exactly this were live when the test was written:
 *   - the player Notes tab guarded on `crm.notes:create`, a CRM permission that
 *     the admin catalogue has never contained, so its Add Note button was
 *     invisible to every admin;
 *   - global search guarded Bonuses on `marketing.bonuses` and Referrals on
 *     `marketing.referrals`, neither of which exists — the real ones are
 *     `bonuses.list` and `referrals.overview`.
 *
 * The test reads the admin source rather than importing it, because the point
 * is to check the strings people actually typed.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const REPO = join(here, '..', '..', '..', '..')
const ADMIN_SRC = join(REPO, 'admin', 'src')

/** Every `domain: 'x'` and `domain="x"` written in the admin panel. */
function domainsUsedInAdmin(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  const pattern = /domain\s*[:=]\s*["']([a-z][a-z0-9._-]*)["']/g

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry)
      if (statSync(p).isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue
        // admin/src/test holds the preview harnesses (*-preview.tsx): fixture data, never shipped,
        // like test files below — a whitelabel's web domain there ('preview.local') is not a guard.
        if (p === join(ADMIN_SRC, 'test')) continue
        walk(p)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue
      // Test files guard nothing and never ship, and their fixtures legitimately carry `domain`
      // fields that are not permissions — a whitelabel's web domain such as 'royal.example', for
      // one. Scanning them made this test fail on fixture data rather than on a real guard.
      // scripts/verifyGraphqlSurface.ts skips test files by the same rule.
      if (/\.test\.tsx?$/.test(entry)) continue
      const text = readFileSync(p, 'utf8')
      for (const m of text.matchAll(pattern)) {
        const rel = p.slice(REPO.length + 1).replace(/\\/g, '/')
        const list = found.get(m[1]) ?? []
        if (!list.includes(rel)) list.push(rel)
        found.set(m[1], list)
      }
    }
  }
  walk(ADMIN_SRC)
  return found
}

/** Everything either catalogue declares: the nested one and the legacy flat seed. */
function domainsDeclared(): Set<string> {
  const out = new Set<string>()
  const pattern = /domain:\s*'([a-z][a-z0-9._-]*)'/g
  for (const rel of [
    'admin-backend/src/config/nestedPermissions.ts',
    'admin-backend/src/repos/rbac/rbacRepo.ts',
  ]) {
    const p = join(REPO, rel)
    assert.ok(existsSync(p), `expected ${rel} to exist — this test is out of date`)
    for (const m of readFileSync(p, 'utf8').matchAll(pattern)) out.add(m[1])
  }
  return out
}

/**
 * Strings that look like a permission domain but are not one.
 *
 * Kept explicit and small. A broad allow-list here would let the next real typo
 * through, which is the only thing this test exists to catch.
 */
const NOT_PERMISSIONS = new Set([
  // Audit events carry a `domain` field that names the area, not a permission.
  'crm',
  'crm.rg',
  'crm.consent',
  'crm.settings',
  'users.security',
  'players',
  // GraphQL/domain filter values used in reporting and bet screens.
  'sports',
  'casino',
  'matka',
  // A bonus's scope value: 'global' means every domain (bonusEditModel), not a permission.
  'global',
  // The audit table's column map names its 'domain' column (AuditTable fields).
  'domain',
])

describe('every permission the admin panel guards on exists', () => {
  it('finds no domain that no catalogue declares', () => {
    const used = domainsUsedInAdmin()
    const declared = domainsDeclared()

    const dangling: string[] = []
    for (const [domain, files] of used) {
      if (declared.has(domain) || NOT_PERMISSIONS.has(domain)) continue
      dangling.push(`${domain}  (${files.slice(0, 3).join(', ')})`)
    }

    assert.deepEqual(
      dangling,
      [],
      'a guard on a permission nothing declares fails closed silently — ' +
        'the element disappears for everyone but an all:* holder'
    )
  })

  it('is actually looking at something', () => {
    // A regex that matched nothing would make the test above pass forever.
    const used = domainsUsedInAdmin()
    assert.ok(used.size > 50, `expected to find many guarded domains, found ${used.size}`)
    assert.ok(domainsDeclared().size > 50, 'expected a populated catalogue')
  })

  it('resolves the two that were broken', () => {
    // Named rather than left to the sweep, because these are the ones that
    // regress if someone re-types them.
    const declared = domainsDeclared()
    for (const d of ['bonuses.list', 'referrals.overview', 'players.notes']) {
      assert.ok(declared.has(d), `${d} should be a declared permission`)
    }
    assert.equal(declared.has('marketing.bonuses'), false, 'this never existed')
    assert.equal(declared.has('marketing.referrals'), false, 'nor this')
  })
})
